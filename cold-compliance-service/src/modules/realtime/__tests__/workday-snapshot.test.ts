import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../../../db/pool';
import { loadOperationalSnapshot } from '../realtime.routes';

test('snapshot and SSE source include every known worker session of the Madrid day', async () => {
  const originalQuery = db.query;
  const queries: Array<{ sql: string; values: unknown[] | undefined }> = [];
  db.query = (async (sql: string, values?: unknown[]) => {
    queries.push({ sql, values });
    if (sql.includes('FROM cold_room_sessions s') && sql.includes('SELECT s.worker_id')) {
      return { rows: [
        { worker_id: 'worker-1', full_name: 'Worker 1', dni: '123', started_at: '2026-09-25T07:00:00Z', exposure_ended_at: '2026-09-25T08:00:00Z' },
        { worker_id: 'worker-1', full_name: 'Worker 1', dni: '123', started_at: '2026-09-25T08:30:00Z', exposure_ended_at: '2026-09-25T08:45:00Z' }
      ], rowCount: 2 };
    }
    return { rows: [], rowCount: 0 };
  }) as typeof db.query;
  try {
    const snapshot = await loadOperationalSnapshot(new Date('2026-09-25T09:00:00Z'));
    assert.equal(snapshot.workersInside.length, 0);
    assert.equal(snapshot.workersWorkday.length, 1);
    assert.equal(snapshot.workersWorkday[0].accumulated_seconds, 75 * 60);
    const workdayQuery = queries.find((query) => query.sql.includes('SELECT s.worker_id'));
    assert.deepEqual(workdayQuery?.values, ['2026-09-24T22:00:00.000Z', '2026-09-25T22:00:00.000Z']);
    assert.match(workdayQuery?.sql ?? '', /s\.worker_id IS NOT NULL/);
    assert.match(workdayQuery?.sql ?? '', /MAX\(ps\.last_presence_at\)/);
    assert.match(workdayQuery?.sql ?? '', /seen_gateway\.cold_room_id = s\.cold_room_id/);
    assert.match(workdayQuery?.sql ?? '', /s\.started_at \+ s\.duration_seconds \* INTERVAL '1 second'/);
    assert.match(workdayQuery?.sql ?? '', /ELSE LEAST\(NOW\(\), COALESCE\(/);
    assert.doesNotMatch(workdayQuery?.sql ?? '', /LIMIT\s+\d+/i);
  } finally {
    db.query = originalQuery;
  }
});

test('dashboard places grace below inside and shows the six-hour total in the former grace column', () => {
  const app = readFileSync(join(process.cwd(), 'web/app.js'), 'utf8');
  const dashboard = app.slice(app.indexOf('async function renderDashboard('), app.indexOf('async function refreshDashboardNow('));
  assert.match(dashboard, /workersWorkday/);
  assert.ok(dashboard.indexOf('<h3>Trabajadores dentro') < dashboard.indexOf('<h3 class="mt-12">En estado de gracia'));
  assert.ok(dashboard.indexOf('<h3 class="mt-12">En estado de gracia') < dashboard.indexOf('Tiempo acumulado en cámaras hoy'));
  assert.match(dashboard, /Referencia visual de 6 horas; no genera bloqueos ni alarmas/);
  const route = readFileSync(join(process.cwd(), 'src/modules/realtime/realtime.routes.ts'), 'utf8');
  assert.match(route, /realtimeRouter\.get\('\/snapshot'[\s\S]*loadOperationalSnapshot\(\)/);
  assert.match(route, /event: snapshot[\s\S]*JSON\.stringify\(payload\)/);
});
