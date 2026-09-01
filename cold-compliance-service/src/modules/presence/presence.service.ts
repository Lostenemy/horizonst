import { db } from '../../db/pool';
import { env } from '../../config/env';
import { appendAuditLog } from '../audit/audit.service';
import { processComplianceRules } from '../compliance/compliance.service';
import { ParsedPresenceEvent } from './types';

export async function ingestPresenceEvent(event: ParsedPresenceEvent): Promise<void> {
  const tagUid = event.tagId.replace(/[:-]/g, '').toLowerCase();
  const gatewayMac = event.gatewayMac.replace(/[:-]/g, '').toLowerCase();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO tag_gateway_presence_state(
         tag_uid, gateway_mac, last_seen_at, last_rssi, last_battery, last_event_id, updated_at
       ) VALUES($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (tag_uid, gateway_mac)
       DO UPDATE SET last_seen_at = GREATEST(tag_gateway_presence_state.last_seen_at, EXCLUDED.last_seen_at),
                     last_rssi = CASE WHEN EXCLUDED.last_seen_at >= tag_gateway_presence_state.last_seen_at
                                      THEN COALESCE(EXCLUDED.last_rssi, tag_gateway_presence_state.last_rssi)
                                      ELSE tag_gateway_presence_state.last_rssi END,
                     last_battery = CASE WHEN EXCLUDED.last_seen_at >= tag_gateway_presence_state.last_seen_at
                                         THEN COALESCE(EXCLUDED.last_battery, tag_gateway_presence_state.last_battery)
                                         ELSE tag_gateway_presence_state.last_battery END,
                     last_event_id = CASE WHEN EXCLUDED.last_seen_at >= tag_gateway_presence_state.last_seen_at
                                          THEN EXCLUDED.last_event_id ELSE tag_gateway_presence_state.last_event_id END,
                     updated_at = NOW()`,
      [tagUid, gatewayMac, event.timestamp, event.rssi ?? null, event.battery ?? null, event.eventId]
    );

    const save = await client.query(
      `INSERT INTO presence_events(event_id, gateway_mac, tag_uid, camera_code, event_type, event_ts, rssi, battery, payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, gatewayMac, tagUid, event.cameraCode ?? null, event.eventType, event.timestamp, event.rssi ?? null, event.battery ?? null, event.rawPayload]
    );

    if (!save.rowCount) {
      await client.query('COMMIT');
      return;
    }

    if (env.SYNC_QUEUE_ENABLED && !['heartbeat', 'telemetry', 'movement'].includes(event.eventType)) {
      await client.query(
        `INSERT INTO sync_queue(entity_type, entity_id, action, payload)
         VALUES('presence_event', $1, 'create', $2)
         ON CONFLICT (entity_type, entity_id, action) DO NOTHING`,
        [event.eventId, event.rawPayload]
      );
    }

    await client.query('COMMIT');
    await processComplianceRules(event);
    if (event.eventType === 'enter' || event.eventType === 'exit') {
      await appendAuditLog({
        actorType: 'system',
        action: `presence_${event.eventType}`,
        entityType: 'presence_event',
        entityId: event.eventId,
        payload: { gatewayMac, tagId: tagUid, eventType: event.eventType }
      });
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
