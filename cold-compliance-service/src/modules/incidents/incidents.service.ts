import { db } from '../../db/pool';

export async function openIncident(params: {
  workerId?: string;
  tagId?: string;
  hardwareDeviceId?: number;
  coldRoomId?: string;
  incidentType: string;
  reason: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (params.tagId && !Number.isInteger(params.hardwareDeviceId)) {
    throw new Error('central_hardware_mapping_required: tagged incidents require hardwareDeviceId');
  }
  await db.query(
    `INSERT INTO incidents(worker_id, tag_id, hardware_device_id, cold_room_id, incident_type, reason, metadata)
     VALUES($1, $2, $3, $4, $5, $6, $7)`,
    [params.workerId ?? null, params.tagId ?? null, params.hardwareDeviceId ?? null, params.coldRoomId ?? null, params.incidentType, params.reason, params.metadata ?? {}]
  );
}
