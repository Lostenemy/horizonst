import { db } from '../../db/pool';

const REQUIRED_COLUMNS = [
  'worker_id',
  'tag_id',
  'cold_room_id',
  'severity',
  'alert_type',
  'message',
  'metadata',
  'acknowledged_at',
  'created_at'
];

let cachedTable: 'alerts' | 'alarms' | null = null;

export async function resolveOperationalAlarmTable(): Promise<'alerts' | 'alarms'> {
  if (cachedTable) return cachedTable;

  const result = await db.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('alerts', 'alarms')`
  );

  const tableColumns = new Map<string, Set<string>>();
  for (const row of result.rows) {
    if (!tableColumns.has(row.table_name)) {
      tableColumns.set(row.table_name, new Set<string>());
    }
    tableColumns.get(row.table_name)?.add(row.column_name);
  }

  const alarmsColumns = tableColumns.get('alarms');
  const alarmsCompatible = alarmsColumns && REQUIRED_COLUMNS.every((column) => alarmsColumns.has(column));

  cachedTable = alarmsCompatible ? 'alarms' : 'alerts';
  return cachedTable;
}
