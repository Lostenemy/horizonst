import { env } from '../../../config/env';
import { db } from '../../../db/pool';

export async function isBleSessionActive(params: { tagId: string }): Promise<boolean> {
  const result = await db.query<{ is_active: boolean }>(
    `SELECT is_active AND lease_expires_at > NOW() AS is_active
     FROM ble_alarm_sessions
     WHERE tag_id = $1`,
    [params.tagId]
  );

  return Boolean(result.rows[0]?.is_active);
}

export async function markBleSessionActive(params: { tagId: string; tagUid: string; gatewayMac: string }): Promise<void> {
  await db.query(
    `INSERT INTO ble_alarm_sessions(tag_id, tag_uid, gateway_mac, is_active, connected_at, disconnected_at,
                                    lease_expires_at, disconnect_requested_at, disconnect_confirmed_at, last_error, updated_at)
     VALUES($1, $2, $3, TRUE, NOW(), NULL, NOW() + $4::interval, NULL, NULL, NULL, NOW())
     ON CONFLICT (tag_id)
     DO UPDATE SET tag_uid = EXCLUDED.tag_uid,
                   gateway_mac = EXCLUDED.gateway_mac,
                   is_active = TRUE,
                   connected_at = NOW(),
                   disconnected_at = NULL,
                   lease_expires_at = NOW() + $4::interval,
                   disconnect_requested_at = NULL,
                   disconnect_confirmed_at = NULL,
                   last_error = NULL,
                   updated_at = NOW()`,
    [params.tagId, params.tagUid.toLowerCase(), params.gatewayMac.toLowerCase(), `${Math.max(1000, env.TAG_ALARM_BLE_SESSION_TTL_MS)} milliseconds`]
  );
}

export async function markBleSessionDisconnected(params: { tagId: string; confirmed?: boolean; error?: string }): Promise<void> {
  await db.query(
    `UPDATE ble_alarm_sessions
     SET is_active = FALSE,
         disconnected_at = NOW(),
         disconnect_requested_at = NOW(),
         disconnect_confirmed_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
         last_error = $3,
         updated_at = NOW()
     WHERE tag_id = $1`,
    [params.tagId, params.confirmed === true, params.error ?? null]
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
