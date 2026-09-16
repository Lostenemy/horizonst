import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { Client } from 'pg';

const migration = readFileSync(path.resolve(process.cwd(), 'migrations/005_vmq_auth_acl_mount_client_unique.sql'), 'utf8');

test('MQTT ACL migration preflights duplicates before adding the idempotent unique index', () => {
  assert.match(migration, /LOCK TABLE vmq_auth_acl IN SHARE MODE/);
  assert.match(migration, /GROUP BY mountpoint, client_id\s+HAVING count\(\*\) > 1/);
  assert.match(migration, /RAISE EXCEPTION 'vmq_auth_acl: % duplicate \(mountpoint, client_id\) group\(s\)/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS vmq_auth_acl_mount_client_unique\s+ON vmq_auth_acl\(mountpoint, client_id\)/);
  assert.ok(migration.indexOf('RAISE EXCEPTION') < migration.indexOf('CREATE UNIQUE INDEX'));
  assert.doesNotMatch(migration, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+vmq_auth_acl\b/i);
});

const databaseUrl = process.env.MQTT_ACL_MIGRATION_TEST_DATABASE_URL;
const databaseTestEnabled = process.env.MQTT_ACL_ALLOW_DATABASE_TESTS === 'true' && Boolean(databaseUrl);

test('MQTT ACL migration rejects duplicates, preserves rows, and is idempotent on PostgreSQL', {
  skip: databaseTestEnabled ? false : 'requires explicit isolated MQTT_ACL_MIGRATION_TEST_DATABASE_URL and MQTT_ACL_ALLOW_DATABASE_TESTS=true'
}, async () => {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("CREATE TEMP TABLE vmq_auth_acl (mountpoint text NOT NULL, client_id text NOT NULL, username text NOT NULL) ON COMMIT DROP");
    await client.query("INSERT INTO vmq_auth_acl VALUES ('', 'duplicate', 'first'), ('', 'duplicate', 'second')");
    await assert.rejects(client.query(migration), /duplicate \(mountpoint, client_id\) group\(s\)/);
    await client.query('ROLLBACK');

    await client.query('BEGIN');
    await client.query("CREATE TEMP TABLE vmq_auth_acl (mountpoint text NOT NULL, client_id text NOT NULL, username text NOT NULL) ON COMMIT DROP");
    await client.query("INSERT INTO vmq_auth_acl VALUES ('', 'first', 'one'), ('', 'second', 'two')");
    await client.query(migration);
    await client.query(migration);
    const rows = await client.query('SELECT count(*)::int AS count FROM vmq_auth_acl');
    assert.equal(rows.rows[0].count, 2);
    const index = await client.query(
      "SELECT i.indisunique, pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relnamespace = pg_my_temp_schema() AND c.relname = 'vmq_auth_acl_mount_client_unique'"
    );
    assert.equal(index.rowCount, 1);
    assert.equal(index.rows[0].indisunique, true);
    assert.match(index.rows[0].definition, /\(mountpoint, client_id\)/);
    await client.query('SAVEPOINT duplicate_attempt');
    await assert.rejects(client.query("INSERT INTO vmq_auth_acl VALUES ('', 'first', 'another')"), { code: '23505' });
    await client.query('ROLLBACK TO SAVEPOINT duplicate_attempt');
    assert.equal((await client.query('SELECT count(*)::int AS count FROM vmq_auth_acl')).rows[0].count, 2);
    await client.query('ROLLBACK');
  } finally {
    await client.end();
  }
});
