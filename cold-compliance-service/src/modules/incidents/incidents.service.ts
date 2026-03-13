import { db } from '../../db/pool';

export async function openIncident(params: {
  workerId?: string;
  tagId?: string;
  coldRoomId?: string;
  incidentType: string;
  reason: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.query(
    `INSERT INTO incidents(worker_id, tag_id, cold_room_id, incident_type, reason, metadata)
     VALUES($1, $2, $3, $4, $5, $6)`,
    [params.workerId ?? null, params.tagId ?? null, params.coldRoomId ?? null, params.incidentType, params.reason, params.metadata ?? {}]
  );
}
