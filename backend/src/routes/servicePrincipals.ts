import { Router } from 'express';
import { validate as validateUuid } from 'uuid';
import { pool } from '../db/pool';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { authorizeHardware } from '../middleware/hardwareRbac';
import { appendTechnicalAudit } from '../services/technicalAudit';
import {
  createOpaqueServiceToken,
  HARDWARE_READ_SCOPE,
  hashServiceToken,
  normalizeServiceCode,
  parseOptionalExpiry,
  serviceTokenHint
} from '../services/serviceIdentity';

const router = Router();
const SERVICE_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

router.use(authenticate, authorizeHardware('superadmin'));

router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.code, p.company_id, p.scopes, p.active, p.created_at, p.updated_at,
              COUNT(t.id)::int AS token_count,
              COUNT(t.id) FILTER (WHERE t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > NOW()))::int AS active_token_count
       FROM service_principals p
       LEFT JOIN service_principal_tokens t ON t.service_principal_id = p.id
       GROUP BY p.id
       ORDER BY p.code`
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list service principals', error);
    return res.status(500).json({ message: 'Failed to list service principals' });
  }
});

router.post('/', async (req: AuthenticatedRequest, res) => {
  const code = normalizeServiceCode(req.body?.code);
  const companyId = req.body?.companyId;
  const scopes = req.body?.scopes ?? [HARDWARE_READ_SCOPE];
  const expiresAt = parseOptionalExpiry(req.body?.expiresAt);
  if (!SERVICE_CODE_PATTERN.test(code) || !validateUuid(companyId)
      || !Array.isArray(scopes) || scopes.length !== 1 || scopes[0] !== HARDWARE_READ_SCOPE
      || expiresAt === undefined) {
    return res.status(400).json({ message: 'Invalid service principal' });
  }

  const token = createOpaqueServiceToken();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const company = await client.query('SELECT id FROM companies WHERE id = $1 AND active = TRUE', [companyId]);
    if (!company.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Company not found' });
    }
    const principalResult = await client.query(
      `INSERT INTO service_principals(code, company_id, scopes)
       VALUES($1, $2, $3::text[])
       RETURNING id, code, company_id, scopes, active, created_at`,
      [code, companyId, scopes]
    );
    const principal = principalResult.rows[0];
    const tokenResult = await client.query(
      `INSERT INTO service_principal_tokens(service_principal_id, token_hash, token_hint, expires_at)
       VALUES($1, $2, $3, $4)
       RETURNING id, token_hint, expires_at, created_at`,
      [principal.id, hashServiceToken(token), serviceTokenHint(token), expiresAt]
    );
    await appendTechnicalAudit({
      actorUserId: req.user!.id,
      action: 'service_principal.create',
      entityType: 'service_principal',
      entityId: principal.id,
      companyId,
      requestId: req.requestId,
      result: 'success',
      after: { ...principal, token: tokenResult.rows[0] }
    }, client);
    await client.query('COMMIT');
    return res.status(201).json({ ...principal, serviceToken: token, token: tokenResult.rows[0] });
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error?.code === '23505') return res.status(409).json({ message: 'Service principal already exists' });
    console.error('Failed to create service principal', error);
    return res.status(500).json({ message: 'Failed to create service principal' });
  } finally {
    client.release();
  }
});

router.post('/:id/rotate', async (req: AuthenticatedRequest, res) => {
  if (!validateUuid(req.params.id)) return res.status(400).json({ message: 'Invalid service principal id' });
  const expiresAt = parseOptionalExpiry(req.body?.expiresAt);
  if (expiresAt === undefined) return res.status(400).json({ message: 'Invalid expiration' });
  const token = createOpaqueServiceToken();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const principalResult = await client.query(
      'SELECT id, code, company_id FROM service_principals WHERE id = $1 AND active = TRUE FOR UPDATE',
      [req.params.id]
    );
    const principal = principalResult.rows[0];
    if (!principal) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Service principal not found' });
    }
    const previous = await client.query(
      `SELECT id FROM service_principal_tokens
       WHERE service_principal_id = $1 AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [principal.id]
    );
    await client.query(
      'UPDATE service_principal_tokens SET revoked_at = NOW() WHERE service_principal_id = $1 AND revoked_at IS NULL',
      [principal.id]
    );
    const created = await client.query(
      `INSERT INTO service_principal_tokens
         (service_principal_id, token_hash, token_hint, expires_at, rotated_from_token_id)
       VALUES($1, $2, $3, $4, $5)
       RETURNING id, token_hint, expires_at, created_at`,
      [principal.id, hashServiceToken(token), serviceTokenHint(token), expiresAt, previous.rows[0]?.id ?? null]
    );
    await appendTechnicalAudit({
      actorUserId: req.user!.id,
      action: 'service_principal.rotate',
      entityType: 'service_principal',
      entityId: principal.id,
      companyId: principal.company_id,
      requestId: req.requestId,
      result: 'success',
      after: created.rows[0]
    }, client);
    await client.query('COMMIT');
    return res.status(201).json({ serviceToken: token, token: created.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to rotate service principal', error);
    return res.status(500).json({ message: 'Failed to rotate service principal' });
  } finally {
    client.release();
  }
});

router.post('/:id/revoke', async (req: AuthenticatedRequest, res) => {
  if (!validateUuid(req.params.id)) return res.status(400).json({ message: 'Invalid service principal id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE service_principals SET active = FALSE, updated_at = NOW()
       WHERE id = $1 AND active = TRUE RETURNING id, code, company_id`,
      [req.params.id]
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Service principal not found' });
    }
    await client.query(
      'UPDATE service_principal_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE service_principal_id = $1',
      [req.params.id]
    );
    await appendTechnicalAudit({
      actorUserId: req.user!.id,
      action: 'service_principal.revoke',
      entityType: 'service_principal',
      entityId: req.params.id,
      companyId: result.rows[0].company_id,
      requestId: req.requestId,
      result: 'success'
    }, client);
    await client.query('COMMIT');
    return res.status(204).send();
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to revoke service principal', error);
    return res.status(500).json({ message: 'Failed to revoke service principal' });
  } finally {
    client.release();
  }
});

export default router;
