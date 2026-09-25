import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  InspectionRow,
  assertInspectionIntegrity,
  consumeInspectionRows,
  inspectionDisplayTimes,
  loadInspectionSummary
} from '../inspection-report.service';
import { sessionExposureEndSql, sessionExposureSecondsSql } from '../../compliance/session-exposure.sql';

function session(index: number): InspectionRow {
  return {
    session_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    worker_name: `Trabajador ${index % 37}`,
    worker_dni: `DNI${index % 37}`,
    tag_mac: `TAG${index % 53}`,
    started_at: new Date(Date.UTC(2026, 0, 1) - index * 1000).toISOString(),
    ended_at: new Date(Date.UTC(2026, 0, 1, 0, 1) - index * 1000).toISOString(),
    exposure_ended_at: new Date(Date.UTC(2026, 0, 1, 0, 1) - index * 1000).toISOString(),
    duration_seconds: 60
  };
}

test('incluye exactamente las 17.524 sesiones mediante páginas internas', async () => {
  const databaseRows = Array.from({ length: 17_524 }, (_, index) => session(index));
  const included: InspectionRow[] = [];
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  let offset = 0;

  const count = await consumeInspectionRows(
    async (sql, values) => {
      queries.push({ sql, values });
      const pageSize = Number(values[values.length - 1]);
      const page = databaseRows.slice(offset, offset + pageSize);
      offset += page.length;
      return page;
    },
    {},
    (row) => {
      included.push(row);
    }
  );

  assertInspectionIntegrity(databaseRows.length, count);
  assert.equal(count, 17_524);
  assert.equal(included.length, 17_524);
  assert.equal(queries.length, 18);
  assert.ok(queries.every(({ sql }) => !sql.includes('w.dni ILIKE')));
  assert.ok(queries.every(({ sql }) => !sql.includes('s.started_at >=')));
  assert.ok(queries.every(({ sql }) => !sql.includes('s.started_at < (')));
  assert.ok(queries.every(({ sql }) => /ORDER BY s\.started_at DESC, s\.id DESC/.test(sql)));
  assert.ok(queries[0].sql.includes(`${sessionExposureEndSql('s')} AS exposure_ended_at`));
  assert.ok(queries[0].sql.includes(`${sessionExposureSecondsSql('s')} AS duration_seconds`));
  assert.match(queries[0].sql, /SELECT MAX\(ps\.last_presence_at\)/);
  assert.doesNotMatch(queries[0].sql, /s\.id\) < /);
  assert.match(queries[1].sql, /\(s\.started_at, s\.id\) < \(\$1::timestamptz, \$2::uuid\)/);
  assert.deepEqual(queries[1].values.slice(0, 2), [databaseRows[999].started_at, databaseRows[999].session_id]);
});

test('panel, report rows and report summary share the same exposure endpoint', async () => {
  const panel = readFileSync(join(process.cwd(), 'src/modules/realtime/realtime.routes.ts'), 'utf8');
  assert.match(panel, /sessionExposureEndSql\('s'\)/);
  const calls: string[] = [];
  await loadInspectionSummary(async (sql) => {
    calls.push(sql);
    return { total_rows: 2, critical_rows: 1, average_seconds: 1800 };
  }, {});
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes(sessionExposureSecondsSql('s')));
  assert.doesNotMatch(calls[0], /COALESCE\(s\.ended_at, NOW\(\)\)/);
  const routes = readFileSync(join(process.cwd(), 'src/modules/reports/reports.routes.ts'), 'utf8');
  assert.match(routes, /inspection\.xlsx[\s\S]*inspectionDisplayTimes\(row\)/);
  assert.match(routes, /inspection\.pdf[\s\S]*inspectionDisplayTimes\(row\)/);
});

test('timeout, explicit exit and open report rows distinguish exposure from exit confirmation', () => {
  const timeout = inspectionDisplayTimes({
    ...session(1), started_at: '2026-09-25T08:00:00Z',
    exposure_ended_at: '2026-09-25T08:10:17Z', ended_at: '2026-09-25T08:10:47Z',
    duration_seconds: 617
  });
  assert.notEqual(timeout.exposureEnd, timeout.exitConfirmed);
  assert.equal(timeout.exposureMinutes, 617 / 60);
  const explicit = inspectionDisplayTimes({
    ...session(2), exposure_ended_at: '2026-09-25T08:10:17Z', ended_at: '2026-09-25T08:10:17Z'
  });
  assert.equal(explicit.exposureEnd, explicit.exitConfirmed);
  const open = inspectionDisplayTimes({
    ...session(3), exposure_ended_at: '2026-09-25T08:10:17Z', ended_at: null
  });
  assert.equal(open.exitConfirmed, 'En curso');
});

test('aplica únicamente los filtros explícitos y cubre el día to completo', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  await consumeInspectionRows(
    async (sql, values) => {
      calls.push({ sql, values });
      return [];
    },
    { from: '2026-03-01', to: '2026-03-31', workerDni: '1234' },
    () => undefined
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /s\.started_at >= \(\$1::date::timestamp AT TIME ZONE 'Europe\/Madrid'\)/);
  assert.match(calls[0].sql, /s\.started_at < \(\(\(\$2::date \+ 1\)::timestamp\) AT TIME ZONE 'Europe\/Madrid'\)/);
  assert.match(calls[0].sql, /w\.dni ILIKE \$3/);
  assert.deepEqual(calls[0].values, ['2026-03-01', '2026-03-31', '%1234%', 1000]);
});

test('rechaza una discrepancia entre PostgreSQL y el contenido del informe', () => {
  assert.throws(() => assertInspectionIntegrity(17_524, 17_523), /Informe incompleto/);
});
