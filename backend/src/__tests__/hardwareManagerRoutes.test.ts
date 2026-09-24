import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import app from '../app';
import { pool } from '../db/pool';
import { handleHardwareGatewayAck, resetHardwareGatewayAckWaitersForTests } from '../services/gatewayAck';
import { handleGatewayIdentityReport, resetGatewayIdentityWaitersForTests } from '../services/gatewayIdentity';
import { handleGatewayConfigurationReport, resetGatewayConfigurationWaitersForTests } from '../services/gatewayObservedReads';
import { credentialVersion, signToken } from '../utils/jwt';

const COMPANY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const mqttService = require('../services/mqttService') as typeof import('../services/mqttService');
const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);
const originalPublish = mqttService.publishMqttJson;
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
  (mqttService as any).publishMqttJson = originalPublish;
  resetHardwareGatewayAckWaitersForTests();
  resetGatewayIdentityWaitersForTests();
  resetGatewayConfigurationWaitersForTests();
});

after(async () => {
  (pool as any).query = originalQuery;
  (pool as any).connect = originalConnect;
  (mqttService as any).publishMqttJson = originalPublish;
  resetHardwareGatewayAckWaitersForTests();
  resetGatewayIdentityWaitersForTests();
  resetGatewayConfigurationWaitersForTests();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const userToken = (id: number, role: Parameters<typeof signToken>[0]['role']) =>
  signToken({ userId: id, role, credentialVersion: credentialVersion('fixture-hash') });

const api = (path: string, id?: number, role?: Parameters<typeof signToken>[0]['role'], init: RequestInit = {}) =>
  fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(id && role ? { Authorization: `Bearer ${userToken(id, role)}` } : {}),
      ...(init.headers ?? {})
    }
  });

function fakeDatabase(verifiedFirmware = false, priorTimeout = false) {
  const idempotencyKeys = new Set<string>();
  const observations = { published: [] as Array<{ topic: string; payload: any }>, persisted: [] as string[],
    auditPayloads: [] as string[], auditQueries: 0, readQueries: 0, observedQueries: 0,
    snapshotQueries: 0, commandInserts: 0, readInserts: 0 };
  (pool as any).connect = async () => ({
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('UPDATE gateways SET') && sql.includes('reported_device_name')) return { rows: [{ id: 41 }] };
      if (sql.includes('SELECT id, company_id FROM gateways')) return { rows: [{ id: 41, company_id: COMPANY_A }] };
      if (sql.includes('INSERT INTO hardware_gateway_observed_settings')) return { rows: [], rowCount: 1 };
      if (sql.includes('INSERT INTO hardware_gateway_ble_snapshots')) return { rows: [], rowCount: 1 };
      if (sql.includes('DELETE FROM hardware_gateway_ble_snapshot_items')) return { rows: [], rowCount: 1 };
      if (sql.includes('INSERT INTO hardware_gateway_ble_snapshot_items')) return { rows: [], rowCount: 1 };
      if (sql.includes('UPDATE hardware_gateway_reads')) return { rows: [], rowCount: 1 };
      if (sql.includes('INSERT INTO hardware_gateway_reads')) {
        observations.readInserts += 1;
        return { rows: [{ id: '22222222-2222-4222-8222-222222222222' }] };
      }
      if (sql.includes('UPDATE gateways SET product_model')) {
        if (sql.includes('product_model = NULL')) {
          assert.deepEqual(params, [41, COMPANY_A]);
          return { rows: [{ id: 41 }] };
        }
        assert.deepEqual(params, [41, 'MKGW3', 'V2.4', 'inspection:ticket-12345678', COMPANY_A]);
        return { rows: [{ id: 41, product_model: 'MKGW3', firmware_version: 'V2.4',
          firmware_evidence: 'inspection:ticket-12345678', firmware_recorded_at: new Date().toISOString() }] };
      }
      if (sql.includes('INSERT INTO technical_audit_log')) {
        observations.auditPayloads.push(JSON.stringify(params));
        return { rows: [] };
      }
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
    release: () => undefined
  });
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql === 'SELECT id, role, password_hash FROM users WHERE id = $1') {
      const id = Number(params[0]);
      const role = id === 1 ? 'hardware_readonly' : 'hardware_technician';
      return { rows: [{ id, role, password_hash: 'fixture-hash' }] };
    }
    if (sql.includes('company_user_memberships')) {
      return { rows: [{ company_id: Number(params[0]) === 3 ? COMPANY_B : COMPANY_A }] };
    }
    if (sql.includes('FROM gateways g') && sql.includes('WHERE g.id = $1') && !sql.includes('hardware_gateway_reads')) {
      assert.match(sql, /g\.company_id = ANY/);
      const scopedCompanies = params[1];
      const allowed = Array.isArray(scopedCompanies) && scopedCompanies.includes(COMPANY_A) && Number(params[0]) === 41;
      return { rows: allowed ? [{ id: 41, mac_address: '2805a55efb68', company_id: COMPANY_A, rssi_threshold: -70,
        product_model: verifiedFirmware ? 'MKGW3' : null,
        firmware_version: verifiedFirmware ? 'V2.4' : null,
        firmware_evidence: verifiedFirmware ? 'inspection:ticket-12345678' : null,
        reported_product_model: null, reported_firmware_version: null, identity_observed_at: null }] : [] };
    }
    if (sql.includes('AS ambiguous')) return { rows: [{ ambiguous: priorTimeout }] };
    if (sql.includes('UPDATE gateways SET product_model')) {
      assert.deepEqual(params.slice(0, 4), [41, 'MKGW3', 'V2.4', 'inspection:ticket-12345678']);
      assert.equal(params[4], COMPANY_A);
      return { rows: [{ id: 41, product_model: 'MKGW3', firmware_version: 'V2.4',
        firmware_evidence: 'inspection:ticket-12345678', firmware_recorded_at: new Date().toISOString() }] };
    }
    if (sql.includes('INSERT INTO hardware_gateway_commands')) {
      const key = String(params[10] ?? '');
      if (key && idempotencyKeys.has(key)) throw Object.assign(new Error('duplicate idempotency key'), { code: '23505' });
      if (key) idempotencyKeys.add(key);
      observations.commandInserts += 1;
      observations.persisted.push(String(params[4]));
      return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] };
    }
    if (sql.includes('INSERT INTO hardware_gateway_reads')) {
      observations.readInserts += 1;
      return { rows: [{ id: '22222222-2222-4222-8222-222222222222' }] };
    }
    if (sql.includes('UPDATE hardware_gateway_reads')) return { rows: [], rowCount: 1 };
    if (sql.includes('FROM hardware_gateway_reads r')) {
      observations.readQueries += 1;
      return { rows: [{ id: 'read-1', msg_id: 2002, read_type: 'gateway_identity', status: 'response_observed' }] };
    }
    if (sql.includes('FROM hardware_gateway_observed_settings s')) {
      observations.observedQueries += 1;
      return { rows: [{ read_type: 'led_state', msg_id: 2011,
        observed_value: { net_led: 1, sys_led: 1, server_led: 1 }, observed_at: new Date().toISOString() }] };
    }
    if (sql.includes('FROM hardware_gateway_ble_snapshots s')) {
      observations.snapshotQueries += 1;
      return { rows: [{ msg_id: 2201, device_count: 1, observed_at: new Date().toISOString(),
        devices: [{ mac: 'fd9d4f8ae226', type: 2 }] }] };
    }
    if (sql.includes('UPDATE hardware_gateway_commands')) return { rows: [], rowCount: 0 };
    if (sql.includes('INSERT INTO technical_audit_log')) {
      observations.auditPayloads.push(JSON.stringify(params));
      return { rows: [] };
    }
    if (sql.includes('FROM hardware_gateway_commands c')) {
      const scopedCompanies = params[1];
      const allowed = Array.isArray(scopedCompanies) && scopedCompanies.includes(COMPANY_A);
      return { rows: allowed ? [{ id: 'command-1030', msg_id: 1030, command_type: 'mqtt_connection_1030', status: 'ack_success',
        actor_type: 'user', actor_name: 'Técnico', destination_host: 'mqtt.horizonst.com.es', destination_port: '8883',
        result_code: 0, result_message: 'success', created_at: new Date().toISOString() }] : [] };
    }
    if (sql.includes('FROM technical_audit_log')) {
      observations.auditQueries += 1;
      assert.deepEqual(params, ['41', COMPANY_A]);
      return { rows: [{ id: 1, action: 'gateway.ble.scan', result: 'success' }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  (mqttService as any).publishMqttJson = async (topic: string, payload: any) => {
    observations.published.push({ topic, payload });
    if (payload.msg_id === 2002) {
      setImmediate(() => { void handleGatewayIdentityReport('gw/2805a55efb68/publish', JSON.stringify({
        msg_id: 2002, device_info: { mac: '2805a55efb68' }, data: {
          ble_mac: '10b41db99239', eth_mac: '2805a55efb6b', device_name: 'MKGW3-9239',
          product_model: 'MKGW3', company_name: 'MOKO TECHNOLOGY LTD.', hardware_version: 'V1.0',
          software_version: 'V4.4.4', firmware_version: 'V2.0.12', function_version: 'V2.4', sl_ble_version: 'V1.0.6'
        }
      })); });
      return;
    }
    const configurationReports: Record<number, Record<string, number>> = {
      2011: { net_led: 1, sys_led: 1, server_led: 1 }, 2040: { scan_switch: 1 },
      2041: { relation: 3 }, 2057: { rule: 0 }
    };
    if (configurationReports[payload.msg_id]) {
      await handleGatewayConfigurationReport('gw/2805a55efb68/publish', JSON.stringify({
        msg_id: payload.msg_id, device_info: { mac: '2805a55efb68' }, data: configurationReports[payload.msg_id]
      }));
      return;
    }
    if (payload.msg_id === 2201) {
      await handleGatewayConfigurationReport('gw/2805a55efb68/publish', JSON.stringify({
        msg_id: 2201, device_info: { mac: '2805a55efb68' },
        data: { ble_conn_list: [{ mac: 'fd9d4f8ae226', type: 2 }] }
      }));
      return;
    }
    await handleHardwareGatewayAck('gw/2805a55efb68/publish', JSON.stringify({
      msg_id: payload.msg_id, device_info: { mac: '2805A55EFB68' }, result_code: 0,
      ...(payload.msg_id === 1030 ? { result_msg: 'success' } : {})
    }));
  };
  return observations;
}

const commandPath = '/api/gateways/41/bluetooth/scan';
const validCommand = { method: 'POST', body: JSON.stringify({ scan_switch: 1 }) };

test('Bluetooth command rejects anonymous and readonly users without publication', async () => {
  const observed = fakeDatabase();
  assert.equal((await api(commandPath, undefined, undefined, validCommand)).status, 401);
  assert.equal((await api(commandPath, 1, 'hardware_readonly', validCommand)).status, 403);
  assert.equal(observed.published.length, 0);
  assert.equal(observed.commandInserts, 0);
});

test('technician from another company gets 404 and cannot publish to the gateway', async () => {
  const observed = fakeDatabase();
  assert.equal((await api(commandPath, 3, 'hardware_technician', validCommand)).status, 404);
  assert.equal(observed.published.length, 0);
  assert.equal(observed.commandInserts, 0);
});

test('authorized technician validates payload and publishes only an exact simulated gateway command', async () => {
  const observed = fakeDatabase();
  assert.equal((await api(commandPath, 2, 'hardware_technician', {
    method: 'POST', body: JSON.stringify({ scan_switch: 1, unexpected: 1 })
  })).status, 400);
  assert.equal(observed.published.length, 0);

  const response = await api(commandPath, 2, 'hardware_technician', validCommand);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'success');
  assert.equal(observed.commandInserts, 1);
  assert.deepEqual(observed.published, [{
    topic: 'gw/2805a55efb68/subscribe',
    payload: { msg_id: 1040, device_info: { mac: '2805A55EFB68' }, data: { scan_switch: 1 } }
  }]);
});

const mqttConfigurationData = () => ({
  security_type: 1,
  host: 'mqtt.horizonst.com.es',
  port: 8883,
  client_id: '2805a55efb68',
  username: '2805a55efb68',
  passwd: 'test-only-secret-not-real',
  sub_topic: 'gw/2805a55efb68/subscribe',
  pub_topic: 'gw/2805a55efb68/publish',
  qos: 0,
  clean_session: 1,
  keepalive: 60,
  lwt_en: 1,
  lwt_qos: 1,
  lwt_retain: 0,
  lwt_topic: 'gw/2805a55efb68/publish',
  lwt_payload: JSON.stringify({ msg_id: 3999, device_info: { mac: '2805a55efb68' }, data: {} })
});

const mqttRequest = (overrides: Record<string, unknown> = {}) => ({
  method: 'POST',
  body: JSON.stringify({ confirmationMac: '2805a55efb68', data: { ...mqttConfigurationData(), ...overrides } })
});

test('MQTT 1030 is technician-only and company-scoped, with its envelope and topic controlled by Backend', async () => {
  const path = '/api/gateways/41/configure-mqtt';
  for (const [id, role, expected] of [
    [undefined, undefined, 401], [1, 'hardware_readonly', 403], [3, 'hardware_technician', 404]
  ] as const) {
    const observed = fakeDatabase();
    assert.equal((await api(path, id, role as any, mqttRequest())).status, expected);
    assert.equal(observed.published.length, 0);
  }
  const injected = fakeDatabase();
  assert.equal((await api(path, 2, 'hardware_technician', {
    method: 'POST', body: JSON.stringify({ confirmationMac: '2805a55efb68', data: mqttConfigurationData(), msg_id: 9999 })
  })).status, 400);
  assert.equal(injected.published.length, 0);

  const observed = fakeDatabase();
  const response = await api(path, 2, 'hardware_technician', mqttRequest());
  assert.equal(response.status, 200);
  const json = await response.json();
  assert.equal(json.status, 'success');
  assert.match(json.message, /todavía no está verificada/);
  assert.equal(JSON.stringify(json).includes('test-only-secret-not-real'), false);
  assert.deepEqual(observed.published, [{
    topic: 'gw/2805a55efb68/subscribe',
    payload: { msg_id: 1030, device_info: { mac: '2805a55efb68' }, data: mqttConfigurationData() }
  }]);
  assert.equal(observed.persisted.length, 1);
  assert.equal(observed.persisted[0].includes('test-only-secret-not-real'), false);
  assert.match(observed.persisted[0], /\[REDACTED\]/);
  assert.equal(observed.auditPayloads.some((payload) => payload.includes('test-only-secret-not-real')), false);
});

test('MQTT 1030 enforces exact confirmation, strict payload and HTTP idempotency without republishing', async () => {
  const path = '/api/gateways/41/configure-mqtt';
  const observed = fakeDatabase();
  assert.equal((await api(path, 2, 'hardware_technician', {
    method: 'POST', body: JSON.stringify({ confirmationMac: '2805A55EFB68', data: mqttConfigurationData() })
  })).status, 400);
  assert.equal((await api(path, 2, 'hardware_technician', mqttRequest({ port: '8883' }))).status, 400);
  assert.equal(observed.published.length, 0);
  const headers = { 'X-Request-Id': 'mqtt-1030-idempotency-test' };
  assert.equal((await api(path, 2, 'hardware_technician', { ...mqttRequest(), headers })).status, 200);
  assert.equal((await api(path, 2, 'hardware_technician', { ...mqttRequest(), headers })).status, 409);
  assert.equal(observed.published.length, 1);
});

test('MQTT 1030 timeout is uncertain and never triggers an automatic retry', async () => {
  const previousTimeout = process.env.GATEWAY_COMMAND_TIMEOUT_MS;
  process.env.GATEWAY_COMMAND_TIMEOUT_MS = '20';
  try {
    const observed = fakeDatabase();
    (mqttService as any).publishMqttJson = async (topic: string, payload: unknown) => {
      observed.published.push({ topic, payload });
    };
    const response = await api('/api/gateways/41/configure-mqtt', 2, 'hardware_technician', mqttRequest());
    assert.equal(response.status, 504);
    assert.equal((await response.json()).status, 'timeout');
    assert.equal(observed.published.length, 1);
  } finally {
    if (previousTimeout === undefined) delete process.env.GATEWAY_COMMAND_TIMEOUT_MS;
    else process.env.GATEWAY_COMMAND_TIMEOUT_MS = previousTimeout;
  }
});

test('MQTT 1030 distinguishes a real rejection from an ambiguous positive ACK after a historical timeout', async () => {
  const rejected = fakeDatabase();
  (mqttService as any).publishMqttJson = async (topic: string, payload: any) => {
    rejected.published.push({ topic, payload });
    await handleHardwareGatewayAck('gw/2805a55efb68/publish', JSON.stringify({
      msg_id: 1030, device_info: { mac: '2805a55efb68' }, result_code: 4, result_msg: 'no object error'
    }));
  };
  const rejectedResponse = await api('/api/gateways/41/configure-mqtt', 2, 'hardware_technician', mqttRequest());
  assert.equal(rejectedResponse.status, 502);
  assert.equal((await rejectedResponse.json()).resultCode, 4);

  const ambiguous = fakeDatabase(false, true);
  const ambiguousResponse = await api('/api/gateways/41/configure-mqtt', 2, 'hardware_technician', mqttRequest());
  assert.equal(ambiguousResponse.status, 202);
  const body = await ambiguousResponse.json();
  assert.equal(body.status, 'ambiguous');
  assert.match(body.message, /no puede atribuirse inequívocamente/);
  assert.equal(ambiguous.published.length, 1);
});

test('MQTT 1030 publication errors cannot expose the password in HTTP, journal, audit or captured logs', async () => {
  const observed = fakeDatabase();
  const capturedLogs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { capturedLogs.push(args.map(String).join(' ')); };
  (mqttService as any).publishMqttJson = async () => {
    throw new Error('simulated failure containing test-only-secret-not-real');
  };
  try {
    const response = await api('/api/gateways/41/configure-mqtt', 2, 'hardware_technician', mqttRequest());
    assert.equal(response.status, 502);
    const serializedResponse = JSON.stringify(await response.json());
    assert.equal(serializedResponse.includes('test-only-secret-not-real'), false);
    assert.equal(observed.persisted.some((value) => value.includes('test-only-secret-not-real')), false);
    assert.equal(observed.auditPayloads.some((value) => value.includes('test-only-secret-not-real')), false);
    assert.equal(capturedLogs.some((value) => value.includes('test-only-secret-not-real')), false);
  } finally {
    console.error = originalError;
  }
});

test('redacted MQTT 1030 history is readable only inside the caller company scope', async () => {
  const own = fakeDatabase();
  const response = await api('/api/gateways/41/commands', 1, 'hardware_readonly');
  assert.equal(response.status, 200);
  const serialized = JSON.stringify(await response.json());
  assert.match(serialized, /mqtt\.horizonst\.com\.es/);
  assert.equal(serialized.includes('passwd'), false);
  assert.equal(serialized.includes('test-only-secret-not-real'), false);
  const foreign = fakeDatabase();
  const foreignResponse = await api('/api/gateways/41/commands', 3, 'hardware_technician');
  assert.equal(foreignResponse.status, 200);
  assert.deepEqual(await foreignResponse.json(), []);
  void own;
  void foreign;
});

test('V2-only Bluetooth writes are blocked for unknown firmware and permitted after verified inventory', async () => {
  const unknown = fakeDatabase();
  for (const [operation, payload] of [
    ['report-interval', { interval: 0 }], ['scan-mode', { scan_mode: 1 }],
    ['filter-relation', { relation: 8 }], ['phy', { phy_filter: 4 }]
  ] as const) {
    const response = await api(`/api/gateways/41/bluetooth/${operation}`, 2, 'hardware_technician', {
      method: 'POST', body: JSON.stringify(payload)
    });
    assert.equal(response.status, 409);
  }
  assert.equal(unknown.published.length, 0);
  const verified = fakeDatabase(true);
  const response = await api('/api/gateways/41/bluetooth/report-interval', 2, 'hardware_technician', {
    method: 'POST', body: JSON.stringify({ interval: 0 })
  });
  assert.equal(response.status, 200);
  assert.equal(verified.published[0].payload.msg_id, 1063);
});

test('firmware registration is technician-only, company-scoped and audit-backed without MQTT publication', async () => {
  const observed = fakeDatabase();
  const path = '/api/gateways/41/firmware';
  const body = JSON.stringify({ productModel: 'MKGW3', firmwareVersion: 'V2.4', evidence: 'inspection:ticket-12345678' });
  assert.equal((await api(path, 1, 'hardware_readonly', { method: 'PUT', body })).status, 403);
  assert.equal((await api(path, 3, 'hardware_technician', { method: 'PUT', body })).status, 404);
  assert.equal((await api(path, 2, 'hardware_technician', {
    method: 'PUT', body: JSON.stringify({ productModel: 'MKGW3', firmwareVersion: 'V2.4', evidence: 'secret password' })
  })).status, 400);
  const response = await api(path, 2, 'hardware_technician', { method: 'PUT', body });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).firmware_version, 'V2.4');
  assert.equal((await api(path, 2, 'hardware_technician', { method: 'DELETE' })).status, 200);
  assert.equal(observed.published.length, 0);
});

test('identity read is technician-only, company-scoped and publishes exact 2002 without data', async () => {
  const path = '/api/gateways/41/read-identity';
  const request = { method: 'POST', body: '{}' };
  const anonymous = fakeDatabase();
  assert.equal((await api(path, undefined, undefined, request)).status, 401);
  assert.equal(anonymous.published.length, 0);
  const readonly = fakeDatabase();
  assert.equal((await api(path, 1, 'hardware_readonly', request)).status, 403);
  assert.equal(readonly.published.length, 0);
  const foreign = fakeDatabase();
  assert.equal((await api(path, 3, 'hardware_technician', request)).status, 404);
  assert.equal(foreign.published.length, 0);
  const technician = fakeDatabase();
  const response = await api(path, 2, 'hardware_technician', request);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'response_observed');
  assert.equal(technician.readInserts, 1);
  assert.deepEqual(technician.published, [{
    topic: 'gw/2805a55efb68/subscribe',
    payload: { msg_id: 2002, device_info: { mac: '2805A55EFB68' } }
  }]);
});

test('identity read HTTP distinguishes operational timeout, busy gateway and publication error', async () => {
  const path = '/api/gateways/41/read-identity';
  const request = { method: 'POST', body: '{}' };
  const previousTimeout = process.env.GATEWAY_COMMAND_TIMEOUT_MS;
  process.env.GATEWAY_COMMAND_TIMEOUT_MS = '20';
  try {
    fakeDatabase();
    let resolveConnection!: (client: unknown) => void;
    const lateReleases: unknown[] = [];
    (pool as any).connect = () => new Promise((resolve) => { resolveConnection = resolve; });
    const timeoutResponse = await api(path, 2, 'hardware_technician', request);
    assert.equal(timeoutResponse.status, 504);
    assert.deepEqual(await timeoutResponse.json(), {
      status: 'timed_out', message: 'Gateway identity operation exceeded its timeout'
    });
    resolveConnection({
      query: async () => { throw new Error('late connection must not be queried'); },
      release: (destroy?: boolean) => { lateReleases.push(destroy); }
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(lateReleases, [true]);

    fakeDatabase();
    let busyReleases = 0;
    (pool as any).connect = async () => ({
      query: async (sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: false }] };
        throw new Error(`Unexpected busy query: ${sql}`);
      },
      release: () => { busyReleases += 1; }
    });
    const busyResponse = await api(path, 2, 'hardware_technician', request);
    assert.equal(busyResponse.status, 409);
    assert.equal(busyReleases, 1);

    fakeDatabase();
    (mqttService as any).publishMqttJson = async () => { throw new Error('simulated offline broker'); };
    const publishResponse = await api(path, 2, 'hardware_technician', request);
    assert.equal(publishResponse.status, 502);
    assert.equal((await publishResponse.json()).status, 'publish_error');
  } finally {
    if (previousTimeout === undefined) delete process.env.GATEWAY_COMMAND_TIMEOUT_MS;
    else process.env.GATEWAY_COMMAND_TIMEOUT_MS = previousTimeout;
  }
});

test('identity history is readable only inside the caller hardware scope', async () => {
  const own = fakeDatabase();
  const response = await api('/api/gateways/41/reads', 1, 'hardware_readonly');
  assert.equal(response.status, 200);
  assert.equal((await response.json())[0].status, 'response_observed');
  assert.equal(own.readQueries, 1);
  const foreign = fakeDatabase();
  assert.equal((await api('/api/gateways/41/reads', 3, 'hardware_technician')).status, 404);
  assert.equal(foreign.readQueries, 0);
});

test('configuration reads are technician-only, company-scoped and publish the four exact requests', async () => {
  const definitions = [
    ['led_state', 2011], ['ble_scan_switch', 2040], ['filter_relation', 2041], ['duplicate_rule', 2057]
  ] as const;
  for (const [readType, msgId] of definitions) {
    const path = `/api/gateways/41/read-configuration/${readType}`;
    const anonymous = fakeDatabase();
    assert.equal((await api(path, undefined, undefined, { method: 'POST', body: '{}' })).status, 401);
    assert.equal(anonymous.published.length, 0);
    const readonly = fakeDatabase();
    assert.equal((await api(path, 1, 'hardware_readonly', { method: 'POST', body: '{}' })).status, 403);
    assert.equal(readonly.published.length, 0);
    const foreign = fakeDatabase();
    assert.equal((await api(path, 3, 'hardware_technician', { method: 'POST', body: '{}' })).status, 404);
    assert.equal(foreign.published.length, 0);
    const own = fakeDatabase();
    const response = await api(path, 2, 'hardware_technician', { method: 'POST', body: '{}' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'response_observed');
    assert.deepEqual(own.published, [{
      topic: 'gw/2805a55efb68/subscribe', payload: { msg_id: msgId, device_info: { mac: '2805A55EFB68' } }
    }]);
  }
  const unsupported = fakeDatabase();
  assert.equal((await api('/api/gateways/41/read-configuration/other', 2, 'hardware_technician', {
    method: 'POST', body: '{}'
  })).status, 400);
  assert.equal(unsupported.published.length, 0);
});

test('latest observed settings are readable only within the gateway company', async () => {
  const own = fakeDatabase();
  const response = await api('/api/gateways/41/observed-settings', 1, 'hardware_readonly');
  assert.equal(response.status, 200);
  assert.equal((await response.json())[0].msg_id, 2011);
  assert.equal(own.observedQueries, 1);
  const foreign = fakeDatabase();
  assert.equal((await api('/api/gateways/41/observed-settings', 3, 'hardware_technician')).status, 404);
  assert.equal(foreign.observedQueries, 0);
});

test('BLE connected snapshot read is technician-only and latest snapshot is company-scoped', async () => {
  const path = '/api/gateways/41/read-ble-connected-devices';
  for (const [id, role, expected] of [
    [undefined, undefined, 401], [1, 'hardware_readonly', 403], [3, 'hardware_technician', 404]
  ] as const) {
    const observed = fakeDatabase();
    assert.equal((await api(path, id, role as any, { method: 'POST', body: '{}' })).status, expected);
    assert.equal(observed.published.length, 0);
  }
  const own = fakeDatabase();
  const response = await api(path, 2, 'hardware_technician', { method: 'POST', body: '{}' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'response_observed');
  assert.deepEqual(own.published, [{ topic: 'gw/2805a55efb68/subscribe',
    payload: { msg_id: 2201, device_info: { mac: '2805A55EFB68' } } }]);

  const visible = fakeDatabase();
  const latest = await api('/api/gateways/41/ble-connected-devices', 1, 'hardware_readonly');
  assert.equal(latest.status, 200);
  assert.deepEqual((await latest.json()).devices, [{ mac: 'fd9d4f8ae226', type: 2 }]);
  assert.equal(visible.snapshotQueries, 1);
  const foreign = fakeDatabase();
  assert.equal((await api('/api/gateways/41/ble-connected-devices', 3, 'hardware_technician')).status, 404);
  assert.equal(foreign.snapshotQueries, 0);
});

test('audit metadata is scoped to the gateway company', async () => {
  const observed = fakeDatabase();
  const own = await api('/api/gateways/41/audit', 1, 'hardware_readonly');
  assert.equal(own.status, 200);
  assert.equal((await own.json())[0].action, 'gateway.ble.scan');
  assert.equal((await api('/api/gateways/41/audit', 3, 'hardware_technician')).status, 404);
  assert.equal(observed.auditQueries, 1);
});
