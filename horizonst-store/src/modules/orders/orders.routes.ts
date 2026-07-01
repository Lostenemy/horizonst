import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { pool as defaultPool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { orderItemColumns, publicOrderColumns } from './order.service.js';

type QueryResult = { rows: any[] };
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<QueryResult> };

export type OrdersRouterDependencies = { pool?: Queryable; authMiddleware?: RequestHandler; roleMiddleware?: RequestHandler };

const idSchema = z.string().uuid();
const listColumns = `o.id, o.order_number, o.status, o.subtotal_cents, o.discount_cents, o.tax_cents, o.total_cents, o.created_at, o.quote_id, q.quote_number`;

export const createOrdersRouter = (dependencies: OrdersRouterDependencies = {}) => {
  const router = Router();
  const ordersPool = dependencies.pool ?? defaultPool;
  router.use(dependencies.authMiddleware ?? requireAuth, dependencies.roleMiddleware ?? requireRole('customer', 'distributor'));

  router.get('/', async (req, res, next) => {
    try {
      const { rows } = await ordersPool.query(`SELECT ${listColumns} FROM store.orders o JOIN store.quotes q ON q.id = o.quote_id WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 200`, [req.user!.sub]);
      res.json({ orders: rows });
    } catch (error) { next(error); }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const id = idSchema.parse(req.params.id);
      const order = await ordersPool.query(`SELECT ${publicOrderColumns}, q.quote_number FROM store.orders o JOIN store.quotes q ON q.id = o.quote_id WHERE o.id = $1 AND o.user_id = $2`, [id, req.user!.sub]);
      if (!order.rows[0]) { res.status(404).json({ error: 'Order not found' }); return; }
      const items = await ordersPool.query(`SELECT ${orderItemColumns} FROM store.order_items WHERE order_id = $1 ORDER BY description ASC`, [id]);
      res.json({ order: order.rows[0], items: items.rows });
    } catch (error) { next(error); }
  });

  return router;
};

export const ordersRouter = createOrdersRouter();
