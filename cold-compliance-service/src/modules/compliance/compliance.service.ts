import { env } from '../../config/env';
import { db } from '../../db/pool';
import { createAlert } from '../alerts/alerts.service';
import { openIncident } from '../incidents/incidents.service';
import { ParsedPresenceEvent } from '../presence/types';
import { sendCriticalExposureAlert, sendEarlyReentryBlockedAlert, sendPreLimitAlert } from '../tag-control/application/tag-control.service';
import { logger } from '../../utils/logger';

interface ActiveSession {
  id: string;
  started_at: string;
  worker_id: string | null;
  cold_room_id: string | null;
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
     LEFT JOIN gateways g ON g.gateway_mac = $1
     LEFT JOIN cold_rooms cr ON cr.id = g.cold_room_id
     WHERE t.tag_uid = $6`,
    [event.gatewayMac, env.MAX_CONTINUOUS_MINUTES, env.PRE_ALERT_MINUTES, env.REQUIRED_BREAK_MINUTES, env.MAX_DAILY_MINUTES, event.tagId]
  );

  if (!tagRes.rowCount) return;
  const tag = tagRes.rows[0];

  if (event.eventType === 'enter') {
    const lastClosedSession = await db.query(
      `SELECT ended_at FROM cold_room_sessions
       WHERE tag_id = $1 AND ended_at IS NOT NULL
       ORDER BY ended_at DESC LIMIT 1`,
      [tag.id]
    );

    if (lastClosedSession.rowCount) {
      const minutesOutside = (Date.parse(event.timestamp) - Date.parse(lastClosedSession.rows[0].ended_at)) / 60000;
      if (minutesOutside < Number(tag.required_break_minutes)) {
        await createAlert({
          workerId: tag.worker_id,
          tagId: tag.id,
          coldRoomId: tag.cold_room_id,
          severity: 'warning',
          alertType: 'break_not_compliant',
          message: `Reentrada sin descanso mínimo (${Math.floor(minutesOutside)} min)`,
          metadata: { requiredBreakMinutes: Number(tag.required_break_minutes), minutesOutside }
        });
        await openIncident({
          workerId: tag.worker_id,
          tagId: tag.id,
          coldRoomId: tag.cold_room_id,
          incidentType: 'non_compliant_reentry',
          reason: 'Intento de reentrada sin descanso reglamentario',
          metadata: { minutesOutside, requiredBreakMinutes: Number(tag.required_break_minutes) }
        });
        await sendEarlyReentryBlockedAlert({ workerId: tag.worker_id ?? undefined, tagId: tag.id, reason: 'Reentrada no permitida por descanso incompleto' }).catch((error) => {
          logger.warn({ error }, 'failed to send early reentry blocked tag alert');
        });
      }
    }

    await db.query(
      `INSERT INTO cold_room_sessions(worker_id, tag_id, cold_room_id, started_at, source_event_id)
       VALUES($1, $2, $3, $4, $5)
       ON CONFLICT (source_event_id) DO NOTHING`,
      [tag.worker_id, tag.id, tag.cold_room_id, event.timestamp, event.eventId]
    );
  }

  if (event.eventType === 'exit') {
    const activeSessionRes = await db.query<ActiveSession>(
      `SELECT id, started_at, worker_id, cold_room_id
       FROM cold_room_sessions
       WHERE tag_id = $1 AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [tag.id]
    );
    if (!activeSessionRes.rowCount) return;

    const session = activeSessionRes.rows[0];
    const durationMinutes = (Date.parse(event.timestamp) - Date.parse(session.started_at)) / 60000;

    await db.query(
      `UPDATE cold_room_sessions
       SET ended_at = $1, duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamptz - started_at)))::int, close_event_id = $2
       WHERE id = $3`,
      [event.timestamp, event.eventId, session.id]
    );

    await db.query(
      `INSERT INTO workday_accumulators(workday_date, worker_id, cold_room_id, accumulated_seconds)
       VALUES (DATE($1), $2, $3, GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamptz - $4::timestamptz)))::int)
       ON CONFLICT (workday_date, worker_id, cold_room_id)
       DO UPDATE SET accumulated_seconds = workday_accumulators.accumulated_seconds + EXCLUDED.accumulated_seconds,
                     updated_at = NOW()`,
      [event.timestamp, session.worker_id, session.cold_room_id, session.started_at]
    );

    if (durationMinutes >= Number(tag.pre_alert_minutes)) {
      const prelimit = durationMinutes < Number(tag.max_continuous_minutes);
      await createAlert({
        workerId: session.worker_id ?? undefined,
        tagId: tag.id,
        coldRoomId: session.cold_room_id ?? undefined,
        severity: prelimit ? 'warning' : 'critical',
        alertType: prelimit ? 'continuous_limit_prewarning' : 'continuous_limit_exceeded',
        message: `Permanencia en cámara: ${Math.round(durationMinutes)} min`,
        metadata: { durationMinutes, limitMinutes: Number(tag.max_continuous_minutes) }
      });

      const sender = prelimit ? sendPreLimitAlert : sendCriticalExposureAlert;
      await sender({ workerId: session.worker_id ?? undefined, tagId: tag.id, reason: prelimit ? 'Pre-límite continuo alcanzado' : 'Límite continuo excedido' }).catch((error) => {
        logger.warn({ error }, 'failed to send tag-control compliance alert');
      });
    }

    if (durationMinutes > Number(tag.max_continuous_minutes) + env.INCIDENT_GRACE_MINUTES) {
      await openIncident({
        workerId: session.worker_id ?? undefined,
        tagId: tag.id,
        coldRoomId: session.cold_room_id ?? undefined,
        incidentType: 'continuous_exposure_breach',
        reason: 'Exceso de permanencia continuada en cámara frigorífica',
        metadata: { durationMinutes }
      });
      await sendCriticalExposureAlert({ workerId: session.worker_id ?? undefined, tagId: tag.id, reason: 'Persistencia >2 min tras límite de permanencia' }).catch((error) => {
        logger.warn({ error }, 'failed to send escalation alert');
      });
    }

    const dailyTotal = await db.query(
      `SELECT accumulated_seconds FROM workday_accumulators
       WHERE workday_date = DATE($1) AND worker_id = $2 AND cold_room_id = $3`,
      [event.timestamp, session.worker_id, session.cold_room_id]
    );
    const dayMinutes = (dailyTotal.rows[0]?.accumulated_seconds ?? 0) / 60;
    if (dayMinutes > Number(tag.max_daily_minutes)) {
      await createAlert({
        workerId: session.worker_id ?? undefined,
        tagId: tag.id,
        coldRoomId: session.cold_room_id ?? undefined,
        severity: 'critical',
        alertType: 'daily_limit_exceeded',
        message: `Límite diario superado (${Math.round(dayMinutes)} min)`,
        metadata: { dayMinutes, dailyLimitMinutes: Number(tag.max_daily_minutes) }
      });
    }
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
