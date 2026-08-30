import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { pool as defaultPool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { orderItemColumns, publicOrderColumns } from './order.service.js';
import { generateDeliveryNotePdf as defaultGenerateDeliveryNotePdf } from './pdf.js';
import { commercialDocumentFilename } from '../shared/commercial-document-pdf.js';

type QueryResult = { rows: any[] };
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<QueryResult> };

export type OrdersRouterDependencies = { pool?: Queryable; authMiddleware?: RequestHandler; roleMiddleware?: RequestHandler; generateDeliveryNotePdf?: typeof defaultGenerateDeliveryNotePdf };

const idSchema = z.string().uuid();
const listColumns = `o.id, o.order_number, o.status, o.subtotal_cents, o.discount_cents, o.tax_cents, o.total_cents, o.created_at, o.quote_id, q.quote_number`;
const orderPdfSelect = `SELECT o.order_number, o.created_at, o.status, o.subtotal_cents, o.discount_cents, o.tax_cents, o.total_cents, o.customer_notes,
  q.quote_number, u.email, u.full_name, COALESCE(cp.company_name, dp.company_name) AS company_name,
  COALESCE(cp.tax_id, dp.tax_id) AS customer_tax_id, COALESCE(cp.billing_address, dp.billing_address) AS customer_billing_address,
  COALESCE(cp.city, dp.city) AS customer_city, COALESCE(cp.province, dp.province) AS customer_province,
  COALESCE(cp.postal_code, dp.postal_code) AS customer_postal_code, COALESCE(cp.country, dp.country) AS customer_country
  FROM store.orders o JOIN store.quotes q ON q.id = o.quote_id JOIN store.users u ON u.id = o.user_id
  LEFT JOIN store.customer_profiles cp ON cp.user_id = u.id LEFT JOIN store.distributor_profiles dp ON dp.user_id = u.id WHERE o.id = $1`;

export const createOrdersRouter = (dependencies: OrdersRouterDependencies = {}) => {
  const router = Router();
  const ordersPool = dependencies.pool ?? defaultPool;
  const generateDeliveryNotePdf = dependencies.generateDeliveryNotePdf ?? defaultGenerateDeliveryNotePdf;
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

  router.get('/:id/pdf', async (req, res, next) => {
    try {
      const id = idSchema.parse(req.params.id);
      const order = await ordersPool.query(`${orderPdfSelect} AND o.user_id = $2`, [id, req.user!.sub]);
      if (!order.rows[0]) { res.status(404).json({ error: 'Order not found' }); return; }
      const items = await ordersPool.query(`SELECT ${orderItemColumns} FROM store.order_items WHERE order_id = $1 ORDER BY description ASC`, [id]);
      const pdf = await generateDeliveryNotePdf({ order: order.rows[0], items: items.rows });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${commercialDocumentFilename('delivery_note', order.rows[0].order_number)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Length', pdf.length.toString());
      res.send(pdf);
    } catch (error) { next(error); }
  });

  return router;
};

export const ordersRouter = createOrdersRouter();
export const orderPdfSelectForAdmin = orderPdfSelect;
