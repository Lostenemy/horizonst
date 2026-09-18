import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import app from '../app';
import { pool } from '../db/pool';
import { handleHardwareGatewayAck, resetHardwareGatewayAckWaitersForTests } from '../services/gatewayAck';
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
});

after(async () => {
  (pool as any).query = originalQuery;
  (pool as any).connect = originalConnect;
  (mqttService as any).publishMqttJson = originalPublish;
  resetHardwareGatewayAckWaitersForTests();
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

function fakeDatabase() {
  const observations = { published: [] as Array<{ topic: string; payload: any }>, auditQueries: 0, commandInserts: 0 };
  (pool as any).connect = async () => ({
    query: async (sql: string) => sql.includes('pg_try_advisory_lock')
      ? { rows: [{ locked: true }] }
      : { rows: [{ pg_advisory_unlock: true }] },
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
    if (sql.includes('FROM gateways g') && sql.includes('WHERE g.id = $1')) {
      assert.match(sql, /g\.company_id = ANY/);
      const scopedCompanies = params[1];
      const allowed = Array.isArray(scopedCompanies) && scopedCompanies.includes(COMPANY_A) && Number(params[0]) === 41;
      return { rows: allowed ? [{ id: 41, mac_address: '2805a55efb68', company_id: COMPANY_A, rssi_threshold: -70 }] : [] };
    }
    if (sql.includes('AS ambiguous')) return { rows: [{ ambiguous: false }] };
    if (sql.includes('INSERT INTO hardware_gateway_commands')) {
      observations.commandInserts += 1;
      return { rows: [{ id: '11111111-1111-4111-8111-111111111111' }] };
    }
    if (sql.includes('UPDATE hardware_gateway_commands')) return { rows: [], rowCount: 0 };
    if (sql.includes('INSERT INTO technical_audit_log')) return { rows: [] };
    if (sql.includes('FROM technical_audit_log')) {
      observations.auditQueries += 1;
      assert.deepEqual(params, ['41', COMPANY_A]);
      return { rows: [{ id: 1, action: 'gateway.ble.scan', result: 'success' }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  (mqttService as any).publishMqttJson = async (topic: string, payload: any) => {
    observations.published.push({ topic, payload });
    await handleHardwareGatewayAck('gw/2805a55efb68/publish', JSON.stringify({
      msg_id: payload.msg_id, device_info: { mac: '2805A55EFB68' }, result_code: 0
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

test('audit metadata is scoped to the gateway company', async () => {
  const observed = fakeDatabase();
  const own = await api('/api/gateways/41/audit', 1, 'hardware_readonly');
  assert.equal(own.status, 200);
  assert.equal((await own.json())[0].action, 'gateway.ble.scan');
  assert.equal((await api('/api/gateways/41/audit', 3, 'hardware_technician')).status, 404);
  assert.equal(observed.auditQueries, 1);
});
