import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { accumulateWorkerWorkday } from '../../realtime/workday-duration';
import { consumeInspectionRows, InspectionRow, loadInspectionSummary } from '../inspection-report.service';

const databaseUrl = process.env.HORNEO_EXPOSURE_TEST_DATABASE_URL;
const enabled = process.env.HORNEO_EXPOSURE_ALLOW_DATABASE_TESTS === 'true' && Boolean(databaseUrl);

test('PostgreSQL 15 keeps report and panel exposure coherent across timeouts, gateways and midnight', {
  skip: enabled ? false : 'requires an explicitly isolated PostgreSQL 15 database'
}, async () => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(databaseUrl!).hostname),
    'isolated PostgreSQL test must connect through loopback');
  const admin = new Pool({ connectionString: databaseUrl });
  const schema = `horneo_exposure_${randomUUID().replace(/-/g, '')}`;
  const database = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` });
  let schemaCreated = false;
  try {
    assert.match((await admin.query("SELECT current_setting('server_version') AS version")).rows[0].version, /^15\./);
    await admin.query(`CREATE SCHEMA ${schema}`);
    schemaCreated = true;
    await database.query(`
      CREATE TABLE workers(id uuid PRIMARY KEY, full_name text, dni text);
      CREATE TABLE tags(id uuid PRIMARY KEY, tag_uid text, hardware_device_id bigint);
      CREATE TABLE gateways(hardware_gateway_id bigint, cold_room_id uuid);
      CREATE TABLE tag_gateway_presence_state(hardware_device_id bigint, hardware_gateway_id bigint, last_presence_at timestamptz);
      CREATE TABLE cold_room_sessions(
        id uuid PRIMARY KEY, worker_id uuid, tag_id uuid, hardware_device_id bigint,
        cold_room_id uuid, started_at timestamptz, ended_at timestamptz, duration_seconds int
      );
      INSERT INTO workers VALUES
        ('00000000-0000-4000-8000-000000000001', 'Worker 1', 'DNI1'),
        ('00000000-0000-4000-8000-000000000002', 'Worker 2', 'DNI2');
      INSERT INTO tags VALUES
        ('10000000-0000-4000-8000-000000000001', 'TAG1', 101),
        ('10000000-0000-4000-8000-000000000002', 'TAG2', 102),
        ('10000000-0000-4000-8000-000000000003', 'TAG3', 103);
      INSERT INTO gateways VALUES
        (11, '20000000-0000-4000-8000-000000000001'),
        (12, '20000000-0000-4000-8000-000000000001'),
        (13, '20000000-0000-4000-8000-000000000002');
      INSERT INTO cold_room_sessions VALUES
        ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
         '10000000-0000-4000-8000-000000000001', 101, '20000000-0000-4000-8000-000000000001',
         '2026-01-15T08:00:00Z', '2026-01-15T08:10:45Z', 600),
        ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001',
         '10000000-0000-4000-8000-000000000001', 101, '20000000-0000-4000-8000-000000000001',
         '2026-01-15T09:00:00Z', '2026-01-15T09:30:00Z', 1800),
        ('30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001',
         '10000000-0000-4000-8000-000000000002', 102, '20000000-0000-4000-8000-000000000001',
         '2026-01-15T10:00:00Z', NULL, NULL),
        ('30000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001',
         '10000000-0000-4000-8000-000000000001', 101, '20000000-0000-4000-8000-000000000001',
         '2026-01-15T10:05:00Z', '2026-01-15T10:20:00Z', 900),
        ('30000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000002',
         '10000000-0000-4000-8000-000000000003', 103, '20000000-0000-4000-8000-000000000001',
         '2026-03-28T22:30:00Z', '2026-03-29T00:30:00Z', 7200);
      INSERT INTO tag_gateway_presence_state VALUES
        (102, 11, '2026-01-15T10:10:00Z'),
        (102, 12, '2026-01-15T10:15:00Z'),
        (102, 12, '2026-01-15T10:14:00Z'),
        (102, 13, '2026-01-15T10:40:00Z');
    `);

    const rows: InspectionRow[] = [];
    await consumeInspectionRows(async (sql, values) => (await database.query<InspectionRow>(sql, values)).rows,
      {}, (row) => { rows.push(row); }, 10);
    assert.equal(rows.length, 5);
    const timeout = rows.find((row) => row.session_id.endsWith('0001'))!;
    const explicit = rows.find((row) => row.session_id.endsWith('0002'))!;
    const open = rows.find((row) => row.session_id.endsWith('0003'))!;
    assert.equal(timeout.duration_seconds, 600);
    assert.equal(new Date(timeout.exposure_ended_at).toISOString(), '2026-01-15T08:10:00.000Z');
    assert.equal(new Date(timeout.ended_at!).toISOString(), '2026-01-15T08:10:45.000Z');
    assert.equal(explicit.duration_seconds, 1800);
    assert.equal(new Date(explicit.exposure_ended_at).toISOString(), new Date(explicit.ended_at!).toISOString());
    assert.equal(open.duration_seconds, 900);
    assert.equal(new Date(open.exposure_ended_at).toISOString(), '2026-01-15T10:15:00.000Z');

    const summary = await loadInspectionSummary(async (sql, values) => (await database.query(sql, values)).rows[0], {});
    assert.deepEqual(summary, { totalRows: 5, criticalRows: 1, averageSeconds: 2280 });
    const totals = accumulateWorkerWorkday(rows.filter((row) => row.worker_dni === 'DNI1').map((row) => ({
      worker_id: 'worker-1', full_name: row.worker_name, dni: row.worker_dni,
      started_at: row.started_at, exposure_ended_at: row.exposure_ended_at
    })), new Date('2026-01-15T12:00:00Z'));
    assert.equal(totals[0].accumulated_seconds, 3600);
    const crossing = rows.find((row) => row.session_id.endsWith('0005'))!;
    assert.equal(crossing.duration_seconds, 7200);
    assert.equal(accumulateWorkerWorkday([{
      worker_id: 'worker-2', full_name: crossing.worker_name, dni: crossing.worker_dni,
      started_at: crossing.started_at, exposure_ended_at: crossing.exposure_ended_at
    }], new Date('2026-03-29T12:00:00Z'))[0].accumulated_seconds, 5400);
  } finally {
    await database.end();
    if (schemaCreated) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
