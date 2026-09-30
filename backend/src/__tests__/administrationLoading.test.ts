import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

class Element {
  children: Element[] = [];
  preceding: Element[] = [];
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  hidden = false;
  disabled = false;
  value = '';
  textContent = '';
  title = '';
  colSpan = 0;
  classList = { add() {}, remove() {} };
  listeners: Record<string, Function> = {};
  elements = { namedItem: () => new Element() };
  private html = '';
  set innerHTML(value: string) { this.html = value; this.children = []; }
  get innerHTML() { return this.html; }
  appendChild(e: Element) { this.children.push(e); if (!this.value && e.value) this.value = e.value; return e; }
  append(...items: Element[]) { this.children.push(...items); }
  replaceChildren(...items: Element[]) { this.children = items; }
  before(e: Element) { this.preceding.push(e); }
  closest() { return this; }
  setAttribute() {}
  addEventListener(event: string, fn: Function) { this.listeners[event] = fn; }
  querySelector() { const e = new Element(); this.children.push(e); return e; }
  querySelectorAll() { return []; }
  get lastElementChild() { return this.children.at(-1); }
}

const source = (name: string) => readFileSync(join(process.cwd(), 'public/js', name), 'utf8');
const settle = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
async function fixture(page: string, role = 'ADMIN', failure?: string, failureStatus = 500) {
  const nodes = new Map<string, Element>();
  const calls: string[] = [];
  const get = (key: string) => { if (!nodes.has(key)) nodes.set(key, new Element()); return nodes.get(key)!; };
  let failing = failure;
  const data: Record<string, unknown> = {
    '/devices': [{ id: 1, name: 'Fixture', ble_mac: 'ABCDEF000001', active: true }],
    '/gateways': [{ id: 1, mac_address: 'abcdef000002', active: true }],
    '/categories': [], '/users': [], '/companies': [], '/users/groups': [],
    '/alarms/configs': [], '/alarms': [], '/messages': []
  };
  const context = vm.createContext({
    document: { readyState: 'complete', hidden: false, getElementById: get, querySelector: get,
      querySelectorAll: () => [], createElement: () => new Element() },
    initAuthPage: () => ({ user: { role }, isAdmin: ['ADMIN', 'hardware_superadmin'].includes(role), isHardwareTechnician: role === 'hardware_technician' }),
    apiGet: async (path: string) => {
      calls.push(path);
      if (path === failing) throw Object.assign(new Error('fixture'), failureStatus === 0 ? { name: 'AbortError' } : { status: failureStatus });
      return data[path] ?? [];
    }, apiPost() {}, apiPut() {}, apiDelete() {}, confirmAction() {}, openFormModal() {},
    setInterval() {}, TextEncoder, console
  });
  vm.runInContext(source('load-state.js').replace(/^export /gm, ''), context);
  vm.runInContext(source(`${page}.js`).replace(/^import .*;\r?\n/gm, ''), context);
  await settle();
  return { nodes, calls, get, data, context, recover: () => { failing = undefined; } };
}

for (const role of ['ADMIN', 'hardware_superadmin', 'hardware_technician', 'hardware_readonly', 'USER']) {
  for (const page of ['devices', 'gateways']) test(`${page} loads authorized inventory independently for ${role}`, async () => {
    const f = await fixture(page, role, '/categories');
    assert(f.calls.includes(`/${page}`));
    assert.equal(f.get(`#${page}Table tbody`).children.length, 1);
    assert.equal(f.get(`${page}Empty`).style.display, 'none');
    if (!['ADMIN', 'hardware_superadmin'].includes(role)) assert(!f.calls.includes('/users'));
  });
}

for (const page of ['devices', 'gateways']) for (const metadata of page === 'devices' ? ['/categories', '/users', '/companies'] : ['/users', '/companies']) {
  for (const status of [403, 500, 0]) test(`${page}: ${metadata} failure ${status} preserves inventory and metadata retry`, async () => {
    const f = await fixture(page, 'ADMIN', metadata, status);
    assert.equal(f.get(`#${page}Table tbody`).children.length, 1);
    assert.equal(f.get(`${page}Empty`).style.display, 'none');
    const form = f.get(page === 'devices' ? 'deviceCreateForm' : 'gatewayForm');
    const panel = form.preceding[0];
    assert.match(panel.children[0].textContent, /deshabilitadas/);
    assert.equal(panel.children[1].hidden, false);
    f.recover(); panel.children[1].listeners.click(); await settle();
    assert.equal(panel.children[0].textContent, '');
    assert.equal(f.calls.filter(p => p === `/${page}`).length, 1);
  });
}

for (const page of ['devices', 'gateways']) for (const status of [403, 500, 0]) test(`${page}: inventory failure ${status} is not empty and recovers`, async () => {
  const f = await fixture(page, 'ADMIN', `/${page}`, status);
  const table = f.get(`#${page}Table tbody`), panel = table.preceding[0];
  assert.equal(f.get(`${page}Empty`).style.display, 'none');
  assert.equal(table.children.length, 0);
  assert.equal(panel.dataset.state, status === 403 ? 'denied' : 'error');
  f.recover(); panel.children[1].listeners.click(); await settle();
  assert.equal(panel.dataset.state, 'ready'); assert.equal(table.children.length, 1);
});

for (const page of ['devices', 'gateways']) test(`${page}: valid empty hides error and has no rows`, async () => {
  const f = await fixture(page); f.data[`/${page}`] = [];
  await vm.runInContext(page === 'devices' ? 'loadDevices()' : 'loadGateways()', f.context);
  assert.equal(f.get(`${page}Empty`).style.display, 'block');
  assert.equal(f.get(`#${page}Table tbody`).preceding[0].dataset.state, 'empty');
});

for (const page of ['devices', 'gateways']) test(`${page}: MAC form rejects garbage instead of silently removing it`, async () => {
  const f = await fixture(page);
  for (const value of ['abcdefabcdef', 'AB:CD:EF:AB:CD:EF', 'ab-cd-ef-ab-cd-ef']) {
    assert.equal(vm.runInContext(`normalizeMac(${JSON.stringify(value)})`, f.context), 'ABCDEFABCDEF');
  }
  for (const value of ['xxABCDEFABCDEF', 'AB:CD-EF:AB:CD:EF', 'ABCDEFABCDE']) {
    assert.equal(vm.runInContext(`normalizeMac(${JSON.stringify(value)})`, f.context), '');
  }
});

test('history selector failure is not an empty history and retry restores the same inventory', async () => {
  const f = await fixture('history', 'ADMIN', '/devices', 403);
  assert.equal(f.get('deviceSelect').disabled, true);
  assert.equal(f.get('historyEmpty').style.display, 'none');
  const panel = f.get('deviceSelect').preceding[0];
  assert.equal(panel.dataset.state, 'denied');
  f.recover(); panel.children[1].listeners.click(); await settle();
  assert.equal(f.get('deviceSelect').disabled, false);
  assert.equal(f.get('deviceSelect').children.length, 1);
});

test('history and dashboard keep registered devices without last observation', async () => {
  const history = await fixture('history');
  assert.equal(history.get('deviceSelect').children.length, 1);
  assert.equal(history.get('deviceSelect').disabled, false);
  assert.equal(history.get('historyEmpty').style.display, 'block');
  const dashboard = await fixture('dashboard');
  assert.equal(dashboard.get('summaryCards').children.length, 4);
  assert.equal(dashboard.get('recentDevicesEmpty').style.display, 'block');
  assert.match(readFileSync(join(process.cwd(), 'public/dashboard.html'), 'utf8'), /última observación central/);
});

for (const metadata of ['/devices', '/categories', '/users/groups']) test(`alarm metadata ${metadata} failure does not block rule and alarm reads`, async () => {
  const f = await fixture('alarms', 'ADMIN', metadata, 403);
  assert(f.calls.includes('/alarms/configs')); assert(f.calls.includes('/alarms'));
  assert.equal(f.get('#configsTable tbody').preceding[0].dataset.state, 'ready');
});

test('technical panels discard partial results and recover without duplicate refresh', async () => {
  const f = await fixture('gateways', 'ADMIN', '/gateways/1/reads', 403);
  await vm.runInContext('selectGateway(gateways[0])', f.context);
  const table = f.get('#gatewayCommandsTable tbody');
  assert.equal(table.preceding[0].dataset.state, 'denied');
  assert.equal(table.children.length, 0);
  f.recover(); await vm.runInContext('Promise.all([refreshTechnicalHistory(), refreshTechnicalHistory()])', f.context);
  assert.equal(table.preceding[0].dataset.state, 'ready');
  assert.equal(f.calls.filter(p => p === '/gateways/1/reads').length, 2);
});

test('GET timeout uses AbortController and clears its timer; 403 retains status', async () => {
  let callback: Function = () => {}, cleared = 0;
  const context = vm.createContext({ window: { apiFetch: (_p: string, o: any) => new Promise((_resolve, reject) => o.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })))) },
    localStorage: { getItem: () => null }, AbortController,
    setTimeout: (fn: Function) => { callback = fn; return 1; }, clearTimeout: () => cleared++ });
  vm.runInContext(source('api.js').replace(/^export /gm, ''), context);
  const pending = vm.runInContext("apiGet('/devices')", context); callback();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(cleared, 1);
  vm.runInContext('window.apiFetch = async () => ({status:403,ok:false})', context);
  await assert.rejects(vm.runInContext("apiGet('/devices')", context), { status: 403 });
  assert.equal(cleared, 2);
});
