import { Router } from 'express';
import { validate as validateUuid } from 'uuid';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import {
  authorizeHardware,
  resolveHardwareAccess
} from '../middleware/hardwareRbac';
import { pool } from '../db/pool';
import { appendTechnicalAudit } from '../services/technicalAudit';

const router = Router();
const COMPANY_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MEMBERSHIP_ROLES = ['hardware_readonly', 'hardware_technician'] as const;

const normalizeCode = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const normalizeName = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const isMembershipRole = (value: unknown): value is typeof MEMBERSHIP_ROLES[number] =>
  MEMBERSHIP_ROLES.includes(value as typeof MEMBERSHIP_ROLES[number]);

router.use(authenticate);

router.get('/', authorizeHardware('read'), async (req: AuthenticatedRequest, res) => {
  try {
    const scope = await resolveHardwareAccess(req.user!, 'read');
    const result = scope.global
      ? await pool.query(
          'SELECT id, code, name, active, created_at, updated_at FROM companies ORDER BY name'
        )
      : await pool.query(
          `SELECT c.id, c.code, c.name, c.active, c.created_at, c.updated_at, m.role AS membership_role
           FROM companies c
           JOIN company_user_memberships m ON m.company_id = c.id
           WHERE m.user_id = $1 AND c.id = ANY($2::uuid[])
           ORDER BY c.name`,
          [req.user!.id, scope.companyIds]
        );
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list companies', error);
    return res.status(500).json({ message: 'Failed to list companies' });
  }
});

router.post('/', authorizeHardware('superadmin'), async (req: AuthenticatedRequest, res) => {
  const code = normalizeCode(req.body?.code);
  const name = normalizeName(req.body?.name);
  if (!COMPANY_CODE_PATTERN.test(code) || !name) {
    return res.status(400).json({ message: 'Invalid company code or name' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO companies(code, name)
       VALUES($1, $2)
       RETURNING id, code, name, active, created_at, updated_at`,
      [code, name]
    );
    const company = result.rows[0];
    await appendTechnicalAudit({
      actorUserId: req.user!.id,
      action: 'company.create',
      entityType: 'company',
      entityId: company.id,
      companyId: company.id,
      requestId: req.requestId,
      result: 'success',
      after: company
    }, client);
    await client.query('COMMIT');
    return res.status(201).json(company);
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error?.code === '23505') return res.status(409).json({ message: 'Company code already exists' });
    console.error('Failed to create company', error);
    return res.status(500).json({ message: 'Failed to create company' });
  } finally {
    client.release();
  }
});

router.get('/:id', authorizeHardware('read'), async (req: AuthenticatedRequest, res) => {
  if (!validateUuid(req.params.id)) return res.status(400).json({ message: 'Invalid company id' });
  try {
    const scope = await resolveHardwareAccess(req.user!, 'read');
    const values: unknown[] = [req.params.id];
    let sql = 'SELECT id, code, name, active, created_at, updated_at FROM companies WHERE id = $1';
    if (!scope.global) {
      values.push(scope.companyIds);
      sql += ` AND id = ANY($${values.length}::uuid[])`;
    }
    const result = await pool.query(sql, values);
    if (!result.rows[0]) return res.status(404).json({ message: 'Company not found' });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to get company', error);
    return res.status(500).json({ message: 'Failed to get company' });
  }
});

router.patch('/:id', authorizeHardware('superadmin'), async (req: AuthenticatedRequest, res) => {
  if (!validateUuid(req.params.id)) return res.status(400).json({ message: 'Invalid company id' });
  const fields: string[] = [];
  const values: unknown[] = [];
  if (req.body?.code !== undefined) {
    const code = normalizeCode(req.body.code);
    if (!COMPANY_CODE_PATTERN.test(code)) return res.status(400).json({ message: 'Invalid company code' });
    values.push(code);
    fields.push(`code = $${values.length}`);
  }
  if (req.body?.name !== undefined) {
    const name = normalizeName(req.body.name);
    if (!name) return res.status(400).json({ message: 'Invalid company name' });
    values.push(name);
    fields.push(`name = $${values.length}`);
  }
  if (req.body?.active !== undefined) {
    if (typeof req.body.active !== 'boolean') return res.status(400).json({ message: 'active must be boolean' });
    values.push(req.body.active);
    fields.push(`active = $${values.length}`);
  }
  if (!fields.length) return res.status(400).json({ message: 'No updates provided' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const beforeResult = await client.query('SELECT * FROM companies WHERE id = $1 FOR UPDATE', [req.params.id]);
    const before = beforeResult.rows[0];
    if (!before) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Company not found' });
    }
    values.push(req.params.id);
    const result = await client.query(
      `UPDATE companies SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING id, code, name, active, created_at, updated_at`,
      values
    );
    const after = result.rows[0];
    await appendTechnicalAudit({
      actorUserId: req.user!.id,
      action: 'company.update',
      entityType: 'company',
      entityId: after.id,
      companyId: after.id,
      requestId: req.requestId,
      result: 'success',
      before,
      after
    }, client);
    await client.query('COMMIT');
    return res.json(after);
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error?.code === '23505') return res.status(409).json({ message: 'Company code already exists' });
    console.error('Failed to update company', error);
    return res.status(500).json({ message: 'Failed to update company' });
  } finally {
    client.release();
  }
});

router.get('/:id/memberships', authorizeHardware('superadmin'), async (req, res) => {
  if (!validateUuid(req.params.id)) return res.status(400).json({ message: 'Invalid company id' });
  const result = await pool.query(
    `SELECT m.user_id, m.company_id, m.role, m.created_at, m.updated_at,
            u.email, u.display_name
     FROM company_user_memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.company_id = $1
     ORDER BY u.email`,
    [req.params.id]
  );
  return res.json(result.rows);
});

router.put('/:id/memberships/:userId', authorizeHardware('superadmin'), async (req: AuthenticatedRequest, res) => {
  if (!validateUuid(req.params.id)) return res.status(400).json({ message: 'Invalid company id' });
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0 || !isMembershipRole(req.body?.role)) {
    return res.status(400).json({ message: 'Invalid user or membership role' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const company = await client.query('SELECT id FROM companies WHERE id = $1 AND active = TRUE', [req.params.id]);
    const user = await client.query('SELECT id, role FROM users WHERE id = $1', [userId]);
    if (!company.rows[0] || !user.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Company or user not found' });
    }
    if (!['hardware_readonly', 'hardware_technician'].includes(user.rows[0].role)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'User does not have a company-scoped hardware role' });
    }
    if (user.rows[0].role === 'hardware_readonly' && req.body.role === 'hardware_technician') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Membership cannot exceed the user hardware role' });
    }
    const result = await client.query(
      `INSERT INTO company_user_memberships(user_id, company_id, role)
       VALUES($1, $2, $3)
       ON CONFLICT(user_id, company_id) DO UPDATE
         SET role = EXCLUDED.role, updated_at = NOW()
       RETURNING user_id, company_id, role, created_at, updated_at`,
      [userId, req.params.id, req.body.role]
    );
    await appendTechnicalAudit({
      actorUserId: req.user!.id,
      action: 'company.membership.upsert',
      entityType: 'company_membership',
      entityId: `${req.params.id}:${userId}`,
      companyId: req.params.id,
      requestId: req.requestId,
      result: 'success',
      after: result.rows[0]
    }, client);
    await client.query('COMMIT');
    return res.json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to update membership', error);
    return res.status(500).json({ message: 'Failed to update membership' });
  } finally {
    client.release();
  }
});

router.delete('/:id/memberships/:userId', authorizeHardware('superadmin'), async (req: AuthenticatedRequest, res) => {
  if (!validateUuid(req.params.id)) return res.status(400).json({ message: 'Invalid company id' });
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ message: 'Invalid user id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deleted = await client.query(
      'DELETE FROM company_user_memberships WHERE company_id = $1 AND user_id = $2 RETURNING *',
      [req.params.id, userId]
    );
    if (!deleted.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Membership not found' });
    }
    await appendTechnicalAudit({
      actorUserId: req.user!.id,
      action: 'company.membership.remove',
      entityType: 'company_membership',
      entityId: `${req.params.id}:${userId}`,
      companyId: req.params.id,
      requestId: req.requestId,
      result: 'success',
      before: deleted.rows[0]
    }, client);
    await client.query('COMMIT');
    return res.status(204).send();
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to delete membership', error);
    return res.status(500).json({ message: 'Failed to delete membership' });
  } finally {
    client.release();
  }
});

export default router;
