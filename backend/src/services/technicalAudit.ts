import { PoolClient } from 'pg';
import { pool } from '../db/pool';

const SENSITIVE_KEY = /(password|passwd|secret|token|credential|authorization|ble_pass)/i;

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item)
    ])
  );
};

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
  result: 'success' | 'failure' | 'denied';
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
      entry.before === undefined ? null : JSON.stringify(redact(entry.before)),
      entry.after === undefined ? null : JSON.stringify(redact(entry.after))
    ]
  );
};
