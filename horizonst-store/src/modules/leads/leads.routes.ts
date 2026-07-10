import { Router } from 'express';
import { z } from 'zod';
import { pool as defaultPool } from '../../db/pool.js';

type QueryResult = { rows: any[] };
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<QueryResult> };

export type LeadsRouterDependencies = { pool?: Queryable };

export const leadSchema = z.object({
  source: z.enum(['demo', 'appcc_guide']),
  fullName: z.string().trim().min(2).max(200),
  companyName: z.string().trim().max(200).optional(),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(60).optional(),
  message: z.string().trim().max(2000).optional(),
  interest: z.string().trim().max(200).optional()
}).strict().superRefine((input, ctx) => {
  if (input.source !== 'appcc_guide') return;
  if (!input.companyName?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['companyName'], message: 'Company is required for APPCC guide leads' });
  if (!input.phone?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['phone'], message: 'Phone is required for APPCC guide leads' });
});

export const createLeadsRouter = (dependencies: LeadsRouterDependencies = {}) => {
  const router = Router();
  const leadPool = dependencies.pool ?? defaultPool;

  router.post('/', async (req, res, next) => {
    try {
      const input = leadSchema.parse(req.body ?? {});
      const { rows } = await leadPool.query(
        `INSERT INTO store.leads (source, full_name, company_name, email, phone, message, interest)
         VALUES ($1, $2, NULLIF($3, ''), $4, NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''))
         RETURNING id, source, status, created_at`,
        [input.source, input.fullName, input.companyName ?? '', input.email, input.phone ?? '', input.message ?? '', input.interest ?? '']
      );
      res.status(201).json({ lead: rows[0] });
    } catch (error) { next(error); }
  });

  return router;
};

export const leadsRouter = createLeadsRouter();
