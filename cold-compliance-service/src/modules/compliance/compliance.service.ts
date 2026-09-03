import { env } from '../../config/env';
import { db } from '../../db/pool';
import { createAlert } from '../alerts/alerts.service';
import { openIncident } from '../incidents/incidents.service';
import { ParsedPresenceEvent } from '../presence/types';
import { logger } from '../../utils/logger';
import { markPresenceAlarm, markPresenceEnter, markPresenceExit } from '../presence/presence-state.service';
import { shouldClosePresenceSession } from './presence-timeout-policy';
import { evaluatePresenceSignal } from './presence-signal-policy';
import { EventTechnicalIdentity, resolveEventTechnicalIdentity } from '../hardware-manager/event-identity.service';
const MIN_SESSION_START_MS = Date.parse('2025-01-01T00:00:00.000Z');
export function isValidSessionStart(startedAt: string): boolean {
  const startedAtMs = Date.parse(startedAt);
  return Number.isFinite(startedAtMs) && startedAtMs >= MIN_SESSION_START_MS;
}

interface ActiveSession {
  id: string;
  started_at: string;
  worker_id: string | null;
  cold_room_id: string | null;
  tag_id: string;
  hardware_device_id: number;
}

interface SessionContext {
  id: string;
  started_at: string;
  worker_id: string | null;
  cold_room_id: string | null;
  tag_id: string;
  hardware_device_id: number;
  max_continuous_minutes: number;
  pre_alert_minutes: number;
  max_daily_minutes: number;
}

async function evaluateOperationalAlarmRules(tag: {
  id: string;
  hardware_device_id: number;
  worker_id: string | null;
  cold_room_id: string | null;
}): Promise<void> {
  const sessionRes = await db.query<ActiveSession>(
    `SELECT s.id, s.started_at, s.worker_id, s.cold_room_id, s.tag_id,
            s.hardware_device_id
     FROM cold_room_sessions s
     WHERE s.hardware_device_id = $1
       AND s.ended_at IS NULL
     ORDER BY s.started_at DESC LIMIT 1`,
    [tag.hardware_device_id]
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

  const operationalState = await db.query<{ in_alarm: boolean }>(
    `SELECT in_alarm
     FROM presence_operational_state
     WHERE hardware_device_id = $1
     LIMIT 1`,
    [tag.hardware_device_id]
  );
  let alreadyInOperationalAlarm = operationalState.rows[0]?.in_alarm === true;

  for (const rule of rules) {
    const warningKey = { sessionId: session.id, ruleId: rule.id, stage: 'warning' };
    const alarmKey = { sessionId: session.id, ruleId: rule.id, stage: 'alarm' };

    if (elapsedMinutes >= Number(rule.buzzer_shaker_minutes)) {
      const existsWarning = await db.query(
        `SELECT 1 FROM alerts
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
          hardwareDeviceId: session.hardware_device_id,
          coldRoomId: session.cold_room_id ?? undefined,
          severity: 'warning',
          alertType: 'alarm_rule_warning',
          message: `${rule.description} · aviso buzzer/shaker (${Math.floor(elapsedMinutes)} min dentro)`,
          metadata: { ...warningKey, thresholdMinutes: Number(rule.buzzer_shaker_minutes), elapsedMinutes }
        });
      }
    }

    if (elapsedMinutes >= Number(rule.alarm_minutes)) {
      if (!alreadyInOperationalAlarm) {
        await markPresenceAlarm(session.tag_id, new Date().toISOString(), {
          hardwareDeviceId: session.hardware_device_id,
          workerId: session.worker_id,
          coldRoomId: session.cold_room_id
        });
        alreadyInOperationalAlarm = true;
      }
      const existsAlarm = await db.query(
        `SELECT 1 FROM alerts
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
          hardwareDeviceId: session.hardware_device_id,
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

async function upsertOpenSession(tag: any, event: ParsedPresenceEvent): Promise<void> {
  if (!isValidSessionStart(event.timestamp)) {
    logger.error({ tagId: tag.id, eventId: event.eventId, startedAt: event.timestamp }, 'rejected session creation due to invalid started_at');
    return;
  }
  if (!Number.isInteger(tag.hardware_device_id)) {
    throw new Error('central_hardware_mapping_required: cold room sessions require hardwareDeviceId');
  }
  await db.query(
    `INSERT INTO cold_room_sessions(worker_id, tag_id, hardware_device_id, cold_room_id, started_at, source_event_id)
     VALUES($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [tag.worker_id, tag.id, tag.hardware_device_id, tag.cold_room_id, event.timestamp, event.eventId]
  );
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
     RETURNING id, started_at, worker_id, cold_room_id, tag_id, hardware_device_id`,
    [endedAt, closeEventId, session.id]
  );

  if (!updateResult.rowCount) return false;

  const closed = updateResult.rows[0];
  await markPresenceExit(closed.tag_id, closed.hardware_device_id, endedAt);
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
      hardwareDeviceId: closed.hardware_device_id,
      coldRoomId: closed.cold_room_id ?? undefined,
      severity: prelimit ? 'warning' : 'critical',
      alertType: prelimit ? 'continuous_limit_prewarning' : 'continuous_limit_exceeded',
      message: `Permanencia en cámara: ${Math.round(durationMinutes)} min`,
      metadata: {
        durationMinutes,
        limitMinutes: session.max_continuous_minutes,
        closeReason: reason
      }
    });

  }

  if (durationMinutes > session.max_continuous_minutes + env.INCIDENT_GRACE_MINUTES) {
    await openIncident({
      workerId: closed.worker_id ?? undefined,
      tagId: closed.tag_id,
      hardwareDeviceId: closed.hardware_device_id,
      coldRoomId: closed.cold_room_id ?? undefined,
      incidentType: 'continuous_exposure_breach',
      reason: 'Exceso de permanencia continuada en cámara frigorífica',
      metadata: { durationMinutes, closeReason: reason }
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
      hardwareDeviceId: closed.hardware_device_id,
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
  const activeSessions = await db.query<SessionContext & { last_seen_at: string }>(
    `SELECT s.id,
            s.started_at,
            COALESCE(s.worker_id, wta.worker_id) AS worker_id,
            s.cold_room_id,
            s.tag_id,
            s.hardware_device_id,
            COALESCE(cr.max_continuous_minutes, $1) AS max_continuous_minutes,
            COALESCE(cr.pre_alert_minutes, $2) AS pre_alert_minutes,
            COALESCE(cr.max_daily_minutes, $3) AS max_daily_minutes,
            COALESCE(MAX(ps.last_presence_at), s.started_at) AS last_seen_at
     FROM cold_room_sessions s
     LEFT JOIN worker_tag_assignments wta
       ON wta.hardware_device_id = s.hardware_device_id
      AND wta.active = true
     LEFT JOIN cold_rooms cr ON cr.id = s.cold_room_id
     LEFT JOIN tag_gateway_presence_state ps
       ON ps.hardware_device_id = s.hardware_device_id
      AND ps.last_presence_at >= s.started_at
      AND (s.cold_room_id IS NULL OR EXISTS (
        SELECT 1 FROM gateways seen_gateway
        WHERE ps.hardware_gateway_id = seen_gateway.hardware_gateway_id
          AND seen_gateway.cold_room_id = s.cold_room_id
      ))
     WHERE s.ended_at IS NULL
     GROUP BY s.id, s.started_at, COALESCE(s.worker_id, wta.worker_id), s.cold_room_id,
              s.tag_id, s.hardware_device_id, cr.max_continuous_minutes, cr.pre_alert_minutes, cr.max_daily_minutes`,
    [env.MAX_CONTINUOUS_MINUTES, env.PRE_ALERT_MINUTES, env.MAX_DAILY_MINUTES]
  );

  const nowMs = Date.now();

  for (const session of activeSessions.rows) {
    let referenceTs = Date.parse(session.last_seen_at);

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
      source: 'tag_gateway_presence_state'
    }, 'presence timeout evaluation');

    if (!shouldClosePresenceSession({ nowMs, lastPresenceAtMs: referenceTs, timeoutMs })) continue;

    const closedAt = new Date(referenceTs + timeoutMs).toISOString();
    const closed = await finalizeSession(session, closedAt, null, 'timeout');
    if (closed) {
      logger.info({ sessionId: session.id, tagId: session.tag_id, closedAt, timeoutMs }, 'closed stale session by presence timeout');
    }
  }
}

export async function processComplianceRules(event: ParsedPresenceEvent, resolvedIdentity?: EventTechnicalIdentity): Promise<void> {
  const identity = resolvedIdentity ?? await resolveEventTechnicalIdentity({ tagMac: event.tagId, gatewayMac: event.gatewayMac });
  if (identity.source !== 'central') {
    logger.warn({ eventId: event.eventId, source: identity.source, reason: identity.reason }, 'presence event rejected by technical identity');
    return;
  }
  const tagRes = await db.query(
    `SELECT t.id, t.tag_uid, t.hardware_device_id,
            wta.worker_id,
            wta.assigned_at,
            wta.unassigned_at,
            cr.id as cold_room_id,
            cr.name as cold_room_name,
            g.id as gateway_id,
            g.hardware_gateway_id,
            g.rssi_threshold,
            coalesce(cr.max_continuous_minutes, $2) as max_continuous_minutes,
            coalesce(cr.pre_alert_minutes, $3) as pre_alert_minutes,
            coalesce(cr.required_break_minutes, $4) as required_break_minutes,
            coalesce(cr.max_daily_minutes, $5) as max_daily_minutes
     FROM tags t
     LEFT JOIN worker_tag_assignments wta
       ON wta.hardware_device_id = t.hardware_device_id
      AND wta.active = true
     LEFT JOIN gateways g ON g.hardware_gateway_id = $1
     LEFT JOIN cold_rooms cr ON cr.id = g.cold_room_id
     WHERE t.hardware_device_id = $6`,
    [identity.hardwareGatewayId, env.MAX_CONTINUOUS_MINUTES, env.PRE_ALERT_MINUTES, env.REQUIRED_BREAK_MINUTES, env.MAX_DAILY_MINUTES, identity.hardwareDeviceId]
  );

  if (!tagRes.rowCount || !tagRes.rows[0].gateway_id) {
    logger.warn({ eventId: event.eventId, hardwareDeviceId: identity.hardwareDeviceId, hardwareGatewayId: identity.hardwareGatewayId }, 'presence event has no reconciled local hardware mapping');
    return;
  }
  const tag = tagRes.rows[0];
  if (!Number.isInteger(tag.hardware_device_id)) {
    logger.warn({ eventId: event.eventId, tagId: tag.id }, 'presence event rejected because the Horneo overlay has no central hardware identity');
    return;
  }

  if (typeof event.battery === 'number' && event.battery <= env.BATTERY_ALERT_THRESHOLD) {
    await createAlert({
      workerId: tag.worker_id,
      tagId: tag.id,
      hardwareDeviceId: tag.hardware_device_id,
      coldRoomId: tag.cold_room_id,
      severity: 'warning',
      alertType: 'low_battery',
      message: `Batería baja de tag ${event.battery}%`,
      metadata: { battery: event.battery }
    });
  }

  if (event.eventType === 'enter' || event.eventType === 'heartbeat' || event.eventType === 'movement') {
    const activeSession = await db.query(
      `SELECT 1
       FROM cold_room_sessions s
       WHERE s.hardware_device_id = $1
         AND s.ended_at IS NULL
       LIMIT 1`,
      [tag.hardware_device_id]
    );
    const signal = evaluatePresenceSignal({
      gatewayRegistered: Boolean(tag.gateway_id),
      coldRoomId: tag.cold_room_id ?? null,
      hasOpenSession: Boolean(activeSession.rowCount),
      rssi: event.rssi,
      rssiThreshold: Number(tag.rssi_threshold ?? -127),
      entryMarginDb: env.PRESENCE_RSSI_ENTRY_MARGIN_DB
    });
    if (!signal.accepted) {
      logger.debug({ tagId: tag.id, gatewayMac: event.gatewayMac, rssi: event.rssi, requiredRssi: signal.requiredRssi, opening: !activeSession.rowCount, reason: signal.reason }, 'presence event ignored by signal policy');
      return;
    }

    await db.query(
      `UPDATE tag_gateway_presence_state
       SET last_presence_at = GREATEST(COALESCE(last_presence_at, '-infinity'::timestamptz), $1::timestamptz),
           hardware_device_id = $2,
           hardware_gateway_id = $3,
           updated_at = NOW()
       WHERE hardware_device_id = $2
         AND hardware_gateway_id = $3`,
      [event.timestamp, tag.hardware_device_id, tag.hardware_gateway_id]
    );

    if (event.eventType === 'enter' || event.eventType === 'heartbeat') {
      if (!activeSession.rowCount) {
        await markPresenceEnter(tag, event.timestamp);
      }
    }

    if (event.eventType === 'enter') {
      const lastClosedSession = await db.query(
        `SELECT ended_at FROM cold_room_sessions s
         WHERE s.hardware_device_id = $1
           AND s.ended_at IS NOT NULL
         ORDER BY ended_at DESC LIMIT 1`,
        [tag.hardware_device_id]
      );

      if (lastClosedSession.rowCount) {
        const minutesOutside = (Date.parse(event.timestamp) - Date.parse(lastClosedSession.rows[0].ended_at)) / 60000;
        if (minutesOutside < Number(tag.required_break_minutes)) {
          await createAlert({
            workerId: tag.worker_id,
            tagId: tag.id,
            hardwareDeviceId: tag.hardware_device_id,
            coldRoomId: tag.cold_room_id,
            severity: 'warning',
            alertType: 'break_not_compliant',
            message: `Reentrada sin descanso mínimo (${Math.floor(minutesOutside)} min)`,
            metadata: { requiredBreakMinutes: Number(tag.required_break_minutes), minutesOutside }
          });
          await openIncident({
            workerId: tag.worker_id,
            tagId: tag.id,
            hardwareDeviceId: tag.hardware_device_id,
            coldRoomId: tag.cold_room_id,
            incidentType: 'non_compliant_reentry',
            reason: 'Intento de reentrada sin descanso reglamentario',
            metadata: { minutesOutside, requiredBreakMinutes: Number(tag.required_break_minutes) }
          });
        }
      }
    }

    await upsertOpenSession(tag, event);
    await evaluateOperationalAlarmRules(tag);
  }

  if (event.eventType === 'exit') {
    const activeSessionRes = await db.query<SessionContext>(
      `SELECT s.id,
              s.started_at,
              COALESCE(s.worker_id, wta.worker_id) AS worker_id,
              COALESCE(s.cold_room_id, g.cold_room_id) AS cold_room_id,
              s.tag_id,
              s.hardware_device_id,
              COALESCE(cr.max_continuous_minutes, $2) AS max_continuous_minutes,
              COALESCE(cr.pre_alert_minutes, $3) AS pre_alert_minutes,
              COALESCE(cr.max_daily_minutes, $4) AS max_daily_minutes
       FROM cold_room_sessions s
       LEFT JOIN worker_tag_assignments wta
         ON wta.hardware_device_id = s.hardware_device_id
        AND wta.active = true
       LEFT JOIN gateways g ON g.hardware_gateway_id = $1
       LEFT JOIN cold_rooms cr ON cr.id = COALESCE(s.cold_room_id, g.cold_room_id)
       WHERE s.hardware_device_id = $5
         AND s.ended_at IS NULL
       ORDER BY s.started_at DESC LIMIT 1`,
      [identity.hardwareGatewayId, env.MAX_CONTINUOUS_MINUTES, env.PRE_ALERT_MINUTES, env.MAX_DAILY_MINUTES, tag.hardware_device_id]
    );
    if (!activeSessionRes.rowCount) return;

    await finalizeSession(activeSessionRes.rows[0], event.timestamp, event.eventId, 'event');
  }

}

export function startComplianceRuleLoop(): void {
  setInterval(() => {
    db.query(
      `SELECT DISTINCT s.tag_id AS id, s.hardware_device_id, wta.worker_id, g.cold_room_id
       FROM cold_room_sessions s
       LEFT JOIN worker_tag_assignments wta
         ON wta.hardware_device_id = s.hardware_device_id
        AND wta.active = true
       LEFT JOIN gateways g ON g.cold_room_id = s.cold_room_id
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
