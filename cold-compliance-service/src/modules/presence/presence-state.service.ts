import { env } from '../../config/env';
import { db } from '../../db/pool';
import { logger } from '../../utils/logger';
import { sendCriticalExposureAlert } from '../tag-control/application/tag-control.service';
import { triggerPhysicalAlarmSequence } from '../alerts/alerts.service';

interface PresenceStateTag {
  id: string;
  worker_id: string | null;
  cold_room_id: string | null;
}

interface PresenceOperationalState {
  tag_id: string;
  worker_id: string | null;
  cold_room_id: string | null;
  inside: boolean;
  in_alarm: boolean;
  in_grace: boolean;
  grace_until: string | null;
  last_alarm_at: string | null;
  reminder_sent_at: string | null;
}

interface PresenceAlarmContext {
  workerId?: string | null;
  coldRoomId?: string | null;
}

async function resolveOperationalGraceMinutes(): Promise<number> {
  const configured = await db.query<{ grace_minutes: number }>(
    `SELECT COALESCE(
        (
          SELECT alarm_visibility_grace_minutes
          FROM alarm_rules
          WHERE active = TRUE
          ORDER BY updated_at DESC
          LIMIT 1
        ),
        $1
      )::int AS grace_minutes`,
    [Math.max(1, Number(env.OPERATIONAL_GRACE_MINUTES))]
  );
  const rawMinutes = Number(configured.rows[0]?.grace_minutes ?? env.OPERATIONAL_GRACE_MINUTES);
  return Number.isFinite(rawMinutes) && rawMinutes > 0 ? rawMinutes : Math.max(1, Number(env.OPERATIONAL_GRACE_MINUTES));
}

export async function markPresenceEnter(tag: PresenceStateTag, eventTs: string): Promise<{ isGraceReentry: boolean }> {
  const current = await db.query<PresenceOperationalState>(
    `SELECT * FROM presence_operational_state WHERE tag_id = $1`,
    [tag.id]
  );

  const nowMs = Date.parse(eventTs);
  const row = current.rows[0];
  const graceActive = Boolean(
    row?.in_grace
      && row.grace_until
      && Number.isFinite(nowMs)
      && nowMs <= Date.parse(row.grace_until)
      && row.last_alarm_at
  );

  if (graceActive) {
    await db.query(
      `INSERT INTO presence_operational_state(
        tag_id, worker_id, cold_room_id, inside, in_alarm, in_grace, grace_until, grace_started_at, last_alarm_at, reminder_sent_at, updated_at
      )
      VALUES($1, $2, $3, TRUE, TRUE, FALSE, NULL, NULL, $4, NULL, NOW())
      ON CONFLICT (tag_id)
      DO UPDATE SET worker_id = COALESCE(EXCLUDED.worker_id, presence_operational_state.worker_id),
                    cold_room_id = COALESCE(EXCLUDED.cold_room_id, presence_operational_state.cold_room_id),
                    inside = TRUE,
                    in_alarm = TRUE,
                    in_grace = FALSE,
                    grace_until = NULL,
                    grace_started_at = NULL,
                    last_alarm_at = EXCLUDED.last_alarm_at,
                    reminder_sent_at = NULL,
                    updated_at = NOW()`,
      [tag.id, tag.worker_id, tag.cold_room_id, eventTs]
    );

    await sendCriticalExposureAlert({
      workerId: tag.worker_id ?? undefined,
      tagId: tag.id,
      reason: 'Reentrada durante ventana de gracia'
    }).catch((error) => {
      logger.warn({ error, tagId: tag.id }, 'failed to send immediate physical alert for grace reentry');
    });

    return { isGraceReentry: true };
  }

  await db.query(
    `INSERT INTO presence_operational_state(
      tag_id, worker_id, cold_room_id, inside, in_alarm, in_grace, grace_until, grace_started_at, reminder_sent_at, updated_at
    )
    VALUES($1, $2, $3, TRUE, FALSE, FALSE, NULL, NULL, NULL, NOW())
    ON CONFLICT (tag_id)
    DO UPDATE SET worker_id = COALESCE(EXCLUDED.worker_id, presence_operational_state.worker_id),
                  cold_room_id = COALESCE(EXCLUDED.cold_room_id, presence_operational_state.cold_room_id),
                  inside = TRUE,
                  in_grace = FALSE,
                  grace_until = NULL,
                  grace_started_at = NULL,
                  reminder_sent_at = NULL,
                  updated_at = NOW()`,
    [tag.id, tag.worker_id, tag.cold_room_id]
  );

  return { isGraceReentry: false };
}

export async function markPresenceAlarm(tagId: string, eventTs: string, context: PresenceAlarmContext = {}): Promise<void> {
  await db.query(
    `INSERT INTO presence_operational_state(
      tag_id, worker_id, cold_room_id, inside, in_alarm, in_grace, grace_until, grace_started_at, last_alarm_at, reminder_sent_at, updated_at
    ) VALUES($1, $2, $3, TRUE, TRUE, FALSE, NULL, NULL, $4, NULL, NOW())
    ON CONFLICT (tag_id)
    DO UPDATE SET worker_id = COALESCE(EXCLUDED.worker_id, presence_operational_state.worker_id),
                  cold_room_id = COALESCE(EXCLUDED.cold_room_id, presence_operational_state.cold_room_id),
                  inside = TRUE,
                  in_alarm = TRUE,
                  in_grace = FALSE,
                  grace_until = NULL,
                  grace_started_at = NULL,
                  last_alarm_at = $4,
                  reminder_sent_at = NULL,
                  updated_at = NOW()`,
    [tagId, context.workerId ?? null, context.coldRoomId ?? null, eventTs]
  );
}

export async function markPresenceExit(tagId: string, exitTs: string): Promise<void> {
  const graceMinutes = await resolveOperationalGraceMinutes();
  const intervalExpr = `${graceMinutes} minutes`;
  await db.query(
    `UPDATE presence_operational_state
     SET inside = FALSE,
         in_grace = CASE WHEN in_alarm OR last_alarm_at IS NOT NULL THEN TRUE ELSE FALSE END,
         grace_started_at = CASE WHEN in_alarm OR last_alarm_at IS NOT NULL THEN $2::timestamptz ELSE grace_started_at END,
         grace_until = CASE WHEN in_alarm OR last_alarm_at IS NOT NULL THEN $2::timestamptz + $3::interval ELSE NULL END,
         in_alarm = FALSE,
         reminder_sent_at = NULL,
         updated_at = NOW()
     WHERE tag_id = $1`,
    [tagId, exitTs, intervalExpr]
  );
}

export async function clearExpiredGrace(): Promise<void> {
  await db.query(
    `DELETE FROM presence_operational_state
     WHERE inside = FALSE
       AND in_grace = TRUE
       AND grace_until IS NOT NULL
       AND grace_until < NOW()`
  );
}

export async function sendGraceReentryReminders(): Promise<void> {
  const cadenceMs = Math.max(60000, Number(env.REENTRY_REMINDER_INTERVAL_MS ?? 180000));
  const due = await db.query<PresenceOperationalState>(
    `SELECT pos.tag_id,
            pos.worker_id,
            pos.cold_room_id,
            pos.inside,
            pos.in_alarm,
            pos.in_grace,
            pos.grace_until,
            pos.last_alarm_at,
            pos.reminder_sent_at
     FROM presence_operational_state pos
     WHERE pos.inside = TRUE
       AND pos.in_alarm = TRUE
       AND pos.last_alarm_at IS NOT NULL
       AND (
         (
           pos.reminder_sent_at IS NULL
           AND EXTRACT(EPOCH FROM (NOW() - pos.last_alarm_at)) * 1000 >= $1
         )
         OR
         (
           pos.reminder_sent_at IS NOT NULL
           AND EXTRACT(EPOCH FROM (NOW() - pos.reminder_sent_at)) * 1000 >= $1
         )
       )`,
    [cadenceMs]
  );

  for (const row of due.rows) {
    await sendCriticalExposureAlert({
      workerId: row.worker_id ?? undefined,
      tagId: row.tag_id,
      reason: 'Recordatorio de reentrada en alarma'
    }).catch((error) => {
      logger.warn({ error, tagId: row.tag_id }, 'failed to send reminder for alarm reentry');
    });

    await triggerPhysicalAlarmSequence({
      alertId: `reentry-reminder:${row.tag_id}:${Date.now()}`,
      workerId: row.worker_id ?? undefined,
      tagId: row.tag_id,
      severity: 'critical',
      alertType: 'alarm_rule_alarm'
    }).catch((error) => {
      logger.warn({ error, tagId: row.tag_id }, 'failed to run physical reminder alarm sequence');
    });

    await db.query(
      `UPDATE presence_operational_state SET reminder_sent_at = NOW(), updated_at = NOW() WHERE tag_id = $1`,
      [row.tag_id]
    );
  }
}

export function startPresenceGraceLoop(): void {
  const cleanupIntervalMs = Math.max(10000, Math.floor(Number(env.PRESENCE_SWEEP_INTERVAL_MS)));
  setInterval(() => {
    clearExpiredGrace().catch((error) => logger.error({ error }, 'failed to clear expired grace states'));
    sendGraceReentryReminders().catch((error) => logger.error({ error }, 'failed to send grace reentry reminders'));
  }, cleanupIntervalMs).unref();
}
