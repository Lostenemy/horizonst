'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { environment } = require('./run-suites.cjs');
const { failures } = require('./inventory.cjs');

test('inventory distinguishes missing resources, module-load wrappers and timing assertions', () => {
  const fixture = [
    "# Subtest: contract", "not ok 1 - contract", "  error: \"ENOENT: open '/app/src/example.ts'\"", "  code: 'ENOENT'",
    "# Error: Cannot find module 'typescript'", "# Subtest: /app/dist/module.test.js", "not ok 2 - /app/dist/module.test.js",
    "  error: 'test failed'", "  code: 'ERR_TEST_FAILURE'",
    "# Subtest: a delayed valid response completes", "not ok 3 - a delayed valid response completes",
    "  code: 'ERR_ASSERTION'", "1..3"
  ].join('\n');
  const parsed = failures(fixture, 'fixture');
  assert.deepEqual(parsed.map(item => item.category), [
    'missing_resource', 'missing_resource_at_module_load', 'timing_unproven_root_cause'
  ]);
  assert.equal(parsed[1].resource, 'typescript');
  assert.deepEqual(failures(fixture, 'fixture').map(i => i.id), parsed.map(i => i.id));
});

test('test environment is ephemeral, explicit and excludes inherited secrets and opt-in integrations', () => {
  const previous = process.env.UNRELATED_PROVIDER_SECRET;
  process.env.UNRELATED_PROVIDER_SECRET = 'fictional-do-not-inherit';
  try {
    const a = environment(), b = environment();
    assert.equal(a.UNRELATED_PROVIDER_SECRET, undefined);
    assert.equal(a.NODE_OPTIONS, undefined);
    assert.equal(a.NODE_ENV, 'test');
    assert.ok(a.JWT_SECRET.length >= 32);
    assert.notEqual(a.JWT_SECRET, b.JWT_SECRET);
    assert.notEqual(a.DB_PASSWORD, b.DB_PASSWORD);
    assert.equal(a.CONTROLLED_B5_ALLOW_DATABASE_TESTS, undefined);
    assert.equal(a.MQTT_REQUIRED, 'false');
  } finally {
    if (previous === undefined) delete process.env.UNRELATED_PROVIDER_SECRET;
    else process.env.UNRELATED_PROVIDER_SECRET = previous;
  }
});

test('preload prevents dotenv reads and rejects unmocked PostgreSQL/MQTT/SMTP/provider sockets', () => {
  const child = spawnSync(process.execPath, ['--require', path.join(__dirname, 'offline-preload.cjs'), '-e', `
    const assert=require('node:assert/strict'),fs=require('node:fs'),net=require('node:net');
    const read=fs.readFileSync;
    fs.readFileSync=function(file,...args){if(String(file).includes('.env'))throw Error('ENV_FILE_READ');return read.call(this,file,...args)};
    assert.deepEqual(require('dotenv').config({path:'production.env'}),{parsed:{}});
    for(const port of [5432,1883,8883,587,443])
      assert.throws(()=>new net.Socket().connect({host:'127.0.0.1',port}),/OFFLINE_TEST_NETWORK_DENIED/);
    assert.throws(()=>new net.Socket().connect({host:'example.invalid',port:443}),/OFFLINE_TEST_NETWORK_DENIED/);
  `], { env: environment(), encoding: 'utf8', timeout: 10_000 });
  assert.equal(child.status, 1, child.stderr);
  assert.match(child.stderr, /OFFLINE_TEST_NETWORK_DENIED/);
});

test('dedicated image keeps Node pinned, dev dependencies and allowlisted resources without modifying runtime', () => {
  const docker = fs.readFileSync(path.join(__dirname, 'Dockerfile'), 'utf8');
  assert.match(docker, /FROM node:22\.23\.4-alpine/);
  assert.match(docker, /npm ci/);
  assert.doesNotMatch(docker, /--omit=dev|COPY \. \./);
  const ignore = fs.readFileSync(path.join(__dirname, 'Dockerfile.dockerignore'), 'utf8');
  assert.match(ignore, /^\*\*/);
  assert.match(ignore, /\*\*\/\.env\*/);
  assert.match(ignore, /\*\*\/node_modules/);
  for (const service of ['backend', 'cold-compliance-service']) {
    const runner = fs.readFileSync(path.join(__dirname, '../..', service, 'test/run-tests.cjs'), 'utf8');
    assert.match(runner, /env: environment\(\)/);
    assert.match(runner, /--require/);
    assert.match(runner, /offline-preload\.cjs/);
    assert.doesNotMatch(runner, /\.\.\.process\.env/);
  }
});
