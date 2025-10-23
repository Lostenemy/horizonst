import dayjs from 'dayjs';
import { pool } from '../db/pool';

const CHECK_INTERVAL = 30_000;
let timer: NodeJS.Timeout | null = null;

interface AlarmConfigRow {
  id: number;
  owner_id: number;
  name: string;
  threshold_seconds: number;
  device_id: number | null;
  category_id: number | null;
  place_id: number | null;
  handler_group_id: number | null;
}

export const startAlarmMonitor = () => {
  if (timer) {
    return;
  }
  timer = setInterval(checkAlarms, CHECK_INTERVAL);
  void checkAlarms();
};

const checkAlarms = async () => {
  try {
    const configResult = await pool.query<AlarmConfigRow>(
      `SELECT id, owner_id, name, threshold_seconds, device_id, category_id, place_id, handler_group_id
       FROM alarm_configs
       WHERE active = true`
    );

    for (const config of configResult.rows) {
      const devices = await resolveDevicesForConfig(config);
      for (const device of devices) {
        await evaluateDeviceAlarm(config, device);
      }
    }
  } catch (error) {
    console.error('Failed to evaluate alarms', error);
  }
};

interface DeviceSummary {
  id: number;
  owner_id: number | null;
  last_seen_at: Date | null;
  last_place_id: number | null;
}

const resolveDevicesForConfig = async (config: AlarmConfigRow): Promise<DeviceSummary[]> => {
  if (config.device_id) {
    const result = await pool.query<DeviceSummary>('SELECT id, owner_id, last_seen_at, last_place_id FROM devices WHERE id = $1', [config.device_id]);
    return result.rows;
  }
  if (config.category_id) {
    const result = await pool.query<DeviceSummary>(
      'SELECT id, owner_id, last_seen_at, last_place_id FROM devices WHERE category_id = $1',
      [config.category_id]
    );
    return result.rows;
  }
  if (config.place_id) {
    const result = await pool.query<DeviceSummary>(
      'SELECT id, owner_id, last_seen_at, last_place_id FROM devices WHERE last_place_id = $1',
      [config.place_id]
    );
    return result.rows;
  }
  return [];
};

const evaluateDeviceAlarm = async (config: AlarmConfigRow, device: DeviceSummary) => {
  const lastSeen = device.last_seen_at ? dayjs(device.last_seen_at) : null;
  const now = dayjs();
  const diffSeconds = lastSeen ? now.diff(lastSeen, 'second') : Number.MAX_SAFE_INTEGER;

  const openAlarmResult = await pool.query(
    `SELECT id FROM alarms
     WHERE device_id = $1 AND alarm_config_id = $2 AND status IN ('OPEN', 'ACKNOWLEDGED')
     LIMIT 1`,
    [device.id, config.id]
  );
  const openAlarm = openAlarmResult.rows[0];

  if (diffSeconds > config.threshold_seconds) {
    if (!openAlarm) {
      await pool.query(
        `INSERT INTO alarms (device_id, alarm_config_id, triggered_at, status, breach_seconds)
         VALUES ($1, $2, NOW(), 'OPEN', $3)`,
        [device.id, config.id, diffSeconds]
      );
    } else {
      await pool.query('UPDATE alarms SET breach_seconds = $1, updated_at = NOW() WHERE id = $2', [diffSeconds, openAlarm.id]);
    }
  } else if (openAlarm) {
    await pool.query(
      `UPDATE alarms
       SET status = 'RESOLVED', resolved_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [openAlarm.id]
    );
  }
};
