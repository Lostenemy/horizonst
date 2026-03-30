import { db } from '../../db/pool';
import { logger } from '../../utils/logger';
import { executeAlarmSequence } from '../tag-control/application/tag-physical-alarm.service';
import { resolveOperationalAlarmTable } from './alarm-table-resolver';

interface CreatedAlert {
  id: string;
  worker_id: string | null;
  tag_id: string | null;
  severity: string;
  alert_type: string;
}

export async function createAlert(params: {
  workerId?: string;
  tagId?: string;
  coldRoomId?: string;
  severity: 'info' | 'warning' | 'critical';
  alertType: string;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<CreatedAlert> {
  const alarmTable = await resolveOperationalAlarmTable();
  const inserted = await db.query<CreatedAlert>(
    `INSERT INTO ${alarmTable}(worker_id, tag_id, cold_room_id, severity, alert_type, message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, worker_id, tag_id, severity, alert_type`,
    [
      params.workerId ?? null,
      params.tagId ?? null,
      params.coldRoomId ?? null,
      params.severity,
      params.alertType,
      params.message,
      params.metadata ?? {}
    ]
  );

  const alert = inserted.rows[0];
  setImmediate(() => {
    executeAlarmSequence({
      alertId: alert.id,
      workerId: alert.worker_id ?? undefined,
      tagId: alert.tag_id ?? undefined,
      severity: alert.severity,
      alertType: alert.alert_type
    }).catch((error) => {
      logger.error({ error, alertId: alert.id }, 'failed to execute physical alarm sequence');
    });
  });

  return alert;
}
