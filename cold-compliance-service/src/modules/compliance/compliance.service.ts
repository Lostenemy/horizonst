import { env } from '../../config/env';
import { db } from '../../db/pool';
import { createAlert } from '../alerts/alerts.service';
import { openIncident } from '../incidents/incidents.service';
import { ParsedPresenceEvent } from '../presence/types';
import { logger } from '../../utils/logger';
import { markPresenceAlarm, markPresenceEnter } from '../presence/presence-state.service';
import { shouldClosePresenceSession } from './presence-timeout-policy';
import { evaluatePresenceSignal } from './presence-signal-policy';
import { EventTechnicalIdentity, resolveEventTechnicalIdentity } from '../hardware-manager/event-identity.service';
import { withControlledClient } from '../tag-control/infrastructure/controlled-presence.repository';
import { persistCanonicalPresenceClose } from './presence-close.repository';
import { runBoundedPresenceClosures, nonOverlapping } from './presence-sweep';
import { performance } from 'node:perf_hooks';
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

async function upsertOpenSession(tag: any, event: ParsedPresenceEvent, query:typeof db.query=db.query.bind(db)): Promise<boolean> {
  if (!isValidSessionStart(event.timestamp)) {
    logger.error({ tagId: tag.id, eventId: event.eventId, startedAt: event.timestamp }, 'rejected session creation due to invalid started_at');
    return false;
  }
  if (!Number.isInteger(tag.hardware_device_id)) {
    throw new Error('central_hardware_mapping_required: cold room sessions require hardwareDeviceId');
  }
  const inserted=await query(
    `INSERT INTO cold_room_sessions(worker_id, tag_id, hardware_device_id, cold_room_id, started_at, source_event_id)
     VALUES($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING RETURNING id`,
    [tag.worker_id, tag.id, tag.hardware_device_id, tag.cold_room_id, event.timestamp, event.eventId]
  );
  return Boolean(inserted.rowCount);
}

async function finalizeSession(
  session: SessionContext, endedAt: string, closeEventId: string | null,
  reason: 'event' | 'timeout', lastDetectionAt: string, timeoutMs: number | null = null
): Promise<boolean> {
  return persistCanonicalPresenceClose({
    sessionId: session.id, endedAt, closeEventId, reason, lastDetectionAt,
    timeoutMs: timeoutMs ?? Math.max(1000, env.PRESENCE_EXIT_TIMEOUT_MS),
    limits: { preAlertMinutes: session.pre_alert_minutes,
      continuousMinutes: session.max_continuous_minutes, dailyMinutes: session.max_daily_minutes }
  });
}

export const closeStaleSessions = nonOverlapping(sweepStaleSessions);
async function sweepStaleSessions(): Promise<void> {
  const timeoutMs = Math.max(1000, Number(env.PRESENCE_EXIT_TIMEOUT_MS));
  const nowMs = Date.now();
  const snapshotStarted=performance.now();
  const activeSessions = await withControlledClient(client => client.query<SessionContext & { last_seen_at: string; control_started_at: string | null;
    control_deadline: string | null; control_until: string | null; timeout_ended_at: string; snapshot_now_ms:string }>(
    `SELECT s.id,
            s.started_at,
            COALESCE(s.worker_id, wta.worker_id) AS worker_id,
            s.cold_room_id,
            s.tag_id,
            s.hardware_device_id,
            COALESCE(cr.max_continuous_minutes, $1) AS max_continuous_minutes,
            COALESCE(cr.pre_alert_minutes, $2) AS pre_alert_minutes,
            COALESCE(cr.max_daily_minutes, $3) AS max_daily_minutes,
            EXTRACT(EPOCH FROM statement_timestamp())*1000 AS snapshot_now_ms,
            -- Text tokens retain PostgreSQL microseconds across pg/Node. Date
            -- below is only a scheduling hint, never the concurrency frontier.
            COALESCE(MAX(ps.last_presence_at), s.started_at)::text AS last_seen_at,
            MAX(op.started_at)::text AS control_started_at, MAX(op.hard_deadline)::text AS control_deadline,
            MAX(op.protect_until)::text AS control_until,
            GREATEST(COALESCE(MAX(ps.last_presence_at), s.started_at) + ($4::double precision * INTERVAL '1 millisecond'),
              LEAST(statement_timestamp(), COALESCE(MAX(op.protect_until), '-infinity'::timestamptz),
                COALESCE(MAX(ps.last_presence_at),s.started_at)+INTERVAL '60 seconds'))::text AS timeout_ended_at
     FROM cold_room_sessions s
     LEFT JOIN worker_tag_assignments wta
       ON wta.hardware_device_id = s.hardware_device_id
      AND wta.active = true
     LEFT JOIN cold_rooms cr ON cr.id = s.cold_room_id
     LEFT JOIN controlled_b5_presence_operations op
       ON op.hardware_device_id = s.hardware_device_id AND op.session_id = s.id
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
    [env.MAX_CONTINUOUS_MINUTES, env.PRE_ALERT_MINUTES, env.MAX_DAILY_MINUTES, timeoutMs]
  ));

  const queueStarted=performance.now();
  logger.debug({activeSessionCount:activeSessions.rows.length,snapshotElapsedMs:queueStarted-snapshotStarted},'presence sweep snapshot');
  await runBoundedPresenceClosures(activeSessions.rows.sort((a,b)=>Date.parse(a.last_seen_at)-Date.parse(b.last_seen_at)),async session => {
    const queueWaitMs=performance.now()-queueStarted;
    const snapshotNowMs=Number(session.snapshot_now_ms);
    const evaluationNowMs=Number.isFinite(snapshotNowMs)?snapshotNowMs:nowMs;
    let referenceTs = new Date(session.last_seen_at).getTime();

    if (!Number.isFinite(referenceTs)) {
      referenceTs = new Date(session.started_at).getTime();
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

    if (!shouldClosePresenceSession({ nowMs:evaluationNowMs, lastPresenceAtMs: referenceTs, timeoutMs,
      controlledOperation: session.control_started_at && session.control_deadline && session.control_until ? {
        startedAtMs: new Date(session.control_started_at).getTime(),
        hardDeadlineMs: new Date(session.control_deadline).getTime(),
        protectUntilMs: new Date(session.control_until).getTime()
      } : undefined })) return;

    // The timeout controls when absence is confirmed. The stored duration and
    // daily exposure stop at the last accepted packet, not at this closure.
    const closedAt = session.timeout_ended_at;
    const transactionStarted=performance.now();
    const closed = await finalizeSession(session, closedAt, null, 'timeout', session.last_seen_at, timeoutMs);
    if (closed) {
      logger.info({ sessionId: session.id, tagId: session.tag_id, closedAt, timeoutMs,
        queueWaitMs,transactionElapsedMs:performance.now()-transactionStarted,
        detectionToCommitMs:Date.now()-referenceTs,within90Seconds:Date.now()-referenceTs<=90000 }, 'closed stale session by presence timeout');
    }
  },(session)=>logger.error({sessionId:session.id,overdueMs:Date.now()-Date.parse(session.last_seen_at),
    exceeds90Seconds:Date.now()-Date.parse(session.last_seen_at)>90000},
    'presence close failed; open session retained for next sweep'));
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

    if (!activeSession.rowCount) {
      const latestClosed = await db.query<{ ended_at: string; stale_event: boolean }>(
        `SELECT ended_at, $2::timestamptz <= ended_at AS stale_event FROM cold_room_sessions
         WHERE hardware_device_id = $1 AND ended_at IS NOT NULL
         ORDER BY ended_at DESC LIMIT 1`,
        [tag.hardware_device_id, event.timestamp]
      );
      if (latestClosed.rowCount && latestClosed.rows[0].stale_event) {
        return;
      }
    }

    const entered=await withControlledClient(async client=>{
      await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='500ms'");
      await client.query("SET LOCAL statement_timeout='1500ms'");
      // Hold the open-session row while accepting the packet. The closer takes
      // FOR UPDATE on that row, so it cannot commit between detection and upsert.
      const current=await client.query(`SELECT id FROM cold_room_sessions
        WHERE hardware_device_id=$1 AND ended_at IS NULL FOR SHARE`,[tag.hardware_device_id]);
      if(!current.rowCount&&!evaluatePresenceSignal({gatewayRegistered:Boolean(tag.gateway_id),coldRoomId:tag.cold_room_id??null,
        hasOpenSession:false,rssi:event.rssi,rssiThreshold:Number(tag.rssi_threshold??-127),entryMarginDb:env.PRESENCE_RSSI_ENTRY_MARGIN_DB}).accepted){
        await client.query('COMMIT');return null;
      }
      await client.query(
      `UPDATE tag_gateway_presence_state
       SET last_presence_at = GREATEST(COALESCE(last_presence_at, '-infinity'::timestamptz), $1::timestamptz),
           hardware_device_id = $2,
           hardware_gateway_id = $3,
           updated_at = NOW()
       WHERE hardware_device_id = $2
         AND hardware_gateway_id = $3`,
      [event.timestamp, tag.hardware_device_id, tag.hardware_gateway_id]
      );

    // Publish the new open session before changing the operational state. A
    // concurrent timeout close must not clear a worker who has re-entered.
      const inserted=await upsertOpenSession(tag,event,client.query.bind(client) as typeof db.query);
      await client.query('COMMIT');return {inserted};
    });
    if(!entered)return;

    if (event.eventType === 'enter' || event.eventType === 'heartbeat') {
      if (!activeSession.rowCount||entered.inserted) {
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

    await finalizeSession(activeSessionRes.rows[0], event.timestamp, event.eventId, 'event', event.timestamp);
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

  let expectedAt=Date.now()+intervalMs;
  setInterval(() => {
    const processDelayMs=Math.max(0,Date.now()-expectedAt);expectedAt=Date.now()+intervalMs;
    if(processDelayMs>1000)logger.warn({processDelayMs,intervalMs},'presence sweep callback delayed; SLA risk');
    closeStaleSessions().catch(() => logger.error('presence timeout snapshot failed; open sessions retained for retry'));
  }, intervalMs).unref();
}
