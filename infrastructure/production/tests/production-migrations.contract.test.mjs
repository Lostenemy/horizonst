import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import {
  cleanupOwnedContainer,
  parseLoopbackBinding,
  startIsolatedPostgres
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
