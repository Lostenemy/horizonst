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

function mockIdentityDatabase(options: {
  busy?: boolean;
  gatewayExists?: boolean;
  gatewayUpdateGate?: Promise<void>;
  gatewayUpdateError?: Error;
} = {}) {
  const operations: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      operations.push({ sql, params });
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: !options.busy }] };
      if (sql.includes('pg_advisory_unlock') || ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('UPDATE gateways SET')) {
        if (options.gatewayUpdateGate) await options.gatewayUpdateGate;
        if (options.gatewayUpdateError) throw options.gatewayUpdateError;
        return { rows: options.gatewayExists === false ? [] : [{ id: 41 }] };
      }
      if (sql.includes('UPDATE hardware_gateway_reads')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected client query: ${sql}`);
    },
    release: (destroy?: boolean) => {
      operations.push({ sql: 'CLIENT_RELEASE', params: [destroy ?? false] });
    }
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

test('identity read observes a response delivered before publish resolves', async () => {
  mockIdentityDatabase();
  const result = await executeGatewayIdentityRead({
    gatewayId: 41, companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gatewayMac: '2805a55efb68',
    actorUserId: 2, timeoutMs: 20,
    deps: { publish: async () => {
      await handleGatewayIdentityReport(TOPIC, JSON.stringify(REPORT));
    } }
  });
  assert.equal(result.status, 'response_observed');
});

test('identity read times out within its absolute budget when response persistence stalls', async () => {
  let releasePersistence!: () => void;
  const persistenceGate = new Promise<void>((resolve) => { releasePersistence = resolve; });
  const operations = mockIdentityDatabase({ gatewayUpdateGate: persistenceGate });
  const operation = executeGatewayIdentityRead({
    gatewayId: 41, companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gatewayMac: '2805a55efb68',
    actorUserId: 2, timeoutMs: 20,
    deps: { publish: async () => {
      await handleGatewayIdentityReport(TOPIC, JSON.stringify(REPORT));
    } }
  });
  try {
    const result = await Promise.race([
      operation,
      new Promise<{ status: 'still_pending' }>((resolve) => setTimeout(() => resolve({ status: 'still_pending' }), 80))
    ]);
    assert.equal(result.status, 'timed_out');
  } finally {
    releasePersistence();
    await operation.catch(() => undefined);
  }
  assert.equal(operations.some((operation) => operation.sql.includes("status = 'response_observed'")), false);
  assert.ok(operations.some((operation) => operation.sql === 'CLIENT_RELEASE' && operation.params[0] === true),
    'the advisory-lock connection must be destroyed when the absolute budget is exhausted');
});

test('failed response persistence cannot resolve the read and expires cleanly', async () => {
  mockIdentityDatabase({ gatewayUpdateError: new Error('simulated persistence failure') });
  const result = await executeGatewayIdentityRead({
    gatewayId: 41, companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gatewayMac: '2805a55efb68',
    actorUserId: 2, timeoutMs: 20,
    deps: { publish: async () => {
      await handleGatewayIdentityReport(TOPIC, JSON.stringify(REPORT));
    } }
  });
  assert.equal(result.status, 'timed_out');
});

test('identity read handles timeout, publish failure and a busy gateway without stale waiters', async () => {
  const timedOutOperations = mockIdentityDatabase();
  const common = { gatewayId: 41, companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    gatewayMac: '2805a55efb68', actorUserId: 2, timeoutMs: 20 };
  assert.equal((await executeGatewayIdentityRead({ ...common, deps: { publish: async () => undefined } })).status, 'timed_out');
  await handleGatewayIdentityReport(TOPIC, JSON.stringify(REPORT));
  assert.equal(timedOutOperations.some((operation) => operation.sql.includes("status = 'response_observed'")), false,
    'a late report may refresh inventory but cannot overwrite the timed-out read');
  mockIdentityDatabase();
  assert.equal((await executeGatewayIdentityRead({ ...common, deps: { publish: async () => { throw new Error('offline'); } } })).status, 'publish_error');
  mockIdentityDatabase({ busy: true });
  await assert.rejects(() => executeGatewayIdentityRead({ ...common, deps: { publish: async () => undefined } }), GatewayIdentityBusyError);
});

test('an observed response remains final when publish later reports an error', async () => {
  mockIdentityDatabase();
  const result = await executeGatewayIdentityRead({
    gatewayId: 41, companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gatewayMac: '2805a55efb68',
    actorUserId: 2, timeoutMs: 50,
    deps: { publish: async () => {
    await handleGatewayIdentityReport(TOPIC, JSON.stringify(REPORT));
    throw new Error('publish callback failed after delivery');
  } } });
  assert.equal(result.status, 'response_observed');
});

test('two consecutive identity reads on the same gateway complete independently', async () => {
  mockIdentityDatabase();
  const common = { gatewayId: 41, companyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    gatewayMac: '2805a55efb68', actorUserId: 2, timeoutMs: 50 };
  const publish = async () => { await handleGatewayIdentityReport(TOPIC, JSON.stringify(REPORT)); };
  assert.equal((await executeGatewayIdentityRead({ ...common, deps: { publish } })).status, 'response_observed');
  assert.equal((await executeGatewayIdentityRead({ ...common, deps: { publish } })).status, 'response_observed');
});

test('migration 009 is additive and never rewrites historical rows', () => {
  const migration = fs.readFileSync(path.resolve(process.cwd(), 'migrations', '009_gateway_identity_reads.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE hardware_gateway_reads/);
  assert.match(migration, /response_observed/);
  assert.match(migration, /reported_firmware_version/);
  assert.doesNotMatch(migration, /^\s*(?:UPDATE\s|DELETE\s+FROM\s|TRUNCATE\s)/im);
});
