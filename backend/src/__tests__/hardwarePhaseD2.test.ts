import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { after, afterEach, before, test } from 'node:test';
import app from '../app';
import { pool } from '../db/pool';
import { resetServiceRateLimitsForTests } from '../middleware/serviceAuth';
import {
  buildPhysicalB5Command,
  durationMsToGatewaySeconds,
  executePhysicalB5Command
} from '../services/gatewayCommands';
import {
  HARDWARE_COMMAND_SCOPE,
  HARDWARE_READ_SCOPE,
  normalizeHardwareServiceScopes
} from '../services/serviceIdentity';

const COMPANY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);
const SERVICE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TOKEN = 'hst_svc_phase-d2-token';
let server: http.Server;
let baseUrl: string;

before(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

afterEach(() => {
  (pool as any).query = originalQuery;
  (pool as any).connect = originalConnect;
  resetServiceRateLimitsForTests();
});

test('service scopes accept validated read/command sets and command is never the default', () => {
  assert.deepEqual(normalizeHardwareServiceScopes([HARDWARE_READ_SCOPE]), [HARDWARE_READ_SCOPE]);
  assert.deepEqual(normalizeHardwareServiceScopes([HARDWARE_COMMAND_SCOPE, HARDWARE_READ_SCOPE]), [HARDWARE_READ_SCOPE, HARDWARE_COMMAND_SCOPE]);
  assert.equal(normalizeHardwareServiceScopes(['hardware.admin']), null);
  const route = fs.readFileSync(path.resolve(process.cwd(), 'src', 'routes', 'servicePrincipals.ts'), 'utf8');
  assert.match(route, /req\.body\?\.scopes \?\? \[HARDWARE_READ_SCOPE\]/);
});

test('migration expands the constraint without changing existing principals', () => {
  const migration = fs.readFileSync(path.resolve(process.cwd(), 'migrations', '003_hardware_command_scope.sql'), 'utf8');
  assert.match(migration, /hardware\.read/);
  assert.match(migration, /hardware\.command/);
  assert.doesNotMatch(migration, /UPDATE|DELETE|TRUNCATE/i);
});

test('physical B5 payloads use exact MKGW3 commands and convert milliseconds to seconds', () => {
  const common = { gatewayMac: '2805a55efb68', deviceMac: 'fd9d4f8ae226' };
  assert.deepEqual(buildPhysicalB5Command({ ...common, command: 'connect', sessionPassword: 'test-value' }), {
    msg_id: 1150, device_info: { mac: '2805A55EFB68' }, data: { mac: 'FD9D4F8AE226', passwd: 'test-value' }
  });
  assert.deepEqual(buildPhysicalB5Command({ ...common, command: 'led' }), {
    msg_id: 1158, device_info: { mac: '2805A55EFB68' }, data: { mac: 'FD9D4F8AE226', flash_time: 100, flash_interval: 10 }
  });
  assert.deepEqual(buildPhysicalB5Command({ ...common, command: 'buzzer', durationMs: 2500 }), {
    msg_id: 1160, device_info: { mac: '2805A55EFB68' }, data: { mac: 'FD9D4F8AE226', ring_time: 3, ring_interval: 10 }
  });
  assert.deepEqual(buildPhysicalB5Command({ ...common, command: 'vibration', durationMs: 15000 }), {
    msg_id: 1169, device_info: { mac: '2805A55EFB68' }, data: { mac: 'FD9D4F8AE226', shake_time: 15, shake_interval: 10 }
  });
  assert.deepEqual(buildPhysicalB5Command({ ...common, command: 'disconnect' }), {
    msg_id: 1200, device_info: { mac: '2805A55EFB68' }, data: { mac: 'FD9D4F8AE226' }
  });
  assert.equal(durationMsToGatewaySeconds(500), 1);
});

function mockDatabase() {
  const inserts: unknown[][] = [];
  (pool as any).connect = async () => ({
    query: async (sql: string) => sql.includes('pg_try_advisory_lock')
      ? { rows: [{ locked: true }] }
      : { rows: [{ pg_advisory_unlock: true }] },
    release: () => undefined
  });
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT INTO hardware_gateway_commands')) {
      inserts.push(params);
      return { rows: [{ id: `command-${inserts.length}` }] };
    }
    if (sql.includes('UPDATE hardware_gateway_commands')) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected query: ${sql}`);
  };
  return inserts;
}

test('physical execution accepts only result_code 0 and correlates base/+2000/+2001 ACK ids', async () => {
  for (const resultCode of [0, 1, 2, 3, 4]) {
    mockDatabase();
    let expectedIds: number[] = [];
    const result = await executePhysicalB5Command({
      gatewayId: 41, companyId: COMPANY_ID, gatewayMac: '2805a55efb68', deviceMac: 'fd9d4f8ae226',
      command: 'led', actor: { type: 'service', serviceId: 'service', code: 'horneo' }, timeoutMs: 100,
      deps: {
        publish: async (topic) => assert.equal(topic, 'gw/2805a55efb68/subscribe'),
        waitForAck: async ({ gatewayMac, msgIds }) => {
          expectedIds = msgIds;
          return { gatewayMac, msgId: msgIds[2], resultCode, payload: {} };
        }
      }
    });
    assert.deepEqual(expectedIds, [1158, 3158, 3159]);
    assert.equal(result.status, resultCode === 0 ? 'success' : 'error');
  }
});

test('physical execution records timeout and never journals the B5 password', async () => {
  const inserts = mockDatabase();
  const result = await executePhysicalB5Command({
    gatewayId: 41, companyId: COMPANY_ID, gatewayMac: '2805a55efb68', deviceMac: 'fd9d4f8ae226',
    command: 'connect', sessionPassword: 'not-journaled', actor: { type: 'service', serviceId: 'service', code: 'horneo' }, timeoutMs: 100,
    deps: {
      publish: async () => undefined,
      waitForAck: async () => { throw new Error('timeout waiting gateway reply'); }
    }
  });
  assert.equal(result.status, 'timeout');
  assert.doesNotMatch(String(inserts[0]), /not-journaled|passwd/);
});

test('internal command route derives company from service principal and requires hardware.command', () => {
  const route = fs.readFileSync(path.resolve(process.cwd(), 'src', 'routes', 'internalHardware.ts'), 'utf8');
  assert.match(route, /requireServiceScope\(HARDWARE_COMMAND_SCOPE\)/);
  assert.match(route, /WHERE id = \$1 AND company_id = \$2 AND active = TRUE/);
  assert.match(route, /\[gatewayId, principal\.companyId\]/);
  assert.match(route, /\[deviceId, principal\.companyId\]/);
  assert.doesNotMatch(route, /req\.body\?\.companyId/);
});

function mockInternalApi(scopes: string[], gatewayRows: unknown[] = []) {
  const resourceQueries: Array<{ sql: string; params: unknown[] }> = [];
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM service_principal_tokens')) return { rows: [{
      principal_id: SERVICE_ID, code: 'horneo', company_id: COMPANY_ID, scopes, token_id: TOKEN_ID
    }] };
    if (sql.includes('UPDATE service_principal_tokens')) return { rows: [] };
    if (sql.includes('FROM gateways')) {
      resourceQueries.push({ sql, params });
      return { rows: gatewayRows };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  return resourceQueries;
}

const servicePost = () => fetch(`${baseUrl}/api/internal/v1/hardware/gateways/99/b5-command`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ deviceId: 31, command: 'connect', companyId: 'foreign' })
});

test('hardware.read without hardware.command receives 403 on physical commands', async () => {
  mockInternalApi([HARDWARE_READ_SCOPE]);
  assert.equal((await servicePost()).status, 403);
});

test('foreign gateway id is hidden with 404 using the Horneo principal company', async () => {
  const queries = mockInternalApi([HARDWARE_READ_SCOPE, HARDWARE_COMMAND_SCOPE]);
  assert.equal((await servicePost()).status, 404);
  assert.deepEqual(queries[0].params, [99, COMPANY_ID]);
});
