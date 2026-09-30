import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool, QueryResult } from 'pg';
import test from 'node:test';
import { pool } from '../db/pool';
import { inventoryMacSql, normalizeInventoryMac } from '../utils/mac';
import { handleDeviceRecord } from '../services/deviceProcessor';

const url = process.env.INVENTORY_MAC_TEST_DATABASE_URL;
const enabled = process.env.INVENTORY_MAC_ALLOW_DATABASE_TESTS === 'true';
test('PostgreSQL 15 isolated: real normalized lookups and MK4 persistence without MQTT',
  { skip: !url || !enabled ? 'requires explicit disposable local PostgreSQL 15 database' : false }, async () => {
    const parsed = new URL(url!);
    assert(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname), 'Only isolated loopback PostgreSQL permitted');
    assert.match(parsed.pathname, /^\/[a-z0-9_]+_isolated_test$/, 'Use a disposable database ending _isolated_test');
    const schema = `inventory_mac_${randomUUID().replace(/-/g, '')}`;
    const admin = new Pool({ connectionString: url });
    const original = pool.connect;
    let database: Pool | undefined;
    let created = false;
    try {
      assert.match((await admin.query("SELECT current_setting('server_version') AS version")).rows[0].version, /^15\./);
      await admin.query(`CREATE SCHEMA ${schema}`); created = true;
      database = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
      await database.query(`
        CREATE TABLE gateways(id integer PRIMARY KEY,mac_address text,active boolean,company_id uuid);
        CREATE TABLE gateway_places(gateway_id integer,place_id integer,active boolean,assigned_at timestamptz);
        CREATE TABLE devices(id integer PRIMARY KEY,ble_mac text,active boolean,owner_id integer,company_id uuid,
          last_seen_at timestamptz,last_gateway_id integer,last_place_id integer,last_rssi integer,
          last_temperature_c numeric,last_battery_mv integer,updated_at timestamptz);
        CREATE TABLE device_records(id serial PRIMARY KEY,device_id integer,gateway_id integer,place_id integer,
          rssi integer,adv_type text,raw_payload text,battery_voltage_mv integer,temperature_c numeric,humidity numeric,
          movement_count integer,additional_data jsonb,recorded_at timestamptz,updated_at timestamptz);
        INSERT INTO gateways VALUES(1,'ab:cd:ef:ab:cd:ef',true,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        INSERT INTO devices(id,ble_mac,active,company_id) VALUES(1,'ab-cd-ef-00-00-01',true,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      `);
      for (const entity of ['device', 'gateway'] as const) {
        const column = entity === 'device' ? 'ble_mac' : 'mac_address';
        const table = entity === 'device' ? 'devices' : 'gateways';
        const value = entity === 'device' ? 'ABCDEF000001' : 'ABCDEFABCDEF';
        const rows: QueryResult<{ id: number }> = await database.query(`SELECT id FROM ${table} WHERE ${inventoryMacSql(column, entity)}=$1`, [normalizeInventoryMac(value, entity)]);
        assert.equal(rows.rows.length, 1);
      }
      (pool as any).connect = () => database!.connect();
      const record = { gatewayMac: 'AB-CD-EF-AB-CD-EF', bleMac: 'AB:CD:EF:00:00:01', rssi: -60, topic: 'devices/MK4' };
      await handleDeviceRecord(record);
      assert.equal((await database.query('SELECT count(*)::int AS count FROM device_records')).rows[0].count, 1);
      assert.equal((await database.query('SELECT last_gateway_id FROM devices WHERE id=1')).rows[0].last_gateway_id, 1);
      await database.query("INSERT INTO gateways VALUES(2,'ABCDEFABCDEF',true,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')");
      await handleDeviceRecord(record);
      assert.equal((await database.query('SELECT count(*)::int AS count FROM device_records')).rows[0].count, 1);
      assert.equal((await database.query('SELECT count(*)::int AS count FROM gateways')).rows[0].count, 2);
    } finally {
      pool.connect = original;
      await database?.end();
      if (created) await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
