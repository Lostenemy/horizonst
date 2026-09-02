import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { db } from '../../db/pool';
import { requireAuth, requireRoles } from '../../middleware/auth';
import { logger } from '../../utils/logger';
import { listHardwareGateways, LocalGatewayReference, normalizeHorneoGatewayMac, resolveHardwareGateway } from './hardware-manager.client';
import { executeHardwareGatewayManagementCommand } from '../hardware-manager/hardware-command.client';

export const gatewaysRouter = Router();
gatewaysRouter.use(requireAuth);

const rssiThresholdSchema = z.number().int().min(-127).max(0);

const gatewayPayloadSchema = z.object({
  mac: z.string().min(1).optional(),
  descripcion: z.string().optional().nullable(),
  rssiThreshold: rssiThresholdSchema.optional(),
  rssi_threshold: rssiThresholdSchema.optional(),
  active: z.boolean().optional()
});

const applyRssiSchema = z.object({
  rssi: rssiThresholdSchema.optional(),
  rssiThreshold: rssiThresholdSchema.optional(),
  rssi_threshold: rssiThresholdSchema.optional()
});

function normalizeRssiThreshold(input: { rssiThreshold?: number; rssi_threshold?: number }): number | undefined {
  return input.rssiThreshold ?? input.rssi_threshold;
}

function httpError(message: string, statusCode: number): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export async function resolveGatewayMacForCommand(local: LocalGatewayReference, deps?: { fetch?: typeof fetch }): Promise<string> {
  const resolution = await resolveHardwareGateway(local, deps);
  if (resolution.source === 'central_not_found') throw httpError('Gateway central no encontrado para el vínculo reconciliado', 409);
  if (resolution.source === 'central') {
    if (!resolution.central?.active) throw httpError('Gateway inactivo en Hardware Manager', 409);
    const centralMac = normalizeHorneoGatewayMac(resolution.central.mac_address);
    if (!centralMac) throw httpError('MAC central de gateway inválida', 409);
    return centralMac;
  }
  const localMac = normalizeHorneoGatewayMac(local.gateway_mac);
  if (!localMac) throw httpError('MAC local de gateway inválida', 409);
  return localMac;
}

gatewaysRouter.get('/', async (_req, res, next) => {
  try {
    const localRows = (await db.query('SELECT * FROM gateways ORDER BY created_at DESC')).rows;
    if (!env.HARDWARE_MANAGER_ENABLED) return res.json(localRows.map((row) => ({ ...row, hardware_source: 'local_disabled' })));
    const central = await listHardwareGateways();
    if (central.kind === 'unavailable') {
      logger.warn({ error: central.error }, 'Hardware Manager unavailable; listing local gateways');
      return res.json(localRows.map((row) => ({ ...row, hardware_source: 'local_fallback' })));
    }
    const byId = new Map((central.kind === 'found' ? central.value : []).map((gateway) => [gateway.id, gateway]));
    return res.json(localRows.map((row) => {
      const hardware = row.hardware_gateway_id ? byId.get(row.hardware_gateway_id) : undefined;
      return hardware ? {
        ...row,
        gateway_mac: normalizeHorneoGatewayMac(hardware.mac_address),
        description: hardware.description,
        active: hardware.active,
        hardware_name: hardware.name,
        hardware_source: 'central'
      } : { ...row, hardware_source: 'central_not_found', hardware_active: false };
    }));
  } catch (error) {
    next(error);
  }
});

gatewaysRouter.get('/:id/hardware-resolution', async (req, res, next) => {
  try {
    const gateway = await db.query<{
      id: string;
      gateway_mac: string;
      hardware_gateway_id: number | null;
      rssi_threshold: number;
      cold_room_id: string | null;
      plant_id: string | null;
    }>(
      `SELECT id, gateway_mac, hardware_gateway_id, rssi_threshold, cold_room_id, plant_id
       FROM gateways WHERE id = $1`,
      [req.params.id]
    );
    if (!gateway.rowCount) return res.status(404).json({ error: 'not_found' });
    return res.json(await resolveHardwareGateway(gateway.rows[0]));
  } catch (error) {
    next(error);
  }
});

gatewaysRouter.post('/', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    gatewayPayloadSchema.parse(req.body);
    res.status(409).json({ error: 'hardware_manager_authoritative', message: 'La creación técnica de gateways debe realizarse en Hardware Manager.' });
  } catch (error) {
    next(error);
  }
});

gatewaysRouter.patch('/:id', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const parsed = gatewayPayloadSchema.parse(req.body);
    if (parsed.mac !== undefined || parsed.descripcion !== undefined || parsed.active !== undefined) {
      return res.status(409).json({ error: 'hardware_manager_authoritative', message: 'MAC, descripción y estado se gestionan en Hardware Manager.' });
    }
    const rssiThreshold = normalizeRssiThreshold(parsed);
    if (rssiThreshold === undefined) return res.status(400).json({ error: 'no_local_fields', message: 'Solo rssiThreshold es editable localmente.' });
    const result = await db.query(
      `UPDATE gateways
       SET rssi_threshold = $2
       WHERE id = $1 RETURNING *`,
      [req.params.id, rssiThreshold]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

gatewaysRouter.post('/:id/apply-rssi', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const parsed = applyRssiSchema.parse(req.body);
    const gateway = await db.query<LocalGatewayReference>('SELECT id, gateway_mac, hardware_gateway_id, rssi_threshold, cold_room_id, plant_id FROM gateways WHERE id = $1', [req.params.id]);
    if (!gateway.rowCount) return res.status(404).json({ error: 'not_found' });
    if (!gateway.rows[0].hardware_gateway_id) return res.status(409).json({ error: 'hardware_manager_mapping_required' });

    const rssi = parsed.rssi ?? normalizeRssiThreshold(parsed) ?? gateway.rows[0].rssi_threshold;
    const result = await executeHardwareGatewayManagementCommand({
      hardwareGatewayId: gateway.rows[0].hardware_gateway_id,
      action: 'apply-rssi',
      body: { rssi }
    });
    logger[result.status === 200 ? 'info' : 'warn']({ gatewayId: req.params.id, hardwareGatewayId: gateway.rows[0].hardware_gateway_id, rssi, status: result.status }, 'central RSSI command completed');
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

gatewaysRouter.post('/:id/configure-emergency-button', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const gateway = await db.query<LocalGatewayReference>('SELECT id, gateway_mac, hardware_gateway_id, rssi_threshold, cold_room_id, plant_id FROM gateways WHERE id = $1', [req.params.id]);
    if (!gateway.rowCount) return res.status(404).json({ error: 'not_found' });
    if (!gateway.rows[0].hardware_gateway_id) return res.status(409).json({ error: 'hardware_manager_mapping_required' });

    const result = await executeHardwareGatewayManagementCommand({
      hardwareGatewayId: gateway.rows[0].hardware_gateway_id,
      action: 'configure-emergency-button'
    });
    logger[result.status === 200 ? 'info' : 'warn']({ gatewayId: req.params.id, hardwareGatewayId: gateway.rows[0].hardware_gateway_id, status: result.status }, 'central emergency button configuration completed');
    res.status(result.status).json(result.body);
  } catch (error) {
    next(error);
  }
});

gatewaysRouter.delete('/:id', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    res.status(409).json({ error: 'hardware_manager_authoritative', message: 'La baja técnica se gestiona en Hardware Manager; la referencia local se conserva por integridad histórica.' });
  } catch (error: any) {
    if (error?.code === '23503') {
      return res.status(409).json({ error: 'dependency_conflict', entity: 'gateway', message: 'No se puede borrar el gateway porque está referenciado por otras tablas' });
    }
    next(error);
  }
});
