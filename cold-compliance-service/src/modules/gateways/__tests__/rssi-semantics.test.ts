import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { env } from '../../../config/env';
import { db } from '../../../db/pool';
import { gatewaysRouter } from '../gateways.routes';
import { evaluatePresenceSignal } from '../../compliance/presence-signal-policy';

test('gateway API separates local/central RSSI, preserves authorization and never copies local into a command', async () => {
  const originalQuery = db.query; const originalFetch = global.fetch;
  const originalEnabled = env.HARDWARE_MANAGER_ENABLED;
  let role = 'superadministrador'; let centralMode: 'ok' | 'missing' | 'error' | 'invalid' = 'ok';
  let commands = 0; let writes = 0;
  const row = { id: 'local-id', gateway_mac: 'abcdef000001', hardware_gateway_id: 41, rssi_threshold: -70 };
  (env as any).HARDWARE_MANAGER_ENABLED = true;
  (db as any).query = async (sql: string) => {
    if (sql.includes('auth_sessions')) return { rows: [{ id: 'fixture', role, email: 'fixture@example.invalid' }] };
    if (sql.includes('SELECT') && sql.includes('FROM gateways')) return { rows: [{ ...row }], rowCount: 1 };
    writes++; throw new Error('unexpected database write');
  };
  global.fetch = (async (input: any, options?: RequestInit) => {
    if (!String(input).includes('/api/internal/v1/hardware/')) return originalFetch(input, options);
    if (options?.method === 'POST') { commands++; return new Response(JSON.stringify({ status: 'success', resultCode: 0 }), { status: 200 }); }
    if (centralMode === 'error') return new Response('{}', { status: 503 });
    return new Response(JSON.stringify(centralMode === 'missing' ? [] : [{ id: 41, mac_address: row.gateway_mac,
      name: 'Central', company_id: 'allowed-company', active: true, rssi_threshold: centralMode === 'invalid' ? '-60' : -60 }]), { status: 200 });
  }) as typeof fetch;
  const app = express(); app.use(express.json()); app.use('/gateways', gatewaysRouter);
  app.use((_error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: 'fixture' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const request = (suffix = '', body?: unknown, auth = true) => originalFetch(`${base}/gateways${suffix}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer fixture' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  try {
    assert.equal((await request('', undefined, false)).status, 401);
    const rows = await (await request()).json();
    assert.equal(rows[0].rssi_threshold, -70); assert.equal(rows[0].hardware_rssi_threshold, -60);
    assert.equal(rows[0].hardware_rssi_state, 'saved_unverified');
    assert.equal(commands, 0); assert.equal(writes, 0);
    for (const mode of ['missing', 'error', 'invalid'] as const) {
      centralMode = mode;
      const [gateway] = await (await request()).json();
      assert.equal(gateway.rssi_threshold, -70); assert.equal(gateway.hardware_rssi_threshold, null);
    }
    role = 'supervisor'; assert.equal((await request('/local-id/apply-rssi', { rssi: -60 })).status, 403);
    role = 'superadministrador'; assert.equal((await request('/local-id/apply-rssi', {})).status, 400);
    assert.equal(commands, 0);
    assert.equal((await request('/local-id/apply-rssi', { rssi: -60 })).status, 200);
    assert.equal(commands, 1); assert.equal(writes, 0); assert.equal(row.rssi_threshold, -70);
    assert.equal(evaluatePresenceSignal({ gatewayRegistered: true, coldRoomId: null, hasOpenSession: true,
      rssi: -65, rssiThreshold: row.rssi_threshold, entryMarginDb: 5 }).accepted, true);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    db.query = originalQuery; global.fetch = originalFetch; (env as any).HARDWARE_MANAGER_ENABLED = originalEnabled;
  }
});

test('Horneo inventory refresh shows separate values and errors without defaults or automatic commands', async () => {
  const source = readFileSync(path.join(process.cwd(), 'web/app.js'), 'utf8');
  const elements: Record<string, any> = {}; const calls: string[] = [];
  let physical: number | null = -60;
  const context = vm.createContext({ localStorage: { getItem: () => '' }, console,
    document: { getElementById: (id: string) => elements[id] ||= { innerHTML: '' } } });
  vm.runInContext(source.slice(0, source.indexOf('(function wireLoginForm()')), context);
  vm.runInContext("currentUser = { role: 'superadministrador' }", context);
  context.api = async (url: string) => {
    calls.push(url); return url === '/tags' ? [] : [{ gateway_mac: 'abcdef000001', rssi_threshold: -70,
      hardware_rssi_threshold: physical, hardware_rssi_state: physical == null ? 'not_available' : 'saved_unverified' }];
  };
  await vm.runInContext('renderInventory()', context);
  assert.match(elements.inventory.innerHTML, /Umbral local de presencia/); assert.match(elements.inventory.innerHTML, /Filtro físico guardado central/);
  assert.match(elements.inventory.innerHTML, /-70 dBm/); assert.match(elements.inventory.innerHTML, /-60 dBm/);
  physical = null; await vm.runInContext('renderInventory()', context);
  assert.match(elements.inventory.innerHTML, /No disponible · Sin lectura física/);
  assert.doesNotMatch(elements.inventory.innerHTML, /-127/);
  assert.ok(calls.every(url => url === '/tags' || url === '/gateways'));
  assert.equal(vm.runInContext('storedGatewayRssi(null)', context), 'No disponible (dato ausente o inválido)');
});
