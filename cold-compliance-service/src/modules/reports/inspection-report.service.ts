export interface InspectionFilters {
  from?: string;
  to?: string;
  workerDni?: string;
}

export interface InspectionRow {
  session_id: string;
  worker_name: string;
  worker_dni: string;
  tag_mac: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
}

export interface InspectionSummary {
  totalRows: number;
  criticalRows: number;
  averageSeconds: number;
}

export type InspectionPageQuery = (sql: string, values: unknown[]) => Promise<InspectionRow[]>;
export type InspectionSummaryQuery = (sql: string, values: unknown[]) => Promise<Record<string, unknown>>;

export const INSPECTION_BATCH_SIZE = 1000;

function inspectionConditions(filters: InspectionFilters, values: unknown[]): string[] {
  const conditions: string[] = [];
  if (filters.from) {
    values.push(filters.from);
    conditions.push(`s.started_at >= ($${values.length}::date::timestamp AT TIME ZONE 'Europe/Madrid')`);
  }
  if (filters.to) {
    values.push(filters.to);
    conditions.push(`s.started_at < ((($${values.length}::date + 1)::timestamp) AT TIME ZONE 'Europe/Madrid')`);
  }
  if (filters.workerDni) {
    values.push(`%${filters.workerDni}%`);
    conditions.push(`w.dni ILIKE $${values.length}`);
  }
  return conditions;
}

export async function loadInspectionSummary(
  query: InspectionSummaryQuery,
  filters: InspectionFilters
): Promise<InspectionSummary> {
  const values: unknown[] = [];
  const conditions = inspectionConditions(filters, values);
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const row = await query(
    `SELECT COUNT(*)::bigint AS total_rows,
            COUNT(*) FILTER (WHERE COALESCE(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at))::int, 0) >= 2700)::bigint AS critical_rows,
            COALESCE(AVG(COALESCE(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at))::int, 0)), 0) AS average_seconds
     FROM cold_room_sessions s
     JOIN workers w ON w.id = s.worker_id
     ${whereClause}`,
    values
  );
  return {
    totalRows: Number(row.total_rows ?? 0),
    criticalRows: Number(row.critical_rows ?? 0),
    averageSeconds: Math.round(Number(row.average_seconds ?? 0))
  };
}

export async function consumeInspectionRows(
  query: InspectionPageQuery,
  filters: InspectionFilters,
  consume: (row: InspectionRow) => void | Promise<void>,
  batchSize = INSPECTION_BATCH_SIZE
): Promise<number> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new Error('El tamaño de página del informe debe ser un entero positivo');
  }

  let cursor: Pick<InspectionRow, 'started_at' | 'session_id'> | undefined;
  let consumed = 0;
  while (true) {
    const values: unknown[] = [];
    const conditions = inspectionConditions(filters, values);
    if (cursor) {
      values.push(cursor.started_at, cursor.session_id);
      conditions.push(`(s.started_at, s.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
    values.push(batchSize);
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await query(
      `SELECT s.id::text AS session_id,
              w.full_name AS worker_name,
              w.dni AS worker_dni,
              COALESCE(t.tag_uid, '') AS tag_mac,
              s.started_at,
              s.ended_at,
              COALESCE(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at))::int, 0) AS duration_seconds
       FROM cold_room_sessions s
       JOIN workers w ON w.id = s.worker_id
       LEFT JOIN tags t ON t.id = s.tag_id
       ${whereClause}
       ORDER BY s.started_at DESC, s.id DESC
       LIMIT $${values.length}`,
      values
    );
    for (const row of rows) {
      await consume(row);
      consumed += 1;
    }
    if (rows.length < batchSize) break;
    const last = rows[rows.length - 1];
    cursor = { started_at: last.started_at, session_id: last.session_id };
  }
  return consumed;
}

export function assertInspectionIntegrity(expected: number, included: number): void {
  if (expected !== included) {
    throw new Error(`Informe incompleto: PostgreSQL contiene ${expected} sesiones y se incluyeron ${included}`);
  }
}
