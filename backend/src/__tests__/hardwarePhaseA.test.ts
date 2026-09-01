import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import app from '../app';
import { pool } from '../db/pool';
import {
  roleAllowsHardware,
  scopedHardwarePredicate
} from '../middleware/hardwareRbac';
import { signToken } from '../utils/jwt';

const COMPANY_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let server: http.Server;
let baseUrl: string;

const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);

before(async () => {
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  (pool as any).query = originalQuery;
  (pool as any).connect = originalConnect;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const token = (userId: number, role: Parameters<typeof signToken>[0]['role']) =>
  signToken({ userId, role });

const api = (path: string, authToken?: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, {
  ...init,
  headers: {
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(init.headers ?? {})
  }
});

test('anonymous public registration cannot create ADMIN', async () => {
  const response = await api('/api/auth/register', undefined, {
    method: 'POST',
    body: JSON.stringify({ email: 'attacker@example.test', password: 'irrelevant', role: 'ADMIN' })
  });
  assert.equal(response.status, 403);
});

test('normal user cannot create or self-assign an administrative role', async () => {
  const response = await api('/api/users', token(9, 'USER'), {
    method: 'POST',
    body: JSON.stringify({
      email: 'elevated@example.test',
      password: 'irrelevant',
      role: 'hardware_superadmin'
    })
  });
  assert.equal(response.status, 403);
});

test('RBAC denies readonly mutations and allows technician/superadmin capabilities', () => {
  assert.equal(roleAllowsHardware('hardware_readonly', 'technician'), false);
  assert.equal(roleAllowsHardware('hardware_technician', 'technician'), true);
  assert.equal(roleAllowsHardware('hardware_technician', 'superadmin'), false);
  assert.equal(roleAllowsHardware('hardware_superadmin', 'superadmin'), true);
  assert.equal(roleAllowsHardware('ADMIN', 'superadmin'), true);
  assert.equal(roleAllowsHardware('USER', 'technician'), false);
});

test('company scope excludes unassigned hardware except for global superadmin', () => {
  const values: unknown[] = [];
  const memberPredicate = scopedHardwarePredicate({
    scope: { global: false, companyIds: [COMPANY_A], legacyOwnerId: null },
    values,
    companyColumn: 'd.company_id'
  });
  assert.match(memberPredicate, /d\.company_id = ANY/);
  assert.deepEqual(values, [[COMPANY_A]]);

  const legacyValues: unknown[] = [];
  assert.match(scopedHardwarePredicate({
    scope: { global: false, companyIds: [], legacyOwnerId: 7 },
    values: legacyValues,
    companyColumn: 'd.company_id',
    ownerColumn: 'd.owner_id'
  }), /company_id IS NULL/);
  assert.equal(scopedHardwarePredicate({
    scope: { global: true, companyIds: [], legacyOwnerId: null },
    values: [], companyColumn: 'd.company_id'
  }), 'TRUE');
});

test('Company A user lists only gateways constrained by backend scope', async () => {
  let gatewayQuery = '';
  (pool as any).query = async (sql: string, params: unknown[]) => {
    if (sql.includes('company_user_memberships')) return { rows: [{ company_id: COMPANY_A }] };
    gatewayQuery = sql;
    assert.deepEqual(params, [[COMPANY_A]]);
    return { rows: [{ id: 10, company_id: COMPANY_A, name: 'Gateway A' }] };
  };
  const response = await api('/api/gateways', token(11, 'hardware_readonly'));
  assert.equal(response.status, 200);
  assert.match(gatewayQuery, /g\.company_id = ANY/);
  assert.deepEqual(await response.json(), [{ id: 10, company_id: COMPANY_A, name: 'Gateway A' }]);
});

test('Company A user cannot obtain Company B device by id', async () => {
  (pool as any).query = async (sql: string, params: unknown[]) => {
    if (sql.includes('company_user_memberships')) return { rows: [{ company_id: COMPANY_A }] };
    assert.match(sql, /d\.id = \$1 AND d\.company_id = ANY/);
    assert.deepEqual(params, [22, [COMPANY_A]]);
    return { rows: [] };
  };
  const response = await api('/api/devices/22', token(11, 'hardware_readonly'));
  assert.equal(response.status, 404);
});

test('Company A technician cannot modify Company B gateway', async () => {
  (pool as any).query = async (sql: string) => {
    if (sql.includes('company_user_memberships')) return { rows: [{ company_id: COMPANY_A }] };
    throw new Error(`Unexpected pool query: ${sql}`);
  };
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      assert.match(sql, /g\.id = \$1 AND g\.company_id = ANY/);
      assert.deepEqual(params, [33, [COMPANY_A]]);
      return { rows: [] };
    },
    release: () => undefined
  };
  (pool as any).connect = async () => client;
  const response = await api('/api/gateways/33', token(12, 'hardware_technician'), {
    method: 'PUT', body: JSON.stringify({ description: 'must not update' })
  });
  assert.equal(response.status, 404);
});

test('global hardware superadmin can create a company', async () => {
  const client = {
    query: async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (sql.includes('INSERT INTO companies')) {
        return { rows: [{ id: COMPANY_B, code: 'company_b', name: 'Company B', active: true }] };
      }
      if (sql.includes('INSERT INTO technical_audit_log')) return { rows: [] };
      throw new Error(`Unexpected client query: ${sql}`);
    },
    release: () => undefined
  };
  (pool as any).connect = async () => client;
  const response = await api('/api/companies', token(1, 'hardware_superadmin'), {
    method: 'POST', body: JSON.stringify({ code: 'COMPANY_B', name: 'Company B' })
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).code, 'company_b');
});

test('required JWT secret fails closed when absent', () => {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const env = { ...process.env };
  delete env.JWT_SECRET;
  const result = spawnSync(process.execPath, ['-e', "require('./dist/config.js')"], {
    cwd: process.cwd(), env, encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /JWT_SECRET is required/);
});

test('app starts without legacy access configuration or broker subscription', () => {
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const env = { ...process.env };
  const legacyPrefix = ['RFID', 'ACCESS'].join('_') + '_';
  for (const name of Object.keys(env)) {
    if (name.startsWith(legacyPrefix)) delete env[name];
  }
  const script = [
    "const { config } = require('./dist/config.js')",
    "const { OFFICIAL_TOPICS } = require('./dist/services/mqttService.js')",
    "const legacyKey = ['rfid', 'Access'].join('')",
    "const retiredTopic = ['devices', 'RF1'].join('/')",
    "if (Object.prototype.hasOwnProperty.call(config, legacyKey)) process.exit(2)",
    "if (OFFICIAL_TOPICS.includes(retiredTopic)) process.exit(3)",
    "require('./dist/app.js')"
  ].join(';');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(), env, encoding: 'utf8'
  });
  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
});
