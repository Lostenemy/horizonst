import { db } from '../../../db/pool';

export async function isBleSessionActive(params: { tagId: string }): Promise<boolean> {
  const result = await db.query<{ is_active: boolean }>(
    `SELECT is_active
     FROM ble_alarm_sessions
     WHERE tag_id = $1`,
    [params.tagId]
  );

  return Boolean(result.rows[0]?.is_active);
}

export async function markBleSessionActive(params: { tagId: string; tagUid: string; gatewayMac: string }): Promise<void> {
  await db.query(
    `INSERT INTO ble_alarm_sessions(tag_id, tag_uid, gateway_mac, is_active, connected_at, disconnected_at, updated_at)
     VALUES($1, $2, $3, TRUE, NOW(), NULL, NOW())
     ON CONFLICT (tag_id)
     DO UPDATE SET tag_uid = EXCLUDED.tag_uid,
                   gateway_mac = EXCLUDED.gateway_mac,
                   is_active = TRUE,
                   connected_at = NOW(),
                   disconnected_at = NULL,
                   updated_at = NOW()`,
    [params.tagId, params.tagUid.toLowerCase(), params.gatewayMac.toLowerCase()]
  );
}

export async function markBleSessionDisconnected(params: { tagId: string }): Promise<void> {
  await db.query(
    `UPDATE ble_alarm_sessions
     SET is_active = FALSE,
         disconnected_at = NOW(),
         updated_at = NOW()
     WHERE tag_id = $1`,
    [params.tagId]
  );
}
