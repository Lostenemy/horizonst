import { env } from '../../config/env';
import { db } from '../../db/pool';

interface PresenceSessionRow {
  id: string;
  worker_id: string | null;
  full_name: string;
  dni: string;
  tag_uid: string;
  started_at: string;
  elapsed_seconds: number;
  last_seen_at: string;
  ble_active: boolean | null;
  ble_disconnected_at: string | null;
}

export interface PresenceWorkerSummary {
  id: string;
  worker_id: string | null;
  full_name: string;
  dni: string;
  tag_uid: string;
  started_at: string;
  elapsed_seconds: number;
  since_last_detection_seconds: number;
  grace_remaining_seconds: number;
}

export interface PresenceStateSnapshot {
  inside: PresenceWorkerSummary[];
  grace: PresenceWorkerSummary[];
}

export async function loadPresenceStateSnapshot(): Promise<PresenceStateSnapshot> {
  const timeoutMs = Math.max(1000, Number(env.PRESENCE_EXIT_TIMEOUT_MS));
  const activeWindowMs = Math.max(1000, Number(env.PRESENCE_ACTIVE_WINDOW_MS));

  const sessions = await db.query<PresenceSessionRow>(
    `SELECT s.id,
            COALESCE(s.worker_id, wta.worker_id) AS worker_id,
            COALESCE(w.full_name, '(sin trabajador asignado)') AS full_name,
            COALESCE(w.dni, '-') AS dni,
            COALESCE(t.tag_uid, '') AS tag_uid,
            s.started_at,
            EXTRACT(EPOCH FROM (NOW() - s.started_at))::INT AS elapsed_seconds,
            COALESCE(MAX(pe.event_ts), s.started_at) AS last_seen_at,
            bs.is_active AS ble_active,
            bs.disconnected_at AS ble_disconnected_at
     FROM cold_room_sessions s
     LEFT JOIN tags t ON t.id = s.tag_id
     LEFT JOIN worker_tag_assignments wta ON wta.tag_id = s.tag_id AND wta.active = true
     LEFT JOIN workers w ON w.id = COALESCE(s.worker_id, wta.worker_id)
     LEFT JOIN ble_alarm_sessions bs ON bs.tag_id = s.tag_id
     LEFT JOIN presence_events pe
       ON regexp_replace(lower(pe.tag_uid), '[-:]', '', 'g') = regexp_replace(lower(t.tag_uid), '[-:]', '', 'g')
      AND pe.event_ts >= s.started_at
      AND pe.event_type IN ('enter', 'heartbeat', 'movement')
     WHERE s.ended_at IS NULL
     GROUP BY s.id, COALESCE(s.worker_id, wta.worker_id), COALESCE(w.full_name, '(sin trabajador asignado)'),
              COALESCE(w.dni, '-'), COALESCE(t.tag_uid, ''), s.started_at, bs.is_active, bs.disconnected_at
     ORDER BY s.started_at ASC`
  );

  const nowMs = Date.now();
  const inside: PresenceWorkerSummary[] = [];
  const grace: PresenceWorkerSummary[] = [];

  for (const row of sessions.rows) {
    let referenceTs = Date.parse(row.last_seen_at);
    if (!Number.isFinite(referenceTs)) {
      referenceTs = Date.parse(row.started_at);
    }

    if (row.ble_disconnected_at) {
      const bleDisconnectedMs = Date.parse(row.ble_disconnected_at);
      if (Number.isFinite(bleDisconnectedMs) && bleDisconnectedMs > referenceTs) {
        referenceTs = bleDisconnectedMs;
      }
    }

    const elapsedSinceLastSeenMs = Math.max(0, nowMs - referenceTs);
    const graceRemainingMs = Math.max(0, timeoutMs - elapsedSinceLastSeenMs);

    if (graceRemainingMs <= 0) {
      continue;
    }

    const workerSummary: PresenceWorkerSummary = {
      id: row.id,
      worker_id: row.worker_id,
      full_name: row.full_name,
      dni: row.dni,
      tag_uid: row.tag_uid,
      started_at: row.started_at,
      elapsed_seconds: Number(row.elapsed_seconds) || 0,
      since_last_detection_seconds: Math.floor(elapsedSinceLastSeenMs / 1000),
      grace_remaining_seconds: Math.floor(graceRemainingMs / 1000)
    };

    if (row.ble_active || elapsedSinceLastSeenMs <= activeWindowMs) {
      inside.push(workerSummary);
      continue;
    }

    grace.push(workerSummary);
  }

  return { inside, grace };
}
