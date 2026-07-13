import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { writeAuditLog } from '../shared/audit.js';
import { createOpaqueToken, emailVerificationSeconds, expiresAtSql, hashToken } from '../auth/token.js';
import { sanitizeMailError, sendEmailVerificationEmail } from '../shared/mail.js';
import { env } from '../../config/env.js';

type AdminCustomersDependencies = {
  pool: typeof pool;
  authMiddleware: typeof requireAuth;
  roleMiddleware: ReturnType<typeof requireRole>;
  sendVerificationEmail: typeof sendEmailVerificationEmail;
  audit: typeof writeAuditLog;
  sanitizeEmailError: typeof sanitizeMailError;
  publicBaseUrl: string;
  logEmailError: (message: string, error: string) => void;
};

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
  pending_email_verification: ['closed'],
  active: ['suspended', 'closed'],
  suspended: ['active', 'closed'],
  closed: []
};

export const canChangeCustomerStatus = (previousStatus: string, status: string) =>
  transitions[previousStatus as keyof typeof transitions]?.includes(status as (typeof mutableStatuses)[number]) ?? false;

const actionFor = (previousStatus: string, status: string) => {
  if (status === 'active') return 'customer_reactivated';
  if (status === 'suspended') return 'customer_suspended';
  return 'customer_closed';
};

export const createAdminCustomersRouter = (overrides: Partial<AdminCustomersDependencies> = {}) => {
  const dependencies: AdminCustomersDependencies = {
    pool,
    authMiddleware: requireAuth,
    roleMiddleware: requireRole('admin'),
    sendVerificationEmail: sendEmailVerificationEmail,
    audit: writeAuditLog,
    sanitizeEmailError: sanitizeMailError,
    publicBaseUrl: env.publicBaseUrl,
    logEmailError: (message, error) => console.error(message, error),
    ...overrides
  };
  const adminCustomersRouter = Router();
  adminCustomersRouter.use(dependencies.authMiddleware, dependencies.roleMiddleware);

adminCustomersRouter.get('/customers', async (req, res, next) => {
  try {
    const input = listSchema.parse(req.query);
    const filters = ["role = 'customer'"];
    const values: unknown[] = [];
    if (input.status) { values.push(input.status); filters.push(`status = $${values.length}`); }
    if (input.email) { values.push(`%${input.email}%`); filters.push(`email ILIKE $${values.length}`); }
    if (input.full_name) { values.push(`%${input.full_name}%`); filters.push(`full_name ILIKE $${values.length}`); }
    values.push(input.limit);
    const { rows } = await dependencies.pool.query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.role, u.status, u.created_at, u.updated_at, u.last_login_at,
              evt.created_at AS verification_last_sent_at, evt.expires_at AS verification_expires_at,
              (evt.id IS NOT NULL AND evt.revoked_at IS NULL AND evt.used_at IS NULL AND evt.expires_at > now()) AS verification_pending
       FROM store.users u LEFT JOIN LATERAL (SELECT * FROM store.email_verification_tokens WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) evt ON true
       WHERE ${filters.map((filter) => filter.replace(/\b(role|status|email|full_name)\b/g, 'u.$1')).join(' AND ')} ORDER BY u.created_at DESC LIMIT $${values.length}`,
      values
    );
    res.json({ customers: rows });
  } catch (error) { next(error); }
});

adminCustomersRouter.get('/customers/:id', async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const { rows } = await dependencies.pool.query(
      `SELECT u.id, u.email, u.full_name, u.phone, u.role, u.status, u.created_at, u.updated_at, u.last_login_at,
              cp.company_name, cp.tax_id, cp.billing_address, cp.city, cp.province, cp.postal_code, cp.country,
              evt.created_at AS verification_last_sent_at, evt.expires_at AS verification_expires_at,
              (evt.id IS NOT NULL AND evt.revoked_at IS NULL AND evt.used_at IS NULL AND evt.expires_at > now()) AS verification_pending
       FROM store.users u LEFT JOIN store.customer_profiles cp ON cp.user_id = u.id
       LEFT JOIN LATERAL (SELECT * FROM store.email_verification_tokens WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) evt ON true
       WHERE u.id = $1 AND u.role = 'customer'`,
      [id]
    );
    if (!rows[0]) { res.status(404).json({ error: 'Customer not found' }); return; }
    res.json({ customer: rows[0] });
  } catch (error) { next(error); }
});

adminCustomersRouter.post('/customers/:id/resend-verification', async (req, res, next) => {
  const client = await dependencies.pool.connect();
  try {
    const id = idSchema.parse(req.params.id);
    await client.query('BEGIN');
    const { rows } = await client.query("SELECT id, email, full_name, status FROM store.users WHERE id = $1 AND role = 'customer' FOR UPDATE", [id]);
    const customer = rows[0];
    if (!customer) { await client.query('ROLLBACK'); res.status(404).json({ error: 'Customer not found' }); return; }
    if (customer.status !== 'pending_email_verification') { await client.query('ROLLBACK'); res.status(409).json({ error: 'Customer is not pending email verification' }); return; }
    const rate = await client.query("SELECT MAX(created_at) AS last_sent_at, COUNT(*) FILTER (WHERE created_at > now() - interval '1 hour')::int AS sent_last_hour FROM store.email_verification_tokens WHERE user_id = $1", [id]);
    const rateRow = rate.rows[0];
    if (Number(rateRow?.sent_last_hour ?? 0) >= 5 || (rateRow?.last_sent_at && Date.now() - new Date(rateRow.last_sent_at).getTime() < 60_000)) { await client.query('ROLLBACK'); res.status(429).json({ error: 'Verification email resend is temporarily limited' }); return; }
    await client.query('UPDATE store.email_verification_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND used_at IS NULL', [id]);
    const token = createOpaqueToken();
    await client.query('INSERT INTO store.email_verification_tokens (user_id, token_hash, expires_at, user_agent, ip_address) VALUES ($1,$2,$3,$4,$5)', [id, hashToken(token), expiresAtSql(emailVerificationSeconds()), req.header('user-agent') ?? null, req.ip]);
    await client.query('COMMIT');
    try {
      await dependencies.sendVerificationEmail({ email: customer.email, fullName: customer.full_name, verificationUrl: `${dependencies.publicBaseUrl.replace(/\/$/, '')}/verify-email?token=${encodeURIComponent(token)}`, expiresInSeconds: emailVerificationSeconds() });
    } catch (error) {
      const sanitizedError = dependencies.sanitizeEmailError(error).replaceAll(token, '[redacted]');
      dependencies.logEmailError('Verification email delivery failed', sanitizedError);
      res.status(502).json({ error: 'No se pudo enviar el correo de verificaciÃ³n' });
      return;
    }
    await dependencies.audit({ actorUserId: req.user!.sub, action: 'customer_verification_email_resent', entityType: 'customer', entityId: id });
    res.json({ message: 'Verification email resent' });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

adminCustomersRouter.patch('/customers/:id/status', async (req, res, next) => {
  const client = await dependencies.pool.connect();
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
    if (input.status === 'suspended' || input.status === 'closed') {
      await client.query('UPDATE store.refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    }
    await dependencies.audit({ actorUserId: req.user!.sub, action: actionFor(customer.status, input.status), entityType: 'customer', entityId: id, payload: { previous_status: customer.status, status: input.status } }, client);
    await client.query('COMMIT');
    res.json({ customer: updatedRows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});

  return adminCustomersRouter;
};

export const adminCustomersRouter = createAdminCustomersRouter();
