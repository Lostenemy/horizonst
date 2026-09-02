import { Router } from 'express';
import { pool } from '../db/pool';
import {
  authenticateService,
  requireServiceScope,
  ServiceAuthenticatedRequest
} from '../middleware/serviceAuth';
import { HARDWARE_READ_SCOPE } from '../services/serviceIdentity';
import { normalizeGatewayMac, normalizeMacAddress } from '../utils/mac';
import { appendTechnicalAudit } from '../services/technicalAudit';

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

router.use(authenticateService, requireServiceScope(HARDWARE_READ_SCOPE));

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

router.get('/gateways', async (req: ServiceAuthenticatedRequest, res) => {
  try {
    const principal = req.servicePrincipal!;
    const result = await pool.query(
      `${gatewaySelect}
       WHERE g.company_id = $1 AND g.active = TRUE
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

router.get('/devices', async (req: ServiceAuthenticatedRequest, res) => {
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

router.get('/devices/by-mac/:mac', async (req: ServiceAuthenticatedRequest, res) => {
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

router.get('/devices/:deviceId', async (req: ServiceAuthenticatedRequest, res) => {
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

router.get('/gateways/by-mac/:mac', async (req: ServiceAuthenticatedRequest, res) => {
  const mac = normalizeGatewayMac(req.params.mac);
  if (!mac) return res.status(400).json({ message: 'MAC address is invalid' });
  try {
    const principal = req.servicePrincipal!;
    const result = await pool.query(
      `${gatewaySelect}
       WHERE regexp_replace(lower(g.mac_address), '[^0-9a-f]', '', 'g') = $1
         AND g.company_id = $2 AND g.active = TRUE`,
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

router.get('/gateways/:gatewayId', async (req: ServiceAuthenticatedRequest, res) => {
  const gatewayId = Number(req.params.gatewayId);
  if (!Number.isInteger(gatewayId) || gatewayId <= 0) {
    return res.status(400).json({ message: 'Invalid gateway id' });
  }
  try {
    const principal = req.servicePrincipal!;
    const result = await pool.query(
      `${gatewaySelect}
       WHERE g.id = $1 AND g.company_id = $2 AND g.active = TRUE`,
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

export default router;
