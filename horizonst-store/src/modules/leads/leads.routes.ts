import { Router } from 'express';
import { z } from 'zod';
import { pool as defaultPool } from '../../db/pool.js';
import { sendAppccGuideEmail } from '../shared/mail.js';

type QueryResult = { rows: any[] };
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<QueryResult> };

export type LeadsRouterDependencies = { pool?: Queryable; sendGuideEmail?: (email: string) => Promise<void>; now?: () => number };

export const leadSchema = z.object({
  source: z.enum(['demo', 'appcc_guide']),
  fullName: z.string().trim().min(2).max(200).optional(),
  companyName: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(60).optional(),
  message: z.string().trim().max(2000).optional(),
  interest: z.string().trim().max(200).optional(),
  privacyAccepted: z.literal(true),
  website: z.string().max(200).optional()
}).strict().superRefine((input, ctx) => {
  if (input.source === 'demo' && !input.fullName?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fullName'], message: 'Name is required for demo leads' });
});

export const createLeadsRouter = (dependencies: LeadsRouterDependencies = {}) => {
  const router = Router();
  const leadPool = dependencies.pool ?? defaultPool;
  const sendGuideEmail = dependencies.sendGuideEmail ?? ((email: string) => sendAppccGuideEmail({ email }));
  const attempts = new Map<string, number[]>();
  const now = dependencies.now ?? Date.now;

  router.post('/', async (req, res, next) => {
    try {
      const input = leadSchema.parse(req.body ?? {});
      const email = input.email.trim().toLowerCase();
      if (input.website) return res.status(201).json({ ok: true });
      const key = `${req.ip}:${email}`;
      const current = now();
      const recent = (attempts.get(key) ?? []).filter((time) => current - time < 60 * 60 * 1000);
      if (recent.length >= 3) return res.status(429).json({ error: 'Too many requests' });
      attempts.set(key, [...recent, current]);
      const { rows } = await leadPool.query(
        `INSERT INTO store.leads (source, full_name, company_name, email, phone, message, interest, privacy_accepted, privacy_accepted_at)
         VALUES ($1, $2, NULLIF($3, ''), $4, NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), $8, now())
         RETURNING id, source, status, created_at`,
        [input.source, input.fullName ?? '', input.companyName ?? '', email, input.phone ?? '', input.message ?? '', input.interest ?? '', input.privacyAccepted]
      );
      if (input.source === 'appcc_guide') {
        try {
          await sendGuideEmail(email);
        } catch (mailError) {
          console.error('APPCC guide email failed', mailError instanceof Error ? mailError.message : 'unknown error');
          return res.status(503).json({ error: 'Guide delivery temporarily unavailable' });
        }
      }
      res.status(201).json({ lead: rows[0] });
    } catch (error) { next(error); }
  });

  return router;
};

export const leadsRouter = createLeadsRouter();
