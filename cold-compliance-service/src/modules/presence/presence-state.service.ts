import { env } from '../../config/env';
import { db } from '../../db/pool';
import { logger } from '../../utils/logger';
import { sendCriticalExposureAlert } from '../tag-control/application/tag-control.service';

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

function graceIntervalSql(): string {
  const minutes = Math.max(1, Number(env.OPERATIONAL_GRACE_MINUTES));
  return `${minutes} minutes`;
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
      DO UPDATE SET worker_id = EXCLUDED.worker_id,
                    cold_room_id = EXCLUDED.cold_room_id,
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
    DO UPDATE SET worker_id = EXCLUDED.worker_id,
                  cold_room_id = EXCLUDED.cold_room_id,
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

export async function markPresenceAlarm(tagId: string, eventTs: string): Promise<void> {
  await db.query(
    `INSERT INTO presence_operational_state(
      tag_id, inside, in_alarm, in_grace, grace_until, grace_started_at, last_alarm_at, reminder_sent_at, updated_at
    ) VALUES($1, TRUE, TRUE, FALSE, NULL, NULL, $2, NULL, NOW())
    ON CONFLICT (tag_id)
    DO UPDATE SET inside = TRUE,
                  in_alarm = TRUE,
                  in_grace = FALSE,
                  grace_until = NULL,
                  grace_started_at = NULL,
                  last_alarm_at = $2,
                  reminder_sent_at = NULL,
                  updated_at = NOW()`,
    [tagId, eventTs]
  );
}

export async function markPresenceExit(tagId: string, exitTs: string): Promise<void> {
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
    [tagId, exitTs, graceIntervalSql()]
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
  const cadenceMs = Math.max(60000, Number(env.REENTRY_REMINDER_INTERVAL_MS));
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
         pos.reminder_sent_at IS NULL
         OR EXTRACT(EPOCH FROM (NOW() - pos.reminder_sent_at)) * 1000 >= $1
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
