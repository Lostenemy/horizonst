import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import app from '../app';
import { pool } from '../db/pool';
import { signToken } from '../utils/jwt';
import { normalizeGatewayMac } from '../utils/mac';
import {
  createOpaqueServiceToken,
  hashServiceToken,
  serviceTokenHint
} from '../services/serviceIdentity';
import { resetServiceRateLimitsForTests } from '../middleware/serviceAuth';
import {
  buildB5GatewayCommands,
  configureB5Gateway,
  expireStaleGatewayCommands,
  GatewayCommandBusyError
} from '../services/gatewayCommands';
import {
  handleHardwareGatewayAck,
  normalizeHardwareGatewayAck,
  resetHardwareGatewayAckWaitersForTests,
  waitForHardwareGatewayAck
} from '../services/gatewayAck';
import { buildGatewayReconciliation } from '../services/gatewayReconciliation';

const COMPANY_HORNEO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SERVICE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const validServiceToken = 'hst_svc_test-token-with-sufficient-random-looking-content';
const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);
let server: http.Server;
let baseUrl: string;

before(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  (pool as any).query = originalQuery;
  (pool as any).connect = originalConnect;
  resetServiceRateLimitsForTests();
  resetHardwareGatewayAckWaitersForTests();
});

after(async () => {
  (pool as any).query = originalQuery;
  (pool as any).connect = originalConnect;
  resetHardwareGatewayAckWaitersForTests();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const serviceIdentityRow = (scopes = ['hardware.read']) => ({
  principal_id: SERVICE_ID,
  code: 'horneo',
  company_id: COMPANY_HORNEO,
  scopes,
  token_id: TOKEN_ID
});

const serviceApi = (path: string, token = validServiceToken) => fetch(`${baseUrl}${path}`, {
  headers: { Authorization: `Bearer ${token}` }
});

const localGateway = (patch: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  gateway_mac: '28:05:A5:5E:FB:68',
  description: 'MKGW3 Horneo',
  rssi_threshold: -70,
  cold_room_id: '22222222-2222-4222-8222-222222222222',
  plant_id: '33333333-3333-4333-8333-333333333333',
  hardware_gateway_id: null,
  created_at: '2026-01-01T00:00:00Z',
  ...patch
});

const centralGateway = (patch: Record<string, unknown> = {}) => ({
  id: 10,
  name: 'MKGW3 Horneo',
  mac_address: '2805a55efb68',
  description: null,
  rssi_threshold: -70,
  active: true,
  company_id: COMPANY_HORNEO,
  company_code: 'horneo',
  ...patch
});

test('gateway MAC normalization is canonical, lowercase and strict', () => {
  assert.equal(normalizeGatewayMac('28:05-A5:5E-FB:68'), '2805a55efb68');
  assert.equal(normalizeGatewayMac('FD9D4F8AE226'), 'fd9d4f8ae226');
  assert.equal(normalizeGatewayMac('invalid'), null);
});

test('Phase B migrations create Horneo idempotently and add only the cross-database logical reference', () => {
  const centralMigration = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'migrations', '002_hardware_manager_phase_b.sql'),
    'utf8'
  );
  const localMigration = fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', 'cold-compliance-service', 'migrations', '013_hardware_gateway_reference.sql'),
    'utf8'
  );
  assert.match(centralMigration, /VALUES \('horneo', 'Horneo', TRUE\)/);
  assert.match(centralMigration, /ON CONFLICT \(code\) DO UPDATE/);
  assert.doesNotMatch(centralMigration, /VALUES \('[0-9a-f]{8}-[0-9a-f-]{27,}'/i);
  assert.match(localMigration, /ADD COLUMN IF NOT EXISTS hardware_gateway_id INTEGER/);
  assert.doesNotMatch(localMigration, /REFERENCES\s+gateways/i);
});

test('opaque service tokens are random and only their SHA-256 hash is persistable', () => {
  const first = createOpaqueServiceToken();
  const second = createOpaqueServiceToken();
  assert.notEqual(first, second);
  assert.match(first, /^hst_svc_/);
  assert.match(hashServiceToken(first), /^[a-f0-9]{64}$/);
  assert.notEqual(hashServiceToken(first), first);
  assert.equal(serviceTokenHint(first), first.slice(-8));
});

test('service identity stores and looks up only the token hash', async () => {
  let authParam: unknown;
  (pool as any).query = async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM service_principal_tokens')) {
      authParam = params[0];
      return { rows: [serviceIdentityRow()] };
    }
    if (sql.includes('UPDATE service_principal_tokens')) return { rows: [] };
    if (sql.includes('FROM gateways g') && sql.includes('ORDER BY')) return { rows: [] };
    if (sql.includes('INSERT INTO technical_audit_log')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  const response = await serviceApi('/api/internal/v1/hardware/gateways');
  assert.equal(response.status, 200);
  assert.equal(authParam, hashServiceToken(validServiceToken));
  assert.notEqual(authParam, validServiceToken);
});

test('invalid, revoked or expired service tokens fail closed', async () => {
  (pool as any).query = async (sql: string) => {
    if (sql.includes('FROM service_principal_tokens')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  for (const token of ['hst_svc_invalid', 'hst_svc_revoked', 'hst_svc_expired']) {
    const response = await serviceApi('/api/internal/v1/hardware/gateways', token);
    assert.equal(response.status, 401);
  }
});

test('service token without hardware.read scope is forbidden', async () => {
  (pool as any).query = async (sql: string) => {
    if (sql.includes('FROM service_principal_tokens')) return { rows: [serviceIdentityRow([])] };
    if (sql.includes('UPDATE service_principal_tokens')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  const response = await serviceApi('/api/internal/v1/hardware/gateways');
  assert.equal(response.status, 403);
});

test('Horneo service list is constrained by persisted company_id', async () => {
  let gatewayParams: unknown[] = [];
  (pool as any).query = async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM service_principal_tokens')) return { rows: [serviceIdentityRow()] };
    if (sql.includes('UPDATE service_principal_tokens')) return { rows: [] };
    if (sql.includes('FROM gateways g') && sql.includes('ORDER BY')) {
      gatewayParams = params;
      return { rows: [{ id: 10, company_id: COMPANY_HORNEO }] };
    }
    if (sql.includes('INSERT INTO technical_audit_log')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  const response = await serviceApi('/api/internal/v1/hardware/gateways');
  assert.equal(response.status, 200);
  assert.deepEqual(gatewayParams, [COMPANY_HORNEO]);
  assert.deepEqual(await response.json(), [{ id: 10, company_id: COMPANY_HORNEO }]);
});

test('Horneo service cannot resolve Company B gateway by id or MAC', async () => {
  const resourceQueries: Array<{ sql: string; params: unknown[] }> = [];
  (pool as any).query = async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM service_principal_tokens')) return { rows: [serviceIdentityRow()] };
    if (sql.includes('UPDATE service_principal_tokens')) return { rows: [] };
    if (sql.includes('FROM gateways g')) {
      resourceQueries.push({ sql, params });
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO technical_audit_log')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  assert.equal((await serviceApi('/api/internal/v1/hardware/gateways/99')).status, 404);
  assert.equal((await serviceApi('/api/internal/v1/hardware/gateways/by-mac/aaaaaaaaaaaa')).status, 404);
  assert.deepEqual(resourceQueries[0].params, [99, COMPANY_HORNEO]);
  assert.deepEqual(resourceQueries[1].params, ['aaaaaaaaaaaa', COMPANY_HORNEO]);
  assert.ok(resourceQueries.every(({ sql }) => /g\.company_id = \$2/.test(sql)));
  assert.notEqual(COMPANY_HORNEO, COMPANY_B);
});

test('new central gateway without company is rejected before SQL mutation', async () => {
  (pool as any).query = async () => { throw new Error('DB must not be called'); };
  const userToken = signToken({ userId: 1, role: 'hardware_superadmin' });
  const response = await fetch(`${baseUrl}/api/gateways`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ macAddress: '2805a55efb68' })
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: 'companyId is required' });
});

test('reconciliation classifies new import and remains idempotent once linked', () => {
  const first = buildGatewayReconciliation({
    localRows: [localGateway()],
    centralRows: [],
    company: { id: COMPANY_HORNEO, active: true }
  });
  assert.equal(first.conflicts.length, 0);
  assert.equal(first.plans[0].action, 'create');

  const second = buildGatewayReconciliation({
    localRows: [localGateway({ hardware_gateway_id: 10 })],
    centralRows: [centralGateway()],
    company: { id: COMPANY_HORNEO, active: true }
  });
  assert.equal(second.conflicts.length, 0);
  assert.equal(second.plans[0].action, 'reuse');
  assert.equal(second.plans[0].central?.id, 10);
});

test('reconciliation links unassigned gateways and rejects other-company ownership', () => {
  const unassigned = buildGatewayReconciliation({
    localRows: [localGateway()],
    centralRows: [centralGateway({ company_id: null, company_code: null })],
    company: { id: COMPANY_HORNEO, active: true }
  });
  assert.equal(unassigned.plans[0].action, 'link_unassigned');

  const foreign = buildGatewayReconciliation({
    localRows: [localGateway()],
    centralRows: [centralGateway({ company_id: COMPANY_B, company_code: 'company_b' })],
    company: { id: COMPANY_HORNEO, active: true }
  });
  assert.equal(foreign.plans.length, 0);
  assert.equal(foreign.conflicts[0].type, 'gateway_owned_by_other_company');
});

test('reconciliation reports invalid and duplicate MACs', () => {
  const result = buildGatewayReconciliation({
    localRows: [
      localGateway({ id: '1', gateway_mac: 'invalid' }),
      localGateway({ id: '2' }),
      localGateway({ id: '3', gateway_mac: '28-05-A5-5E-FB-68' })
    ],
    centralRows: [],
    company: { id: COMPANY_HORNEO, active: true }
  });
  assert.ok(result.conflicts.some((item) => item.type === 'invalid_local_mac'));
  assert.ok(result.conflicts.some((item) => item.type === 'duplicate_local_mac'));
  assert.equal(result.plans.length, 0);
});

test('reconciliation rejects orphan mappings and inactive central gateways', () => {
  const orphan = buildGatewayReconciliation({
    localRows: [localGateway({ hardware_gateway_id: 999 })],
    centralRows: [],
    company: { id: COMPANY_HORNEO, active: true }
  });
  assert.equal(orphan.conflicts[0].type, 'hardware_gateway_id_orphan');

  const inactive = buildGatewayReconciliation({
    localRows: [localGateway()],
    centralRows: [centralGateway({ active: false })],
    company: { id: COMPANY_HORNEO, active: true }
  });
  assert.equal(inactive.conflicts[0].type, 'central_gateway_inactive');
});

test('B5 commands preserve exact MKGW3 V2.4 payloads', () => {
  assert.deepEqual(buildB5GatewayCommands('2805a55efb68'), [
    {
      msg_id: 1045,
      device_info: { mac: '2805A55EFB68' },
      data: {
        ibeacon: 0, eddystone_uid: 0, eddystone_url: 0, eddystone_tlm: 0,
        bxp_devinfo: 0, bxp_acc: 0, bxp_th: 0, bxp_button: 1, bxp_tag: 0,
        pir: 0, other: 0, mk_tof: 0, nano_beacon_info: 0
      }
    },
    {
      msg_id: 1053,
      device_info: { mac: '2805A55EFB68' },
      data: { switch_value: 1, single_press: 0, double_press: 1, long_press: 0, abnormal_inactivity: 0 }
    },
    {
      msg_id: 1059,
      device_info: { mac: '2805A55EFB68' },
      data: { timestamp: 1, adv_data: 1, parse_adv_data: 1 }
    },
    {
      msg_id: 1063,
      device_info: { mac: '2805A55EFB68' },
      data: { interval: 0 }
    }
  ]);
});

function mockCommandDatabase(lock = true) {
  let nextId = 0;
  const queries: string[] = [];
  (pool as any).connect = async () => ({
    query: async (sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: lock }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
      throw new Error(`Unexpected lock query: ${sql}`);
    },
    release: () => undefined
  });
  (pool as any).query = async (sql: string) => {
    queries.push(sql);
    if (sql.includes('INSERT INTO hardware_gateway_commands')) return { rows: [{ id: `command-${++nextId}` }] };
    if (sql.includes('UPDATE hardware_gateway_commands')) return { rows: [] };
    throw new Error(`Unexpected command query: ${sql}`);
  };
  return queries;
}

test('B5 is successful only after four ACK result_code=0', async () => {
  mockCommandDatabase();
  const published: number[] = [];
  const result = await configureB5Gateway({
    gatewayId: 10,
    companyId: COMPANY_HORNEO,
    gatewayMac: '2805a55efb68',
    actor: { type: 'user', userId: 1 },
    timeoutMs: 100,
    deps: {
      publish: async (_topic, payload) => { published.push(payload.msg_id as number); },
      waitForAck: async ({ gatewayMac, msgIds }) => ({
        gatewayMac, msgId: msgIds[0], resultCode: 0, resultMessage: 'success', payload: {}
      })
    }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(published, [1045, 1053, 1059, 1063]);
  assert.ok(result.results.every((item) => item.status === 'success'));
});

test('ACK error and timeout prevent B5 success', async () => {
  mockCommandDatabase();
  const errorResult = await configureB5Gateway({
    gatewayId: 10,
    companyId: COMPANY_HORNEO,
    gatewayMac: '2805a55efb68',
    actor: { type: 'user', userId: 1 },
    timeoutMs: 100,
    deps: {
      publish: async () => undefined,
      waitForAck: async ({ gatewayMac, msgIds }) => ({
        gatewayMac,
        msgId: msgIds[0],
        resultCode: msgIds[0] === 1053 ? 4 : 0,
        resultMessage: msgIds[0] === 1053 ? 'no object error' : 'success',
        payload: {}
      })
    }
  });
  assert.equal(errorResult.ok, false);
  assert.equal(errorResult.results.find((item) => item.msgId === 1053)?.status, 'error');

  mockCommandDatabase();
  const timeoutResult = await configureB5Gateway({
    gatewayId: 10,
    companyId: COMPANY_HORNEO,
    gatewayMac: '2805a55efb68',
    actor: { type: 'user', userId: 1 },
    timeoutMs: 100,
    deps: {
      publish: async () => undefined,
      waitForAck: async () => { throw new Error('timeout waiting gateway reply'); }
    }
  });
  assert.equal(timeoutResult.ok, false);
  assert.ok(timeoutResult.results.every((item) => item.status === 'timeout'));
});

test('gateway command concurrency is rejected by advisory lock', async () => {
  mockCommandDatabase(false);
  await assert.rejects(
    configureB5Gateway({
      gatewayId: 10,
      companyId: COMPANY_HORNEO,
      gatewayMac: '2805a55efb68',
      actor: { type: 'user', userId: 1 },
      timeoutMs: 100
    }),
    GatewayCommandBusyError
  );
});

test('stale pending commands are recovered as explicit timeouts', async () => {
  let sqlSeen = '';
  let paramsSeen: unknown[] = [];
  (pool as any).query = async (sql: string, params: unknown[]) => {
    sqlSeen = sql;
    paramsSeen = params;
    return { rows: [], rowCount: 2 };
  };
  assert.equal(await expireStaleGatewayCommands(10), 2);
  assert.match(sqlSeen, /status = 'timed_out'/);
  assert.match(sqlSeen, /timeout_ms \* INTERVAL '1 millisecond'/);
  assert.deepEqual(paramsSeen, [10]);
});

test('ACK correlation uses gateway and expected msg_id', async () => {
  (pool as any).query = async () => ({ rows: [] });
  const waiter = waitForHardwareGatewayAck({ gatewayMac: '2805a55efb68', msgIds: [3045], timeoutMs: 100 });
  await handleHardwareGatewayAck('gw/ffffffffffff/publish', JSON.stringify({ msg_id: 3045, result_code: 0 }));
  await handleHardwareGatewayAck('gw/2805a55efb68/publish', JSON.stringify({ msg_id: 3045, result_code: 0 }));
  const ack = await waiter;
  assert.equal(ack.gatewayMac, '2805a55efb68');
  assert.equal(ack.msgId, 3045);
  assert.equal(ack.resultCode, 0);
  assert.equal(normalizeHardwareGatewayAck('gw/2805a55efb68/publish', { msg_id: 3045, result_code: 4 })?.resultMessage, 'no object error');
});
