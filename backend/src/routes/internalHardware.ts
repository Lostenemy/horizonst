import { Router } from 'express';
import { pool } from '../db/pool';
import {
  authenticateService,
  requireServiceScope,
  ServiceAuthenticatedRequest
} from '../middleware/serviceAuth';
import { HARDWARE_COMMAND_SCOPE, HARDWARE_READ_SCOPE } from '../services/serviceIdentity';
import { normalizeGatewayMac, normalizeMacAddress } from '../utils/mac';
import { appendTechnicalAudit } from '../services/technicalAudit';
import {
  configureB5Gateway,
  configureGatewayRssi,
  executePhysicalB5Command,
  GatewayCommandBusyError,
  PhysicalB5Command
} from '../services/gatewayCommands';

const router = Router();

const gatewaySelect = `SELECT g.id, g.name, g.mac_address, g.description, g.company_id,
                              g.rssi_threshold, g.active, g.created_at, g.updated_at,
                              gp.place_id, p.name AS place_name
                       FROM gateways g
                       LEFT JOIN gateway_places gp ON gp.gateway_id = g.id AND gp.active = TRUE
                       LEFT JOIN places p ON p.id = gp.place_id`;

const deviceSelect = `SELECT d.id, d.name, d.ble_mac, d.description, d.company_id,
                             d.device_type, d.status, d.active, d.created_at, d.updated_at
                      FROM devices d`;

router.use(authenticateService);
const requireRead = requireServiceScope(HARDWARE_READ_SCOPE);
const requireCommand = requireServiceScope(HARDWARE_COMMAND_SCOPE);

async function auditRead(
  req: ServiceAuthenticatedRequest,
  action: string,
  entityId: string | number,
  result: 'success' | 'failure',
  entityType: 'gateway' | 'device' = 'gateway'
): Promise<void> {
  const principal = req.servicePrincipal!;
  await appendTechnicalAudit({
    actorType: 'service',
    actorCode: principal.code,
    actorServiceId: principal.id,
    action,
    entityType,
    entityId,
    companyId: principal.companyId,
    requestId: req.requestId,
    result
  });
}

router.get('/gateways', requireRead, async (req: ServiceAuthenticatedRequest, res) => {
  try {
    const principal = req.servicePrincipal!;
    const result = await pool.query(
      `${gatewaySelect}
       WHERE g.company_id = $1
       ORDER BY g.name NULLS LAST, g.id`,
      [principal.companyId]
    );
    await auditRead(req, 'internal.gateway.list', 'collection', 'success');
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list internal gateways', error);
    return res.status(500).json({ message: 'Failed to list gateways' });
  }
});

router.get('/devices', requireRead, async (req: ServiceAuthenticatedRequest, res) => {
  try {
    const principal = req.servicePrincipal!;
    const result = await pool.query(
      `${deviceSelect}
       WHERE d.company_id = $1
       ORDER BY d.name NULLS LAST, d.id`,
      [principal.companyId]
    );
    await auditRead(req, 'internal.device.list', 'collection', 'success', 'device');
    return res.json(result.rows);
  } catch (error) {
    console.error('Failed to list internal devices', error);
    return res.status(500).json({ message: 'Failed to list devices' });
  }
});

router.get('/devices/by-mac/:mac', requireRead, async (req: ServiceAuthenticatedRequest, res) => {
  const mac = normalizeMacAddress(req.params.mac);
  if (!mac) return res.status(400).json({ message: 'MAC address is invalid' });
  try {
    const principal = req.servicePrincipal!;
    const result = await pool.query(
      `${deviceSelect}
       WHERE upper(regexp_replace(d.ble_mac, '[^0-9A-Fa-f]', '', 'g')) = $1
         AND d.company_id = $2`,
      [mac, principal.companyId]
    );
    if (!result.rows[0]) {
      await auditRead(req, 'internal.device.read_by_mac', mac, 'failure', 'device');
      return res.status(404).json({ message: 'Device not found' });
    }
    await auditRead(req, 'internal.device.read_by_mac', result.rows[0].id, 'success', 'device');
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to get internal device by MAC', error);
    return res.status(500).json({ message: 'Failed to get device' });
  }
});

router.get('/devices/:deviceId', requireRead, async (req: ServiceAuthenticatedRequest, res) => {
  const deviceId = Number(req.params.deviceId);
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return res.status(400).json({ message: 'Invalid device id' });
  }
  try {
    const principal = req.servicePrincipal!;
    const result = await pool.query(
      `${deviceSelect}
       WHERE d.id = $1 AND d.company_id = $2`,
      [deviceId, principal.companyId]
    );
    if (!result.rows[0]) {
      await auditRead(req, 'internal.device.read', deviceId, 'failure', 'device');
      return res.status(404).json({ message: 'Device not found' });
    }
    await auditRead(req, 'internal.device.read', deviceId, 'success', 'device');
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to get internal device', error);
    return res.status(500).json({ message: 'Failed to get device' });
  }
});

router.get('/gateways/by-mac/:mac', requireRead, async (req: ServiceAuthenticatedRequest, res) => {
  const mac = normalizeGatewayMac(req.params.mac);
  if (!mac) return res.status(400).json({ message: 'MAC address is invalid' });
  try {
    const principal = req.servicePrincipal!;
    const result = await pool.query(
      `${gatewaySelect}
       WHERE regexp_replace(lower(g.mac_address), '[^0-9a-f]', '', 'g') = $1
         AND g.company_id = $2`,
      [mac, principal.companyId]
    );
    if (!result.rows[0]) {
      await auditRead(req, 'internal.gateway.read_by_mac', mac, 'failure');
      return res.status(404).json({ message: 'Gateway not found' });
    }
    await auditRead(req, 'internal.gateway.read_by_mac', result.rows[0].id, 'success');
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to get internal gateway by MAC', error);
    return res.status(500).json({ message: 'Failed to get gateway' });
  }
});

router.get('/gateways/:gatewayId', requireRead, async (req: ServiceAuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  if (!Number.isInteger(gatewayId) || gatewayId <= 0) {
    return res.status(400).json({ message: 'Invalid gateway id' });
  }
  try {
    const principal = req.servicePrincipal!;
    const result = await pool.query(
      `${gatewaySelect}
       WHERE g.id = $1 AND g.company_id = $2`,
      [gatewayId, principal.companyId]
    );
    if (!result.rows[0]) {
      await auditRead(req, 'internal.gateway.read', gatewayId, 'failure');
      return res.status(404).json({ message: 'Gateway not found' });
    }
    await auditRead(req, 'internal.gateway.read', gatewayId, 'success');
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Failed to get internal gateway', error);
    return res.status(500).json({ message: 'Failed to get gateway' });
  }
});

const PHYSICAL_COMMANDS = new Set<PhysicalB5Command>(['connect', 'led', 'buzzer', 'vibration', 'disconnect']);

function physicalCommandTimeoutMs(command: PhysicalB5Command): number {
  const name = command === 'connect' ? 'B5_CONNECT_TIMEOUT_MS' : 'B5_ACTION_TIMEOUT_MS';
  const fallback = command === 'connect' ? 12000 : 8000;
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isFinite(parsed) ? Math.min(120000, Math.max(100, Math.floor(parsed))) : fallback;
}

function managementCommandTimeoutMs(): number {
  const parsed = Number(process.env.GATEWAY_COMMAND_TIMEOUT_MS ?? 8000);
  return Number.isFinite(parsed) ? Math.min(120000, Math.max(100, Math.floor(parsed))) : 8000;
}

async function scopedActiveGateway(gatewayId: number, companyId: string) {
  const result = await pool.query<{ id: number; mac_address: string; company_id: string }>(
    `SELECT id, mac_address, company_id FROM gateways
     WHERE id = $1 AND company_id = $2 AND active = TRUE`,
    [gatewayId, companyId]
  );
  return result.rows[0] ?? null;
}

router.post('/gateways/:gatewayId/b5-command', requireCommand, async (req: ServiceAuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  const deviceId = Number(req.body?.deviceId);
  const command = req.body?.command as PhysicalB5Command;
  const durationMs = req.body?.durationMs;
  if (!Number.isInteger(gatewayId) || gatewayId <= 0 || !Number.isInteger(deviceId) || deviceId <= 0
      || !PHYSICAL_COMMANDS.has(command)) {
    return res.status(400).json({ message: 'Invalid physical B5 command' });
  }
  if ((command === 'buzzer' || command === 'vibration')
      && (!Number.isInteger(durationMs) || durationMs < 100 || durationMs > 60000)) {
    return res.status(400).json({ message: 'Invalid physical B5 command duration' });
  }
  const principal = req.servicePrincipal!;
  try {
    const gateway = await scopedActiveGateway(gatewayId, principal.companyId);
    if (!gateway) return res.status(404).json({ message: 'Hardware target not found' });
    const device = await pool.query<{ id: number; ble_mac: string }>(
      `SELECT id, ble_mac FROM devices
       WHERE id = $1 AND company_id = $2 AND active = TRUE
         AND status = 'active' AND device_type = 'b5'`,
      [deviceId, principal.companyId]
    );
    if (!device.rows[0]) return res.status(404).json({ message: 'Hardware target not found' });

    const sessionPassword = command === 'connect' ? process.env.B5_SESSION_PASSWORD?.trim() : undefined;
    if (command === 'connect' && !sessionPassword) {
      return res.status(503).json({ message: 'B5 command executor is not configured' });
    }
    const result = await executePhysicalB5Command({
      gatewayId: gateway.id,
      companyId: gateway.company_id,
      gatewayMac: gateway.mac_address,
      deviceMac: device.rows[0].ble_mac,
      command,
      durationMs,
      sessionPassword,
      actor: { type: 'service', serviceId: principal.id, code: principal.code },
      requestId: req.requestId,
      timeoutMs: physicalCommandTimeoutMs(command)
    });
    await appendTechnicalAudit({
      actorType: 'service', actorCode: principal.code, actorServiceId: principal.id,
      action: `internal.gateway.b5.${command}`, entityType: 'gateway', entityId: gatewayId,
      companyId: principal.companyId, requestId: req.requestId,
      result: result.status === 'success' ? 'success' : 'failure', after: result
    });
    return res.status(result.status === 'success' ? 200 : result.status === 'timeout' ? 504 : 502).json(result);
  } catch (error) {
    if (error instanceof GatewayCommandBusyError || (error as any)?.code === '23505') {
      return res.status(409).json({ message: 'Gateway already has an active command' });
    }
    console.error('Failed to execute internal physical B5 command', error);
    return res.status(500).json({ message: 'Failed to execute physical B5 command' });
  }
});

router.post('/gateways/:gatewayId/configure-emergency-button', requireCommand, async (req: ServiceAuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  if (!Number.isInteger(gatewayId) || gatewayId <= 0) return res.status(400).json({ message: 'Invalid gateway id' });
  const principal = req.servicePrincipal!;
  try {
    const gateway = await scopedActiveGateway(gatewayId, principal.companyId);
    if (!gateway) return res.status(404).json({ message: 'Gateway not found' });
    const configuration = await configureB5Gateway({
      gatewayId: gateway.id, companyId: gateway.company_id, gatewayMac: gateway.mac_address,
      actor: { type: 'service', serviceId: principal.id, code: principal.code },
      requestId: req.requestId, timeoutMs: managementCommandTimeoutMs()
    });
    await appendTechnicalAudit({
      actorType: 'service', actorCode: principal.code, actorServiceId: principal.id,
      action: 'internal.gateway.b5.configure', entityType: 'gateway', entityId: gatewayId,
      companyId: principal.companyId, requestId: req.requestId,
      result: configuration.ok ? 'success' : 'failure', after: { results: configuration.results }
    });
    return res.status(configuration.ok ? 200 : 207).json(configuration);
  } catch (error) {
    if (error instanceof GatewayCommandBusyError || (error as any)?.code === '23505') return res.status(409).json({ message: 'Gateway already has an active command sequence' });
    console.error('Failed to configure B5 gateway from internal API', error);
    return res.status(500).json({ message: 'Failed to configure B5 gateway' });
  }
});

router.post('/gateways/:gatewayId/apply-rssi', requireCommand, async (req: ServiceAuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  const rssi = req.body?.rssi;
  if (!Number.isInteger(gatewayId) || gatewayId <= 0 || !Number.isInteger(rssi) || rssi < -127 || rssi > 0) {
    return res.status(400).json({ message: 'Invalid RSSI command' });
  }
  const principal = req.servicePrincipal!;
  try {
    const gateway = await scopedActiveGateway(gatewayId, principal.companyId);
    if (!gateway) return res.status(404).json({ message: 'Gateway not found' });
    const result = await configureGatewayRssi({
      gatewayId: gateway.id, companyId: gateway.company_id, gatewayMac: gateway.mac_address, rssi,
      actor: { type: 'service', serviceId: principal.id, code: principal.code },
      requestId: req.requestId, timeoutMs: managementCommandTimeoutMs()
    });
    await appendTechnicalAudit({
      actorType: 'service', actorCode: principal.code, actorServiceId: principal.id,
      action: 'internal.gateway.rssi.configure', entityType: 'gateway', entityId: gatewayId,
      companyId: principal.companyId, requestId: req.requestId,
      result: result.status === 'success' ? 'success' : 'failure', after: result
    });
    return res.status(result.status === 'success' ? 200 : result.status === 'timeout' ? 504 : 502).json(result);
  } catch (error) {
    if (error instanceof GatewayCommandBusyError || (error as any)?.code === '23505') return res.status(409).json({ message: 'Gateway already has an active command' });
    console.error('Failed to configure gateway RSSI from internal API', error);
    return res.status(500).json({ message: 'Failed to configure gateway RSSI' });
  }
});

export default router;
