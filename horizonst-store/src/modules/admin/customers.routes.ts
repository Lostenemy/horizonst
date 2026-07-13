import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { writeAuditLog } from '../shared/audit.js';

const customerStatuses = ['pending_email_verification', 'active', 'suspended', 'closed'] as const;
const mutableStatuses = ['active', 'suspended', 'closed'] as const;
const idSchema = z.string().uuid();
const listSchema = z.object({
  status: z.enum(customerStatuses).optional(),
  email: z.string().trim().min(1).max(320).optional(),
  full_name: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
}).strict();
const statusSchema = z.object({ status: z.enum(mutableStatuses) }).strict();

const transitions: Record<(typeof customerStatuses)[number], Array<(typeof mutableStatuses)[number]>> = {
  pending_email_verification: ['active', 'closed'],
  active: ['suspended', 'closed'],
  suspended: ['active', 'closed'],
  closed: []
};

export const canChangeCustomerStatus = (previousStatus: string, status: string) =>
  transitions[previousStatus as keyof typeof transitions]?.includes(status as (typeof mutableStatuses)[number]) ?? false;

const actionFor = (previousStatus: string, status: string) => {
  if (status === 'active' && previousStatus === 'pending_email_verification') return 'customer_activated_by_admin';
  if (status === 'active') return 'customer_reactivated';
  if (status === 'suspended') return 'customer_suspended';
  return 'customer_closed';
};

export const adminCustomersRouter = Router();
adminCustomersRouter.use(requireAuth, requireRole('admin'));

adminCustomersRouter.get('/customers', async (req, res, next) => {
  try {
    const input = listSchema.parse(req.query);
    const filters = ["role = 'customer'"];
    const values: unknown[] = [];
    if (input.status) { values.push(input.status); filters.push(`status = $${values.length}`); }
    if (input.email) { values.push(`%${input.email}%`); filters.push(`email ILIKE $${values.length}`); }
    if (input.full_name) { values.push(`%${input.full_name}%`); filters.push(`full_name ILIKE $${values.length}`); }
    values.push(input.limit);
    const { rows } = await pool.query(
      `SELECT id, email, full_name, phone, role, status, created_at, updated_at, last_login_at
       FROM store.users WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT $${values.length}`,
      values
    );
    res.json({ customers: rows });
  } catch (error) { next(error); }
});

adminCustomersRouter.get('/customers/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.role, u.status, u.created_at, u.updated_at, u.last_login_at,
              cp.company_name, cp.tax_id, cp.billing_address, cp.city, cp.province, cp.postal_code, cp.country
       FROM store.users u LEFT JOIN store.customer_profiles cp ON cp.user_id = u.id
       WHERE u.id = $1 AND u.role = 'customer'`,
      [id]
    );
    if (!rows[0]) { res.status(404).json({ error: 'Customer not found' }); return; }
    res.json({ customer: rows[0] });
  } catch (error) { next(error); }
});

adminCustomersRouter.patch('/customers/:id/status', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = idSchema.parse(req.params.id);
    const input = statusSchema.parse(req.body);
    await client.query('BEGIN');
    const { rows } = await client.query(
      "SELECT id, status FROM store.users WHERE id = $1 AND role = 'customer' FOR UPDATE",
      [id]
    );
    const customer = rows[0];
    if (!customer) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Customer not found' }); return; }
    if (!canChangeCustomerStatus(customer.status, input.status)) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Invalid customer status transition' });
      return;
    }
    const { rows: updatedRows } = await client.query(
      "UPDATE store.users SET status = $2, updated_at = now() WHERE id = $1 AND role = 'customer' RETURNING id, email, full_name, phone, role, status, created_at, updated_at, last_login_at",
      [id, input.status]
    );
    if (customer.status === 'pending_email_verification' && input.status === 'active') {
      await client.query('UPDATE store.email_verification_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    }
    if (input.status === 'suspended' || input.status === 'closed') {
      await client.query('UPDATE store.refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    }
    await writeAuditLog({ actorUserId: req.user!.sub, action: actionFor(customer.status, input.status), entityType: 'customer', entityId: id, payload: { previous_status: customer.status, status: input.status } }, client);
    await client.query('COMMIT');
    res.json({ customer: updatedRows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});
