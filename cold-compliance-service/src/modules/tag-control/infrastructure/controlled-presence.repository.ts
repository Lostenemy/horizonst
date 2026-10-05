import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { db } from '../../../db/pool';
import { env } from '../../../config/env';

export const CONTROLLED_BLE_MAX_MS = 120_000;
export const CONTROLLED_BLE_RECOVERY_MS = 10_000;
export interface ControlledPresenceOperation { operationId: string; hardwareDeviceId: number; deadlineMs: number }

// A stalled database must not leave the executor waiting or a session lock borrowed.
export async function withControlledClient<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient | undefined;
  let expired = false;
  let released = false;
  const release = (destroy: boolean) => { if (client && !released) { released = true; client.release(destroy); } };
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; release(true); reject(new Error('controlled_presence_database_timeout')); }, 2000);
  });
  const operation = (async () => {
    client = await db.connect();
    if (expired) { release(true); throw new Error('controlled_presence_database_timeout'); }
    return work(client);
  })();
  try { return await Promise.race([operation, deadline]); }
  catch (error) { release(true); throw error; }
  finally { clearTimeout(timer!); release(false); }
}

export async function beginControlledPresenceOperation(params: {
  tagId: string; hardwareDeviceId: number; companyId: string; alertId: string;
}): Promise<ControlledPresenceOperation | 'busy' | null> {
  return withControlledClient(async client => {
    await client.query('BEGIN');
    // The timeout closer takes the same session row lock before its guarded UPDATE.
    const session = await client.query<{ id: string }>(
      `SELECT id FROM cold_room_sessions WHERE hardware_device_id = $1 AND tag_id = $2
       AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1 FOR UPDATE`, [params.hardwareDeviceId, params.tagId]);
    if (!session.rowCount) { await client.query('COMMIT'); return null; }
    const operationId = randomUUID();
    const result = await client.query<{ hard_deadline: Date }>(
      `WITH detection AS (
         SELECT MAX(ps.last_presence_at) AS last_presence_at FROM tag_gateway_presence_state ps
         JOIN gateways g ON g.hardware_gateway_id = ps.hardware_gateway_id
         JOIN cold_room_sessions s ON s.id = $3
         WHERE ps.hardware_device_id = $1 AND ps.last_presence_at >= s.started_at
           AND (s.cold_room_id IS NULL OR g.cold_room_id = s.cold_room_id)
       )
       INSERT INTO controlled_b5_presence_operations
         (hardware_device_id, operation_id, session_id, company_id, alert_reference,
          started_at, hard_deadline, protect_until, completed_at, outcome)
       SELECT $1,$2,$3,$4,$5,statement_timestamp(),statement_timestamp() + INTERVAL '120 seconds',
              statement_timestamp() + INTERVAL '120 seconds',NULL,'running'
       FROM detection WHERE last_presence_at > clock_timestamp() - $6::interval
       ON CONFLICT (hardware_device_id) DO UPDATE SET
         operation_id = EXCLUDED.operation_id, session_id = EXCLUDED.session_id, company_id = EXCLUDED.company_id,
         alert_reference = EXCLUDED.alert_reference, started_at = EXCLUDED.started_at,
         hard_deadline = EXCLUDED.hard_deadline, protect_until = EXCLUDED.protect_until,
         completed_at = NULL, outcome = 'running'
       WHERE controlled_b5_presence_operations.protect_until <= clock_timestamp()
         AND (controlled_b5_presence_operations.session_id <> EXCLUDED.session_id
              OR (SELECT last_presence_at FROM detection) > controlled_b5_presence_operations.protect_until)
       RETURNING hard_deadline`,
      [params.hardwareDeviceId, operationId, session.rows[0].id, params.companyId, params.alertId,
        `${Math.max(1000, env.PRESENCE_EXIT_TIMEOUT_MS)} milliseconds`]);
    await client.query('COMMIT');
    // No fresh accepted detection or an earlier operation: fail conservatively, do not connect/reprotect.
    if (!result.rowCount) return 'busy';
    return { operationId, hardwareDeviceId: params.hardwareDeviceId, deadlineMs: new Date(result.rows[0].hard_deadline).getTime() };
  });
}

export async function finishControlledPresenceOperation(operation: ControlledPresenceOperation, outcome: 'confirmed' | 'unverified' | 'failed'): Promise<void> {
  await withControlledClient(async client => {
    await client.query(
      `UPDATE controlled_b5_presence_operations SET completed_at = clock_timestamp(), outcome = $3,
       protect_until = LEAST(hard_deadline, clock_timestamp() + INTERVAL '10 seconds')
       WHERE hardware_device_id = $1 AND operation_id = $2 AND outcome = 'running'`,
      [operation.hardwareDeviceId, operation.operationId, outcome]);
  });
}
