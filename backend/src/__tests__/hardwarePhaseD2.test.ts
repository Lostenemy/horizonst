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
  executePhysicalB5Command,
  physicalB5HttpStatus
} from '../services/gatewayCommands';
import { handleHardwareGatewayAck, resetHardwareGatewayAckWaitersForTests } from '../services/gatewayAck';
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
  resetHardwareGatewayAckWaitersForTests();
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

function mockDatabase(historicalTimeout = false) {
  const inserts: unknown[][] = [];
  const updates: unknown[][] = [];
  (pool as any).connect = async () => ({
    query: async (sql: string) => sql.includes('pg_try_advisory_lock')
      ? { rows: [{ locked: true }] }
      : { rows: [{ pg_advisory_unlock: true }] },
    release: () => undefined
  });
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('AS ambiguous')) {
      if (historicalTimeout) assert.deepEqual(params, [41, 1150]);
      return { rows: [{ ambiguous: historicalTimeout }] };
    }
    if (sql.includes('INSERT INTO hardware_gateway_commands')) {
      inserts.push(params);
      return { rows: [{ id: `command-${inserts.length}` }] };
    }
    if (sql.includes('UPDATE hardware_gateway_commands')) {
      updates.push(params);
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  return { inserts, updates };
}

test('historical timed_out 1150 on gateway 142b2fe271b4 yields an unverified 202, never a confirmed success', async () => {
  const { inserts, updates } = mockDatabase(true);
  const result = await executePhysicalB5Command({
    gatewayId: 41, companyId: COMPANY_ID, gatewayMac: '142b2fe271b4', deviceMac: 'fd9d4f8ae226',
    command: 'connect', sessionPassword: 'simulation-only-secret',
    actor: { type: 'service', serviceId: 'service', code: 'horneo' }, timeoutMs: 100,
    deps: {
      publish: async (topic) => assert.equal(topic, 'gw/142b2fe271b4/subscribe'),
      waitForAck: async ({ gatewayMac, msgIds }) => {
        assert.deepEqual(msgIds, [1150]);
        return { gatewayMac, msgId: 1150, resultCode: 0, payload: { result_code: 0 } };
      }
    }
  });
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.ackAmbiguous, true);
  assert.equal(result.connectionState, 'unverified');
  assert.equal(physicalB5HttpStatus(result), 202);
  assert.ok(updates.some((params) => params[1] === 'ack_ambiguous' && params[3] === 0));
  assert.equal(updates.some((params) => params[1] === 'ack_error'), false);
  assert.doesNotMatch(String(inserts[0]), /simulation-only-secret|passwd/);
  assert.equal(physicalB5HttpStatus({ ...result, resultCode: 4 }), 502);
});

test('simulated 1150 acceptance permits best-effort physical attempt without claiming BLE connection', async () => {
  const { updates } = mockDatabase();
  let releaseReport!: () => Promise<void>;
  const reportSent = new Promise<void>((resolve) => {
    releaseReport = async () => {
      await handleHardwareGatewayAck('gw/142b2fe271b4/publish', JSON.stringify({
        msg_id: 3151, device_info: { mac: '142B2FE271B4' }, result_code: 0, result_msg: 'Connect succeed'
      }));
      resolve();
    };
  });
  let settled = false;
  const attempt = executePhysicalB5Command({
    gatewayId: 41, companyId: COMPANY_ID, gatewayMac: '142b2fe271b4', deviceMac: 'fd9d4f8ae226',
    command: 'connect', sessionPassword: 'simulation-only-secret',
    actor: { type: 'service', serviceId: 'service', code: 'horneo' }, timeoutMs: 200,
    deps: { publish: async () => {
      await handleHardwareGatewayAck('gw/142b2fe271b4/publish', JSON.stringify({
        msg_id: 1150, device_info: { mac: '142B2FE271B4' }, result_code: 0, result_msg: 'success'
      }));
    } }
  }).then((result) => { settled = true; return result; });
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  assert.equal(settled, true, '1150 acceptance preserves the operational physical attempt');
  await releaseReport();
  await reportSent;
  const result = await attempt;
  assert.equal(result.status, 'accepted_unverified');
  assert.equal(result.connectionState, 'unverified');
  assert.equal(result.connectionReportMsgId, undefined);
  assert.ok(updates.some((params) => params[0] === result.commandId));
});

test('1150 acceptance without 3151 remains an unverified physical attempt', async () => {
  const { updates } = mockDatabase();
  const result = await executePhysicalB5Command({
    gatewayId: 41, companyId: COMPANY_ID, gatewayMac: '142b2fe271b4', deviceMac: 'fd9d4f8ae226',
    command: 'connect', sessionPassword: 'simulation-only-secret',
    actor: { type: 'service', serviceId: 'service', code: 'horneo' }, timeoutMs: 30,
    deps: { publish: async () => {
      await handleHardwareGatewayAck('gw/142b2fe271b4/publish', JSON.stringify({
        msg_id: 1150, device_info: { mac: '142B2FE271B4' }, result_code: 0, result_msg: 'success'
      }));
    } }
  });
  assert.equal(result.status, 'accepted_unverified');
  assert.equal(result.connectionState, 'unverified');
  assert.equal(physicalB5HttpStatus(result), 202);
  assert.ok(updates.some((params) => params[0] === result.commandId));
});

test('unattributed negative 3151 or wrong tag MAC cannot reject a new 1150 attempt', async () => {
  const listener = fs.readFileSync(path.resolve(process.cwd(), 'src', 'services', 'gatewayAck.ts'), 'utf8');
  assert.match(listener, /AND NOT \(c\.msg_id = 1150 AND \$2 = 3151\)/);
  for (const report of [
    { gatewayMac: '142b2fe271b4', msgId: 3151, resultCode: 4, resultMessage: 'Connect failed', payload: {} },
    { gatewayMac: '142b2fe271b4', msgId: 3151, resultCode: 0, resultMessage: 'Connect succeed',
      payload: { data: { mac: 'FFFFFFFFFFFF' } } }
  ]) {
    const { updates } = mockDatabase();
    const result = await executePhysicalB5Command({
      gatewayId: 41, companyId: COMPANY_ID, gatewayMac: '142b2fe271b4', deviceMac: 'fd9d4f8ae226',
      command: 'connect', sessionPassword: 'simulation-only-secret',
      actor: { type: 'service', serviceId: 'service', code: 'horneo' }, timeoutMs: 100,
      deps: {
        publish: async () => {
          await handleHardwareGatewayAck('gw/142b2fe271b4/publish', JSON.stringify({
            msg_id: 1150, device_info: { mac: '142B2FE271B4' }, result_code: 0
          }));
          await handleHardwareGatewayAck('gw/142b2fe271b4/publish', JSON.stringify({
            msg_id: report.msgId, device_info: { mac: '142B2FE271B4' }, result_code: report.resultCode,
            result_msg: report.resultMessage, ...report.payload
          }));
        },
        waitForAck: async ({ gatewayMac, msgIds }) => {
          assert.deepEqual(msgIds, [1150]);
          return { gatewayMac, msgId: 1150, resultCode: 0, resultMessage: 'success', payload: {} };
        }
      }
    });
    assert.equal(result.status, 'accepted_unverified');
    assert.equal(result.connectionState, 'unverified');
    assert.equal(physicalB5HttpStatus(result), 202);
    assert.ok(updates.some((params) => params[0] === result.commandId));
  }
});

test('a stale simulated 3151 received before 1150 acceptance cannot establish the new connection', async () => {
  mockDatabase();
  const result = await executePhysicalB5Command({
    gatewayId: 41, companyId: COMPANY_ID, gatewayMac: '142b2fe271b4', deviceMac: 'fd9d4f8ae226',
    command: 'connect', sessionPassword: 'simulation-only-secret',
    actor: { type: 'service', serviceId: 'service', code: 'horneo' }, timeoutMs: 100,
    deps: { publish: async () => {
      await handleHardwareGatewayAck('gw/142b2fe271b4/publish', JSON.stringify({
        msg_id: 3151, device_info: { mac: '142B2FE271B4' }, result_code: 0, result_msg: 'Connect succeed'
      }));
      await handleHardwareGatewayAck('gw/142b2fe271b4/publish', JSON.stringify({
        msg_id: 1150, device_info: { mac: '142B2FE271B4' }, result_code: 0, result_msg: 'success'
      }));
    } }
  });
  assert.equal(result.status, 'accepted_unverified');
  assert.equal(result.connectionState, 'unverified');
});

test('a late 3151 for an earlier attempt arriving after a new 1150 ACK cannot establish the new connection', async () => {
  const { updates } = mockDatabase();
  const base = {
    gatewayId: 41, companyId: COMPANY_ID, gatewayMac: '142b2fe271b4', deviceMac: 'fd9d4f8ae226',
    command: 'connect' as const, sessionPassword: 'simulation-only-secret',
    actor: { type: 'service' as const, serviceId: 'service', code: 'horneo' }, timeoutMs: 30
  };
  const first = await executePhysicalB5Command({ ...base, deps: { publish: async () => {
    await handleHardwareGatewayAck('gw/142b2fe271b4/publish', JSON.stringify({
      msg_id: 1150, device_info: { mac: '142B2FE271B4' }, result_code: 0
    }));
  } } });
  assert.equal(first.connectionState, 'unverified');
  const second = await executePhysicalB5Command({ ...base, deps: { publish: async () => {
    await handleHardwareGatewayAck('gw/142b2fe271b4/publish', JSON.stringify({
      msg_id: 1150, device_info: { mac: '142B2FE271B4' }, result_code: 0
    }));
    await handleHardwareGatewayAck('gw/142b2fe271b4/publish', JSON.stringify({
      msg_id: 3151, device_info: { mac: '142B2FE271B4' }, result_code: 0,
      result_msg: 'Connect succeed', data: { mac: 'FD9D4F8AE226' }
    }));
  } } });
  assert.equal(second.status, 'accepted_unverified');
  assert.equal(second.connectionState, 'unverified');
  assert.notEqual(first.commandId, second.commandId);
  assert.ok(updates.some((params) => params[0] === second.commandId));
});

test('new ACK status migration separates positive ambiguous replies without rewriting historical rows', () => {
  const migration = fs.readFileSync(path.resolve(process.cwd(), 'migrations', '006_gateway_ack_ambiguous.sql'), 'utf8');
  assert.match(migration, /DROP CONSTRAINT hardware_gateway_commands_status_check/);
  assert.match(migration, /ADD CONSTRAINT hardware_gateway_commands_status_check/);
  assert.match(migration, /'ack_success', 'ack_ambiguous', 'ack_error'/);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|TRUNCATE)\s+hardware_gateway_commands\b/i);
});

test('connection uncertainty migration is additive and does not rewrite historical commands', () => {
  const migration = fs.readFileSync(path.resolve(process.cwd(), 'migrations', '008_b5_connection_unverified.sql'), 'utf8');
  assert.match(migration, /DROP CONSTRAINT hardware_gateway_commands_connection_state_check/);
  assert.match(migration, /ADD CONSTRAINT hardware_gateway_commands_connection_state_check/);
  assert.match(migration, /'unverified'/);
  assert.doesNotMatch(migration, /\b(?:UPDATE|DELETE|TRUNCATE)\s+hardware_gateway_commands\b/i);
});

test('physical execution accepts only result_code 0 and correlates base/+2000/+2001 ACK ids', async () => {
  for (const resultCode of [0, 1, 2, 3, 4]) {
    const { updates } = mockDatabase();
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
    assert.ok(updates.some((params) => params[1] === (resultCode === 0 ? 'ack_success' : 'ack_error')));
  }
});

test('historical timeout does not turn a real gateway rejection into ack_ambiguous', async () => {
  const { updates } = mockDatabase(true);
  const result = await executePhysicalB5Command({
    gatewayId: 41, companyId: COMPANY_ID, gatewayMac: '142b2fe271b4', deviceMac: 'fd9d4f8ae226',
    command: 'connect', sessionPassword: 'simulation-only-secret',
    actor: { type: 'service', serviceId: 'service', code: 'horneo' }, timeoutMs: 100,
    deps: {
      publish: async () => undefined,
      waitForAck: async ({ gatewayMac, msgIds }) => msgIds[0] === 3151
        ? { gatewayMac, msgId: 3151, resultCode: 0, resultMessage: 'Connect succeed', payload: {} }
        : { gatewayMac, msgId: 1150, resultCode: 4, resultMessage: 'no object error', payload: {} }
    }
  });
  assert.equal(result.status, 'error');
  assert.equal(result.ackAmbiguous, undefined);
  assert.equal(result.resultMessage, 'no object error');
  assert.equal(physicalB5HttpStatus(result), 502);
  assert.ok(updates.some((params) => params[1] === 'ack_error' && params[3] === 4));
});

test('physical execution records timeout and never journals the B5 password', async () => {
  const { inserts } = mockDatabase();
  const result = await executePhysicalB5Command({
    gatewayId: 41, companyId: COMPANY_ID, gatewayMac: '2805a55efb68', deviceMac: 'fd9d4f8ae226',
    command: 'connect', sessionPassword: 'not-journaled', actor: { type: 'service', serviceId: 'service', code: 'horneo' }, timeoutMs: 100,
    deps: {
      publish: async () => undefined,
      waitForAck: async () => { throw new Error('timeout waiting gateway reply'); }
    }
  });
  assert.equal(result.status, 'timeout');
  assert.equal(result.connectionState, undefined);
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

test('internal B5 configuration refuses unknown firmware before any gateway command', async () => {
  const queries = mockInternalApi([HARDWARE_READ_SCOPE, HARDWARE_COMMAND_SCOPE], [{
    id: 99, mac_address: '142b2fe271b4', company_id: COMPANY_ID, active: true,
    product_model: null, firmware_version: null, firmware_evidence: null
  }]);
  const response = await fetch(`${baseUrl}/api/internal/v1/hardware/gateways/99/configure-emergency-button`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: '{}'
  });
  assert.equal(response.status, 409);
  assert.deepEqual(queries[0].params, [99, COMPANY_ID]);
});
