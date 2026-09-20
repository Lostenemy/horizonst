import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { Client } from 'pg';

const enabled = process.env.GATEWAY_OBSERVED_MIGRATION_ALLOW_DATABASE_TESTS === 'true';

const connectionConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
};

const runMigrationExecutor = (migrationsDir: string): void => {
  const script = [
    "const { runMigrations } = require('./dist/db/migrations.js');",
    "const { pool } = require('./dist/db/pool.js');",
    "runMigrations().then(() => pool.end()).catch(async (error) => {",
    "  console.error(error instanceof Error ? error.message : String(error));",
    "  await pool.end().catch(() => undefined);",
    "  process.exitCode = 1;",
    "});"
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, APP_MIGRATIONS_DIR: migrationsDir },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `migration runner failed:\n${result.stdout}\n${result.stderr}`);
};

const assertRejectedValue = async (
  client: Client,
  readType: string,
  msgId: number,
  value: unknown
): Promise<void> => {
  await assert.rejects(
    client.query(
      `INSERT INTO hardware_gateway_observed_settings
         (gateway_id, company_id, read_type, msg_id, observed_value)
       VALUES (1, '11111111-1111-4111-8111-111111111111', $1, $2, $3::jsonb)`,
      [readType, msgId, JSON.stringify(value)]
    ),
    { code: '23514' }
  );
};

test('migrations 010 and 011 apply on PostgreSQL 15, preserve 009 and are runner-idempotent', {
  skip: enabled ? false : 'requires an explicit isolated PostgreSQL 15 database'
}, async () => {
  const client = new Client(connectionConfig);
  const migrationsDir = await mkdtemp(path.join(os.tmpdir(), 'horizonst-migration-010-'));
  await copyFile(
    path.resolve(process.cwd(), 'migrations', '010_gateway_observed_configuration_reads.sql'),
    path.join(migrationsDir, '010_gateway_observed_configuration_reads.sql')
  );
  await copyFile(
    path.resolve(process.cwd(), 'migrations', '011_gateway_ble_connected_devices.sql'),
    path.join(migrationsDir, '011_gateway_ble_connected_devices.sql')
  );
  await client.connect();
  try {
    const version = await client.query<{ server_version: string }>('SHOW server_version');
    assert.match(version.rows[0].server_version, /^15\./);

    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await client.query(`
      CREATE TABLE companies (id UUID PRIMARY KEY);
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE gateways (
        id INTEGER PRIMARY KEY,
        company_id UUID NOT NULL REFERENCES companies(id),
        active BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE TABLE device_categories (id INTEGER PRIMARY KEY);
      CREATE TABLE places (id INTEGER PRIMARY KEY);
      CREATE TABLE mqtt_messages (id BIGSERIAL PRIMARY KEY);
      INSERT INTO companies(id) VALUES
        ('11111111-1111-4111-8111-111111111111'),
        ('22222222-2222-4222-8222-222222222222');
      INSERT INTO users(id) VALUES (1);
      INSERT INTO gateways(id, company_id) VALUES
        (1, '11111111-1111-4111-8111-111111111111'),
        (2, '11111111-1111-4111-8111-111111111111');
    `);
    await client.query(
      await import('node:fs/promises').then((fs) => fs.readFile(
        path.resolve(process.cwd(), 'migrations', '009_gateway_identity_reads.sql'),
        'utf8'
      ))
    );
    await client.query(`
      INSERT INTO hardware_gateway_reads
        (id, gateway_id, company_id, msg_id, read_type, request_payload, status,
         actor_user_id, timeout_ms, request_id)
      VALUES
        ('22222222-2222-4222-8222-222222222222', 1,
         '11111111-1111-4111-8111-111111111111', 2002, 'gateway_identity',
         '{"msg_id":2002}'::jsonb, 'timed_out', 1, 1000, 'migration-010-sentinel')
    `);

    const preservedConstraints = [
      'hardware_gateway_reads_pkey',
      'hardware_gateway_reads_gateway_id_fkey',
      'hardware_gateway_reads_company_id_fkey',
      'hardware_gateway_reads_actor_user_id_fkey',
      'hardware_gateway_reads_timeout_ms_check'
    ];

    runMigrationExecutor(migrationsDir);

    const migrationRows = await client.query(
      `SELECT name FROM app_schema_migrations
       WHERE name = '010_gateway_observed_configuration_reads.sql'`
    );
    assert.equal(migrationRows.rowCount, 1);
    assert.equal((await client.query(
      `SELECT count(*)::int AS count FROM app_schema_migrations
       WHERE name IN ('010_gateway_observed_configuration_reads.sql', '011_gateway_ble_connected_devices.sql')`
    )).rows[0].count, 2);
    assert.deepEqual(
      (await client.query(
        `SELECT id::text, gateway_id, company_id::text, msg_id, read_type,
                request_payload, status, actor_user_id, timeout_ms, request_id
         FROM hardware_gateway_reads`
      )).rows,
      [{
        id: '22222222-2222-4222-8222-222222222222',
        gateway_id: 1,
        company_id: '11111111-1111-4111-8111-111111111111',
        msg_id: 2002,
        read_type: 'gateway_identity',
        request_payload: { msg_id: 2002 },
        status: 'timed_out',
        actor_user_id: 1,
        timeout_ms: 1000,
        request_id: 'migration-010-sentinel'
      }]
    );
    const constraintRows = await client.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'hardware_gateway_reads'::regclass`
    );
    const constraintNames = new Set(constraintRows.rows.map((row) => row.conname));
    for (const name of preservedConstraints) assert.equal(constraintNames.has(name), true, name);
    assert.equal(constraintNames.has('hardware_gateway_reads_msg_type_check'), true);
    assert.equal(constraintNames.has('hardware_gateway_reads_status_check'), true);
    const preservedIndexes = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'hardware_gateway_reads'`
    );
    const indexNames = new Set(preservedIndexes.rows.map((row) => row.indexname));
    for (const name of [
      'idx_hardware_gateway_reads_gateway_created',
      'idx_hardware_gateway_reads_company_created',
      'uq_hardware_gateway_reads_active_gateway'
    ]) assert.equal(indexNames.has(name), true, name);

    const validValues: Array<[string, number, unknown]> = [
      ['led_state', 2011, { net_led: 0, sys_led: 1, server_led: 0 }],
      ['ble_scan_switch', 2040, { scan_switch: 1 }],
      ['filter_relation', 2041, { relation: 8 }],
      ['duplicate_rule', 2057, { rule: 3 }]
    ];
    for (const [readType, msgId, value] of validValues) {
      await client.query(
        `INSERT INTO hardware_gateway_observed_settings
           (gateway_id, company_id, read_type, msg_id, observed_value)
         VALUES (1, '11111111-1111-4111-8111-111111111111', $1, $2, $3::jsonb)`,
        [readType, msgId, JSON.stringify(value)]
      );
    }
    assert.equal(
      (await client.query('SELECT count(*)::int AS count FROM hardware_gateway_observed_settings')).rows[0].count,
      4
    );

    await client.query('TRUNCATE hardware_gateway_observed_settings');
    const invalidValues: Array<[string, number, unknown]> = [
      ['led_state', 2011, { net_led: 0, sys_led: 1, server_led: 0, extra: 1 }],
      ['led_state', 2011, { net_led: 0, sys_led: 1 }],
      ['led_state', 2011, { net_led: '0', sys_led: 1, server_led: 0 }],
      ['led_state', 2011, { net_led: 0.5, sys_led: 1, server_led: 0 }],
      ['led_state', 2011, { net_led: false, sys_led: 1, server_led: 0 }],
      ['led_state', 2011, { net_led: 2, sys_led: 1, server_led: 0 }],
      ['ble_scan_switch', 2040, { scan_switch: 1, extra: 0 }],
      ['ble_scan_switch', 2040, {}],
      ['ble_scan_switch', 2040, { scan_switch: '1' }],
      ['ble_scan_switch', 2040, { scan_switch: 0.5 }],
      ['ble_scan_switch', 2040, { scan_switch: true }],
      ['ble_scan_switch', 2040, { scan_switch: 2 }],
      ['filter_relation', 2041, { relation: 8, extra: 0 }],
      ['filter_relation', 2041, {}],
      ['filter_relation', 2041, { relation: '8' }],
      ['filter_relation', 2041, { relation: 1.5 }],
      ['filter_relation', 2041, { relation: false }],
      ['filter_relation', 2041, { relation: 9 }],
      ['duplicate_rule', 2057, { rule: 3, extra: 0 }],
      ['duplicate_rule', 2057, {}],
      ['duplicate_rule', 2057, { rule: '3' }],
      ['duplicate_rule', 2057, { rule: 0.5 }],
      ['duplicate_rule', 2057, { rule: true }],
      ['duplicate_rule', 2057, { rule: 4 }]
    ];
    for (const [readType, msgId, value] of invalidValues) {
      await assertRejectedValue(client, readType, msgId, value);
    }

    await client.query(
      `INSERT INTO hardware_gateway_reads
         (gateway_id, company_id, msg_id, read_type, request_payload, status, actor_user_id, timeout_ms)
       VALUES (1, '11111111-1111-4111-8111-111111111111', 2201, 'ble_connected_devices',
               '{"msg_id":2201}'::jsonb, 'response_observed', 1, 1000)`
    );
    await client.query(
      `INSERT INTO hardware_gateway_ble_snapshots(gateway_id, company_id, device_count)
       VALUES (1, '11111111-1111-4111-8111-111111111111', 0)`
    );
    assert.deepEqual((await client.query(
      `SELECT device_count, (SELECT count(*)::int FROM hardware_gateway_ble_snapshot_items i
                             WHERE i.gateway_id = s.gateway_id) AS item_count
       FROM hardware_gateway_ble_snapshots s WHERE gateway_id = 1`
    )).rows, [{ device_count: 0, item_count: 0 }]);
    await client.query(
      `UPDATE hardware_gateway_ble_snapshots SET device_count = 2 WHERE gateway_id = 1;
       INSERT INTO hardware_gateway_ble_snapshot_items
         (gateway_id, company_id, position, device_mac, firmware_type)
       VALUES
         (1, '11111111-1111-4111-8111-111111111111', 0, 'fd9d4f8ae226', 2),
         (1, '11111111-1111-4111-8111-111111111111', 1, 'f074bff07dc9', -7)`
    );
    assert.deepEqual((await client.query(
      `SELECT position, device_mac::text, firmware_type
       FROM hardware_gateway_ble_snapshot_items WHERE gateway_id = 1 ORDER BY position`
    )).rows, [
      { position: 0, device_mac: 'fd9d4f8ae226', firmware_type: 2 },
      { position: 1, device_mac: 'f074bff07dc9', firmware_type: -7 }
    ]);
    await assert.rejects(client.query(
      `INSERT INTO hardware_gateway_ble_snapshots(gateway_id, company_id, device_count)
       VALUES (2, '22222222-2222-4222-8222-222222222222', 0)`
    ), { code: '23503' });
    await assert.rejects(client.query(
      `INSERT INTO hardware_gateway_ble_snapshot_items
         (gateway_id, company_id, position, device_mac, firmware_type)
       VALUES (1, '22222222-2222-4222-8222-222222222222', 2, 'aaaaaaaaaaaa', 1)`
    ), { code: '23503' });
    await assert.rejects(client.query(
      `INSERT INTO hardware_gateway_ble_snapshot_items
         (gateway_id, company_id, position, device_mac, firmware_type)
       VALUES (1, '11111111-1111-4111-8111-111111111111', 2, 'INVALID-MAC!', 1)`
    ), { code: '23514' });
    await assert.rejects(client.query(
      `INSERT INTO hardware_gateway_ble_snapshot_items
         (gateway_id, company_id, position, device_mac, firmware_type)
       VALUES (1, '11111111-1111-4111-8111-111111111111', 2, 'fd9d4f8ae226', 3)`
    ), { code: '23505' });
    await assert.rejects(client.query(
      `INSERT INTO hardware_gateway_ble_snapshot_items
         (gateway_id, company_id, position, device_mac, firmware_type)
       VALUES (1, '11111111-1111-4111-8111-111111111111', -1, 'bbbbbbbbbbbb', 1)`
    ), { code: '23514' });
    await assert.rejects(client.query(
      `INSERT INTO hardware_gateway_ble_snapshot_items
         (gateway_id, company_id, position, device_mac, firmware_type)
       VALUES (1, '11111111-1111-4111-8111-111111111111', 2, 'bbbbbbbbbbbb', 2147483648)`
    ), { code: '22003' });

    runMigrationExecutor(migrationsDir);
    assert.equal(
      (await client.query(
        `SELECT count(*)::int AS count FROM app_schema_migrations
         WHERE name = '010_gateway_observed_configuration_reads.sql'`
      )).rows[0].count,
      1
    );
    assert.equal(
      (await client.query('SELECT count(*)::int AS count FROM hardware_gateway_reads')).rows[0].count,
      2
    );
    assert.equal((await client.query(
      `SELECT count(*)::int AS count FROM app_schema_migrations
       WHERE name = '011_gateway_ble_connected_devices.sql'`
    )).rows[0].count, 1);
  } finally {
    await client.end();
    await rm(migrationsDir, { recursive: true, force: true });
  }
});
