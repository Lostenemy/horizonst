import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import {
  cleanupOwnedContainer,
  parseLoopbackBinding,
  startIsolatedPostgres,
  waitForStablePostgres
} from './postgres-container-lifecycle.mjs';

const scriptPath = path.resolve(import.meta.dirname, 'production-migrations.postgres.mjs');
const source = readFileSync(scriptPath, 'utf8');
const lifecycleSource = readFileSync(path.resolve(import.meta.dirname, 'postgres-container-lifecycle.mjs'), 'utf8');

test('production migration harness uses random identity, loopback-only publication and conditional cleanup', () => {
  assert.match(source, /import \{ randomBytes, randomUUID \} from 'node:crypto'/);
  assert.match(source, /randomUUID\(\)\.replaceAll\('-', ''\)/);
  assert.match(source, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.doesNotMatch(`${source}\n${lifecycleSource}`, /['"]-P['"]/);
  assert.match(lifecycleSource, /'-p', '127\.0\.0\.1::5432'/);
  assert.match(lifecycleSource, /'run', '--rm', '-d'/);
  assert.doesNotMatch(lifecycleSource, /['"](?:-v|--volume)['"]/);
  assert.doesNotMatch(lifecycleSource, /0\.0\.0\.0|\[::\]/);
  assert.match(source, /cleanupOwnedContainer\(\{ spawn: spawnSync, state: containerState/);
  assert.match(source, /waitForStablePostgres\(/);
  assert.doesNotMatch(source, /pg_isready/);
  assert.match(source, /'psql', '-X', '-v', 'ON_ERROR_STOP=1'/);
  assert.match(source, /'-tAc', 'SELECT 1'/);
  assert.match(source, /timeoutMs: 60_000/);
});

test('scalar helpers only receive valid SELECT subqueries', () => {
  assert.match(
    source,
    /const version = scalar\('horizonst', "SELECT current_setting\('server_version'\)"\);/,
  );
  assert.doesNotMatch(source, /\bscalar\(\s*[^,]+,\s*(['"`])\s*(?!SELECT\b)/i);
  assert.doesNotMatch(source, /\bscalar\([^,\n]+,\s*['"`]\s*SHOW\b/i);
});

test('temporary pg_isready success does not advance before the final server is SQL-stable', () => {
  let elapsed = 0;
  const legacyPgIsReady = () => elapsed < 10 || elapsed >= 30;
  const probeTimes = [];
  const probeResults = [false, true, true];
  const marker = 'PostgreSQL init process complete; ready for start up.';

  assert.equal(legacyPgIsReady(), true, 'the legacy check succeeds on the temporary server');
  waitForStablePostgres({
    readLogs: () => {
      if (elapsed < 10) return 'temporary server: database system is ready to accept connections';
      if (elapsed < 20) return 'temporary server: database system is shutting down';
      return `${marker}\nfinal server: database system is ready to accept connections`;
    },
    probeSql: () => {
      probeTimes.push(elapsed);
      return probeResults.shift();
    },
    timeoutMs: 100,
    pollIntervalMs: 10,
    stableProbeIntervalMs: 10,
    now: () => elapsed,
    sleep: (milliseconds) => { elapsed += milliseconds; }
  });

  assert.deepEqual(probeTimes, [20, 30, 40]);
  assert.equal(elapsed, 40);
});

test('stable-server wait has a bounded timeout and redacts technical logs', () => {
  let elapsed = 0;
  const secret = 'not-a-real-password';
  assert.throws(() => waitForStablePostgres({
    readLogs: () => `POSTGRES_PASSWORD=${secret} database system is shutting down`,
    probeSql: () => false,
    timeoutMs: 30,
    pollIntervalMs: 10,
    now: () => elapsed,
    sleep: (milliseconds) => { elapsed += milliseconds; },
    redactValues: [secret]
  }), (error) => {
    assert.match(error.message, /did not reach a stable final server within 30ms/);
    assert.match(error.message, /database system is shutting down/);
    assert.doesNotMatch(error.message, new RegExp(secret));
    return true;
  });
  assert.equal(elapsed, 30);
});

test('a simulated name collision never removes the pre-existing container', () => {
  const state = { name: 'already-owned', password: 'random-test-value', containerCreated: false };
  const cleanupCalls = [];
  assert.throws(() => startIsolatedPostgres({
    state,
    docker: (args) => {
      assert.equal(args[0], 'run');
      throw new Error('Conflict. The container name is already in use.');
    }
  }), /already in use/);
  cleanupOwnedContainer({ spawn: (...args) => cleanupCalls.push(args), state, cwd: 'fixture' });
  assert.equal(state.containerCreated, false);
  assert.deepEqual(cleanupCalls, []);
});

test('successful ownership uses one loopback binding and cleans only the exact generated name', () => {
  const state = { name: 'unique-container-name', password: 'random-test-value', containerCreated: false };
  const dockerCalls = [];
  const cleanupCalls = [];
  const port = startIsolatedPostgres({
    state,
    docker: (args) => {
      dockerCalls.push(args);
      return args[0] === 'port' ? '127.0.0.1:49152\n' : 'container-id\n';
    }
  });
  cleanupOwnedContainer({ spawn: (...args) => cleanupCalls.push(args), state, cwd: 'fixture' });
  assert.equal(port, 49152);
  assert.equal(state.containerCreated, true);
  assert.deepEqual(dockerCalls[0].slice(-3), ['-p', '127.0.0.1::5432', 'postgres:15-alpine']);
  assert.deepEqual(cleanupCalls, [[
    'docker', ['rm', '-f', 'unique-container-name'], { cwd: 'fixture', stdio: 'ignore' }
  ]]);
});

test('global, IPv6 and multiple bindings are rejected', () => {
  for (const binding of [
    '0.0.0.0:49152',
    '[::]:49152',
    '127.0.0.1:49152\n[::1]:49152',
    ''
  ]) assert.throws(() => parseLoopbackBinding(binding), /exactly one 127\.0\.0\.1 binding/);
});
