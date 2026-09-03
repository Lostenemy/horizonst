import { db } from '../../db/pool';
import { logger } from '../../utils/logger';
import { executeAlarmSequence } from '../tag-control/application/tag-physical-alarm.service';

interface QueryClient {
  query: typeof db.query;
}

interface CreatedAlert {
  id: string;
  worker_id: string | null;
  tag_id: string | null;
  hardware_device_id: number | null;
  severity: string;
  alert_type: string;
}

export async function createAlert(params: {
  workerId?: string;
  tagId?: string;
  hardwareDeviceId?: number;
  coldRoomId?: string;
  severity: 'info' | 'warning' | 'critical';
  alertType: string;
  message: string;
  metadata?: Record<string, unknown>;
  dispatchPhysicalAlarm?: boolean;
  queryClient?: QueryClient;
}): Promise<CreatedAlert> {
  if (params.tagId && !Number.isInteger(params.hardwareDeviceId)) {
    throw new Error('central_hardware_mapping_required: tagged alerts require hardwareDeviceId');
  }
  const queryClient = params.queryClient ?? db;
  const inserted = await queryClient.query<CreatedAlert>(
    `INSERT INTO alerts(worker_id, tag_id, hardware_device_id, cold_room_id, severity, alert_type, message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, worker_id, tag_id, hardware_device_id, severity, alert_type`,
    [
      params.workerId ?? null,
      params.tagId ?? null,
      params.hardwareDeviceId ?? null,
      params.coldRoomId ?? null,
      params.severity,
      params.alertType,
      params.message,
      params.metadata ?? {}
    ]
  );

  const alert = inserted.rows[0];
  if (params.dispatchPhysicalAlarm !== false) setImmediate(() => {
    logger.info({
      alertId: alert.id,
      alertType: alert.alert_type,
      severity: alert.severity,
      tagId: alert.tag_id,
      workerId: alert.worker_id
    }, 'compliance alert dispatching physical alarm sequence');

    executeAlarmSequence({
      alertId: alert.id,
      workerId: alert.worker_id ?? undefined,
      tagId: alert.tag_id ?? undefined,
      hardwareDeviceId: alert.hardware_device_id ?? undefined,
      severity: alert.severity,
      alertType: alert.alert_type
    }).catch((error) => {
      logger.error({ error, alertId: alert.id, alertType: alert.alert_type, severity: alert.severity, tagId: alert.tag_id, workerId: alert.worker_id }, 'failed to execute physical alarm sequence');
    });
  });

  return alert;
}

export async function triggerPhysicalAlarmSequence(params: {
  workerId?: string;
  tagId?: string;
  hardwareDeviceId?: number;
  severity: 'info' | 'warning' | 'critical';
  alertType: string;
  alertId: string;
}): Promise<void> {
  await executeAlarmSequence({
    alertId: params.alertId,
    workerId: params.workerId,
    tagId: params.tagId,
    hardwareDeviceId: params.hardwareDeviceId,
    severity: params.severity,
    alertType: params.alertType
  });
}
