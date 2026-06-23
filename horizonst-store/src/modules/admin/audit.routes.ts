import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

export const adminAuditRouter = Router();
adminAuditRouter.use(requireAuth, requireRole('admin'));

const auditQuerySchema = z.object({
  action: z.string().trim().optional(),
  entity_type: z.string().trim().optional(),
  actor_user_id: z.string().uuid().optional(),
  entity_id: z.string().uuid().optional(),
  date_from: z.string().datetime().or(z.string().date()).optional(),
  date_to: z.string().datetime().or(z.string().date()).optional(),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

const exactFilters = [
  ['action', 'a.action'],
  ['entity_type', 'a.entity_type'],
  ['actor_user_id', 'a.actor_user_id'],
  ['entity_id', 'a.entity_id']
] as const;

adminAuditRouter.get('/audit', async (req, res, next) => {
  try {
    const query = auditQuerySchema.parse(req.query);
    const params: unknown[] = [];
    const where: string[] = [];

    for (const [key, column] of exactFilters) {
      const value = query[key];
      if (value) {
        params.push(value);
        where.push(`${column} = $${params.length}`);
      }
    }

    if (query.date_from) {
      params.push(query.date_from);
      where.push(`a.created_at >= $${params.length}`);
    }

    if (query.date_to) {
      params.push(query.date_to);
      where.push(`a.created_at <= $${params.length}`);
    }

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`(a.action ILIKE $${params.length} OR a.entity_type ILIKE $${params.length} OR a.payload::text ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
    }

    params.push(query.limit);
    const { rows } = await pool.query(
      `SELECT a.id, a.actor_user_id, a.action, a.entity_type, a.entity_id, a.payload, a.created_at,
        u.email AS actor_email, u.full_name AS actor_full_name
       FROM store.audit_log a
       LEFT JOIN store.users u ON u.id = a.actor_user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.created_at DESC
       LIMIT $${params.length}`,
      params
    );

    res.json({ events: rows });
  } catch (error) {
    next(error);
  }
});
