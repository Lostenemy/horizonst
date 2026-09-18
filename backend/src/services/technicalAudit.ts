import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { redactHardwarePayload } from './hardwarePayloadRedaction';

export interface TechnicalAuditEntry {
  actorUserId?: number | null;
  actorType?: 'user' | 'service' | 'system';
  actorCode?: string | null;
  actorServiceId?: string | null;
  action: string;
  entityType: string;
  entityId: string | number;
  companyId?: string | null;
  requestId?: string;
  result: 'success' | 'failure' | 'denied' | 'unverified';
  before?: unknown;
  after?: unknown;
}

export const appendTechnicalAudit = async (
  entry: TechnicalAuditEntry,
  client: Pick<PoolClient, 'query'> | typeof pool = pool
): Promise<void> => {
  await client.query(
    `INSERT INTO technical_audit_log
       (actor_user_id, actor_type, actor_code, actor_service_id, action, entity_type, entity_id,
        company_id, request_id, result, before_state, after_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)`,
    [
      entry.actorUserId ?? null,
      entry.actorType ?? 'user',
      entry.actorCode ?? null,
      entry.actorServiceId ?? null,
      entry.action,
      entry.entityType,
      String(entry.entityId),
      entry.companyId ?? null,
      entry.requestId ?? null,
      entry.result,
      entry.before === undefined ? null : JSON.stringify(redactHardwarePayload(entry.before)),
      entry.after === undefined ? null : JSON.stringify(redactHardwarePayload(entry.after))
    ]
  );
};
