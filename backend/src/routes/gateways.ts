import { Router } from 'express';
import { validate as validateUuid } from 'uuid';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import {
  authorizeHardware,
  isHardwareSuperadmin,
  resolveHardwareAccess,
  scopedHardwarePredicate
} from '../middleware/hardwareRbac';
import { pool } from '../db/pool';
import { normalizeGatewayMac } from '../utils/mac';
import { appendTechnicalAudit } from '../services/technicalAudit';
import {
  configureB5Gateway,
  configureGatewayRssi,
  GatewayCommandBusyError
} from '../services/gatewayCommands';

const router = Router();

const companyIdValue = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return typeof value === 'string' && validateUuid(value) ? value : undefined;
};

const gatewaySelect = `SELECT g.id, g.name, g.mac_address, g.description, g.owner_id, g.company_id,
                              g.rssi_threshold, g.active, gp.place_id, p.name AS place_name, c.code AS company_code,
                              c.name AS company_name, g.created_at, g.updated_at
                       FROM gateways g
                       LEFT JOIN gateway_places gp ON gp.gateway_id = g.id AND gp.active = true
                       LEFT JOIN places p ON p.id = gp.place_id
                       LEFT JOIN companies c ON c.id = g.company_id`;

router.get('/', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const scope = await resolveHardwareAccess(req.user!, 'read');
    const values: unknown[] = [];
    const predicate = scopedHardwarePredicate({
      scope, values, companyColumn: 'g.company_id', ownerColumn: 'g.owner_id'
    });
    const result = await pool.query(`${gatewaySelect} WHERE ${predicate} ORDER BY g.name NULLS LAST, g.id`, values);
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list gateways', error);
    return res.status(500).json({ message: 'Failed to list gateways' });
  }
});

router.get('/by-mac/:mac', authenticate, async (req: AuthenticatedRequest, res) => {
  const mac = normalizeGatewayMac(req.params.mac);
  if (!mac) return res.status(400).json({ message: 'MAC address is invalid' });
  try {
    const scope = await resolveHardwareAccess(req.user!, 'read');
    const values: unknown[] = [mac];
    const predicate = scopedHardwarePredicate({ scope, values, companyColumn: 'g.company_id', ownerColumn: 'g.owner_id' });
    const result = await pool.query(
      `${gatewaySelect}
       WHERE regexp_replace(lower(g.mac_address), '[^0-9a-f]', '', 'g') = $1 AND ${predicate}`,
      values
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Gateway not found' });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to get gateway by MAC', error);
    return res.status(500).json({ message: 'Failed to get gateway' });
  }
});

router.get('/:gatewayId', authenticate, async (req: AuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  if (!Number.isInteger(gatewayId)) return res.status(400).json({ message: 'Invalid gateway id' });
  try {
    const scope = await resolveHardwareAccess(req.user!, 'read');
    const values: unknown[] = [gatewayId];
    const predicate = scopedHardwarePredicate({ scope, values, companyColumn: 'g.company_id', ownerColumn: 'g.owner_id' });
    const result = await pool.query(`${gatewaySelect} WHERE g.id = $1 AND ${predicate}`, values);
    if (!result.rows[0]) return res.status(404).json({ message: 'Gateway not found' });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to get gateway', error);
    return res.status(500).json({ message: 'Failed to get gateway' });
  }
});

const commandTimeoutMs = (): number => {
  const parsed = Number(process.env.GATEWAY_COMMAND_TIMEOUT_MS ?? 8000);
  return Number.isFinite(parsed) ? Math.min(120000, Math.max(100, Math.floor(parsed))) : 8000;
};

async function gatewayForCommand(req: AuthenticatedRequest, gatewayId: number) {
  const scope = await resolveHardwareAccess(req.user!, 'technician');
  const values: unknown[] = [gatewayId];
  const predicate = scopedHardwarePredicate({
    scope,
    values,
    companyColumn: 'g.company_id',
    ownerColumn: 'g.owner_id'
  });
  const result = await pool.query<{
    id: number;
    mac_address: string;
    company_id: string;
    rssi_threshold: number;
  }>(
    `SELECT g.id, g.mac_address, g.company_id, g.rssi_threshold
     FROM gateways g
     WHERE g.id = $1 AND g.active = TRUE AND g.company_id IS NOT NULL AND ${predicate}`,
    values
  );
  return result.rows[0] ?? null;
}

router.get('/:gatewayId/commands', authenticate, async (req: AuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  if (!Number.isInteger(gatewayId)) return res.status(400).json({ message: 'Invalid gateway id' });
  try {
    const scope = await resolveHardwareAccess(req.user!, 'read');
    const values: unknown[] = [gatewayId];
    const predicate = scopedHardwarePredicate({ scope, values, companyColumn: 'g.company_id', ownerColumn: 'g.owner_id' });
    const result = await pool.query(
      `SELECT c.id, c.gateway_id, c.company_id, c.msg_id, c.command_type, c.status,
              c.actor_type, c.actor_code, c.request_id, c.created_at, c.sent_at, c.ack_at,
              c.ack_msg_id, c.result_code, c.result_message, c.timeout_ms
       FROM hardware_gateway_commands c
       JOIN gateways g ON g.id = c.gateway_id
       WHERE g.id = $1 AND ${predicate}
       ORDER BY c.created_at DESC LIMIT 200`,
      values
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list gateway commands', error);
    return res.status(500).json({ message: 'Failed to list gateway commands' });
  }
});

router.post('/:gatewayId/configure-emergency-button', authenticate, authorizeHardware('technician'), async (req: AuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  if (!Number.isInteger(gatewayId)) return res.status(400).json({ message: 'Invalid gateway id' });
  try {
    const gateway = await gatewayForCommand(req, gatewayId);
    if (!gateway) return res.status(404).json({ message: 'Gateway not found' });
    const configuration = await configureB5Gateway({
      gatewayId,
      companyId: gateway.company_id,
      gatewayMac: gateway.mac_address,
      actor: { type: 'user', userId: req.user!.id },
      requestId: req.requestId,
      timeoutMs: commandTimeoutMs()
    });
    await appendTechnicalAudit({
      actorUserId: req.user!.id,
      action: 'gateway.b5.configure',
      entityType: 'gateway',
      entityId: gatewayId,
      companyId: gateway.company_id,
      requestId: req.requestId,
      result: configuration.ok ? 'success' : 'failure',
      after: { results: configuration.results }
    });
    return res.status(configuration.ok ? 200 : 207).json({
      ok: configuration.ok,
      status: configuration.ok ? 'configured' : 'partial_failure',
      message: configuration.ok
        ? 'B5 configurado correctamente.'
        : 'La configuración B5 no ha sido confirmada por todos los comandos.',
      topic: `gw/${normalizeGatewayMac(gateway.mac_address)}/subscribe`,
      commands: configuration.commands,
      results: configuration.results
    });
  } catch (error) {
    if (error instanceof GatewayCommandBusyError || (error as any)?.code === '23505') {
      return res.status(409).json({ message: 'Gateway already has an active command sequence' });
    }
    console.error('Failed to configure B5 gateway', error);
    return res.status(500).json({ message: 'Failed to configure B5 gateway' });
  }
});

router.post('/:gatewayId/apply-rssi', authenticate, authorizeHardware('technician'), async (req: AuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  const rssi = req.body?.rssi;
  if (!Number.isInteger(gatewayId)) return res.status(400).json({ message: 'Invalid gateway id' });
  if (!Number.isInteger(rssi) || rssi < -127 || rssi > 0) {
    return res.status(400).json({ message: 'RSSI threshold must be an integer between -127 and 0' });
  }
  try {
    const gateway = await gatewayForCommand(req, gatewayId);
    if (!gateway) return res.status(404).json({ message: 'Gateway not found' });
    const result = await configureGatewayRssi({
      gatewayId,
      companyId: gateway.company_id,
      gatewayMac: gateway.mac_address,
      rssi,
      actor: { type: 'user', userId: req.user!.id },
      requestId: req.requestId,
      timeoutMs: commandTimeoutMs()
    });
    await appendTechnicalAudit({
      actorUserId: req.user!.id,
      action: 'gateway.rssi.configure',
      entityType: 'gateway',
      entityId: gatewayId,
      companyId: gateway.company_id,
      requestId: req.requestId,
      result: result.status === 'success' ? 'success' : 'failure',
      after: result
    });
    return res.status(result.status === 'success' ? 200 : result.status === 'timeout' ? 504 : 502).json(result);
  } catch (error) {
    if (error instanceof GatewayCommandBusyError || (error as any)?.code === '23505') {
      return res.status(409).json({ message: 'Gateway already has an active command sequence' });
    }
    console.error('Failed to configure gateway RSSI', error);
    return res.status(500).json({ message: 'Failed to configure gateway RSSI' });
  }
});

router.post('/', authenticate, authorizeHardware('superadmin'), async (req: AuthenticatedRequest, res) => {
  const { name, macAddress, description, ownerId } = req.body;
  const normalizedMac = normalizeGatewayMac(macAddress);
  if (!normalizedMac) return res.status(400).json({ message: 'MAC address is invalid' });
  const parsedCompanyId = companyIdValue(req.body?.companyId);
  if (!parsedCompanyId) {
    return res.status(400).json({ message: 'companyId is required' });
  }
  const ownerValue = ownerId === undefined || ownerId === null || ownerId === '' ? null : Number(ownerId);
  if (ownerValue !== null && !Number.isInteger(ownerValue)) return res.status(400).json({ message: 'ownerId must be a number' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (parsedCompanyId) {
      const company = await client.query('SELECT id FROM companies WHERE id = $1 AND active = TRUE', [parsedCompanyId]);
      if (!company.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Company not found' });
      }
    }
    const result = await client.query(
      `INSERT INTO gateways(name, mac_address, description, owner_id, company_id)
       VALUES($1, $2, $3, $4, $5)
       RETURNING id, name, mac_address, description, owner_id, company_id, active, created_at, updated_at`,
      [name ? String(name).trim() || null : null, normalizedMac,
       description ? String(description).trim() || null : null, ownerValue, parsedCompanyId]
    );
    const gateway = result.rows[0];
    await appendTechnicalAudit({
      actorUserId: req.user!.id, action: 'gateway.create', entityType: 'gateway',
      entityId: gateway.id, companyId: gateway.company_id, requestId: req.requestId,
      result: 'success', after: gateway
    }, client);
    await client.query('COMMIT');
    return res.status(201).json(gateway);
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error?.code === '23505') return res.status(409).json({ message: 'Gateway already exists' });
    console.error('Failed to create gateway', error);
    return res.status(500).json({ message: 'Failed to create gateway' });
  } finally { client.release(); }
});

router.post('/:gatewayId/assign-place', authenticate, async (req: AuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  if (!Number.isInteger(gatewayId)) return res.status(400).json({ message: 'Invalid gateway id' });
  try {
    const scope = await resolveHardwareAccess(req.user!, 'technician');
    const values: unknown[] = [gatewayId];
    const predicate = scopedHardwarePredicate({ scope, values, companyColumn: 'g.company_id', ownerColumn: 'g.owner_id' });
    const gatewayResult = await pool.query(`SELECT g.id, g.company_id FROM gateways g WHERE g.id = $1 AND g.active = TRUE AND ${predicate}`, values);
    const gateway = gatewayResult.rows[0];
    if (!gateway) return res.status(404).json({ message: 'Gateway not found' });

    const { placeId } = req.body;
    if (placeId === undefined || placeId === null || placeId === '') {
      await pool.query('UPDATE gateway_places SET active = FALSE WHERE gateway_id = $1', [gatewayId]);
      await appendTechnicalAudit({ actorUserId: req.user!.id, action: 'gateway.place.unassign', entityType: 'gateway', entityId: gatewayId, companyId: gateway.company_id, requestId: req.requestId, result: 'success' });
      return res.json({ gateway_id: gatewayId, place_id: null });
    }
    const parsedPlaceId = Number(placeId);
    if (!Number.isInteger(parsedPlaceId)) return res.status(400).json({ message: 'placeId must be a number' });
    const placeResult = await pool.query('SELECT owner_id FROM places WHERE id = $1', [parsedPlaceId]);
    if (!placeResult.rows[0]) return res.status(404).json({ message: 'Place not found' });
    if (req.user!.role === 'USER' && placeResult.rows[0].owner_id !== req.user!.id) {
      return res.status(404).json({ message: 'Place not found' });
    }
    await pool.query('UPDATE gateway_places SET active = FALSE WHERE gateway_id = $1', [gatewayId]);
    const result = await pool.query(
      `INSERT INTO gateway_places(gateway_id, place_id, assigned_by)
       VALUES($1, $2, $3) RETURNING gateway_id, place_id, assigned_at`,
      [gatewayId, parsedPlaceId, req.user!.id]
    );
    await appendTechnicalAudit({ actorUserId: req.user!.id, action: 'gateway.place.assign', entityType: 'gateway', entityId: gatewayId, companyId: gateway.company_id, requestId: req.requestId, result: 'success', after: result.rows[0] });
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Failed to assign gateway', error);
    return res.status(500).json({ message: 'Failed to assign gateway' });
  }
});

router.put('/:gatewayId', authenticate, async (req: AuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  if (!Number.isInteger(gatewayId)) return res.status(400).json({ message: 'Invalid gateway id' });
  if (!isHardwareSuperadmin(req.user!.role) && req.user!.role !== 'hardware_technician' && req.user!.role !== 'USER') {
    return res.status(403).json({ message: 'Forbidden' });
  }
  const scope = await resolveHardwareAccess(req.user!, 'technician');
  const accessValues: unknown[] = [gatewayId];
  const predicate = scopedHardwarePredicate({ scope, values: accessValues, companyColumn: 'g.company_id', ownerColumn: 'g.owner_id' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const beforeResult = await client.query(`SELECT g.* FROM gateways g WHERE g.id = $1 AND ${predicate} FOR UPDATE`, accessValues);
    const before = beforeResult.rows[0];
    if (!before) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Gateway not found' });
    }
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const key of ['name', 'description'] as const) {
      if (req.body?.[key] !== undefined) {
        values.push(typeof req.body[key] === 'string' ? req.body[key].trim() || null : null);
        fields.push(`${key} = $${values.length}`);
      }
    }
    if (isHardwareSuperadmin(req.user!.role)) {
      if (req.body?.active !== undefined) {
        if (typeof req.body.active !== 'boolean') {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'active must be boolean' });
        }
        values.push(req.body.active); fields.push(`active = $${values.length}`);
      }
      if (req.body?.companyId !== undefined) {
        const parsed = companyIdValue(req.body.companyId);
        if (parsed === undefined) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'companyId is invalid' });
        }
        if (parsed) {
          const company = await client.query('SELECT id FROM companies WHERE id = $1 AND active = TRUE', [parsed]);
          if (!company.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Company not found' });
          }
        }
        values.push(parsed); fields.push(`company_id = $${values.length}`);
      }
    } else if (req.body?.active !== undefined || req.body?.companyId !== undefined || req.body?.ownerId !== undefined) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (!fields.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'No updates provided' });
    }
    values.push(gatewayId);
    const result = await client.query(
      `UPDATE gateways SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${values.length}
       RETURNING id, name, mac_address, description, owner_id, company_id, active, updated_at`, values
    );
    const after = result.rows[0];
    await appendTechnicalAudit({ actorUserId: req.user!.id, action: 'gateway.update', entityType: 'gateway', entityId: gatewayId, companyId: after.company_id, requestId: req.requestId, result: 'success', before, after }, client);
    await client.query('COMMIT');
    return res.json(after);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to update gateway', error);
    return res.status(500).json({ message: 'Failed to update gateway' });
  } finally { client.release(); }
});

router.delete('/:gatewayId', authenticate, authorizeHardware('superadmin'), async (req: AuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  if (!Number.isInteger(gatewayId)) return res.status(400).json({ message: 'Invalid gateway id' });
  try {
    const result = await pool.query(
      `UPDATE gateways SET active = FALSE, updated_at = NOW()
       WHERE id = $1 RETURNING id, company_id, active`, [gatewayId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Gateway not found' });
    await appendTechnicalAudit({ actorUserId: req.user!.id, action: 'gateway.deactivate', entityType: 'gateway', entityId: gatewayId, companyId: result.rows[0].company_id, requestId: req.requestId, result: 'success', after: result.rows[0] });
    return res.status(204).send();
  } catch (error) {
    console.error('Failed to deactivate gateway', error);
    return res.status(500).json({ message: 'Failed to deactivate gateway' });
  }
});

export default router;
