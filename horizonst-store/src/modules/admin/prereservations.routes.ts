import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { pool as defaultPool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { prereservationCodeSchema } from '../prereservation/prereservation.service.js';

type QueryResult = { rows: any[] };
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<QueryResult> };
export type AdminPrereservationsRouterDependencies = { pool?: Queryable; authMiddleware?: RequestHandler; roleMiddleware?: RequestHandler };

const idSchema = z.string().uuid();
const filtersSchema = z.object({
  email: z.string().trim().max(320).optional(),
  offer: prereservationCodeSchema.optional(),
  status: z.enum(['pending', 'confirmed']).optional(),
  date_from: z.string().date().optional(),
  date_to: z.string().date().optional()
}).strict();

const publicColumns = `p.id, p.email, p.offer_code, p.campaign_code, p.created_at, p.last_interest_at,
  p.confirmed_at, p.lead_id, p.confirmation_email_sent_at, p.confirmation_email_last_error_at,
  p.confirmation_email_attempts, p.commercial_email_sent_at, p.commercial_email_last_error_at,
  p.commercial_email_attempts,
  CASE WHEN p.confirmed_at IS NULL THEN 'pending' ELSE 'confirmed' END AS status,
  CASE WHEN p.confirmation_email_sent_at IS NOT NULL THEN 'sent'
       WHEN p.confirmation_email_last_error_at IS NOT NULL THEN 'failed' ELSE 'pending' END AS confirmation_email_status`;

export const createAdminPrereservationsRouter = (dependencies: AdminPrereservationsRouterDependencies = {}) => {
  const router = Router();
  const pool = dependencies.pool ?? defaultPool;
  router.use(dependencies.authMiddleware ?? requireAuth, dependencies.roleMiddleware ?? requireRole('admin'));

  router.get('/prereservations', async (req, res, next) => {
    try {
      const query = filtersSchema.parse(req.query);
      const params: unknown[] = [];
      const where: string[] = [];
      if (query.email) { params.push(`%${query.email}%`); where.push(`p.email ILIKE $${params.length}`); }
      if (query.offer) { params.push(query.offer); where.push(`p.offer_code = $${params.length}`); }
      if (query.status === 'pending') where.push('p.confirmed_at IS NULL');
      if (query.status === 'confirmed') where.push('p.confirmed_at IS NOT NULL');
      if (query.date_from) { params.push(query.date_from); where.push(`p.created_at >= $${params.length}::date`); }
      if (query.date_to) { params.push(query.date_to); where.push(`p.created_at < ($${params.length}::date + interval '1 day')`); }
      const { rows } = await pool.query(
        `SELECT ${publicColumns} FROM store.public_prereservations p
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY p.last_interest_at DESC, p.created_at DESC LIMIT 200`,
        params
      );
      res.json({ prereservations: rows });
    } catch (error) { next(error); }
  });

  router.get('/prereservations/:id', async (req, res, next) => {
    try {
      const id = idSchema.parse(req.params.id);
      const { rows } = await pool.query(
        `SELECT ${publicColumns} FROM store.public_prereservations p WHERE p.id = $1`,
        [id]
      );
      if (!rows[0]) { res.status(404).json({ error: 'Prereservation not found' }); return; }
      res.json({ prereservation: rows[0] });
    } catch (error) { next(error); }
  });

  return router;
};

export const adminPrereservationsRouter = createAdminPrereservationsRouter();
