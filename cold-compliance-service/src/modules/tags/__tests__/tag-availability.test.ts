import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { env } from '../../../config/env';
import { db } from '../../../db/pool';
import { workersRouter } from '../../workers/workers.routes';
import { tagsRouter } from '../tags.routes';
import { operationalTagInventory, verifyTagAssignment } from '../tag-availability.service';

// Synthetic identities only: never read/mutate the device reported from staging.
const local = { id: '11111111-1111-4111-8111-111111111111', tag_uid: 'aa0000000001',
  hardware_device_id: 71, active: true, model: 'B5', last_battery: 80 };
const central = { id: 71, ble_mac: 'AA0000000001', active: true, status: 'active', device_type: 'b5',
  company_id: '22222222-2222-4222-8222-222222222222', name: 'Fixture', description: null,
  type_policy: { known: true, typeActive: true, companyAllowed: true, horneoCompatible: true } };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('complete scoped inventory hides absence/company transfer; reassignment reuses overlay identity and history', async () => {
  const enabled = env.HARDWARE_MANAGER_ENABLED;
  (env as any).HARDWARE_MANAGER_ENABLED = true;
  const before = structuredClone(local);
  try {
    assert.deepEqual(await operationalTagInventory([local], async () => response([])), []);
    // Both deassignment and transfer disappear from the old company's scoped list.
    assert.deepEqual(await operationalTagInventory([local], async () => response([{ ...central, id: 72, ble_mac: 'AA0000000002' }])), []);
    const restored = await operationalTagInventory([local], async () => response([central]));
    assert.equal(restored.length, 1);
    assert.equal(restored[0].id, local.id);
    assert.equal(restored[0].hardware_device_id, local.hardware_device_id);
    assert.equal(restored[0].assignment_available, true);
    assert.equal((restored[0] as any).last_battery, 80);
    for (const unavailableDevice of [{ ...central, active: false }, { ...central, status: 'inactive' },
      { ...central, device_type: 'sensor' }, { ...central, type_policy: { ...central.type_policy, companyAllowed: false } }]) {
      const rows = await operationalTagInventory([local], async () => response([unavailableDevice]));
      assert.equal(rows[0].assignment_available, false);
      assert.equal(rows[0].availability_status, 'ineligible');
    }
    assert.deepEqual(local, before);
  } finally { (env as any).HARDWARE_MANAGER_ENABLED = enabled; }
});

test('list errors/authentication/malformed contracts are never confirmed absence or permission', async () => {
  const enabled = env.HARDWARE_MANAGER_ENABLED;
  (env as any).HARDWARE_MANAGER_ENABLED = true;
  try {
    const badFetches: typeof fetch[] = [
      async () => response({}, 401), async () => response({}, 403), async () => response({}, 404),
      async () => response({}, 429), async () => response({}, 500), async () => { throw new Error('offline'); },
      async () => response({ devices: [] }), async () => response([null]),
      async () => response([{ ...central, active: 'true' }]), async () => response([central, central]),
      async () => new Response('invalid json')
    ];
    for (const badFetch of badFetches) {
      const rows = await operationalTagInventory([local], badFetch);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].availability_status, 'unverified');
      assert.equal(rows[0].assignment_available, false);
      assert.equal(rows[0].active, true, 'local state retained, not changed into deassignment');
    }
    assert.equal(await verifyTagAssignment(local, async () => response({ ...central, id: 72 })), 'unverified');
    assert.equal(await verifyTagAssignment(local, async () => response({ ...central, ble_mac: 'AA0000000002' })), 'unverified');
    (env as any).HARDWARE_MANAGER_ENABLED = false;
    assert.equal(await verifyTagAssignment(local, async () => { throw new Error('must not fetch'); }), 'unverified');
  } finally { (env as any).HARDWARE_MANAGER_ENABLED = enabled; }
});

test('HTTP direct/stale assignments use a fresh scope check before any mutation; existing sessions survive denials', async () => {
  const originalQuery = db.query;
  const originalFetch = global.fetch;
  const config = { enabled: env.HARDWARE_MANAGER_ENABLED, url: env.HARDWARE_MANAGER_BASE_URL, timeout: env.HARDWARE_MANAGER_TIMEOUT_MS };
  (env as any).HARDWARE_MANAGER_ENABLED = true;
  (env as any).HARDWARE_MANAGER_BASE_URL = 'http://central-fixture.invalid';
  (env as any).HARDWARE_MANAGER_TIMEOUT_MS = 20;
  let lookupFetch: typeof fetch = async () => response(central);
  let calls = 0;
  let writes = 0;
  let role = 'supervisor';
  const retained = { assignments: [{ id: 'existing', active: true }], sessions: [{ id: 'open', ended_at: null }], history: ['kept'] };
  const before = structuredClone(retained);
  global.fetch = async (input, init) => {
    if (String(input).startsWith('http://central-fixture.invalid')) {
      if (String(input).endsWith('/devices/71')) assert.equal(init?.cache, 'no-store');
      calls++; return lookupFetch(input, init);
    }
    return originalFetch(input, init);
  };
  (db as any).query = async (sql: string) => {
    if (sql.includes('FROM auth_sessions')) return { rows: [{ id: 'actor', role, email: 'fixture@example.invalid' }], rowCount: 1 };
    if (sql.includes('SELECT active FROM workers')) return { rows: [{ active: true }], rowCount: 1 };
    if (sql.includes('FROM tags')) return { rows: [structuredClone(local)], rowCount: 1 };
    if (/UPDATE|INSERT/.test(sql)) { writes++; return { rows: [{ id: 'new', hardware_device_id: 71 }], rowCount: 1 }; }
    throw new Error('Unexpected fixture query');
  };
  const app = express();
  app.use(express.json()); app.use('/workers', workersRouter); app.use('/tags', tagsRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  const assign = () => originalFetch(`${url}/workers/fixture/assign-tag`, { method: 'POST',
    headers: { Authorization: 'Bearer isolated-fixture', 'Content-Type': 'application/json' }, body: JSON.stringify({ tagId: local.id }) });
  try {
    assert.equal((await originalFetch(`${url}/workers/fixture/assign-tag`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tagId: local.id }) })).status, 401);
    role = 'trabajador';
    assert.equal((await assign()).status, 403);
    assert.equal(calls, 0);
    assert.equal(writes, 0);
    role = 'supervisor';
    lookupFetch = async () => response([central]);
    const inventory = await originalFetch(`${url}/tags`, { headers: { Authorization: 'Bearer isolated-fixture' } });
    assert.equal((await inventory.json())[0].assignment_available, true, 'previously loaded screen');
    const denied: Array<[typeof fetch, number]> = [
      [async () => response({ message: 'Device not found' }, 404), 409], // Deassigned or transferred out of scope.
      [async () => response({}, 404), 503], // Unknown proxy/router 404 is not confirmed absence.
      [async () => response({ ...central, active: false }), 409],
      [async () => response({ ...central, status: 'inactive' }), 409],
      [async () => response({ ...central, device_type: 'sensor' }), 409],
      [async () => response({ ...central, type_policy: { ...central.type_policy, companyAllowed: false } }), 409],
      [async () => response({}, 401), 503], [async () => response({}, 403), 503],
      [async () => response({}, 429), 503], [async () => response({}, 500), 503],
      [async () => { throw new Error('offline'); }, 503],
      [async () => response({}), 503],
      [async () => response({ ...central, company_id: null }), 503],
      [async (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true })), 503]
    ];
    for (const [fake, code] of denied) {
      lookupFetch = fake;
      const result = await assign();
      assert.equal(result.status, code);
      assert.equal(writes, 0, 'no assignment UPDATE/INSERT before verified authorization');
      assert.deepEqual(retained, before);
    }
    lookupFetch = async () => response(central);
    assert.equal((await assign()).status, 201, 'reassignment uses original local id/link');
    assert.equal(writes, 3);
    assert.equal(calls, 1 + denied.length + 1, 'no cached inventory success authorizes a later request');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.query = originalQuery; global.fetch = originalFetch;
    (env as any).HARDWARE_MANAGER_ENABLED = config.enabled;
    (env as any).HARDWARE_MANAGER_BASE_URL = config.url;
    (env as any).HARDWARE_MANAGER_TIMEOUT_MS = config.timeout;
  }
});

test('UI inventory/selectors omit confirmed scope loss, block unverified tags and retain existing worker/history', async () => {
  const source = readFileSync(path.resolve(process.cwd(), 'web/app.js'), 'utf8');
  const elements: Record<string, any> = {};
  const context = vm.createContext({ localStorage: { getItem: () => '' }, console,
    document: { getElementById: (id: string) => elements[id] ||= { innerHTML: '', value: '', hidden: false }, querySelectorAll: () => [] },
    window: { innerWidth: 1200 } });
  vm.runInContext(source.slice(0, source.indexOf('(function wireLoginForm()')), context);
  context.tagFixture = { ...local, assignment_available: true, availability_status: 'available' };
  context.workerFixture = { id: 'worker', full_name: 'Fixture', dni: 'TEST', active: true, current_tag_uid: 'OLD-TAG' };
  vm.runInContext("currentUser = { role: 'superadministrador' }; api = async url => url === '/tags' ? [tagFixture] : url === '/workers' ? [workerFixture] : [];", context);
  await vm.runInContext('renderAssignments()', context);
  assert.match(elements.assignments.innerHTML, /value="11111111-1111-4111-8111-111111111111"/);
  context.tagFixture.availability_status = 'not_in_company';
  context.tagFixture.assignment_available = false;
  await vm.runInContext('renderInventory()', context);
  assert.doesNotMatch(elements.inventory.innerHTML, /aa0000000001/);
  await vm.runInContext('renderAssignments()', context);
  assert.doesNotMatch(elements.assignments.innerHTML, /aa0000000001/);
  assert.match(elements.assignments.innerHTML, /No hay tags verificados/);
  assert.match(elements.assignments.innerHTML, /OLD-TAG/);
  context.tagFixture.availability_status = 'unverified';
  await vm.runInContext('renderInventory()', context);
  assert.match(elements.inventory.innerHTML, /aa0000000001/);
  assert.match(elements.inventory.innerHTML, /no se ha podido verificar/);
  await vm.runInContext('renderAssignments()', context);
  assert.match(elements.assignments.innerHTML, /id="asTag" disabled/);
  assert.doesNotMatch(elements.assignments.innerHTML, /value="11111111-1111-4111-8111-111111111111"/);
  context.tagFixture.availability_status = 'available'; context.tagFixture.assignment_available = true;
  await vm.runInContext('renderAssignments()', context);
  assert.match(elements.assignments.innerHTML, /value="11111111-1111-4111-8111-111111111111"/);
  elements.asWorker = { value: 'worker' }; elements.asTag = { value: local.id };
  context.messages = [];
  vm.runInContext("toast = (message, type) => messages.push({message, type}); api = async () => { throw Object.assign(new Error('rejected'), { payload: { message: 'No autorizado' } }); };", context);
  const beforeError = elements.assignments.innerHTML;
  await vm.runInContext('assignTag()', context);
  assert.equal(context.messages.length, 1);
  assert.equal(context.messages[0].type, 'error');
  assert.equal(elements.assignments.innerHTML, beforeError, 'rejection does not discard the current screen');
});
