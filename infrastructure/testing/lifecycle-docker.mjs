import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { waitForStablePostgres } from '../production/tests/postgres-container-lifecycle.mjs';

// Explicit opt-in. No real hosts, credentials, volumes or published ports are accepted as arguments.
assert.ok(process.argv.includes('--run-disposable-docker'), 'Explicit disposable Docker opt-in required');
const root = path.resolve(import.meta.dirname, '../..');
const prefix = `horizonst-lifecycle-${randomUUID().replaceAll('-', '')}`;
const password = randomBytes(32).toString('hex');
const jwt = randomBytes(48).toString('hex');
const evidence = mkdtempSync(path.join(tmpdir(), 'horizonst-lifecycle-docker-'));
const owned = [], results = [];
const versions = { images: {} }, cleanup = [];
let network;
let dockerSequence = 0;
const redact = text => String(text).replaceAll(password, '[REDACTED]').replaceAll(jwt, '[REDACTED]');
function docker(args, options = {}) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...options });
  if (result.status !== 0) {
    writeFileSync(path.join(evidence, `docker-error-${++dockerSequence}.log`), redact((result.stdout || '') + (result.stderr || '')));
    throw new Error(`Disposable Docker operation ${args[0]} failed: ${redact(result.stderr || result.error?.code || 'nonzero_exit').slice(-3000)}`);
  }
  return result.stdout + (['build', 'logs'].includes(args[0]) ? result.stderr : '');
}
function start(name, args) {
  // Ownership is acquired only after successful creation; name collisions are never cleaned up.
  const id = docker(['run', '-d', '--name', name, ...args]).trim();
  assert.match(id, /^[0-9a-f]{64}$/);
  owned.push(id);
  return id;
}
const sql = (pg, db, query) => docker(['exec', '-i', pg, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
  '-U', 'fixture', '-d', db, '-f', '-'], { input: query });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (check()) return; await sleep(200); }
  throw new Error('Disposable scenario deadline exceeded');
}
const inspect = id => JSON.parse(docker(['inspect', '--format', '{{json .State}}', id]));
function status(id, port, route) {
  try {
    return Number(docker(['exec', id, 'node', '-e',
      `fetch('http://127.0.0.1:${port}${route}',{signal:AbortSignal.timeout(3000)}).then(r=>console.log(r.status)).catch(()=>process.exit(2))`]).trim());
  } catch { return 0; }
}
async function stop(id, service, scenario) {
  const started = Date.now();
  docker(['kill', '--signal=TERM', id]);
  try { docker(['kill', '--signal=TERM', id]); } catch {
    assert.equal(inspect(id).Running, false, 'Second signal may race with an already completed shutdown');
  }
  await until(() => !inspect(id).Running, 28_000);
  const state = inspect(id), elapsedMs = Date.now() - started;
  results.push({ service, scenario, elapsedMs, exitCode: state.ExitCode, oomKilled: state.OOMKilled });
  assert.ok(elapsedMs < 28_000, 'Shutdown must leave margin below 30 seconds');
  assert.equal(state.OOMKilled, false);
  assert.equal(state.ExitCode, 0, 'Normal test shutdown must be graceful, not a forced deadline exit');
}
const services = [
  { name: 'backend', db: 'backend', port: 3000, route: '/ready' },
  { name: 'horneo', db: 'horneo', port: 3100, route: '/ready' },
  { name: 'store', db: 'store', port: 4020, route: '/health' }
];
function args(service) {
  return ['--network', network, '-e', 'NODE_ENV=production', '-e', 'DB_HOST=pg', '-e', 'DB_USER=fixture',
    '-e', `DB_PASSWORD=${password}`, '-e', `DB_NAME=${service.db}`, '-e', `JWT_SECRET=${jwt}`,
    '-e', `STORE_JWT_SECRET=${jwt}`, '-e', 'MAIL_ENABLED=false', '-e', 'HARDWARE_MANAGER_ENABLED=false',
    '-e', 'MQTT_HOST=broker', '-e', 'MQTT_URL=mqtt://broker:1883', '-e', 'MQTT_USER=fixture',
    '-e', 'MQTT_PASS=fixture', '-e', 'MQTT_REQUIRED=true', '-e', `PORT=${service.port}`, `${prefix}-${service.name}`];
}

try {
  versions.docker = docker(['version', '--format', '{{.Server.Version}}']).trim();
  for (const target of [...services.map(s => s.name), 'broker']) {
    console.log(JSON.stringify({ phase: 'build', target, evidence }));
    const output = docker(['build', '-f', 'infrastructure/testing/lifecycle.Dockerfile', '--target', target,
      '-t', `${prefix}-${target}`, '.'], { timeout: 600_000 });
    writeFileSync(path.join(evidence, `build-${target}.log`), redact(output));
    versions.images[target] = docker(['image', 'inspect', '--format', '{{.Id}}', `${prefix}-${target}`]).trim();
  }
  network = docker(['network', 'create', '--internal', prefix]).trim();
  const pg = start(`${prefix}-pg`, ['--network', network, '--network-alias', 'pg',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=256m', '-e', 'POSTGRES_USER=fixture',
    // Keep fixture data through stop/start in this container's private writable layer, not a volume.
    '-e', 'PGDATA=/var/lib/postgresql/lifecycle-data',
    '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=backend', 'postgres:15-alpine']);
  waitForStablePostgres({ readLogs: () => docker(['logs', '--tail', '80', pg]),
    probeSql: () => { try { return sql(pg, 'backend', 'SELECT 1').includes('1'); } catch { return false; } },
    timeoutMs: 60_000, redactValues: [password, jwt] });
  versions.postgres = sql(pg, 'backend', "SELECT current_setting('server_version')");
  assert.match(versions.postgres, /15\./);
  sql(pg, 'backend', 'CREATE DATABASE horneo; CREATE DATABASE store;');
  sql(pg, 'backend', readFileSync(path.join(root, 'db/schema.sql'), 'utf8'));
  sql(pg, 'backend', readFileSync(path.join(root, 'db/mqtt.sql'), 'utf8'));
  start(`${prefix}-broker`, ['--network', network, '--network-alias', 'broker',
    '--tmpfs', '/mosquitto/data', '--tmpfs', '/mosquitto/log', `${prefix}-broker`]);
  const migration = start(`${prefix}-store-migration`, [...args(services[2]), 'node', 'dist/db/migrate.js']);
  await until(() => !inspect(migration).Running);
  assert.equal(inspect(migration).ExitCode, 0);
  for (const service of services) sql(pg, service.db, 'CREATE TABLE lifecycle_probe(operation_id text NOT NULL);');

  for (let round = 1; round <= 3; round++) {
    console.log(JSON.stringify({ phase: 'scenario', round, evidence }));
    const active = services.map(service => ({ ...service,
      id: start(`${prefix}-${service.name}-${round}`, args(service)) }));
    for (const service of active) {
      await until(() => status(service.id, service.port, service.route) === 200);
      versions[service.name] = docker(['exec', service.id, 'node', '--version']).trim();
      assert.equal(versions[service.name], 'v22.23.4');
      assert.match(docker(['inspect', '--format', '{{json .Config.Cmd}}', service.id]), /^\["node",/);
      const pid1 = JSON.parse(docker(['exec', service.id, 'node', '-e',
        "console.log(JSON.stringify(require('fs').readFileSync('/proc/1/cmdline','utf8').split('\\0').filter(Boolean)))"]));
      assert.equal(path.posix.basename(pid1[0]), 'node', 'Signal target must be Node, not an npm/shell wrapper');
      service.startedAt = inspect(service.id).StartedAt;
      if (round === 1 && service.name === 'backend') {
        const sse = docker(['exec', service.id, 'node', '--test', '--test-reporter=tap',
          '--test-name-pattern=^an accepted SSE', 'dist/__tests__/lifecycle.test.js']);
        writeFileSync(path.join(evidence, 'linux-sse.log'), redact(sse));
        assert.match(sse, /^# fail 0$/m);
        results.push({ service: 'backend', scenario: 'linux-sse-drain', passed: true });
      }
      if (round === 1) {
        // Negative control: original unhandled idle-pool pattern, using each service's real pg dependency.
        const baseline = `const fs=require('node:fs'),{Pool}=require('pg');let errorCode=null;
          process.on('uncaughtExceptionMonitor',error=>{errorCode=error.code||'uncaught';});
          process.on('exit',exitCode=>fs.writeFileSync('/tmp/lifecycle-baseline-exit.json',JSON.stringify({exitCode,errorCode})));
          const p=new Pool({host:'pg',user:'fixture',password:process.env.DB_PASSWORD,database:process.env.DB_NAME,idleTimeoutMillis:60000});
          p.query('SELECT 1').then(()=>{fs.writeFileSync('/tmp/lifecycle-baseline-ready.json','true');setInterval(()=>{},60000);});`;
        docker(['exec', '-d', service.id, 'node', '-e', baseline]);
        await until(() => docker(['exec', service.id, 'node', '-e',
          "console.log(require('fs').existsSync('/tmp/lifecycle-baseline-ready.json'))"]).trim() === 'true');
      }
      const op = `${round}-${service.name}`;
      const worker = `
        const fs=require('node:fs');
        (async()=>{const m=await import('./dist/db/pool.js');const p=m.pool||m.db||m.default?.pool;
          const c=await p.connect();let committed=false,errorSeen=false;
          try{await c.query('BEGIN');await c.query('INSERT INTO lifecycle_probe VALUES($1)',[${JSON.stringify(op)}]);
            fs.writeFileSync('/tmp/lifecycle-inflight.json','true');await c.query('SELECT pg_sleep(60)');
            await c.query('COMMIT');committed=true;
          }catch{errorSeen=true;await c.query('ROLLBACK').catch(()=>{});}
          finally{c.release();await p.end();fs.writeFileSync('/tmp/lifecycle-result.json',JSON.stringify({committed,errorSeen}));}
        })().catch(()=>process.exit(2));`;
      docker(['exec', '-d', service.id, 'node', '-e', worker]);
      await until(() => { try { return docker(['exec', service.id, 'node', '-e',
        "console.log(require('fs').existsSync('/tmp/lifecycle-inflight.json'))"]).trim() === 'true'; } catch { return false; } });
    }
    docker(['stop', '--time', '5', pg]);
    for (const service of active) {
      assert.equal(status(service.id, service.port, service.route), 503);
      if (round === 1) {
        await until(() => docker(['exec', service.id, 'node', '-e',
          "console.log(require('fs').existsSync('/tmp/lifecycle-baseline-exit.json'))"]).trim() === 'true');
        const baseline = JSON.parse(docker(['exec', service.id, 'node', '-e',
          "console.log(require('fs').readFileSync('/tmp/lifecycle-baseline-exit.json','utf8'))"]));
        assert.equal(baseline.exitCode, 1);
        assert.ok(baseline.errorCode);
        results.push({ service: service.name, scenario: 'unhandled-idle-pool-negative-control', ...baseline });
      }
    }
    docker(['start', pg]);
    for (const service of active) {
      await until(() => status(service.id, service.port, service.route) === 200);
      assert.equal(inspect(service.id).StartedAt, service.startedAt, 'Application must not restart');
      await until(() => { try { return docker(['exec', service.id, 'node', '-e',
        "console.log(require('fs').existsSync('/tmp/lifecycle-result.json'))"]).trim() === 'true'; } catch { return false; } }, 10_000);
      const result = docker(['exec', service.id, 'node', '-e', "console.log(require('fs').readFileSync('/tmp/lifecycle-result.json','utf8'))"]);
      assert.deepEqual(JSON.parse(result), { committed: false, errorSeen: true });
      assert.match(sql(pg, service.db, `SELECT count(*) FROM lifecycle_probe WHERE operation_id='${round}-${service.name}'`), /\b0\b/);
      await stop(service.id, service.name, `recovered-${round}`);
    }
    const outage = services.map(service => ({ ...service,
      id: start(`${prefix}-${service.name}-outage-${round}`, args(service)) }));
    for (const service of outage) await until(() => status(service.id, service.port, service.route) === 200);
    docker(['stop', '--time', '5', pg]);
    for (const service of outage) {
      assert.equal(status(service.id, service.port, service.route), 503);
      await stop(service.id, service.name, `database-down-${round}`);
    }
    docker(['start', pg]);
    await until(() => { try { sql(pg, 'backend', 'SELECT 1'); return true; } catch { return false; } });
  }
} catch (error) {
  results.push({ failed: true, error: redact(error.message) });
  process.exitCode = 1;
} finally {
  for (const id of owned.reverse()) {
    try { writeFileSync(path.join(evidence, `${id.slice(0, 12)}.log`), redact(docker(['logs', '--tail', '200', id]))); } catch { /* retain other evidence */ }
    try { docker(['rm', '-f', id]); cleanup.push({ container: id, removed: true }); }
    catch { process.exitCode = 1; cleanup.push({ container: id, removed: false }); }
  }
  if (network) {
    try { docker(['network', 'rm', network]); cleanup.push({ network, removed: true }); }
    catch { process.exitCode = 1; cleanup.push({ network, removed: false }); }
  }
  writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ runId: prefix, versions, results, cleanup, evidence, validated: process.exitCode !== 1 }, null, 2));
  console.log(JSON.stringify({ evidence, results }));
}
