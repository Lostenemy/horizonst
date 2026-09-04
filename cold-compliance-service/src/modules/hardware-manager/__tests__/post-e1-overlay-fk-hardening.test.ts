import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';

const migrationPath = join(process.cwd(), 'migrations/020_overlay_tag_foreign_keys_restrict.sql');
const migration = readFileSync(migrationPath, 'utf8');

test('Post-E.1 validates the real legacy constraints before replacing only their delete action', () => {
  for (const table of ['presence_operational_state', 'ble_alarm_sessions']) {
    assert.match(migration, new RegExp(`FROM ${table}[\\s\\S]+tag_id IS NULL OR hardware_device_id IS NULL`));
    assert.match(migration, new RegExp(`FROM ${table} [a-z]+[\\s\\S]+LEFT JOIN tags overlay[\\s\\S]+overlay\\.id IS NULL`));
    assert.match(migration, new RegExp(`${table}_tag_id_fkey[\\s\\S]+confdeltype = 'c'`));
    assert.match(migration, new RegExp(`ALTER TABLE ${table}[\\s\\S]+DROP CONSTRAINT ${table}_tag_id_fkey,[\\s\\S]+ADD CONSTRAINT ${table}_tag_id_fkey[\\s\\S]+ON DELETE RESTRICT`));
    assert.match(migration, new RegExp(`${table}_tag_id_fkey[\\s\\S]+confdeltype = 'r'`));
  }
});

test('Post-E.1 keeps both identities mandatory, changes no rows and documents their ownership', () => {
  assert.match(migration, /attname IN \('tag_id', 'hardware_device_id'\)[\s\S]+attnotnull/);
  assert.match(migration, /presence_operational_state\.hardware_device_id[\s\S]+Identidad operativa obligatoria gobernada por Hardware Manager/);
  assert.match(migration, /ble_alarm_sessions\.hardware_device_id[\s\S]+Identidad operativa obligatoria gobernada por Hardware Manager/);
  assert.match(migration, /presence_operational_state\.tag_id[\s\S]+Referencia local e histórica al overlay tags de Horneo/);
  assert.match(migration, /ble_alarm_sessions\.tag_id[\s\S]+Referencia local e histórica al overlay tags de Horneo/);
  assert.doesNotMatch(migration, /\b(?:UPDATE\s+\w+|INSERT\s+INTO|DELETE\s+FROM|TRUNCATE)\b/i);
  assert.doesNotMatch(migration, /CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+INDEX|ALTER\s+COLUMN/i);
});

test('the migration runner applies each SQL migration transactionally', () => {
  const runner = readFileSync(join(process.cwd(), 'src/db/migrate.ts'), 'utf8');
  assert.match(runner, /await db\.query\('BEGIN'\)/);
  assert.match(runner, /await db\.query\(sql\)/);
  assert.match(runner, /await db\.query\('COMMIT'\)/);
  assert.match(runner, /await db\.query\('ROLLBACK'\)/);
  assert.ok(runner.indexOf("await db.query('BEGIN')") < runner.indexOf('await db.query(sql)'));
  assert.ok(runner.indexOf('await db.query(sql)') < runner.indexOf("await db.query('COMMIT')"));
});

const databaseUrl = process.env.POST_E1_TEST_DATABASE_URL;
const databaseTestEnabled = process.env.POST_E1_ALLOW_DATABASE_TESTS === 'true' && Boolean(databaseUrl);

test('Post-E.1 preserves counts and rejects a referenced tag DELETE transactionally', {
  skip: databaseTestEnabled ? false : 'requires explicit POST_E1_TEST_DATABASE_URL and POST_E1_ALLOW_DATABASE_TESTS=true'
}, async () => {
  assert.ok(databaseUrl);
  const parsedUrl = new URL(databaseUrl);
  assert.match(parsedUrl.pathname, /test/i, 'the dedicated database name must contain "test"');

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const schema = `post_e1_${process.pid}_${randomUUID().replace(/-/g, '')}`;
  const tagId = '00000000-0000-4000-8000-000000000001';

  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}", public`);
    await client.query(`
      CREATE TABLE tags (id UUID PRIMARY KEY);
      CREATE TABLE presence_operational_state (
        hardware_device_id INTEGER PRIMARY KEY,
        tag_id UUID NOT NULL CONSTRAINT presence_operational_state_tag_id_fkey
          REFERENCES tags(id) ON DELETE CASCADE
      );
      CREATE TABLE ble_alarm_sessions (
        hardware_device_id INTEGER PRIMARY KEY,
        tag_id UUID NOT NULL CONSTRAINT ble_alarm_sessions_tag_id_fkey
          REFERENCES tags(id) ON DELETE CASCADE
      );
    `);
    await client.query('INSERT INTO tags(id) VALUES($1)', [tagId]);
    await client.query('INSERT INTO presence_operational_state(hardware_device_id, tag_id) VALUES(101, $1)', [tagId]);
    await client.query('INSERT INTO ble_alarm_sessions(hardware_device_id, tag_id) VALUES(101, $1)', [tagId]);

    const before = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM tags) AS tags,
        (SELECT COUNT(*)::int FROM presence_operational_state) AS presence,
        (SELECT COUNT(*)::int FROM ble_alarm_sessions) AS ble,
        (SELECT COUNT(*)::int FROM presence_operational_state WHERE tag_id IS NULL OR hardware_device_id IS NULL) AS presence_nulls,
        (SELECT COUNT(*)::int FROM ble_alarm_sessions WHERE tag_id IS NULL OR hardware_device_id IS NULL) AS ble_nulls,
        (SELECT COUNT(*)::int FROM presence_operational_state state LEFT JOIN tags overlay ON overlay.id = state.tag_id WHERE overlay.id IS NULL) AS presence_orphans,
        (SELECT COUNT(*)::int FROM ble_alarm_sessions session LEFT JOIN tags overlay ON overlay.id = session.tag_id WHERE overlay.id IS NULL) AS ble_orphans
    `);

    const constraintsBefore = await client.query<{ conname: string; confdeltype: string }>(`
      SELECT conname, confdeltype
      FROM pg_constraint
      WHERE conrelid IN ('presence_operational_state'::regclass, 'ble_alarm_sessions'::regclass)
        AND conname IN ('presence_operational_state_tag_id_fkey', 'ble_alarm_sessions_tag_id_fkey')
      ORDER BY conname
    `);
    assert.deepEqual(constraintsBefore.rows, [
      { conname: 'ble_alarm_sessions_tag_id_fkey', confdeltype: 'c' },
      { conname: 'presence_operational_state_tag_id_fkey', confdeltype: 'c' }
    ]);

    await client.query(migration);

    const constraints = await client.query<{ conname: string; confdeltype: string }>(`
      SELECT conname, confdeltype
      FROM pg_constraint
      WHERE conrelid IN ('presence_operational_state'::regclass, 'ble_alarm_sessions'::regclass)
        AND conname IN ('presence_operational_state_tag_id_fkey', 'ble_alarm_sessions_tag_id_fkey')
      ORDER BY conname
    `);
    assert.deepEqual(constraints.rows, [
      { conname: 'ble_alarm_sessions_tag_id_fkey', confdeltype: 'r' },
      { conname: 'presence_operational_state_tag_id_fkey', confdeltype: 'r' }
    ]);
    const mandatoryColumns = await client.query<{ table_name: string; column_name: string; is_nullable: string }>(`
      SELECT table_name, column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name IN ('presence_operational_state', 'ble_alarm_sessions')
        AND column_name IN ('tag_id', 'hardware_device_id')
      ORDER BY table_name, column_name
    `, [schema]);
    assert.equal(mandatoryColumns.rowCount, 4);
    assert.ok(mandatoryColumns.rows.every((column) => column.is_nullable === 'NO'));

    await client.query('SAVEPOINT referenced_delete');
    let deleteErrorCode: string | undefined;
    try {
      await client.query('DELETE FROM tags WHERE id = $1', [tagId]);
    } catch (error) {
      deleteErrorCode = (error as { code?: string }).code;
    }
    await client.query('ROLLBACK TO SAVEPOINT referenced_delete');
    assert.equal(deleteErrorCode, '23503');

    const after = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM tags) AS tags,
        (SELECT COUNT(*)::int FROM presence_operational_state) AS presence,
        (SELECT COUNT(*)::int FROM ble_alarm_sessions) AS ble,
        (SELECT COUNT(*)::int FROM presence_operational_state WHERE tag_id IS NULL OR hardware_device_id IS NULL) AS presence_nulls,
        (SELECT COUNT(*)::int FROM ble_alarm_sessions WHERE tag_id IS NULL OR hardware_device_id IS NULL) AS ble_nulls,
        (SELECT COUNT(*)::int FROM presence_operational_state state LEFT JOIN tags overlay ON overlay.id = state.tag_id WHERE overlay.id IS NULL) AS presence_orphans,
        (SELECT COUNT(*)::int FROM ble_alarm_sessions session LEFT JOIN tags overlay ON overlay.id = session.tag_id WHERE overlay.id IS NULL) AS ble_orphans
    `);
    assert.deepEqual(after.rows[0], before.rows[0]);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    await pool.end();
  }
});
