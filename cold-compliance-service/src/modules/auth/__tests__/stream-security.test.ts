import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { realtimeRouter } from '../../realtime/realtime.routes';
import { db } from '../../../db/pool';

const originalQuery = db.query;
afterEach(() => { db.query = originalQuery; mock.restoreAll(); });

test('active SSE connection closes when its session is revoked', async () => {
  let valid = true;
  let tick: () => Promise<void> = async () => {};
  let cleared = false;
  mock.method(global, 'setInterval', (fn: () => Promise<void>) => { tick = fn; return {} as any; });
  mock.method(global, 'clearInterval', () => { cleared = true; });
  (db as any).query = async (sql: string, values: unknown[]) => {
    if (sql.includes('FROM auth_sessions')) { assert.equal(values[0], 'fixture-session'); return { rowCount: valid ? 1 : 0, rows: [] }; }
    return { rowCount: 0, rows: [] };
  };
  const handler = (realtimeRouter as any).stack.find((layer: any) => layer.route?.path === '/stream').route.stack[0].handle;
  let output = '';
  const res: any = { writableEnded: false, setHeader() {}, write(data: string) { output += data; }, end() { this.writableEnded = true; } };
  await handler({ header: () => 'Bearer fixture-session', on() {} }, res);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.match(output, /event: snapshot/);
  valid = false;
  await tick();
  assert.equal(res.writableEnded, true);
  assert.equal(cleared, true);
});

test('frontend parses split SSE frames with Authorization and cancels reconnect on close', async () => {
  const source = readFileSync(path.resolve(process.cwd(), 'web/app.js'), 'utf8');
  let request: any;
  let cancelled = false;
  const elements: Record<string, any> = {};
  const payload = { workersInside: [], workersInGrace: [], activeAlerts: [], totals: { workersInside: 0, workersInGrace: 0, activeAlerts: 0 } };
  const frame = `event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`;
  const fragments = [frame.slice(0, 12), frame.slice(12, 30), frame.slice(30)];
  const context: any = vm.createContext({
    localStorage: { getItem: () => '' },
    document: { getElementById: (id: string) => elements[id] ||= { innerHTML: '', value: '', hidden: true }, querySelectorAll: () => [] },
    window: { innerWidth: 1200 }, AbortController, TextDecoder,
    setTimeout: () => 1, clearTimeout() {}, console,
    fetch: async (url: string, init: any) => {
      request = { url, init };
      return { ok: true, status: 200, body: { getReader: () => ({
        read: async () => fragments.length ? { value: new TextEncoder().encode(fragments.shift()), done: false } : { done: true },
        cancel: async () => { cancelled = true; }, releaseLock() {}
      }) } };
    }
  });
  vm.runInContext(source.slice(0, source.indexOf('(function wireLoginForm()')), context);
  vm.runInContext("token = 'fixture-session'; currentUser = { email: 'worker@example.test', role: 'supervisor' }; startRealtime();", context);
  for (let i = 0; i < 25; i++) await Promise.resolve();
  assert.equal(request.url, '/realtime/stream');
  assert.equal(request.init.headers.Authorization, 'Bearer fixture-session');
  assert.equal(vm.runInContext('lastSnapshot.totals.activeAlerts', context), 0);
  vm.runInContext('realtimeSource.close()', context);
  assert.equal(request.init.signal.aborted, true);
  assert.equal(cancelled, true);
});
