import { env } from '../../../config/env';
import { db } from '../../../db/pool';

export async function isBleSessionActive(params: { tagId: string; hardwareDeviceId?: number | null; query?: typeof db.query }): Promise<boolean> {
  if (!Number.isInteger(params.hardwareDeviceId)) {
    throw new Error('central_hardware_mapping_required: BLE sessions require hardwareDeviceId');
  }
  const result = await (params.query ?? db.query.bind(db))<{ is_active: boolean }>(
    `SELECT is_active AND lease_expires_at > NOW() AS is_active
     FROM ble_alarm_sessions
     WHERE hardware_device_id = $1`,
    [params.hardwareDeviceId ?? null]
  );

  return Boolean(result.rows[0]?.is_active);
}

export async function markBleSessionActive(params: { tagId: string; hardwareDeviceId?: number | null; tagUid: string; gatewayMac: string;
  operationId?: string; query?: typeof db.query }): Promise<void> {
  if (!Number.isInteger(params.hardwareDeviceId)) {
    throw new Error('central_hardware_mapping_required: BLE sessions require hardwareDeviceId');
  }
  await (params.query ?? db.query.bind(db))(
    `INSERT INTO ble_alarm_sessions(tag_id, hardware_device_id, tag_uid, gateway_mac, is_active, connected_at, disconnected_at,
                                    lease_expires_at, disconnect_requested_at, disconnect_confirmed_at, last_error, updated_at)
     SELECT $1, $2, $3, $4, TRUE, NOW(), NULL,
       CASE WHEN $6::uuid IS NULL THEN NOW() + $5::interval ELSE (
         SELECT LEAST(NOW() + $5::interval, op.hard_deadline) FROM controlled_b5_presence_operations op
         WHERE op.hardware_device_id = $2 AND op.operation_id = $6
       ) END, NULL, NULL, NULL, NOW()
     WHERE $6::uuid IS NULL OR EXISTS (
       SELECT 1 FROM controlled_b5_presence_operations op WHERE op.hardware_device_id = $2
       AND op.operation_id = $6 AND op.outcome = 'running' AND op.hard_deadline > clock_timestamp()
     )
     ON CONFLICT (hardware_device_id) WHERE hardware_device_id IS NOT NULL
     DO UPDATE SET tag_id = EXCLUDED.tag_id,
                   hardware_device_id = EXCLUDED.hardware_device_id,
                   tag_uid = EXCLUDED.tag_uid,
                   gateway_mac = EXCLUDED.gateway_mac,
                   is_active = TRUE,
                   connected_at = NOW(),
                   disconnected_at = NULL,
                   lease_expires_at = EXCLUDED.lease_expires_at,
                   disconnect_requested_at = NULL,
                   disconnect_confirmed_at = NULL,
                   last_error = NULL,
                   updated_at = NOW()`,
    [params.tagId, params.hardwareDeviceId, params.tagUid.toLowerCase(), params.gatewayMac.toLowerCase(), `${Math.max(1000, env.TAG_ALARM_BLE_SESSION_TTL_MS)} milliseconds`, params.operationId ?? null]
  );
}

export async function markBleSessionDisconnected(params: { tagId: string; hardwareDeviceId?: number | null; confirmed?: boolean; error?: string;
  operationId?: string; query?: typeof db.query }): Promise<void> {
  if (!Number.isInteger(params.hardwareDeviceId)) {
    throw new Error('central_hardware_mapping_required: BLE sessions require hardwareDeviceId');
  }
  await (params.query ?? db.query.bind(db))(
    `UPDATE ble_alarm_sessions
     SET is_active = FALSE,
         disconnected_at = NOW(),
         disconnect_requested_at = NOW(),
         disconnect_confirmed_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
         last_error = $3,
         updated_at = NOW()
     WHERE hardware_device_id = $1 AND ($4::uuid IS NULL OR EXISTS (
       SELECT 1 FROM controlled_b5_presence_operations op WHERE op.hardware_device_id = $1 AND op.operation_id = $4
     ))`,
    [params.hardwareDeviceId, params.confirmed === true, params.error ?? null, params.operationId ?? null]
  );
}

export async function reconcileExpiredBleSessions(): Promise<number> {
  const result = await db.query(
    `UPDATE ble_alarm_sessions
     SET is_active = FALSE,
         disconnected_at = COALESCE(disconnected_at, NOW()),
         last_error = COALESCE(last_error, 'BLE lease expired without confirmed disconnect'),
         updated_at = NOW()
     WHERE is_active = TRUE
       AND (lease_expires_at IS NULL OR lease_expires_at <= NOW())`
  );
  return result.rowCount ?? 0;
}
