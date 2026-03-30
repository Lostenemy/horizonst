import { env } from '../../config/env';
import { db } from '../../db/pool';
import { createAlert } from '../alerts/alerts.service';
import { resolveOperationalAlarmTable } from '../alerts/alarm-table-resolver';
import { openIncident } from '../incidents/incidents.service';
import { ParsedPresenceEvent } from '../presence/types';
import {
  sendCriticalExposureAlert,
  sendEarlyReentryBlockedAlert,
  sendPreLimitAlert
} from '../tag-control/application/tag-control.service';
import { logger } from '../../utils/logger';

interface ActiveSession {
  id: string;
  started_at: string;
  worker_id: string | null;
  cold_room_id: string | null;
}

interface SessionContext {
  id: string;
  started_at: string;
  worker_id: string | null;
  cold_room_id: string | null;
  tag_id: string;
  max_continuous_minutes: number;
  pre_alert_minutes: number;
  max_daily_minutes: number;
}

interface LastClosedSession {
  id: string;
  started_at: string;
  ended_at: string;
}

interface PreviousCriticalContext {
  previousSessionId: string;
  hasCriticalAlarm: boolean;
  withinGrace: boolean;
  graceMinutes: number;
  minutesOutside: number;
}

const REENTRY_GRACE_ALERT_TYPE = 'grace_reentry_alarm';
const REENTRY_GRACE_REMINDER_ALERT_TYPE = 'grace_reentry_alarm_reminder';

async function evaluateOperationalAlarmRules(tag: {
  id: string;
  worker_id: string | null;
  cold_room_id: string | null;
}): Promise<void> {
  const alarmTable = await resolveOperationalAlarmTable();
  const sessionRes = await db.query<ActiveSession>(
    `SELECT id, started_at, worker_id, cold_room_id
     FROM cold_room_sessions
     WHERE tag_id = $1 AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [tag.id]
  );
  if (!sessionRes.rowCount) return;

  const session = sessionRes.rows[0];
  const rules = (await db.query(
    `SELECT id, description, buzzer_shaker_minutes, alarm_minutes
     FROM alarm_rules
     WHERE active = true
     ORDER BY created_at ASC`
  )).rows;
  if (!rules.length) return;

  const elapsedMinutes = (Date.now() - Date.parse(session.started_at)) / 60000;

  for (const rule of rules) {
    const warningKey = { sessionId: session.id, ruleId: rule.id, stage: 'warning' };
    const alarmKey = { sessionId: session.id, ruleId: rule.id, stage: 'alarm' };

    if (elapsedMinutes >= Number(rule.buzzer_shaker_minutes)) {
      const existsWarning = await db.query(
        `SELECT 1 FROM ${alarmTable}
         WHERE alert_type = 'alarm_rule_warning'
           AND acknowledged_at IS NULL
           AND metadata @> $1::jsonb
         LIMIT 1`,
        [JSON.stringify(warningKey)]
      );
      if (!existsWarning.rowCount) {
        await createAlert({
          workerId: session.worker_id ?? undefined,
          tagId: tag.id,
          coldRoomId: session.cold_room_id ?? undefined,
          severity: 'warning',
          alertType: 'alarm_rule_warning',
          message: `${rule.description} · aviso buzzer/shaker (${Math.floor(elapsedMinutes)} min dentro)`,
          metadata: { ...warningKey, thresholdMinutes: Number(rule.buzzer_shaker_minutes), elapsedMinutes }
        });
      }
    }

    if (elapsedMinutes >= Number(rule.alarm_minutes)) {
      const existsAlarm = await db.query(
        `SELECT 1 FROM ${alarmTable}
         WHERE alert_type = 'alarm_rule_alarm'
           AND acknowledged_at IS NULL
           AND metadata @> $1::jsonb
         LIMIT 1`,
        [JSON.stringify(alarmKey)]
      );
      if (!existsAlarm.rowCount) {
        await createAlert({
          workerId: session.worker_id ?? undefined,
          tagId: tag.id,
          coldRoomId: session.cold_room_id ?? undefined,
          severity: 'critical',
          alertType: 'alarm_rule_alarm',
          message: `${rule.description} · alarma por permanencia (${Math.floor(elapsedMinutes)} min dentro)`,
          metadata: { ...alarmKey, thresholdMinutes: Number(rule.alarm_minutes), elapsedMinutes }
        });
      }
    }
  }
}

async function resolvePreviousCriticalContext(tagId: string, eventTs: string): Promise<PreviousCriticalContext | null> {
  const alarmTable = await resolveOperationalAlarmTable();
  const lastClosedSession = await db.query<LastClosedSession>(
    `SELECT id, started_at, ended_at
     FROM cold_room_sessions
     WHERE tag_id = $1 AND ended_at IS NOT NULL
     ORDER BY ended_at DESC LIMIT 1`,
    [tagId]
  );

  if (!lastClosedSession.rowCount) return null;
  const previousSession = lastClosedSession.rows[0];

  const criticalAlert = await db.query<{ rule_id: string | null; grace_minutes_override: string | null }>(
    `SELECT (
        SELECT a.metadata->>'ruleId'
        FROM ${alarmTable} a
        WHERE a.tag_id = $1
          AND a.severity = 'critical'
          AND a.metadata ? 'ruleId'
          AND (
            (a.metadata ? 'sessionId' AND a.metadata->>'sessionId' = $2)
            OR (a.created_at >= $3::timestamptz AND a.created_at <= $4::timestamptz)
          )
        ORDER BY a.created_at DESC
        LIMIT 1
      ) AS rule_id,
      (
        SELECT a.metadata->>'reentryGraceMinutes'
        FROM ${alarmTable} a
        WHERE a.tag_id = $1
          AND a.severity = 'critical'
          AND a.metadata ? 'reentryGraceMinutes'
          AND (
            (a.metadata ? 'sessionId' AND a.metadata->>'sessionId' = $2)
            OR (a.created_at >= $3::timestamptz AND a.created_at <= $4::timestamptz)
          )
        ORDER BY a.created_at DESC
        LIMIT 1
      ) AS grace_minutes_override`,
    [tagId, previousSession.id, previousSession.started_at, previousSession.ended_at]
  );

  const hasCriticalAlarm = await db.query(
    `SELECT 1
     FROM ${alarmTable} a
     WHERE a.tag_id = $1
       AND a.severity = 'critical'
       AND (
         (a.metadata ? 'sessionId' AND a.metadata->>'sessionId' = $2)
         OR (a.created_at >= $3::timestamptz AND a.created_at <= $4::timestamptz)
       )
     LIMIT 1`,
    [tagId, previousSession.id, previousSession.started_at, previousSession.ended_at]
  );

  if (!hasCriticalAlarm.rowCount) {
    return {
      previousSessionId: previousSession.id,
      hasCriticalAlarm: false,
      withinGrace: false,
      graceMinutes: 0,
      minutesOutside: (Date.parse(eventTs) - Date.parse(previousSession.ended_at)) / 60000
    };
  }

  const ruleId = criticalAlert.rows[0].rule_id;
  const graceOverride = Number(criticalAlert.rows[0].grace_minutes_override ?? NaN);
  const graceByRuleRes = await db.query<{ alarm_visibility_grace_minutes: number }>(
    `SELECT alarm_visibility_grace_minutes
     FROM alarm_rules
     WHERE id::text = $1
     LIMIT 1`,
    [ruleId ?? '']
  );
  const defaultGraceRes = await db.query<{ grace_minutes: number }>(
    `SELECT COALESCE((
       SELECT alarm_visibility_grace_minutes
       FROM alarm_rules
       ORDER BY updated_at DESC
       LIMIT 1
     ), 15) AS grace_minutes`
  );

  const graceMinutes = Number.isFinite(graceOverride) && graceOverride > 0
    ? graceOverride
    : (graceByRuleRes.rows[0]?.alarm_visibility_grace_minutes ?? defaultGraceRes.rows[0]?.grace_minutes ?? 15);
  const minutesOutside = (Date.parse(eventTs) - Date.parse(previousSession.ended_at)) / 60000;

  return {
    previousSessionId: previousSession.id,
    hasCriticalAlarm: true,
    withinGrace: minutesOutside < graceMinutes,
    graceMinutes,
    minutesOutside
  };
}

async function upsertOpenSession(tag: any, event: ParsedPresenceEvent): Promise<string> {
  const active = await db.query<{ id: string }>(
    `SELECT id FROM cold_room_sessions WHERE tag_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    [tag.id]
  );
  if (active.rowCount) return active.rows[0].id;

  const inserted = await db.query<{ id: string }>(
    `INSERT INTO cold_room_sessions(worker_id, tag_id, cold_room_id, started_at, source_event_id)
     VALUES($1, $2, $3, $4, $5)
     ON CONFLICT (source_event_id) DO NOTHING
     RETURNING id`,
    [tag.worker_id, tag.id, tag.cold_room_id, event.timestamp, event.eventId]
  );

  if (inserted.rowCount) {
    return inserted.rows[0].id;
  }

  const fallback = await db.query<{ id: string }>(
    `SELECT id FROM cold_room_sessions WHERE tag_id = $1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
    [tag.id]
  );
  if (!fallback.rowCount) throw new Error('failed to resolve open session after upsert');
  return fallback.rows[0].id;
}

async function finalizeSession(
  session: SessionContext,
  endedAt: string,
  closeEventId: string | null,
  reason: 'event' | 'timeout'
): Promise<boolean> {
  const updateResult = await db.query(
    `UPDATE cold_room_sessions
     SET ended_at = $1,
         duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamptz - started_at)))::int,
         close_event_id = COALESCE($2, close_event_id)
     WHERE id = $3 AND ended_at IS NULL
     RETURNING id, started_at, worker_id, cold_room_id, tag_id`,
    [endedAt, closeEventId, session.id]
  );

  if (!updateResult.rowCount) return false;

  const closed = updateResult.rows[0];
  const durationMinutes = (Date.parse(endedAt) - Date.parse(closed.started_at)) / 60000;

  await db.query(
    `INSERT INTO workday_accumulators(workday_date, worker_id, cold_room_id, accumulated_seconds)
     VALUES (DATE($1), $2, $3, GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamptz - $4::timestamptz)))::int)
     ON CONFLICT (workday_date, worker_id, cold_room_id)
     DO UPDATE SET accumulated_seconds = workday_accumulators.accumulated_seconds + EXCLUDED.accumulated_seconds,
                   updated_at = NOW()`,
    [endedAt, closed.worker_id, closed.cold_room_id, closed.started_at]
  );

  if (durationMinutes >= session.pre_alert_minutes) {
    const prelimit = durationMinutes < session.max_continuous_minutes;
    await createAlert({
      workerId: closed.worker_id ?? undefined,
      tagId: closed.tag_id,
      coldRoomId: closed.cold_room_id ?? undefined,
      severity: prelimit ? 'warning' : 'critical',
      alertType: prelimit ? 'continuous_limit_prewarning' : 'continuous_limit_exceeded',
      message: `Permanencia en cámara: ${Math.round(durationMinutes)} min`,
      metadata: {
        durationMinutes,
        limitMinutes: session.max_continuous_minutes,
        closeReason: reason,
        sessionId: session.id
      }
    });

    const sender = prelimit ? sendPreLimitAlert : sendCriticalExposureAlert;
    await sender({
      workerId: closed.worker_id ?? undefined,
      tagId: closed.tag_id,
      reason: prelimit ? 'Pre-límite continuo alcanzado' : 'Límite continuo excedido'
    }).catch((error) => {
      logger.warn({ error }, 'failed to send tag-control compliance alert');
    });
  }

  if (durationMinutes > session.max_continuous_minutes + env.INCIDENT_GRACE_MINUTES) {
    await openIncident({
      workerId: closed.worker_id ?? undefined,
      tagId: closed.tag_id,
      coldRoomId: closed.cold_room_id ?? undefined,
      incidentType: 'continuous_exposure_breach',
      reason: 'Exceso de permanencia continuada en cámara frigorífica',
      metadata: { durationMinutes, closeReason: reason }
    });
    await sendCriticalExposureAlert({
      workerId: closed.worker_id ?? undefined,
      tagId: closed.tag_id,
      reason: 'Persistencia >2 min tras límite de permanencia'
    }).catch((error) => {
      logger.warn({ error }, 'failed to send escalation alert');
    });
  }

  const dailyTotal = await db.query(
    `SELECT accumulated_seconds FROM workday_accumulators
     WHERE workday_date = DATE($1) AND worker_id = $2 AND cold_room_id = $3`,
    [endedAt, closed.worker_id, closed.cold_room_id]
  );
  const dayMinutes = (dailyTotal.rows[0]?.accumulated_seconds ?? 0) / 60;
  if (dayMinutes > session.max_daily_minutes) {
    await createAlert({
      workerId: closed.worker_id ?? undefined,
      tagId: closed.tag_id,
      coldRoomId: closed.cold_room_id ?? undefined,
      severity: 'critical',
      alertType: 'daily_limit_exceeded',
      message: `Límite diario superado (${Math.round(dayMinutes)} min)`,
      metadata: { dayMinutes, dailyLimitMinutes: session.max_daily_minutes }
    });
  }

  return true;
}

async function closeStaleSessions(): Promise<void> {
  const timeoutMs = Math.max(1000, Number(env.PRESENCE_EXIT_TIMEOUT_MS));
  const activeSessions = await db.query<SessionContext & { last_seen_at: string; tag_uid: string; ble_active: boolean | null; ble_disconnected_at: string | null }>(
    `SELECT s.id,
            s.started_at,
            COALESCE(s.worker_id, wta.worker_id) AS worker_id,
            s.cold_room_id,
            s.tag_id,
            t.tag_uid,
            COALESCE(cr.max_continuous_minutes, $1) AS max_continuous_minutes,
            COALESCE(cr.pre_alert_minutes, $2) AS pre_alert_minutes,
            COALESCE(cr.max_daily_minutes, $3) AS max_daily_minutes,
            COALESCE(MAX(pe.event_ts), s.started_at) AS last_seen_at,
            bs.is_active AS ble_active,
            bs.disconnected_at AS ble_disconnected_at
     FROM cold_room_sessions s
     JOIN tags t ON t.id = s.tag_id
     LEFT JOIN worker_tag_assignments wta ON wta.tag_id = t.id AND wta.active = true
     LEFT JOIN cold_rooms cr ON cr.id = s.cold_room_id
     LEFT JOIN ble_alarm_sessions bs ON bs.tag_id = s.tag_id
     LEFT JOIN presence_events pe
       ON regexp_replace(lower(pe.tag_uid), '[-:]', '', 'g') = regexp_replace(lower(t.tag_uid), '[-:]', '', 'g')
      AND pe.event_ts >= s.started_at
      AND pe.event_type IN ('enter', 'heartbeat', 'movement')
     WHERE s.ended_at IS NULL
     GROUP BY s.id, s.started_at, COALESCE(s.worker_id, wta.worker_id), s.cold_room_id,
              s.tag_id, t.tag_uid, cr.max_continuous_minutes, cr.pre_alert_minutes, cr.max_daily_minutes,
              bs.is_active, bs.disconnected_at`,
    [env.MAX_CONTINUOUS_MINUTES, env.PRE_ALERT_MINUTES, env.MAX_DAILY_MINUTES]
  );

  const nowMs = Date.now();

  for (const session of activeSessions.rows) {
    if (session.ble_active) {
      logger.info({ sessionId: session.id, tagId: session.tag_id }, 'presence timeout skipped due to active BLE session');
      continue;
    }

    let referenceTs = Date.parse(session.last_seen_at);
    if (session.ble_disconnected_at) {
      const bleDisconnectedMs = Date.parse(session.ble_disconnected_at);
      if (Number.isFinite(bleDisconnectedMs) && bleDisconnectedMs > referenceTs) {
        referenceTs = bleDisconnectedMs;
        logger.info({ sessionId: session.id, tagId: session.tag_id, bleDisconnectedAt: session.ble_disconnected_at }, 'presence timeout started from BLE disconnect timestamp');
      }
    }

    if (!Number.isFinite(referenceTs)) {
      referenceTs = Date.parse(session.started_at);
    }

    const elapsedMs = nowMs - referenceTs;
    logger.debug({
      sessionId: session.id,
      tagId: session.tag_id,
      referenceTs: new Date(referenceTs).toISOString(),
      elapsedMs,
      timeoutMs,
      lastSeenAt: session.last_seen_at,
      bleDisconnectedAt: session.ble_disconnected_at
    }, 'presence timeout evaluation');

    if (elapsedMs <= timeoutMs) continue;

    const closedAt = new Date(referenceTs + timeoutMs).toISOString();
    const closed = await finalizeSession(session, closedAt, null, 'timeout');
    if (closed) {
      logger.info({ sessionId: session.id, tagId: session.tag_id, closedAt, timeoutMs }, 'closed stale session by presence timeout');
    }
  }
}

async function triggerGraceReentryAlarm(params: {
  sessionId: string;
  previousSessionId: string;
  workerId: string | null;
  tagId: string;
  coldRoomId: string | null;
  graceMinutes: number;
  minutesOutside: number;
  reminder: boolean;
}): Promise<void> {
  const alertType = params.reminder ? REENTRY_GRACE_REMINDER_ALERT_TYPE : REENTRY_GRACE_ALERT_TYPE;
  await createAlert({
    workerId: params.workerId ?? undefined,
    tagId: params.tagId,
    coldRoomId: params.coldRoomId ?? undefined,
    severity: 'critical',
    alertType,
    message: params.reminder
      ? 'Recordatorio: reentrada en cámara durante estado de gracia'
      : 'Reentrada en cámara durante estado de gracia',
    metadata: {
      sessionId: params.sessionId,
      previousSessionId: params.previousSessionId,
      reenteredDuringGrace: true,
      reentryReminder: params.reminder,
      reminderEveryMinutes: 3,
      graceMinutes: params.graceMinutes,
      minutesOutside: params.minutesOutside,
      reentryAlertAt: new Date().toISOString(),
      reentryGraceMinutes: params.graceMinutes
    }
  });
}

async function processGraceReentryReminders(): Promise<void> {
  const alarmTable = await resolveOperationalAlarmTable();
  const sessions = await db.query<{
    session_id: string;
    worker_id: string | null;
    tag_id: string;
    cold_room_id: string | null;
    previous_session_id: string | null;
    grace_minutes: number | null;
    last_reentry_alert_at: string | null;
  }>(
    `SELECT s.id AS session_id,
            COALESCE(s.worker_id, wta.worker_id) AS worker_id,
            s.tag_id,
            s.cold_room_id AS cold_room_id,
            COALESCE(alert_seed.metadata->>'previousSessionId', '') AS previous_session_id,
            NULLIF(alert_seed.metadata->>'graceMinutes', '')::int AS grace_minutes,
            MAX(a.created_at) AS last_reentry_alert_at
     FROM cold_room_sessions s
     LEFT JOIN worker_tag_assignments wta ON wta.tag_id = s.tag_id AND wta.active = true
     JOIN ${alarmTable} alert_seed
       ON alert_seed.tag_id = s.tag_id
      AND alert_seed.metadata->>'sessionId' = s.id::text
      AND alert_seed.metadata->>'reenteredDuringGrace' = 'true'
     LEFT JOIN ${alarmTable} a
       ON a.tag_id = s.tag_id
      AND a.metadata->>'sessionId' = s.id::text
      AND a.metadata->>'reenteredDuringGrace' = 'true'
     WHERE s.ended_at IS NULL
     GROUP BY s.id, COALESCE(s.worker_id, wta.worker_id), s.tag_id, s.cold_room_id,
              COALESCE(alert_seed.metadata->>'previousSessionId', ''), NULLIF(alert_seed.metadata->>'graceMinutes', '')::int`
  );

  const reminderMs = 3 * 60 * 1000;
  const nowMs = Date.now();

  for (const session of sessions.rows) {
    const lastAlertMs = session.last_reentry_alert_at ? Date.parse(session.last_reentry_alert_at) : 0;
    if (Number.isFinite(lastAlertMs) && nowMs - lastAlertMs < reminderMs) continue;

    await triggerGraceReentryAlarm({
      sessionId: session.session_id,
      previousSessionId: session.previous_session_id || session.session_id,
      workerId: session.worker_id,
      tagId: session.tag_id,
      coldRoomId: session.cold_room_id,
      graceMinutes: session.grace_minutes ?? 15,
      minutesOutside: 0,
      reminder: true
    });
  }
}

export async function processComplianceRules(event: ParsedPresenceEvent): Promise<void> {
  const tagRes = await db.query(
    `SELECT t.id, t.tag_uid,
            wta.worker_id,
            wta.assigned_at,
            wta.unassigned_at,
            cr.id as cold_room_id,
            cr.name as cold_room_name,
            coalesce(cr.max_continuous_minutes, $2) as max_continuous_minutes,
            coalesce(cr.pre_alert_minutes, $3) as pre_alert_minutes,
            coalesce(cr.required_break_minutes, $4) as required_break_minutes,
            coalesce(cr.max_daily_minutes, $5) as max_daily_minutes
     FROM tags t
     LEFT JOIN worker_tag_assignments wta ON wta.tag_id = t.id AND wta.active = true
     LEFT JOIN gateways g ON regexp_replace(lower(g.gateway_mac), '[-:]', '', 'g') = $1
     LEFT JOIN cold_rooms cr ON cr.id = g.cold_room_id
     WHERE regexp_replace(lower(t.tag_uid), '[-:]', '', 'g') = $6`,
    [event.gatewayMac, env.MAX_CONTINUOUS_MINUTES, env.PRE_ALERT_MINUTES, env.REQUIRED_BREAK_MINUTES, env.MAX_DAILY_MINUTES, event.tagId]
  );

  if (!tagRes.rowCount) return;
  const tag = tagRes.rows[0];

  if (event.eventType === 'enter' || event.eventType === 'heartbeat' || event.eventType === 'movement') {
    let previousCriticalContext: PreviousCriticalContext | null = null;
    if (event.eventType === 'enter') {
      previousCriticalContext = await resolvePreviousCriticalContext(tag.id, event.timestamp);
      if (previousCriticalContext?.hasCriticalAlarm && !previousCriticalContext.withinGrace) {
        if (previousCriticalContext.minutesOutside < Number(tag.required_break_minutes)) {
          await createAlert({
            workerId: tag.worker_id,
            tagId: tag.id,
            coldRoomId: tag.cold_room_id,
            severity: 'warning',
            alertType: 'break_not_compliant',
            message: `Reentrada sin descanso mínimo tras alarma crítica (${Math.floor(previousCriticalContext.minutesOutside)} min)`,
            metadata: {
              requiredBreakMinutes: Number(tag.required_break_minutes),
              minutesOutside: previousCriticalContext.minutesOutside,
              previousSessionId: previousCriticalContext.previousSessionId
            }
          });
          await openIncident({
            workerId: tag.worker_id,
            tagId: tag.id,
            coldRoomId: tag.cold_room_id,
            incidentType: 'non_compliant_reentry',
            reason: 'Intento de reentrada sin descanso tras alarma crítica',
            metadata: {
              minutesOutside: previousCriticalContext.minutesOutside,
              requiredBreakMinutes: Number(tag.required_break_minutes),
              previousSessionId: previousCriticalContext.previousSessionId
            }
          });
          await sendEarlyReentryBlockedAlert({ workerId: tag.worker_id ?? undefined, tagId: tag.id, reason: 'Reentrada no permitida tras alarma crítica y descanso incompleto' }).catch((error) => {
            logger.warn({ error }, 'failed to send early reentry blocked tag alert');
          });
        }
      }
    }

    const openSessionId = await upsertOpenSession(tag, event);
    if (event.eventType === 'enter' && previousCriticalContext?.withinGrace) {
      await triggerGraceReentryAlarm({
        sessionId: openSessionId,
        previousSessionId: previousCriticalContext.previousSessionId,
        workerId: tag.worker_id,
        tagId: tag.id,
        coldRoomId: tag.cold_room_id,
        graceMinutes: previousCriticalContext.graceMinutes,
        minutesOutside: previousCriticalContext.minutesOutside,
        reminder: false
      });
    }
    await evaluateOperationalAlarmRules(tag);
  }

  if (event.eventType === 'exit') {
    const activeSessionRes = await db.query<SessionContext>(
      `SELECT s.id,
              s.started_at,
              COALESCE(s.worker_id, wta.worker_id) AS worker_id,
              COALESCE(s.cold_room_id, g.cold_room_id) AS cold_room_id,
              s.tag_id,
              COALESCE(cr.max_continuous_minutes, $2) AS max_continuous_minutes,
              COALESCE(cr.pre_alert_minutes, $3) AS pre_alert_minutes,
              COALESCE(cr.max_daily_minutes, $4) AS max_daily_minutes
       FROM cold_room_sessions s
       LEFT JOIN tags t ON t.id = s.tag_id
       LEFT JOIN worker_tag_assignments wta ON wta.tag_id = s.tag_id AND wta.active = true
       LEFT JOIN gateways g ON regexp_replace(lower(g.gateway_mac), '[-:]', '', 'g') = $1
       LEFT JOIN cold_rooms cr ON cr.id = COALESCE(s.cold_room_id, g.cold_room_id)
       WHERE s.tag_id = $5 AND s.ended_at IS NULL
       ORDER BY s.started_at DESC LIMIT 1`,
      [event.gatewayMac, env.MAX_CONTINUOUS_MINUTES, env.PRE_ALERT_MINUTES, env.MAX_DAILY_MINUTES, tag.id]
    );
    if (!activeSessionRes.rowCount) return;

    await finalizeSession(activeSessionRes.rows[0], event.timestamp, event.eventId, 'event');
  }

  if (typeof event.battery === 'number' && event.battery <= env.BATTERY_ALERT_THRESHOLD) {
    await createAlert({
      workerId: tag.worker_id,
      tagId: tag.id,
      coldRoomId: tag.cold_room_id,
      severity: 'warning',
      alertType: 'low_battery',
      message: `Batería baja de tag ${event.battery}%`,
      metadata: { battery: event.battery }
    });
  }
}

export function startComplianceRuleLoop(): void {
  setInterval(() => {
    db.query(
      `SELECT DISTINCT t.id, wta.worker_id, g.cold_room_id
       FROM cold_room_sessions s
       JOIN tags t ON t.id = s.tag_id
       LEFT JOIN worker_tag_assignments wta ON wta.tag_id = t.id AND wta.active = true
       LEFT JOIN presence_events pe ON pe.tag_uid = t.tag_uid
       LEFT JOIN gateways g ON g.gateway_mac = pe.gateway_mac
       WHERE s.ended_at IS NULL`
    )
      .then((result) => Promise.all(result.rows.map((tag) => evaluateOperationalAlarmRules(tag))))
      .catch((error) => logger.error({ error }, 'compliance loop failed'));
  }, 60000).unref();
}

export function startPresenceTimeoutLoop(): void {
  const intervalMs = Math.max(1000, Math.min(env.PRESENCE_SWEEP_INTERVAL_MS, Math.floor(env.PRESENCE_EXIT_TIMEOUT_MS / 4), 10000));
  if (intervalMs !== env.PRESENCE_SWEEP_INTERVAL_MS) {
    logger.warn({ configured: env.PRESENCE_SWEEP_INTERVAL_MS, effective: intervalMs }, 'presence sweep interval adjusted to avoid delayed timeout closes');
  }

  setInterval(() => {
    closeStaleSessions().catch((error) => logger.error({ error }, 'presence timeout loop failed'));
  }, intervalMs).unref();
}

export function startGraceReentryReminderLoop(): void {
  const intervalMs = 30000;
  setInterval(() => {
    processGraceReentryReminders().catch((error) => logger.error({ error }, 'grace reentry reminder loop failed'));
  }, intervalMs).unref();
}
