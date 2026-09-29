import { createHmac } from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { createAuthRateLimit } from '../auth/rate-limit.js';
import { sendPublicContactEmail } from '../shared/mail.js';

const noHeaderControls = (value: string) => !/[\r\n\u0000]/.test(value);
export const contactSchema = z.object({
  fullName: z.string().refine(noHeaderControls).pipe(z.string().trim().min(2).max(200)),
  email: z.string().refine(noHeaderControls).pipe(z.string().trim().email().max(320)),
  message: z.string().trim().min(10).max(2000).refine((value) => !value.includes('\u0000')),
  privacyAccepted: z.literal(true),
  website: z.string().max(200).optional()
}).strict();
export type ContactInput = { fullName: string; email: string; message: string; privacyAccepted: true; website?: string };
type Store = { query: (sql: string, values?: any[]) => Promise<any> };

export function createContactRouter(dependencies: { store?: Store; deliver?: (input: ContactInput) => Promise<void>; enabled?: () => boolean } = {}) {
  const router = Router();
  const store = dependencies.store ?? pool;
  const deliver = dependencies.deliver ?? sendPublicContactEmail;
  const enabled = dependencies.enabled ?? (() => env.mail.enabled);
  router.use(express.json({ limit: '12kb' }));
  router.use(createAuthRateLimit(store, { paths: ['/'], group: 'public-contact', source: 5, account: 3, pair: 3,
    windowSeconds: 3600, unavailableError: 'contact_temporarily_unavailable' }));
  router.post('/', async (req, res) => {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_contact', fields: [...new Set(parsed.error.issues.map((issue) => issue.path[0]))] });
    const input = { ...parsed.data, email: parsed.data.email.toLowerCase() };
    if (input.website) return res.status(400).json({ error: 'invalid_contact' });
    if (!enabled()) return res.status(503).json({ error: 'contact_temporarily_unavailable' });
    // El registro comparte la primitiva atómica existente, con namespace HMAC separado.
    // attempts=1: envío en curso/resultado incierto; 2: SMTP aceptó; 3: fallo de envío.
    const key = createHmac('sha256', env.auth.jwtSecret).update('contact-delivery:' + JSON.stringify([input.fullName, input.email, input.message])).digest('hex');
    let smtpAccepted = false;
    let ownsClaim = false;
    try {
      const claimed = await store.query(`INSERT INTO store.auth_rate_limits AS delivery (bucket_key, attempts, expires_at)
        VALUES ($1, 1, clock_timestamp() + interval '15 minutes')
        ON CONFLICT (bucket_key) DO UPDATE SET attempts = 1, expires_at = EXCLUDED.expires_at
        WHERE delivery.expires_at <= clock_timestamp() RETURNING attempts`, [key]);
      if (!claimed.rows.length) {
        const previous = await store.query('SELECT attempts FROM store.auth_rate_limits WHERE bucket_key = $1', [key]);
        if (previous.rows[0]?.attempts === 2) return res.json({ ok: true, duplicate: true });
        if (previous.rows[0]?.attempts === 3) return res.status(503).json({ error: 'contact_temporarily_unavailable' });
        res.setHeader('Retry-After', '30');
        return res.status(409).json({ error: 'contact_delivery_pending' });
      }
      ownsClaim = true;
      await deliver(input);
      smtpAccepted = true;
      const saved = await store.query('UPDATE store.auth_rate_limits SET attempts = 2 WHERE bucket_key = $1 AND attempts = 1 RETURNING attempts', [key]);
      if (!saved.rows.length) throw new Error('contact_result_unavailable');
      return res.json({ ok: true });
    } catch {
      // No imprimir ni propagar mensajes SMTP, payloads, email, IP o credenciales.
      if (ownsClaim && !smtpAccepted) {
        try { await store.query('UPDATE store.auth_rate_limits SET attempts = 3 WHERE bucket_key = $1 AND attempts = 1', [key]); } catch {}
      }
      return res.status(503).json({ error: 'contact_temporarily_unavailable' });
    }
  });
  router.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error?.type === 'entity.too.large' ? 413 : 400).json({ error: 'invalid_contact_body' });
  });
  return router;
}
export const contactRouter = createContactRouter();
