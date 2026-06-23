import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { writeAuditLog } from '../shared/audit.js';

export const adminCatalogRouter = Router();
adminCatalogRouter.use(requireAuth, requireRole('admin'));

const idSchema = z.string().uuid();

const productSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  category: z.enum(['hardware', 'accessory']),
  price_cents: z.number().int().min(0),
  tax_rate: z.number().min(0).max(100).optional(),
  is_active: z.boolean().optional()
}).strict();

const productPatchSchema = productSchema.partial();

const planSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  annual_price_cents: z.number().int().min(0).nullable().optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  max_tags: z.number().int().min(0).nullable().optional(),
  max_gateways: z.number().int().min(0).nullable().optional(),
  is_enterprise: z.boolean().default(false),
  is_active: z.boolean().optional()
}).strict()
  .refine((value) => value.is_enterprise || value.annual_price_cents != null, { message: 'annual_price_cents is required unless is_enterprise=true' })
  .refine((value) => !value.is_enterprise || value.annual_price_cents == null, { message: 'Enterprise plans must not have annual_price_cents' });

const planPatchSchema = planSchema.partial()
  .refine((value) => value.is_enterprise !== true || value.annual_price_cents == null, { message: 'Enterprise plans must not have annual_price_cents' });

const buildPatch = (input: Record<string, unknown>, startIndex = 2) => {
  const sets: string[] = [];
  const values: unknown[] = [];

  Object.entries(input).forEach(([key, value], index) => {
    sets.push(`${key} = $${startIndex + index}`);
    values.push(value);
  });

  return { sets, values };
};

adminCatalogRouter.get('/products', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM store.products ORDER BY created_at DESC');
    res.json({ products: rows });
  } catch (error) {
    next(error);
  }
});

adminCatalogRouter.get('/products/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { rows } = await pool.query('SELECT * FROM store.products WHERE id = $1', [id]);
    if (!rows[0]) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ product: rows[0] });
  } catch (error) {
    next(error);
  }
});

adminCatalogRouter.post('/products', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = productSchema.parse(req.body);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO store.products (sku, name, description, category, price_cents, tax_rate, is_active)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 21), COALESCE($7, true))
       RETURNING *`,
      [input.sku, input.name, input.description ?? null, input.category, input.price_cents, input.tax_rate ?? null, input.is_active ?? null]
    );
    await writeAuditLog({ actorUserId: req.user!.sub, action: 'product_created', entityType: 'product', entityId: rows[0].id, payload: input }, client);
    await client.query('COMMIT');
    res.status(201).json({ product: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

adminCatalogRouter.patch('/products/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = idSchema.parse(req.params.id);
    const input = productPatchSchema.parse(req.body);
    const patch = buildPatch(input);

    if (!patch.sets.length) {
      res.status(400).json({ error: 'No changes provided' });
      return;
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE store.products SET ${patch.sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...patch.values]
    );

    if (!rows[0]) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    await writeAuditLog({ actorUserId: req.user!.sub, action: input.is_active === false ? 'product_deactivated' : 'product_updated', entityType: 'product', entityId: id, payload: input }, client);
    await client.query('COMMIT');
    res.json({ product: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

adminCatalogRouter.get('/saas-plans', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM store.saas_plans ORDER BY is_enterprise ASC, annual_price_cents ASC NULLS LAST');
    res.json({ saasPlans: rows });
  } catch (error) {
    next(error);
  }
});

adminCatalogRouter.get('/saas-plans/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { rows } = await pool.query('SELECT * FROM store.saas_plans WHERE id = $1', [id]);
    if (!rows[0]) {
      res.status(404).json({ error: 'SaaS plan not found' });
      return;
    }
    res.json({ saasPlan: rows[0] });
  } catch (error) {
    next(error);
  }
});

adminCatalogRouter.post('/saas-plans', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = planSchema.parse(req.body);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO store.saas_plans (code, name, description, annual_price_cents, tax_rate, max_tags, max_gateways, is_enterprise, is_active)
       VALUES ($1, $2, $3, $4, COALESCE($5, 21), $6, $7, $8, COALESCE($9, true))
       RETURNING *`,
      [input.code, input.name, input.description ?? null, input.is_enterprise ? null : input.annual_price_cents ?? null, input.tax_rate ?? null, input.max_tags ?? null, input.max_gateways ?? null, input.is_enterprise, input.is_active ?? null]
    );
    await writeAuditLog({ actorUserId: req.user!.sub, action: 'saas_plan_created', entityType: 'saas_plan', entityId: rows[0].id, payload: input }, client);
    await client.query('COMMIT');
    res.status(201).json({ saasPlan: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

adminCatalogRouter.patch('/saas-plans/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = idSchema.parse(req.params.id);
    const input = planPatchSchema.parse(req.body);
    const normalizedInput = input.is_enterprise ? { ...input, annual_price_cents: null } : input;
    const patch = buildPatch(normalizedInput);

    if (!patch.sets.length) {
      res.status(400).json({ error: 'No changes provided' });
      return;
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE store.saas_plans SET ${patch.sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...patch.values]
    );

    if (!rows[0]) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'SaaS plan not found' });
      return;
    }

    if (!rows[0].is_enterprise && rows[0].annual_price_cents == null) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'annual_price_cents is required unless is_enterprise=true' });
      return;
    }

    await writeAuditLog({ actorUserId: req.user!.sub, action: normalizedInput.is_active === false ? 'saas_plan_deactivated' : 'saas_plan_updated', entityType: 'saas_plan', entityId: id, payload: normalizedInput }, client);
    await client.query('COMMIT');
    res.json({ saasPlan: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});
