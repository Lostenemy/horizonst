import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { pool as defaultPool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { orderItemColumns, orderStatuses, publicOrderColumns } from '../orders/order.service.js';

type QueryResult = { rows: any[] };
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<QueryResult> };

export type AdminOrdersRouterDependencies = { pool?: Queryable; authMiddleware?: RequestHandler; roleMiddleware?: RequestHandler };

const idSchema = z.string().uuid();
const filtersSchema = z.object({
  status: z.enum(orderStatuses).optional(),
  email: z.string().trim().max(320).optional(),
  order_number: z.string().trim().max(100).optional(),
  quote_number: z.string().trim().max(100).optional()
}).strict();

export const createAdminOrdersRouter = (dependencies: AdminOrdersRouterDependencies = {}) => {
const router = Router();
const pool = dependencies.pool ?? defaultPool;
router.use(dependencies.authMiddleware ?? requireAuth, dependencies.roleMiddleware ?? requireRole('admin'));

router.get('/orders', async (req, res, next) => {
  try {
    const query = filtersSchema.parse(req.query);
    const params: unknown[] = []; const where: string[] = [];
    if (query.status) { params.push(query.status); where.push(`o.status = $${params.length}`); }
    if (query.email) { params.push(`%${query.email}%`); where.push(`u.email ILIKE $${params.length}`); }
    if (query.order_number) { params.push(`%${query.order_number}%`); where.push(`o.order_number ILIKE $${params.length}`); }
    if (query.quote_number) { params.push(`%${query.quote_number}%`); where.push(`q.quote_number ILIKE $${params.length}`); }
    const { rows } = await pool.query(`SELECT o.id, o.order_number, o.status, o.subtotal_cents, o.discount_cents, o.tax_cents, o.total_cents, o.created_at, o.updated_at, u.id AS user_id, u.email, u.full_name, u.role, q.id AS quote_id, q.quote_number FROM store.orders o JOIN store.users u ON u.id = o.user_id JOIN store.quotes q ON q.id = o.quote_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY o.created_at DESC LIMIT 200`, params);
    res.json({ orders: rows });
  } catch (error) { next(error); }
});

router.get('/orders/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const order = await pool.query(`SELECT ${publicOrderColumns}, q.quote_number, u.email, u.full_name, u.role FROM store.orders o JOIN store.quotes q ON q.id = o.quote_id JOIN store.users u ON u.id = o.user_id WHERE o.id = $1`, [id]);
    if (!order.rows[0]) { res.status(404).json({ error: 'Order not found' }); return; }
    const items = await pool.query(`SELECT ${orderItemColumns} FROM store.order_items WHERE order_id = $1 ORDER BY description ASC`, [id]);
    res.json({ order: order.rows[0], items: items.rows });
  } catch (error) { next(error); }
});

return router;
};

export const adminOrdersRouter = createAdminOrdersRouter();
