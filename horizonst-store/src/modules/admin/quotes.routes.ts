import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { writeAuditLog } from '../shared/audit.js';

export const adminQuotesRouter = Router();
adminQuotesRouter.use(requireAuth, requireRole('admin'));

const quoteStatuses = ['draft', 'submitted', 'in_review', 'sent', 'accepted', 'rejected', 'cancelled'] as const;
const adminStatuses = ['in_review', 'sent', 'accepted', 'rejected', 'cancelled'] as const;
const idSchema = z.string().uuid();
const statusSchema = z.object({ status: z.enum(adminStatuses), internal_notes: z.string().trim().max(5000).optional() }).strict();

adminQuotesRouter.get('/quotes', async (req, res, next) => {
  try {
    const query = z.object({ status: z.enum(quoteStatuses).optional(), email: z.string().optional(), quote_number: z.string().optional() }).parse(req.query);
    const params: unknown[] = []; const where: string[] = [];
    if (query.status) { params.push(query.status); where.push(`q.status = $${params.length}`); }
    if (query.email) { params.push(`%${query.email}%`); where.push(`u.email ILIKE $${params.length}`); }
    if (query.quote_number) { params.push(`%${query.quote_number}%`); where.push(`q.quote_number ILIKE $${params.length}`); }
    const { rows } = await pool.query(`SELECT q.id, q.quote_number, q.status, q.subtotal_cents, q.discount_cents, q.tax_cents, q.total_cents, q.created_at, q.updated_at, q.submitted_at, u.id AS user_id, u.email, u.full_name, u.role FROM store.quotes q JOIN store.users u ON u.id = q.user_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY q.created_at DESC LIMIT 200`, params);
    res.json({ quotes: rows });
  } catch (error) { next(error); }
});

adminQuotesRouter.get('/quotes/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const quote = await pool.query(`SELECT q.*, u.email, u.full_name, u.role FROM store.quotes q JOIN store.users u ON u.id = q.user_id WHERE q.id = $1`, [id]);
    if (!quote.rows[0]) { res.status(404).json({ error: 'Quote not found' }); return; }
    const items = await pool.query(`SELECT id, item_type, product_id, saas_plan_id, description, quantity, unit_price_cents, discount_percent, tax_rate, line_subtotal_cents, line_discount_cents, line_tax_cents, line_total_cents FROM store.quote_items WHERE quote_id = $1 ORDER BY description ASC`, [id]);
    res.json({ quote: quote.rows[0], items: items.rows });
  } catch (error) { next(error); }
});

adminQuotesRouter.patch('/quotes/:id/status', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = idSchema.parse(req.params.id); const input = statusSchema.parse(req.body);
    await client.query('BEGIN');
    const existing = await client.query('SELECT id, status FROM store.quotes WHERE id = $1', [id]);
    if (!existing.rows[0]) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Quote not found' }); return; }
    if (existing.rows[0].status === 'draft') { await client.query('ROLLBACK'); res.status(409).json({ error: 'Draft quotes cannot be modified from admin' }); return; }
    const { rows } = await client.query(`UPDATE store.quotes SET status = $2, internal_notes = COALESCE($3, internal_notes), reviewed_at = now(), reviewed_by = $4, updated_at = now() WHERE id = $1 RETURNING *`, [id, input.status, input.internal_notes ?? null, req.user!.sub]);
    await writeAuditLog({ actorUserId: req.user!.sub, action: 'quote_status_changed', entityType: 'quote', entityId: id, payload: { previous_status: existing.rows[0].status, status: input.status } }, client);
    await client.query('COMMIT'); res.json({ quote: rows[0] });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});
