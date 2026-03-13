import { db } from '../../db/pool';

export async function createAlert(params: {
  workerId?: string;
  tagId?: string;
  coldRoomId?: string;
  severity: 'info' | 'warning' | 'critical';
  alertType: string;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.query(
    `INSERT INTO alerts(worker_id, tag_id, cold_room_id, severity, alert_type, message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
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
}
