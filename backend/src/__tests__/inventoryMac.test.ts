import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import app from '../app';
import { pool } from '../db/pool';
import { credentialVersion, signToken } from '../utils/jwt';
import { normalizeInventoryMac, inventoryMacSql } from '../utils/mac';
import { handleDeviceRecord } from '../services/deviceProcessor';
import { Role } from '../types';

const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const originalQuery = pool.query;
const originalConnect = pool.connect;
let server: http.Server, base: string;
before(async () => {
  server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
});
after(async () => {
  pool.query = originalQuery; pool.connect = originalConnect;
  await new Promise<void>(resolve => server.close(() => resolve()));
});

test('inventory MAC contract preserves accepted formats and rejects garbage/mixed separators', () => {
  for (const value of ['ABCDEFABCDEF', 'abcdefabcdef', 'AB:CD:EF:AB:CD:EF', 'ab-cd-ef-ab-cd-ef']) {
    assert.equal(normalizeInventoryMac(value, 'gateway'), 'abcdefabcdef');
    assert.equal(normalizeInventoryMac(value, 'device'), 'ABCDEFABCDEF');
  }
  for (const value of [null, 3, '', 'ABCDEFABCDE', 'ABCDEFABCDEFG', 'AB:CD-EF:AB:CD:EF', 'xxABCDEFABCDEF']) {
    assert.equal(normalizeInventoryMac(value, 'device'), null);
    assert.equal(normalizeInventoryMac(value, 'gateway'), null);
  }
  assert.throws(() => inventoryMacSql('d.ble_mac; DROP TABLE devices', 'device'));
});

for (const role of ['ADMIN', 'hardware_superadmin', 'hardware_technician', 'hardware_readonly', 'USER'] as Role[]) {
  test(`real API inventory scope and MAC lookup remain isolated for ${role}`, async () => {
    (pool as any).query = async (sql: string, values: any[] = []) => {
      if (sql === 'SELECT id, role, password_hash FROM users WHERE id = $1') return { rows: [{ id: 1, role, password_hash: 'fixture-hash' }] };
      if (sql.includes('company_user_memberships')) return { rows: [{ company_id: COMPANY }] };
      if (sql.includes('FROM devices d') || sql.includes('FROM gateways g')) {
        if (sql.includes('ANY')) assert.deepEqual(values.at(-1), [COMPANY]);
        if (role === 'USER') assert.match(sql, /company_id IS NULL AND .*owner_id =/);
        if (['hardware_technician', 'hardware_readonly'].includes(role)) assert.match(sql, /company_id = ANY/);
        if (sql.includes('regexp_replace(btrim')) {
          assert.match(sql, /btrim\(/);
          const wanted = sql.includes('FROM devices d') ? 'ABCDEFABCDEF' : 'abcdefabcdef';
          if (values[0] !== wanted) return { rows: [] };
        }
        return { rows: [{ id: 1 }] };
      }
      throw new Error('Unexpected fixture query');
    };
    const auth = { Authorization: `Bearer ${signToken({ userId: 1, role, credentialVersion: credentialVersion('fixture-hash') })}` };
    for (const entity of ['devices', 'gateways']) {
      assert.equal((await fetch(`${base}/api/${entity}`, { headers: auth })).status, 200);
      for (const mac of ['ABCDEFABCDEF', 'ab:cd:ef:ab:cd:ef', 'ab-cd-ef-ab-cd-ef']) {
        assert.equal((await fetch(`${base}/api/${entity}/by-mac/${mac}`, { headers: auth })).status, 200);
      }
      assert.equal((await fetch(`${base}/api/${entity}/by-mac/111111111111`, { headers: auth })).status, 404);
      assert.equal((await fetch(`${base}/api/${entity}/by-mac/bad-mac`, { headers: auth })).status, 400);
      if (!['ADMIN', 'hardware_superadmin'].includes(role)) {
        assert.equal((await fetch(`${base}/api/${entity}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
        assert.equal((await fetch(`${base}/api/${entity}/1`, { method: 'DELETE', headers: auth })).status, 403);
      }
      if (role === 'hardware_readonly') assert.equal((await fetch(`${base}/api/${entity}/1`, { method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    }
  });
}

test('public MAC APIs reject ambiguous visible matches with 409, not a chosen record', async () => {
  (pool as any).query = async (sql: string) => sql.includes('FROM users')
    ? { rows: [{ id: 1, role: 'ADMIN', password_hash: 'fixture-hash' }] } : { rows: [{ id: 1 }, { id: 2 }] };
  const auth = { Authorization: `Bearer ${signToken({ userId: 1, role: 'ADMIN', credentialVersion: credentialVersion('fixture-hash') })}` };
  for (const entity of ['devices', 'gateways']) assert.equal((await fetch(`${base}/api/${entity}/by-mac/ABCDEFABCDEF`, { headers: auth })).status, 409);
});

test('company-scoped and legacy users cannot resolve a foreign-company MAC or see unassigned inventory', async () => {
  for (const role of ['hardware_technician', 'hardware_readonly', 'USER'] as Role[]) {
    (pool as any).query = async (sql: string, values: any[] = []) => {
      if (sql.includes('FROM users')) return { rows: [{ id: 1, role, password_hash: 'fixture-hash' }] };
      if (sql.includes('company_user_memberships')) return { rows: [{ company_id: COMPANY }] };
      if (sql.includes('FROM devices d') || sql.includes('FROM gateways g')) {
        const companyColumn = sql.includes('FROM devices d') ? 'd.company_id' : 'g.company_id';
        const ownerColumn = sql.includes('FROM devices d') ? 'd.owner_id' : 'g.owner_id';
        const entries = [
          { id: 1, company_id: COMPANY, owner_id: 1 },
          { id: 2, company_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', owner_id: 1 },
          { id: 3, company_id: null, owner_id: 2 }
        ];
        if (role === 'USER') assert(sql.includes(`${companyColumn} IS NULL AND ${ownerColumn} =`));
        else { assert(sql.includes(`${companyColumn} = ANY`)); assert.deepEqual(values.at(-1), [COMPANY]); }
        const scoped = entries.filter(row => role === 'USER' ? row.company_id === null && row.owner_id === 1 : row.company_id === COMPANY);
        return { rows: sql.includes('WHERE') && values[0] === '111111111111' ? scoped.filter(row => row.id === 2) : scoped };
      }
      throw new Error('Unexpected scope fixture query');
    };
    const headers = { Authorization: `Bearer ${signToken({ userId: 1, role, credentialVersion: credentialVersion('fixture-hash') })}` };
    for (const entity of ['devices', 'gateways']) {
      const inventory = await (await fetch(`${base}/api/${entity}`, { headers })).json() as Array<{ id: number }>;
      assert.deepEqual(inventory.map(row => row.id), role === 'USER' ? [] : [1]);
      assert.equal((await fetch(`${base}/api/${entity}/by-mac/111111111111`, { headers })).status, 404);
    }
  }
});

for (const ambiguous of ['none', 'gateway', 'device', 'invalid', 'foreign']) test(`MK4 normalized observation: ${ambiguous}`, async () => {
  const writes: string[] = [];
  let released = 0;
  (pool as any).connect = async () => ({ release: () => released++, query: async (sql: string, values: unknown[] = []) => {
    if (sql.includes('FROM gateways g')) {
      assert.equal(values[0], 'abcdefabcdef'); assert.match(sql, /lower\(regexp_replace\(btrim/);
      return { rows: [{ id: 1, company_id: COMPANY, place_id: null }, ...(ambiguous === 'gateway' ? [{ id: 2, company_id: COMPANY }] : [])] };
    }
    if (sql.includes('FROM devices WHERE')) {
      assert.equal(values[0], 'ABCDEF000001'); assert.match(sql, /upper\(regexp_replace\(btrim/);
      return { rows: [{ id: 1, company_id: ambiguous === 'foreign' ? 'foreign' : COMPANY }, ...(ambiguous === 'device' ? [{ id: 2 }] : [])] };
    }
    writes.push(sql); return { rows: [] };
  } });
  await handleDeviceRecord({ gatewayMac: ambiguous === 'invalid' ? 'bad' : 'AB:CD:EF:AB:CD:EF', bleMac: 'ab-cd-ef-00-00-01', rssi: -60, topic: 'devices/MK4' });
  assert.equal(writes.some(sql => sql.includes('INSERT INTO device_records')), ambiguous === 'none');
  assert.equal(writes.some(sql => sql.includes('UPDATE devices')), ambiguous === 'none');
  if (ambiguous !== 'none') assert(writes.includes('ROLLBACK'));
  assert.equal(released, 1);
});
