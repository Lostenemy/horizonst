import { env } from '../../config/env';
import { db } from '../../db/pool';
import { logger } from '../../utils/logger';

export function startSyncLoop(): void {
  setInterval(async () => {
    try {
      const pending = await db.query(
        `SELECT id FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1`,
        [env.SYNC_BATCH_SIZE]
      );

      if (!pending.rowCount) return;

      const ids = pending.rows.map((r) => r.id);
      await db.query(`UPDATE sync_queue SET status='synced', synced_at = NOW(), retries = retries + 1 WHERE id = ANY($1::uuid[])`, [ids]);
    } catch (error) {
      logger.error({ error }, 'sync loop failed');
    }
  }, 15000);
}
