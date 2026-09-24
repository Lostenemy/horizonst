import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, test } from 'node:test';
import app from '../app';
import { pool } from '../db/pool';
import {
  assignGatewayCompany, GatewayAssignmentConflictError, GatewayAssignmentNotFoundError
} from '../services/gatewayCompanyAssignment';
import { credentialVersion, signToken } from '../utils/jwt';

const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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
});
after(async () => {
  (pool as any).query = originalQuery;
  (pool as any).connect = originalConnect;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function fixture(options: { busy?: boolean; assigned?: boolean; references?: boolean; failAudit?: boolean;
  inactiveCompany?: boolean } = {}) {
  const observed = { sql: [] as string[], audit: [] as unknown[][], released: 0, brokerChanges: 0 };
  const client = {
    query: async (sql: string, params: unknown[] = []): Promise<any> => {
      observed.sql.push(sql);
      if (sql === 'SELECT pg_try_advisory_lock($1, $2) AS locked') return { rows: [{ locked: !options.busy }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('FROM gateways WHERE id = $1 FOR UPDATE')) return { rows: [{ id: 41,
        mac_address: '2805a55efb68', company_id: options.assigned ? COMPANY : null, active: true }] };
      if (sql.includes('FROM companies WHERE id = $1')) return { rows: options.inactiveCompany ? [] : [{ id: COMPANY, code: 'acme', name: 'Acme' }] };
      if (sql.includes('AS incompatible')) return { rows: [{ incompatible: !!options.references }] };
      if (sql.includes('UPDATE gateways SET company_id')) return { rows: [{ id: 41, mac_address: '2805a55efb68', company_id: COMPANY }] };
      if (sql.includes('INSERT INTO technical_audit_log')) {
        if (options.failAudit) throw new Error('audit unavailable');
        observed.audit.push(params);
        return { rows: [] };
      }
      if (sql.includes('vmq_auth_acl')) observed.brokerChanges += 1;
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release: () => { observed.released += 1; }
  };
  return { observed, database: { connect: async () => client } };
}

test('assignment is transactional, audited, and leaves broker credentials intact', async () => {
  const { database, observed } = fixture();
  const result = await assignGatewayCompany({ gatewayId: 41, companyId: COMPANY, actorUserId: 5 }, { database: database as any });
  assert.equal(result.gateway.company_id, COMPANY);
  assert.deepEqual(observed.sql.filter((sql) => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)), ['BEGIN', 'COMMIT']);
  assert.equal(observed.audit.length, 1);
  assert.equal(observed.brokerChanges, 0);
  assert.equal(observed.released, 1);
});

test('assignment refuses busy, already assigned, inactive company and legacy references', async () => {
  for (const options of [{ busy: true }, { assigned: true }, { references: true }, { inactiveCompany: true }]) {
    const { database, observed } = fixture(options);
    await assert.rejects(assignGatewayCompany({ gatewayId: 41, companyId: COMPANY, actorUserId: 5 },
      { database: database as any }), options.inactiveCompany ? GatewayAssignmentNotFoundError : GatewayAssignmentConflictError);
    assert.equal(observed.sql.includes('COMMIT'), false);
    assert.equal(observed.released, 1);
  }
});

test('assignment rolls back when audit fails', async () => {
  const { database, observed } = fixture({ failAudit: true });
  await assert.rejects(assignGatewayCompany({ gatewayId: 41, companyId: COMPANY, actorUserId: 5 },
    { database: database as any }), /audit unavailable/);
  assert.equal(observed.sql.includes('ROLLBACK'), true);
  assert.equal(observed.sql.includes('COMMIT'), false);
});

test('assignment HTTP route requires a global role and a valid target company', async () => {
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql === 'SELECT id, role, password_hash FROM users WHERE id = $1') {
      return { rows: [{ id: params[0], role: Number(params[0]) === 5 ? 'hardware_superadmin' : 'hardware_technician',
        password_hash: 'fixture-hash' }] };
    }
    return { rows: [] };
  };
  const send = (id: number, role: 'hardware_superadmin' | 'hardware_technician', body: unknown) => fetch(
    `${baseUrl}/api/gateways/41/assign-company`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken({
        userId: id, role, credentialVersion: credentialVersion('fixture-hash')
      })}` }, body: JSON.stringify(body)
    }
  );
  assert.equal((await send(2, 'hardware_technician', { companyId: COMPANY })).status, 403);
  assert.equal((await send(5, 'hardware_superadmin', { companyId: 'invalid' })).status, 400);
  assert.equal((await send(5, 'hardware_superadmin', { companyId: COMPANY, unexpected: true })).status, 400);
});

test('company API lists states and limits create, edit and logical removal to global roles', async () => {
  const observed: string[] = [];
  const company = { id: COMPANY, code: 'acme', name: 'Acme', active: true };
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql === 'SELECT id, role, password_hash FROM users WHERE id = $1') {
      return { rows: [{ id: params[0], role: Number(params[0]) === 5 ? 'hardware_superadmin' : 'hardware_readonly',
        password_hash: 'fixture-hash' }] };
    }
    if (sql.includes('FROM companies ORDER BY name')) return { rows: [company, { ...company, active: false, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }] };
    if (sql.includes('FROM company_user_memberships')) return { rows: [] };
    if (sql.includes('FROM companies c')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  (pool as any).connect = async () => ({
    query: async (sql: string) => {
      observed.push(sql);
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
      if (sql.includes('INSERT INTO companies')) return { rows: [company] };
      if (sql.includes('SELECT * FROM companies') || sql.includes('SELECT id, code, name, active FROM companies')) return { rows: [company] };
      if (sql.includes('UPDATE companies')) return { rows: [sql.includes('active = FALSE') ? { ...company, active: false } : company] };
      if (sql.includes('INSERT INTO technical_audit_log')) return { rows: [] };
      throw new Error(`Unexpected transaction query: ${sql}`);
    }, release: () => undefined
  });
  const send = (id: number, method: string, path: string, body?: unknown) => fetch(`${baseUrl}/api/companies${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signToken({
      userId: id, role: id === 5 ? 'hardware_superadmin' : 'hardware_readonly',
      credentialVersion: credentialVersion('fixture-hash')
    })}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const listing = await send(5, 'GET', '');
  assert.equal(listing.status, 200);
  assert.deepEqual((await listing.json()).map((item: { active: boolean }) => item.active), [true, false]);
  assert.equal((await send(2, 'POST', '', { code: 'acme', name: 'Acme' })).status, 403);
  assert.equal((await send(5, 'POST', '', { code: 'BAD CODE', name: 'Acme' })).status, 400);
  assert.equal((await send(5, 'POST', '', { code: 'acme', name: 'Acme' })).status, 201);
  assert.equal((await send(5, 'PATCH', `/${COMPANY}`, { name: 'Acme 2' })).status, 200);
  assert.equal((await send(5, 'DELETE', `/${COMPANY}`)).status, 200);
  assert.equal((await send(5, 'PATCH', `/${COMPANY}`, { active: true })).status, 200);
  assert.equal(observed.filter((sql) => sql === 'COMMIT').length, 4);
});

test('unassigned gateway is invisible to company roles and becomes visible only after assignment', async () => {
  let assigned = false;
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql === 'SELECT id, role, password_hash FROM users WHERE id = $1') {
      return { rows: [{ id: params[0], role: Number(params[0]) === 5 ? 'hardware_superadmin' : 'hardware_technician',
        password_hash: 'fixture-hash' }] };
    }
    if (sql.includes('FROM company_user_memberships')) return { rows: [{ company_id: COMPANY }] };
    if (sql.includes('FROM gateways g')) {
      const global = sql.includes('WHERE TRUE') || sql.includes('AND TRUE');
      return { rows: global || assigned ? [{ id: 41, mac_address: '2805a55efb68',
        company_id: assigned ? COMPANY : null, broker_prepared: true }] : [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  const get = (id: number, role: 'hardware_superadmin' | 'hardware_technician', path: string) => fetch(
    `${baseUrl}/api/gateways${path}`, { headers: { Authorization: `Bearer ${signToken({
      userId: id, role, credentialVersion: credentialVersion('fixture-hash')
    })}` } }
  );
  assert.equal((await (await get(5, 'hardware_superadmin', '')).json()).length, 1);
  assert.equal((await (await get(2, 'hardware_technician', '')).json()).length, 0);
  assert.equal((await get(2, 'hardware_technician', '/41')).status, 404);
  assigned = true;
  assert.equal((await (await get(2, 'hardware_technician', '')).json()).length, 1);
  assert.equal((await get(2, 'hardware_technician', '/41')).status, 200);
});
