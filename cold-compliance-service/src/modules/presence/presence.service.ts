import { db } from '../../db/pool';
import { appendAuditLog } from '../audit/audit.service';
import { processComplianceRules } from '../compliance/compliance.service';
import { ParsedPresenceEvent } from './types';

export async function ingestPresenceEvent(event: ParsedPresenceEvent): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const save = await client.query(
      `INSERT INTO presence_events(event_id, gateway_mac, tag_uid, camera_code, event_type, event_ts, rssi, battery, payload)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, event.gatewayMac, event.tagId, event.cameraCode ?? null, event.eventType, event.timestamp, event.rssi ?? null, event.battery ?? null, event.rawPayload]
    );

    if (!save.rowCount) {
      await client.query('ROLLBACK');
      return;
    }

    await client.query(
      `INSERT INTO sync_queue(entity_type, entity_id, action, payload)
       VALUES('presence_event', $1, 'create', $2)`,
      [event.eventId, event.rawPayload]
    );

    await client.query('COMMIT');
    await processComplianceRules(event);
    await appendAuditLog({
      actorType: 'system',
      action: 'presence_event_ingested',
      entityType: 'presence_event',
      entityId: event.eventId,
      payload: { gatewayMac: event.gatewayMac, tagId: event.tagId, eventType: event.eventType }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
