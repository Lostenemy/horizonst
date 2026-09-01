import { config } from '../config';
import { pool } from '../db/pool';

export async function runMqttStorageMaintenance(): Promise<number> {
  const startedAt = Date.now();
  const result = await pool.query(
    `WITH expired AS (
       SELECT id FROM mqtt_messages
       WHERE received_at < NOW() - $1::interval
       ORDER BY received_at ASC
       LIMIT $2
     )
     DELETE FROM mqtt_messages m USING expired e WHERE m.id = e.id`,
    [`${config.maintenance.mqttRawRetentionHours} hours`, config.maintenance.batchSize]
  );
  const deleted = result.rowCount ?? 0;
  console.log('MQTT storage maintenance completed', { deleted, durationMs: Date.now() - startedAt });
  return deleted;
}

export function startMqttStorageMaintenance(): void {
  const run = () => runMqttStorageMaintenance().catch((error) => console.error('MQTT storage maintenance failed', error));
  setImmediate(run);
  setInterval(run, config.maintenance.intervalMs).unref();
}
