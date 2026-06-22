import { pool } from '../../db/pool.js';

export const writeAuditLog = async (input: {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  payload?: Record<string, unknown>;
}, client?: any): Promise<void> => {
  const executor = client ?? pool;
  await executor.query(
    `INSERT INTO store.audit_log (actor_user_id, action, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [input.actorUserId ?? null, input.action, input.entityType, input.entityId ?? null, JSON.stringify(input.payload ?? {})]
  );
};
