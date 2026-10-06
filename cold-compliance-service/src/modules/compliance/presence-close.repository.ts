import { withControlledClient } from '../tag-control/infrastructure/controlled-presence.repository';
import { env } from '../../config/env';

export interface PresenceCloseInput {
  sessionId: string;
  endedAt: string;
  lastDetectionAt: string;
  closeEventId: string | null;
  reason: 'event' | 'timeout';
  timeoutMs: number;
  limits: { preAlertMinutes: number; continuousMinutes: number; dailyMinutes: number };
}

// The sweep and explicit exits share the canonical transaction and durable effects.
// Timestamp strings are PostgreSQL tokens, never reconstructed through Date.
export async function persistCanonicalPresenceClose(input: PresenceCloseInput): Promise<boolean> {
  return withControlledClient(async client => {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '500ms'");
    await client.query("SET LOCAL statement_timeout = '1500ms'");
    await client.query('SELECT id FROM cold_room_sessions WHERE id=$1 FOR UPDATE', [input.sessionId]);
    const exposureEnd = input.reason === 'timeout' ? input.lastDetectionAt : input.endedAt;
    const closed = await client.query<{
      id: string; tag_id: string; hardware_device_id: number;
      worker_id: string | null; cold_room_id: string | null; started_at: string;
    }>(`UPDATE cold_room_sessions
      SET ended_at=$1::timestamptz,
          duration_seconds=CASE WHEN $5::text='timeout'
            THEN FLOOR(GREATEST(0,EXTRACT(EPOCH FROM ($4::timestamptz-cold_room_sessions.started_at))))::int
            ELSE GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-cold_room_sessions.started_at)))::int END,
          close_event_id=COALESCE($2::text,cold_room_sessions.close_event_id)
      WHERE cold_room_sessions.id=$3 AND cold_room_sessions.ended_at IS NULL AND $1::timestamptz>=cold_room_sessions.started_at
        AND ($5::text<>'timeout' OR (
          $4::timestamptz + ($6::double precision * INTERVAL '1 millisecond') < clock_timestamp()
          AND NOT EXISTS (
            SELECT 1 FROM controlled_b5_presence_operations op
            WHERE op.hardware_device_id=cold_room_sessions.hardware_device_id AND op.session_id=cold_room_sessions.id
              AND LEAST(op.protect_until,$4::timestamptz+INTERVAL '60 seconds')>clock_timestamp()
          )))
        AND NOT EXISTS (
          SELECT 1 FROM tag_gateway_presence_state ps
          JOIN gateways g ON g.hardware_gateway_id=ps.hardware_gateway_id
          WHERE ps.hardware_device_id=cold_room_sessions.hardware_device_id
            AND ps.last_presence_at > $4::timestamptz AND ps.last_presence_at>=cold_room_sessions.started_at
            AND (cold_room_sessions.cold_room_id IS NULL OR g.cold_room_id=cold_room_sessions.cold_room_id)
        )
      RETURNING cold_room_sessions.id,cold_room_sessions.tag_id,cold_room_sessions.hardware_device_id,cold_room_sessions.worker_id,cold_room_sessions.cold_room_id,cold_room_sessions.started_at::text`,
    [input.endedAt,input.closeEventId,input.sessionId,exposureEnd,input.reason,input.timeoutMs]);
    if (!closed.rowCount) { await client.query('COMMIT'); return false; }
    const row = closed.rows[0];
    // The grace frontier is calculated in PostgreSQL, retaining microseconds.
    // An independently open session retains the existing operational state.
    await client.query(`INSERT INTO presence_operational_state
      (tag_id,hardware_device_id,worker_id,cold_room_id,inside,in_alarm,in_grace,updated_at)
      SELECT $1,$2,$3,$4,FALSE,FALSE,FALSE,clock_timestamp()
      WHERE NOT EXISTS (SELECT 1 FROM cold_room_sessions WHERE hardware_device_id=$2 AND ended_at IS NULL)
      ON CONFLICT (hardware_device_id) WHERE hardware_device_id IS NOT NULL DO UPDATE
      SET inside=FALSE,
          in_grace=presence_operational_state.in_alarm OR presence_operational_state.last_alarm_at IS NOT NULL,
          grace_started_at=CASE WHEN presence_operational_state.in_alarm OR presence_operational_state.last_alarm_at IS NOT NULL
            THEN $5::timestamptz ELSE presence_operational_state.grace_started_at END,
          grace_until=CASE WHEN presence_operational_state.in_alarm OR presence_operational_state.last_alarm_at IS NOT NULL
            THEN $5::timestamptz+(COALESCE((SELECT alarm_visibility_grace_minutes FROM alarm_rules
              WHERE active=TRUE ORDER BY updated_at DESC LIMIT 1),$6)::double precision*INTERVAL '1 minute') ELSE NULL END,
          in_alarm=FALSE,reminder_sent_at=NULL,updated_at=clock_timestamp()
      WHERE NOT EXISTS (SELECT 1 FROM cold_room_sessions WHERE hardware_device_id=$2 AND ended_at IS NULL)`,
    [row.tag_id,row.hardware_device_id,row.worker_id,row.cold_room_id,input.lastDetectionAt,
      Math.max(1,Number(env.OPERATIONAL_GRACE_MINUTES))]);
    // Construct the payload from known columns only, never raw MQTT or caller secrets.
    await client.query(`INSERT INTO presence_close_outbox(session_id,payload)
      VALUES($1,$2::jsonb) ON CONFLICT (session_id) DO NOTHING`,
    [row.id,JSON.stringify({sessionId:row.id,tagId:row.tag_id,hardwareDeviceId:row.hardware_device_id,
      workerId:row.worker_id,coldRoomId:row.cold_room_id,startedAt:row.started_at,
      exposureEndedAt:exposureEnd,lastDetectionAt:input.lastDetectionAt,reason:input.reason,limits:input.limits})]);
    await client.query('COMMIT');
    return true;
  });
}
