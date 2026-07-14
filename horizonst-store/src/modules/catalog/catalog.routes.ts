import type { RequestHandler } from 'express';
import { Router } from 'express';
import { pool as defaultPool } from '../../db/pool.js';
import { requireAuth } from '../auth/middleware.js';

type QueryResult = { rows: any[] };
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<QueryResult> };

export type CatalogRouterDependencies = { pool?: Queryable; authMiddleware?: RequestHandler };

export const createCatalogRouter = (dependencies: CatalogRouterDependencies = {}) => {
const catalogRouter = Router();
const catalogPool = dependencies.pool ?? defaultPool;

catalogRouter.get('/products', async (_req, res, next) => {
  try {
    const { rows } = await catalogPool.query(
      `SELECT id, sku, name, description, category, price_cents, tax_rate, is_active
       FROM store.products
       WHERE is_active = true
       ORDER BY name ASC`
    );
    res.json({ products: rows });
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/saas-plans', async (_req, res, next) => {
  try {
    const { rows } = await catalogPool.query(
      `SELECT id, code, name, description, annual_price_cents, tax_rate, max_tags, max_gateways, is_enterprise, is_active
       FROM store.saas_plans
       WHERE is_active = true
       ORDER BY is_enterprise ASC, annual_price_cents ASC NULLS LAST`
    );
    res.json({ saasPlans: rows });
  } catch (error) {
    next(error);
  }
});

catalogRouter.get('/packs', dependencies.authMiddleware ?? requireAuth, async (_req, res, next) => {
  try {
    const { rows } = await catalogPool.query(
      `SELECT p.id, p.code, p.name, p.description, p.price_cents, p.tax_rate, p.is_active, p.presentation_order,
              COALESCE(json_agg(json_build_object('product_id', product.id, 'name', product.name, 'quantity', pi.quantity, 'presentation_order', pi.presentation_order) ORDER BY pi.presentation_order) FILTER (WHERE pi.id IS NOT NULL), '[]'::json) AS items
       FROM store.packs p
       LEFT JOIN store.pack_items pi ON pi.pack_id = p.id
       LEFT JOIN store.products product ON product.id = pi.product_id
       WHERE p.is_active = true
       GROUP BY p.id
       ORDER BY p.presentation_order ASC, p.name ASC`
    );
    res.json({ packs: rows });
  } catch (error) {
    next(error);
  }
});

return catalogRouter;
};

export const catalogRouter = createCatalogRouter();
