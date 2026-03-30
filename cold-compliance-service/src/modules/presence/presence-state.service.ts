import { db } from '../../db/pool';

interface InsideSessionRow {
  id: string;
  worker_id: string | null;
  full_name: string;
  dni: string;
  tag_uid: string;
  started_at: string;
  elapsed_seconds: number;
  has_active_critical_alert: boolean;
}

interface GraceSessionRow {
  id: string;
  worker_id: string | null;
  full_name: string;
  dni: string;
  tag_uid: string;
  ended_at: string;
  grace_minutes: number;
  since_exit_seconds: number;
  grace_remaining_seconds: number;
}

export interface PresenceWorkerSummary {
  id: string;
  worker_id: string | null;
  full_name: string;
  dni: string;
  tag_uid: string;
  started_at?: string;
  ended_at?: string;
  elapsed_seconds?: number;
  since_exit_seconds?: number;
  grace_minutes?: number;
  grace_remaining_seconds?: number;
  has_active_critical_alert?: boolean;
}

export interface PresenceStateSnapshot {
  inside: PresenceWorkerSummary[];
  grace: PresenceWorkerSummary[];
}

export async function loadPresenceStateSnapshot(): Promise<PresenceStateSnapshot> {
  const [insideSessions, graceSessions] = await Promise.all([
    db.query<InsideSessionRow>(
      `SELECT s.id,
              COALESCE(s.worker_id, wta.worker_id) AS worker_id,
              COALESCE(w.full_name, '(sin trabajador asignado)') AS full_name,
              COALESCE(w.dni, '-') AS dni,
              COALESCE(t.tag_uid, '') AS tag_uid,
              s.started_at,
              EXTRACT(EPOCH FROM (NOW() - s.started_at))::INT AS elapsed_seconds,
              EXISTS(
                SELECT 1
                FROM alerts a
                WHERE a.tag_id = s.tag_id
                  AND a.acknowledged_at IS NULL
                  AND a.severity = 'critical'
                  AND a.created_at >= s.started_at
              ) AS has_active_critical_alert
       FROM cold_room_sessions s
       LEFT JOIN tags t ON t.id = s.tag_id
       LEFT JOIN worker_tag_assignments wta ON wta.tag_id = s.tag_id AND wta.active = true
       LEFT JOIN workers w ON w.id = COALESCE(s.worker_id, wta.worker_id)
       WHERE s.ended_at IS NULL
       ORDER BY s.started_at ASC`
    ),
    db.query<GraceSessionRow>(
      `WITH cfg AS (
         SELECT COALESCE((
           SELECT alarm_visibility_grace_minutes
           FROM alarm_rules
           ORDER BY updated_at DESC
           LIMIT 1
         ), 15) AS default_grace_minutes
       ), alarmed_sessions AS (
         SELECT s.id,
                s.tag_id,
                s.started_at,
                s.ended_at,
                COALESCE(s.worker_id, wta.worker_id) AS worker_id,
                COALESCE(w.full_name, '(sin trabajador asignado)') AS full_name,
                COALESCE(w.dni, '-') AS dni,
                COALESCE(t.tag_uid, '') AS tag_uid,
                (
                  SELECT a.metadata->>'ruleId'
                  FROM alerts a
                  WHERE a.tag_id = s.tag_id
                    AND a.severity = 'critical'
                    AND a.created_at >= s.started_at
                    AND a.created_at <= s.ended_at
                  ORDER BY a.created_at DESC
                  LIMIT 1
                ) AS alarm_rule_id
         FROM cold_room_sessions s
         LEFT JOIN tags t ON t.id = s.tag_id
         LEFT JOIN worker_tag_assignments wta ON wta.tag_id = s.tag_id AND wta.active = true
         LEFT JOIN workers w ON w.id = COALESCE(s.worker_id, wta.worker_id)
         WHERE s.ended_at IS NOT NULL
           AND EXISTS(
             SELECT 1
             FROM alerts a
             WHERE a.tag_id = s.tag_id
               AND a.severity = 'critical'
               AND a.created_at >= s.started_at
               AND a.created_at <= s.ended_at
           )
           AND NOT EXISTS(
             SELECT 1
             FROM cold_room_sessions open_session
             WHERE open_session.tag_id = s.tag_id
               AND open_session.ended_at IS NULL
           )
       )
       SELECT alarmed.id,
              alarmed.worker_id,
              alarmed.full_name,
              alarmed.dni,
              alarmed.tag_uid,
              alarmed.ended_at,
              COALESCE(rule.alarm_visibility_grace_minutes, cfg.default_grace_minutes) AS grace_minutes,
              EXTRACT(EPOCH FROM (NOW() - alarmed.ended_at))::INT AS since_exit_seconds,
              GREATEST(0, EXTRACT(EPOCH FROM ((alarmed.ended_at + (COALESCE(rule.alarm_visibility_grace_minutes, cfg.default_grace_minutes) * INTERVAL '1 minute')) - NOW())))::INT AS grace_remaining_seconds
       FROM alarmed_sessions alarmed
       CROSS JOIN cfg
       LEFT JOIN alarm_rules rule ON rule.id::text = alarmed.alarm_rule_id
       WHERE NOW() < (alarmed.ended_at + (COALESCE(rule.alarm_visibility_grace_minutes, cfg.default_grace_minutes) * INTERVAL '1 minute'))
       ORDER BY alarmed.ended_at DESC`
    )
  ]);

  return {
    inside: insideSessions.rows.map((row) => ({
      id: row.id,
      worker_id: row.worker_id,
      full_name: row.full_name,
      dni: row.dni,
      tag_uid: row.tag_uid,
      started_at: row.started_at,
      elapsed_seconds: Number(row.elapsed_seconds) || 0,
      grace_remaining_seconds: 0,
      since_exit_seconds: 0,
      grace_minutes: 0,
      has_active_critical_alert: row.has_active_critical_alert
    })),
    grace: graceSessions.rows.map((row) => ({
      id: row.id,
      worker_id: row.worker_id,
      full_name: row.full_name,
      dni: row.dni,
      tag_uid: row.tag_uid,
      ended_at: row.ended_at,
      since_exit_seconds: Number(row.since_exit_seconds) || 0,
      grace_minutes: Number(row.grace_minutes) || 0,
      grace_remaining_seconds: Number(row.grace_remaining_seconds) || 0,
      has_active_critical_alert: false
    }))
  };
}
