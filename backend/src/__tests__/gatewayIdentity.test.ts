import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { pool } from '../db/pool';
import { normalizeHardwareGatewayAck } from '../services/gatewayAck';
import {
  buildGatewayIdentityRequest,
  executeGatewayIdentityRead,
  GatewayIdentityBusyError,
  handleGatewayIdentityReport,
  parseGatewayIdentityReport,
  resetGatewayIdentityWaitersForTests
} from '../services/gatewayIdentity';

const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);
const TOPIC = 'gw/2805a55efb68/publish';
const REPORT = {
  msg_id: 2002,
  device_info: { mac: '2805a55efb68' },
  data: {
    ble_mac: '10b41db99239', eth_mac: '2805a55efb6b', device_name: 'MKGW3-9239',
    product_model: 'MKGW3', company_name: 'MOKO TECHNOLOGY LTD.', hardware_version: 'V1.0',
    software_version: 'V4.4.4', firmware_version: 'V2.0.12', function_version: 'V2.4',
    sl_ble_version: 'V1.0.6'
  }
};

afterEach(() => {
  (pool as any).query = originalQuery;
  (pool as any).connect = originalConnect;
  resetGatewayIdentityWaitersForTests();
});

test('parser accepts the verified real 2002 report and request contains no data object', () => {
  assert.deepEqual(buildGatewayIdentityRequest('28:05:A5:5E:FB:68'), {
    msg_id: 2002, device_info: { mac: '2805A55EFB68' }
  });
  const parsed = parseGatewayIdentityReport(TOPIC, REPORT);
  assert.equal(parsed?.gatewayMac, '2805a55efb68');
  assert.deepEqual(parsed?.data, {
    bleMac: '10b41db99239', ethMac: '2805a55efb6b', deviceName: 'MKGW3-9239',
    productModel: 'MKGW3', companyName: 'MOKO TECHNOLOGY LTD.', hardwareVersion: 'V1.0',
    softwareVersion: 'V4.4.4', firmwareVersion: 'V2.0.12', functionVersion: 'V2.4',
    slBleVersion: 'V1.0.6'
  });
  assert.equal(normalizeHardwareGatewayAck(TOPIC, REPORT), null, '2002 has no result_code and is not an ACK');
});

test('parser rejects contradictory MAC, missing/extra fields, wrong types, invalid MACs and excessive values', () => {
  const clone = () => JSON.parse(JSON.stringify(REPORT));
  const invalid: unknown[] = [];
  let value = clone(); value.device_info.mac = 'ffffffffffff'; invalid.push(value);
  value = clone(); delete value.data.function_version; invalid.push(value);
  value = clone(); value.data.extra = true; invalid.push(value);
  value = clone(); value.data.software_version = 44; invalid.push(value);
  value = clone(); value.data.ble_mac = 'invalid'; invalid.push(value);
  value = clone(); value.data.eth_mac = '2805a55efb6'; invalid.push(value);
  value = clone(); value.data.company_name = 'x'.repeat(129); invalid.push(value);
  value = clone(); value.result_code = 0; invalid.push(value);
  for (const candidate of invalid) assert.equal(parseGatewayIdentityReport(TOPIC, candidate), null);
  assert.equal(parseGatewayIdentityReport('gw/2805a55efb68/publish/extra', REPORT), null);
});

function mockIdentityDatabase(options: { busy?: boolean; gatewayExists?: boolean } = {}) {
  const operations: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      operations.push({ sql, params });
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: !options.busy }] };
      if (sql.includes('pg_advisory_unlock') || ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('UPDATE gateways SET')) return { rows: options.gatewayExists === false ? [] : [{ id: 41 }] };
      if (sql.includes('UPDATE hardware_gateway_reads')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected client query: ${sql}`);
    },
    release: () => undefined
  };
  (pool as any).connect = async () => client;
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    operations.push({ sql, params });
    if (sql.includes('INSERT INTO hardware_gateway_reads')) return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] };
    if (sql.includes('UPDATE hardware_gateway_reads')) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected pool query: ${sql}`);
  };
  return operations;
}

test('valid observed identity updates only an active gateway with the topic MAC', async () => {
  const operations = mockIdentityDatabase();
  assert.equal(await handleGatewayIdentityReport(TOPIC, JSON.stringify(REPORT)), true);
  const update = operations.find((item) => item.sql.includes('UPDATE gateways SET'))!;
  assert.equal(update.params[0], '2805a55efb68');
  assert.match(update.sql, /active = TRUE/);
  assert.match(update.sql, /regexp_replace\(lower\(mac_address\)/);
  mockIdentityDatabase({ gatewayExists: false });
  assert.equal(await handleGatewayIdentityReport(TOPIC, JSON.stringify(REPORT)), false);
});

test('identity read journals publication and an observed response without ACK semantics', async () => {
  const operations = mockIdentityDatabase();
  const result = await executeGatewayIdentityRead({
    gatewayId: 41, companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gatewayMac: '2805a55efb68',
    actorUserId: 2, timeoutMs: 100,
    deps: { publish: async (topic, payload) => {
      assert.equal(topic, 'gw/2805a55efb68/subscribe');
      assert.deepEqual(payload, buildGatewayIdentityRequest('2805a55efb68'));
      setImmediate(() => { void handleGatewayIdentityReport(TOPIC, JSON.stringify(REPORT)); });
    } }
  });
  assert.equal(result.status, 'response_observed');
  assert.match(result.message, /does not uniquely correlate/);
  assert.ok(operations.some((item) => item.sql.includes("status = 'published'")));
  assert.ok(operations.some((item) => item.sql.includes("status = 'response_observed'")));
  assert.equal(operations.some((item) => /hardware_gateway_commands|ack_success/.test(item.sql)), false);
});

test('identity read handles timeout, publish failure, busy gateway and pre-publication response', async () => {
  mockIdentityDatabase();
  const common = { gatewayId: 41, companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    gatewayMac: '2805a55efb68', actorUserId: 2, timeoutMs: 20 };
  assert.equal((await executeGatewayIdentityRead({ ...common, deps: { publish: async () => undefined } })).status, 'timed_out');
  mockIdentityDatabase();
  assert.equal((await executeGatewayIdentityRead({ ...common, deps: { publish: async () => { throw new Error('offline'); } } })).status, 'publish_error');
  mockIdentityDatabase({ busy: true });
  await assert.rejects(() => executeGatewayIdentityRead({ ...common, deps: { publish: async () => undefined } }), GatewayIdentityBusyError);
  mockIdentityDatabase();
  const outOfOrder = await executeGatewayIdentityRead({ ...common, deps: { publish: async () => {
    await handleGatewayIdentityReport(TOPIC, JSON.stringify(REPORT));
  } } });
  assert.equal(outOfOrder.status, 'timed_out', 'a response seen before publication cannot resolve the request');
});

test('migration 009 is additive and never rewrites historical rows', () => {
  const migration = fs.readFileSync(path.resolve(process.cwd(), 'migrations', '009_gateway_identity_reads.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE hardware_gateway_reads/);
  assert.match(migration, /response_observed/);
  assert.match(migration, /reported_firmware_version/);
  assert.doesNotMatch(migration, /^\s*(?:UPDATE\s|DELETE\s+FROM\s|TRUNCATE\s)/im);
});
