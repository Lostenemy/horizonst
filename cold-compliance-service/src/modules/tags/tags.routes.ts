import { Router } from 'express';
import { db } from '../../db/pool';
import { requireAuth, requireRoles } from '../../middleware/auth';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { listHardwareDevices, LocalTagReference, normalizeHorneoDeviceMac, resolveHardwareDevice } from './hardware-manager.client';

export const tagsRouter = Router();

const MIN_ACTION_DURATION_MS = 100;
const MAX_ACTION_DURATION_MS = 60000;

tagsRouter.use(requireAuth);

function parseOptionalInteger(value: unknown, field: string, min: number, max?: number): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || (max != null && parsed > max)) {
    const range = max == null ? `>= ${min}` : `entre ${min} y ${max}`;
    const error = new Error(`${field} debe ser un entero ${range}`) as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

tagsRouter.post('/', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    void req;
    res.status(409).json({ error: 'hardware_manager_authoritative', message: 'La creación técnica de dispositivos debe realizarse en Hardware Manager.' });
  } catch (e) { next(e); }
});

tagsRouter.get('/', async (_req, res, next) => {
  try {
    const result = await db.query(
      `SELECT t.*, (SELECT last_battery FROM tag_gateway_presence_state p
                    WHERE ((t.hardware_device_id IS NOT NULL AND p.hardware_device_id = t.hardware_device_id)
                           OR (p.hardware_device_id IS NULL AND p.tag_uid = regexp_replace(lower(t.tag_uid), '[-:]', '', 'g')))
                      AND last_battery IS NOT NULL
                    ORDER BY last_seen_at DESC LIMIT 1) as last_battery
       FROM tags t ORDER BY created_at DESC`
    );
    if (!env.HARDWARE_MANAGER_ENABLED) return res.json(result.rows.map((row) => ({ ...row, hardware_source: 'local_disabled' })));
    const central = await listHardwareDevices();
    if (central.kind === 'unavailable') {
      logger.warn({ error: central.error }, 'Hardware Manager unavailable; listing local tags');
      return res.json(result.rows.map((row) => ({ ...row, hardware_source: 'local_fallback' })));
    }
    const byId = new Map((central.kind === 'found' ? central.value : []).map((device) => [device.id, device]));
    return res.json(result.rows.map((row) => {
      const hardware = row.hardware_device_id ? byId.get(row.hardware_device_id) : undefined;
      return hardware ? {
        ...row,
        tag_uid: normalizeHorneoDeviceMac(hardware.ble_mac)?.toLowerCase(),
        model: hardware.name,
        active: hardware.active,
        status: hardware.status,
        device_type: hardware.device_type,
        technical_description: hardware.description,
        hardware_source: 'central'
      } : { ...row, hardware_source: 'central_not_found', hardware_active: false };
    }));
  } catch (e) { next(e); }
});

tagsRouter.get('/:id/hardware-resolution', async (req, res, next) => {
  try {
    const result = await db.query<LocalTagReference>(
      `SELECT id, tag_uid, hardware_device_id, model, active,
              physical_alarm_followup_delay_ms, physical_alarm_buzzer_duration_ms,
              physical_alarm_vibration_duration_ms
       FROM tags WHERE id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'not_found' });
    return res.json(await resolveHardwareDevice(result.rows[0]));
  } catch (e) { return next(e); }
});

tagsRouter.patch('/:id', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    const technicalFields = ['mac', 'descripcion', 'model', 'active', 'status', 'device_type', 'tag_uid'];
    if (technicalFields.some((field) => Object.prototype.hasOwnProperty.call(req.body, field))) {
      return res.status(409).json({ error: 'hardware_manager_authoritative', message: 'MAC, modelo y estado se gestionan en Hardware Manager.' });
    }
    const physicalAlarmFollowupDelayMs = parseOptionalInteger(req.body.physicalAlarmFollowupDelayMs, 'physicalAlarmFollowupDelayMs', 0);
    const physicalAlarmBuzzerDurationMs = parseOptionalInteger(req.body.physicalAlarmBuzzerDurationMs, 'physicalAlarmBuzzerDurationMs', MIN_ACTION_DURATION_MS, MAX_ACTION_DURATION_MS);
    const physicalAlarmVibrationDurationMs = parseOptionalInteger(req.body.physicalAlarmVibrationDurationMs, 'physicalAlarmVibrationDurationMs', MIN_ACTION_DURATION_MS, MAX_ACTION_DURATION_MS);
    if (physicalAlarmFollowupDelayMs === undefined && physicalAlarmBuzzerDurationMs === undefined && physicalAlarmVibrationDurationMs === undefined) {
      return res.status(400).json({ error: 'no_local_fields', message: 'Solo los tres tiempos de alarma física son editables localmente.' });
    }
    const result = await db.query(
      `UPDATE tags
       SET physical_alarm_followup_delay_ms = COALESCE($2, physical_alarm_followup_delay_ms),
           physical_alarm_buzzer_duration_ms = COALESCE($3, physical_alarm_buzzer_duration_ms),
           physical_alarm_vibration_duration_ms = COALESCE($4, physical_alarm_vibration_duration_ms),
           updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [
        req.params.id,
        physicalAlarmFollowupDelayMs ?? null,
        physicalAlarmBuzzerDurationMs ?? null,
        physicalAlarmVibrationDurationMs ?? null
      ]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json(result.rows[0]);
  } catch (e) { next(e); }
});

tagsRouter.delete('/:id', requireRoles(['superadministrador']), async (req, res, next) => {
  try {
    void req;
    res.status(409).json({ error: 'hardware_manager_authoritative', message: 'La baja técnica se gestiona en Hardware Manager; la referencia local se conserva por integridad histórica.' });
  } catch (e) { next(e); }
});
