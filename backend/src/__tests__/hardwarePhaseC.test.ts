import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import app from '../app';
import { pool } from '../db/pool';
import { resetServiceRateLimitsForTests } from '../middleware/serviceAuth';
import {
  buildDeviceReconciliation,
  ReconciliationCentralDevice,
  ReconciliationLocalDevice
} from '../services/deviceReconciliation';
import { normalizeMacAddress } from '../utils/mac';

const COMPANY_HORNEO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SERVICE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TOKEN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TOKEN = 'hst_svc_phase-c-token-with-sufficient-random-looking-content';
const HORNEO_TAGS = [
  ['C65B52531BDC', 'B5 Horneo 11'],
  ['CFFED3729D25', 'B5 Horneo 6'],
  ['D8DFBC0445F7', 'B5 Horneo 9'],
  ['DDAF7B0420A7', 'B5 Horneo 5'],
  ['DF9DDAA7EAB3', 'B5 Horneo 1'],
  ['E3D5904006A9', 'B5 Horneo 4'],
  ['E5CB649D8B01', 'B5 Horneo 7'],
  ['E70B472E802F', 'B5 Horneo 10'],
  ['F057869A984F', 'B5 Horneo 3'],
  ['F86385C8F038', 'B5 Horneo 8'],
  ['F8FAB24A26A8', 'B5 Horneo 2'],
  ['FCB6429F0476', 'B5 Horneo 12'],
  ['FD9D4F8AE226', 'B5 pruebas emergencia']
] as const;
const originalQuery = pool.query.bind(pool);
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
  resetServiceRateLimitsForTests();
});

after(async () => {
  (pool as any).query = originalQuery;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

const localTag = (patch: Partial<ReconciliationLocalDevice> = {}): ReconciliationLocalDevice => ({
  id: '11111111-1111-4111-8111-111111111111',
  tag_uid: 'DF9DDAA7EAB3',
  model: 'B5',
  active: true,
  hardware_device_id: null,
  created_at: '2026-01-01T00:00:00Z',
  ...patch
});

const centralDevice = (patch: Partial<ReconciliationCentralDevice> = {}): ReconciliationCentralDevice => ({
  id: 1,
  name: 'B5 existente',
  ble_mac: 'DF9DDAA7EAB3',
  description: null,
  device_type: 'b5',
  status: 'active',
  active: true,
  company_id: COMPANY_HORNEO,
  company_code: 'horneo',
  ...patch
});

test('normalización MAC de devices es canónica, mayúscula y estricta', () => {
  assert.equal(normalizeMacAddress('df:9d-da:a7-ea:b3'), 'DF9DDAA7EAB3');
  assert.equal(normalizeMacAddress('invalid'), null);
});

test('migración 015 añade referencia lógica idempotente, única y sin FK cross-database', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', 'cold-compliance-service', 'migrations', '015_hardware_device_reference.sql'),
    'utf8'
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS hardware_device_id INTEGER/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS[\s\S]*WHERE hardware_device_id IS NOT NULL/);
  assert.doesNotMatch(migration, /REFERENCES\s+devices/i);
  assert.doesNotMatch(migration, /UPDATE\s+tags/i);
});

test('inventario inicial de 13 tags reutiliza device 1 y planifica 12 altas sin duplicarlo', () => {
  const localRows = HORNEO_TAGS.map(([mac, model], index) => localTag({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    tag_uid: mac === 'DF9DDAA7EAB3' ? 'df:9d:da:a7:ea:b3' : mac.toLowerCase(),
    model
  }));
  const result = buildDeviceReconciliation({
    localRows,
    centralRows: [centralDevice({ company_id: null, company_code: null, device_type: 'unknown' })],
    company: { id: COMPANY_HORNEO, active: true }
  });
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.plans.length, 13);
  assert.equal(result.plans.filter((plan) => plan.action === 'link_unassigned').length, 1);
  assert.equal(result.plans.filter((plan) => plan.action === 'create').length, 12);
  const existing = result.plans.find((plan) => plan.mac === 'DF9DDAA7EAB3');
  assert.equal(existing?.central?.id, 1);
  assert.ok(existing?.differences.includes('device_type'));
});

test('segunda reconciliación ya enlazada es idempotente', () => {
  const localRows = HORNEO_TAGS.map(([mac, model], index) => localTag({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    tag_uid: mac,
    model,
    hardware_device_id: mac === 'DF9DDAA7EAB3' ? 1 : (index < 4 ? index + 2 : index + 1)
  }));
  const centralRows = localRows.map((row) => centralDevice({
    id: row.hardware_device_id!,
    ble_mac: row.tag_uid!,
    name: row.model
  }));
  const result = buildDeviceReconciliation({ localRows, centralRows, company: { id: COMPANY_HORNEO, active: true } });
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.plans.length, 13);
  assert.ok(result.plans.every((plan) => plan.action === 'reuse'));
  assert.ok(result.plans.every((plan) => plan.local.hardware_device_id === plan.central?.id));
});

test('reconciliación bloquea MAC locales inválidas o duplicadas', () => {
  const result = buildDeviceReconciliation({
    localRows: [
      localTag({ id: 'invalid', tag_uid: 'bad' }),
      localTag({ id: 'duplicate-a' }),
      localTag({ id: 'duplicate-b', tag_uid: 'df-9d-da-a7-ea-b3' })
    ],
    centralRows: [],
    company: { id: COMPANY_HORNEO, active: true }
  });
  assert.ok(result.conflicts.some((item) => item.type === 'invalid_local_mac'));
  assert.ok(result.conflicts.some((item) => item.type === 'duplicate_local_mac'));
  assert.equal(result.plans.length, 0);
});

test('reconciliación bloquea duplicados centrales y referencias locales múltiples', () => {
  const result = buildDeviceReconciliation({
    localRows: [localTag({ id: 'a', hardware_device_id: 1 }), localTag({ id: 'b', tag_uid: 'A00000000001', hardware_device_id: 1 })],
    centralRows: [centralDevice(), centralDevice({ id: 2, ble_mac: 'df:9d:da:a7:ea:b3' })],
    company: { id: COMPANY_HORNEO, active: true }
  });
  assert.ok(result.conflicts.some((item) => item.type === 'duplicate_central_mac'));
  assert.ok(result.conflicts.some((item) => item.type === 'duplicate_local_hardware_device_id'));
});

test('reconciliación bloquea propiedad ajena y empresa Horneo ausente o inactiva', () => {
  const foreign = buildDeviceReconciliation({
    localRows: [localTag()],
    centralRows: [centralDevice({ company_id: COMPANY_B, company_code: 'other' })],
    company: { id: COMPANY_HORNEO, active: true }
  });
  assert.equal(foreign.conflicts[0].type, 'device_owned_by_other_company');
  const inactiveCompany = buildDeviceReconciliation({ localRows: [], centralRows: [], company: { id: COMPANY_HORNEO, active: false } });
  assert.equal(inactiveCompany.conflicts[0].type, 'horneo_company_missing_or_inactive');
});

test('reconciliación distingue hardware_device_id enlazado a otra empresa', () => {
  const result = buildDeviceReconciliation({
    localRows: [localTag({ hardware_device_id: 1 })],
    centralRows: [centralDevice({ company_id: COMPANY_B, company_code: 'other' })],
    company: { id: COMPANY_HORNEO, active: true }
  });
  assert.equal(result.plans.length, 0);
  assert.equal(result.conflicts[0].type, 'hardware_device_id_other_company');
});

test('reconciliación bloquea referencia huérfana, MAC incoherente y estado operativo distinto', () => {
  const orphan = buildDeviceReconciliation({
    localRows: [localTag({ hardware_device_id: 99 })], centralRows: [], company: { id: COMPANY_HORNEO, active: true }
  });
  assert.equal(orphan.conflicts[0].type, 'hardware_device_id_orphan');
  const mismatch = buildDeviceReconciliation({
    localRows: [localTag({ hardware_device_id: 2 })],
    centralRows: [centralDevice(), centralDevice({ id: 2, ble_mac: 'A00000000001' })],
    company: { id: COMPANY_HORNEO, active: true }
  });
  assert.equal(mismatch.conflicts[0].type, 'hardware_device_id_mac_mismatch');
  const inactive = buildDeviceReconciliation({
    localRows: [localTag()], centralRows: [centralDevice({ active: false, status: 'inactive' })], company: { id: COMPANY_HORNEO, active: true }
  });
  assert.equal(inactive.conflicts[0].type, 'central_device_operational_state_mismatch');
});

test('reconciliación informa devices Horneo y sin empresa que no tienen tag local', () => {
  const result = buildDeviceReconciliation({
    localRows: [],
    centralRows: [centralDevice(), centralDevice({ id: 2, ble_mac: 'A00000000001', company_id: null, company_code: null })],
    company: { id: COMPANY_HORNEO, active: true }
  });
  assert.deepEqual(result.centralWithoutLocal, [{ id: 1, mac: 'DF9DDAA7EAB3' }]);
  assert.deepEqual(result.centralWithoutCompany, [{ id: 2, mac: 'A00000000001' }]);
});

const serviceRow = (scopes = ['hardware.read']) => ({
  principal_id: SERVICE_ID,
  code: 'horneo',
  company_id: COMPANY_HORNEO,
  scopes,
  token_id: TOKEN_ID
});

const serviceApi = (pathName: string, token = TOKEN) => fetch(`${baseUrl}${pathName}`, {
  headers: { Authorization: `Bearer ${token}` }
});

function mockDeviceApi(scopes = ['hardware.read']) {
  const resourceQueries: Array<{ sql: string; params: unknown[] }> = [];
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM service_principal_tokens')) return { rows: [serviceRow(scopes)] };
    if (sql.includes('UPDATE service_principal_tokens')) return { rows: [] };
    if (sql.includes('FROM devices d')) {
      resourceQueries.push({ sql, params });
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO technical_audit_log')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  return resourceQueries;
}

test('API interna lista devices usando company_id del principal, nunca del cliente', async () => {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM service_principal_tokens')) return { rows: [serviceRow()] };
    if (sql.includes('UPDATE service_principal_tokens')) return { rows: [] };
    if (sql.includes('FROM devices d')) {
      queries.push({ sql, params });
      return { rows: [centralDevice()] };
    }
    if (sql.includes('INSERT INTO technical_audit_log')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  const response = await serviceApi(`/api/internal/v1/hardware/devices?companyId=${COMPANY_B}`);
  assert.equal(response.status, 200);
  assert.deepEqual(queries[0].params, [COMPANY_HORNEO]);
  assert.match(queries[0].sql, /d\.company_id = \$1/);
  assert.deepEqual(await response.json(), [centralDevice()]);
});

test('API interna resuelve un device Horneo por id y por MAC', async () => {
  const resourceQueries: Array<{ sql: string; params: unknown[] }> = [];
  (pool as any).query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('FROM service_principal_tokens')) return { rows: [serviceRow()] };
    if (sql.includes('UPDATE service_principal_tokens')) return { rows: [] };
    if (sql.includes('FROM devices d')) {
      resourceQueries.push({ sql, params });
      return { rows: [centralDevice()] };
    }
    if (sql.includes('INSERT INTO technical_audit_log')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  assert.equal((await serviceApi('/api/internal/v1/hardware/devices/1')).status, 200);
  assert.equal((await serviceApi('/api/internal/v1/hardware/devices/by-mac/df:9d:da:a7:ea:b3')).status, 200);
  assert.deepEqual(resourceQueries[0].params, [1, COMPANY_HORNEO]);
  assert.deepEqual(resourceQueries[1].params, ['DF9DDAA7EAB3', COMPANY_HORNEO]);
});

test('API interna oculta devices de otra empresa por id y MAC con 404', async () => {
  const queries = mockDeviceApi();
  assert.equal((await serviceApi('/api/internal/v1/hardware/devices/99')).status, 404);
  assert.equal((await serviceApi('/api/internal/v1/hardware/devices/by-mac/DF9DDAA7EAB3')).status, 404);
  assert.deepEqual(queries[0].params, [99, COMPANY_HORNEO]);
  assert.deepEqual(queries[1].params, ['DF9DDAA7EAB3', COMPANY_HORNEO]);
  assert.ok(queries.every(({ sql }) => /d\.company_id = \$2/.test(sql)));
});

test('API interna rechaza token inválido y scope insuficiente', async () => {
  (pool as any).query = async (sql: string) => {
    if (sql.includes('FROM service_principal_tokens')) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  assert.equal((await serviceApi('/api/internal/v1/hardware/devices', 'invalid')).status, 401);
  mockDeviceApi([]);
  assert.equal((await serviceApi('/api/internal/v1/hardware/devices')).status, 403);
});

test('script es report-only por defecto y separa las dos transacciones de apply', () => {
  const script = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'reconcileHorneoDevices.js'), 'utf8');
  assert.match(script, /process\.argv\.includes\('--apply'\)/);
  assert.match(script, /if \(!apply\)/);
  assert.match(script, /UPDATE tags SET hardware_device_id/);
  assert.equal((script.match(/query\('BEGIN'\)/g) ?? []).length, 2);
  assert.equal((script.match(/query\('COMMIT'\)/g) ?? []).length, 2);
  assert.equal((script.match(/query\('ROLLBACK'\)/g) ?? []).length, 2);
});
