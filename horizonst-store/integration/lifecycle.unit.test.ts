import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';
import { attachDatabaseLifecycle, ServiceLifecycle } from '../src/lifecycle.js';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from '../src/server.js';
import { pool } from '../src/db/pool.js';
import { lifecycle } from '../src/lifecycle.js';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
function server() {
  const calls = { close: 0, idle: 0, force: 0 };
  return { calls, server: {
    close: (done: () => void) => { calls.close++; done(); },
    on: () => undefined, prependListener: () => undefined, removeListener: () => undefined,
    closeIdleConnections: () => calls.idle++, closeAllConnections: () => calls.force++
  } as unknown as Server };
}

test('idle PostgreSQL error reproduces original crash; managed pool recovers without replaying a query', async () => {
  const unmanaged = new EventEmitter();
  assert.throws(() => unmanaged.emit('error', new Error('simulated_restart')));
  const pool = new EventEmitter() as any;
  let available = false, acquisitions = 0, queries = 0, released = 0;
  pool.connect = async () => {
    acquisitions++;
    if (!available) throw new Error('simulated_restart');
    return { query: async () => { queries++; return { rows: [] }; }, release: () => released++ };
  };
  pool.end = async () => undefined;
  const database = attachDatabaseLifecycle(pool);
  assert.doesNotThrow(() => pool.emit('error', new Error('simulated_restart')));
  assert.equal(await database.ready(), false);
  assert.equal(acquisitions, 1);
  available = true;
  const a = database.ready(), b = database.ready();
  assert.equal(a, b);
  assert.equal(await a, true);
  assert.equal(acquisitions, 2);
  assert.equal(queries, 1);
  assert.equal(released, 1);
  await database.close();
});

test('late health connection is destroyed once after an absolute bounded probe timeout', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const gate = deferred();
  const pool = new EventEmitter() as any;
  const releases: boolean[] = [];
  let queries = 0;
  pool.connect = async () => { await gate.promise; return {
    query: async () => { queries++; }, release: (destroy: boolean) => releases.push(destroy)
  }; };
  const database = attachDatabaseLifecycle(pool);
  const ready = database.ready();
  await flush();
  t.mock.timers.tick(2_000);
  assert.equal(await ready, false);
  gate.resolve();
  await flush();
  assert.deepEqual(releases, [true]);
  assert.equal(queries, 0);
});

test('periodic tasks never overlap, stop admission and repeated shutdown closes each resource once', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 0 });
  const runtime = new ServiceLifecycle(), gate = deferred(), http = server();
  let runs = 0, mqtt = 0, database = 0;
  runtime.periodic('job', 10, async () => { runs++; await gate.promise; }, true);
  runtime.periodic('job', 10, async () => { runs++; });
  await flush();
  t.mock.timers.tick(50);
  assert.equal(runs, 1);
  const stop = () => { mqtt++; return Promise.resolve(); };
  const close = () => { database++; return Promise.resolve(); };
  const a = runtime.shutdown(http.server, stop, close), b = runtime.shutdown(http.server, stop, close);
  assert.equal(a, b);
  gate.resolve();
  assert.equal(await a, 0);
  t.mock.timers.tick(100);
  assert.equal(runs, 1);
  assert.equal(mqtt, 1); assert.equal(database, 1); assert.equal(http.calls.close, 1);
});

test('unfinished work does not get completed or retried and shutdown remains bounded', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const runtime = new ServiceLifecycle(), gate = deferred(), http = server();
  let completed = 0, closes = 0;
  void runtime.track(gate.promise.then(() => { completed++; }));
  const shutdown = runtime.shutdown(http.server, async () => undefined, async () => { closes++; }, 60);
  await flush();
  t.mock.timers.tick(50);
  assert.equal(await shutdown, 1);
  assert.equal(completed, 0); assert.equal(closes, 1);
  gate.resolve(); await flush();
});

test('SIGTERM followed by SIGINT installs one idempotent shutdown; handlers are removable', async t => {
  const runtime = new ServiceLifecycle(), http = server();
  let exits = 0, closes = 0;
  t.mock.method(process, 'exit', (() => { exits++; }) as typeof process.exit);
  const remove = runtime.install(http.server, async () => undefined, async () => { closes++; });
  assert.equal(runtime.install(http.server, async () => undefined, async () => { closes++; }), remove);
  try {
    process.emit('SIGTERM'); process.emit('SIGINT');
    await flush();
    assert.equal(closes, 1); assert.equal(exits, 1);
  } finally { remove(); }
});

test('borrowed client errors are consumed, failed probes destroy clients and never replay the failed query', async () => {
  const pool = new EventEmitter() as any, client = new EventEmitter() as any;
  let queries = 0;
  const releases: boolean[] = [];
  client.query = async () => { queries++; throw new Error('uncertain_query_result'); };
  client.release = (destroy: boolean) => releases.push(destroy);
  pool.connect = async () => client;
  const database = attachDatabaseLifecycle(pool);
  pool.emit('connect', client);
  assert.doesNotThrow(() => client.emit('error', new Error('server_restart')));
  assert.equal(await database.ready(), false);
  assert.equal(queries, 1);
  assert.deepEqual(releases, [true]);
  pool.emit('remove', client);
  assert.doesNotThrow(() => client.emit('error', new Error('late_socket_error')));
});

test('stuck pool end is bounded and terminates borrowed sockets without a second pool end', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const pool = new EventEmitter() as any, client = new EventEmitter() as any;
  const gate = deferred(); let ends = 0, clientEnds = 0;
  pool.end = async () => { ends++; await gate.promise; };
  client.end = async () => { clientEnds++; };
  const database = attachDatabaseLifecycle(pool);
  pool.emit('connect', client);
  const a = database.close(), b = database.close();
  assert.equal(a, b);
  const rejected = assert.rejects(a, /lifecycle_deadline/);
  await flush(); t.mock.timers.tick(2_000); await rejected;
  assert.equal(ends, 1); assert.equal(clientEnds, 1);
  gate.resolve(); await flush();
});

test('Store health returns 503 during a database outage and recovers with its original JSON contract', async t => {
  let available = false;
  t.mock.method(pool, 'connect', (async () => {
    if (!available) throw new Error('simulated_database_restart');
    return { query: async () => ({ rows: [{ ready: 1 }] }), release: () => undefined };
  }) as any);
  const http = createHttpServer(createServer());
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const address = http.address(); assert.ok(address && typeof address === 'object');
  const request = async () => {
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    return { status: response.status, body: await response.json() };
  };
  const previous = lifecycle.stopping;
  try {
    assert.deepEqual(await request(), { status: 503,
      body: { status: 'degraded', service: 'horizonst-store', database: 'unavailable' } });
    pool.emit('error', new Error('simulated_database_restart'));
    available = true;
    assert.deepEqual(await request(), { status: 200,
      body: { status: 'ok', service: 'horizonst-store', database: 'ok' } });
    lifecycle.stopping = true;
    assert.deepEqual(await request(), { status: 503,
      body: { status: 'degraded', service: 'horizonst-store', database: 'unavailable' } });
  } finally {
    lifecycle.stopping = previous;
    http.closeIdleConnections();
    await new Promise<void>(resolve => http.close(() => resolve()));
  }
});
