import { Router } from 'express';
import { pool } from '../../db/pool.js';

export const catalogRouter = Router();

catalogRouter.get('/products', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
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
    const { rows } = await pool.query(
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
