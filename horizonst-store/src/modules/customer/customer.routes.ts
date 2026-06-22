import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

export const customerRouter = Router();
customerRouter.use(requireAuth, requireRole('customer', 'distributor', 'admin'));

const profileFields = `u.id, u.email, u.full_name, u.phone, u.role, u.status,
  cp.company_name, cp.tax_id, cp.billing_address, cp.city, cp.province, cp.postal_code, cp.country`;

customerRouter.get('/profile', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT ${profileFields} FROM store.users u LEFT JOIN store.customer_profiles cp ON cp.user_id = u.id WHERE u.id = $1`, [req.user!.sub]);
    res.json({ profile: rows[0] });
  } catch (error) { next(error); }
});

const updateSchema = z.object({
  fullName: z.string().min(2).max(200).optional(), phone: z.string().max(50).nullable().optional(),
  companyName: z.string().max(200).nullable().optional(), taxId: z.string().max(80).nullable().optional(),
  billingAddress: z.string().max(500).nullable().optional(), city: z.string().max(120).nullable().optional(),
  province: z.string().max(120).nullable().optional(), postalCode: z.string().max(30).nullable().optional(), country: z.string().max(2).nullable().optional()
});

customerRouter.patch('/profile', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = updateSchema.parse(req.body);
    await client.query('BEGIN');
    await client.query('UPDATE store.users SET full_name = COALESCE($2, full_name), phone = $3, updated_at = now() WHERE id = $1', [req.user!.sub, input.fullName ?? null, input.phone ?? null]);
    await client.query(`INSERT INTO store.customer_profiles (user_id, company_name, tax_id, billing_address, city, province, postal_code, country)
      VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'ES'))
      ON CONFLICT (user_id) DO UPDATE SET company_name=$2,tax_id=$3,billing_address=$4,city=$5,province=$6,postal_code=$7,country=COALESCE($8, store.customer_profiles.country),updated_at=now()`,
      [req.user!.sub, input.companyName ?? null, input.taxId ?? null, input.billingAddress ?? null, input.city ?? null, input.province ?? null, input.postalCode ?? null, input.country ?? null]);
    const { rows } = await client.query(`SELECT ${profileFields} FROM store.users u LEFT JOIN store.customer_profiles cp ON cp.user_id = u.id WHERE u.id = $1`, [req.user!.sub]);
    await client.query('COMMIT'); res.json({ profile: rows[0] });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});
