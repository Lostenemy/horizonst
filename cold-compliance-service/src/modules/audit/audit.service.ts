import { db } from '../../db/pool';

export async function appendAuditLog(params: {
  actorType: 'system' | 'user';
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await db.query(
    `INSERT INTO audit_log(actor_type, actor_id, action, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [params.actorType, params.actorId ?? null, params.action, params.entityType, params.entityId, params.payload]
  );
}
