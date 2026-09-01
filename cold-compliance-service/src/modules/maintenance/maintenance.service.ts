import { env } from '../../config/env';
import { db } from '../../db/pool';
import { logger } from '../../utils/logger';
import { reconcileExpiredBleSessions } from '../tag-control/infrastructure/ble-session.repository';

async function deleteBatch(sql: string, params: unknown[]): Promise<number> {
  const result = await db.query(sql, params);
  return result.rowCount ?? 0;
}

export async function runPresenceMaintenance(): Promise<void> {
  const startedAt = Date.now();
  const batchSize = Math.max(100, env.PRESENCE_MAINTENANCE_BATCH_SIZE);
  const heartbeatDays = Math.max(1, env.PRESENCE_HEARTBEAT_RETENTION_DAYS);
  const syncHours = Math.max(1, env.SYNC_QUEUE_SYNCED_RETENTION_HOURS);

  const expiredBleSessions = await reconcileExpiredBleSessions();
  const presenceEventsDeleted = await deleteBatch(
    `WITH expired AS (
       SELECT id FROM presence_events
       WHERE event_type IN ('heartbeat', 'telemetry', 'movement')
         AND created_at < NOW() - $1::interval
       ORDER BY created_at ASC
       LIMIT $2
     )
     DELETE FROM presence_events p USING expired e WHERE p.id = e.id`,
    [`${heartbeatDays} days`, batchSize]
  );
  const syncRowsDeleted = await deleteBatch(
    `WITH expired AS (
       SELECT id FROM sync_queue
       WHERE status = 'synced' AND synced_at < NOW() - $1::interval
       ORDER BY synced_at ASC
       LIMIT $2
     )
     DELETE FROM sync_queue q USING expired e WHERE q.id = e.id`,
    [`${syncHours} hours`, batchSize]
  );

  logger.info({ expiredBleSessions, presenceEventsDeleted, syncRowsDeleted, durationMs: Date.now() - startedAt }, 'presence storage maintenance completed');
}

export function startPresenceMaintenanceLoop(): void {
  const intervalMs = Math.max(60000, env.PRESENCE_MAINTENANCE_INTERVAL_MS);
  const run = () => runPresenceMaintenance().catch((error) => logger.error({ error }, 'presence storage maintenance failed'));
  setImmediate(run);
  setInterval(run, intervalMs).unref();
}
