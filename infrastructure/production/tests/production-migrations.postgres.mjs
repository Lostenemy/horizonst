import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { cleanupOwnedContainer, startIsolatedPostgres } from './postgres-container-lifecycle.mjs';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const base = '9f5754d378491772b2730a9adc1fe88edc86dd31';
const name = `horizonst-production-parity-${randomUUID().replaceAll('-', '')}`;
const password = randomBytes(32).toString('base64url');
const containerState = { name, password, containerCreated: false };

const docker = (args, options = {}) => execFileSync('docker', args, {
  cwd: root, encoding: 'utf8', stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'], ...options
});
const gitShow = (file) => execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' });
const sqlFile = (file) => readFileSync(path.join(root, file), 'utf8');
const psql = (database, sql) => {
  const result = spawnSync('docker', ['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'fixture', '-d', database, '-f', '-'], {
    cwd: root, input: sql, encoding: 'utf8'
  });
  assert.equal(result.status, 0, `psql ${database} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
const scalar = (database, query) => psql(database, `COPY (${query}) TO STDOUT;`).trim();
const runNode = (cwd, code, database) => {
  const result = spawnSync(process.execPath, ['-e', code], {
    cwd, encoding: 'utf8', env: {
      ...process.env, DB_HOST: '127.0.0.1', DB_PORT: String(hostPort), DB_USER: 'fixture',
      DB_PASSWORD: password, DB_NAME: database, NODE_ENV: 'test'
    }
  });
  assert.equal(result.status, 0, `node runner failed in ${cwd}:\n${result.stdout}\n${result.stderr}`);
};

let hostPort;
try {
  assert.equal(execFileSync('git', ['rev-parse', `${base}^{commit}`], { cwd: root, encoding: 'utf8' }).trim(), base);
  hostPort = startIsolatedPostgres({ docker, state: containerState });
  for (let i = 0; i < 60; i += 1) {
    const ready = spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'fixture', '-d', 'horizonst']);
    if (ready.status === 0) break;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    if (i === 59) throw new Error('isolated PostgreSQL 15 did not become ready');
  }
  const version = scalar('horizonst', 'SHOW server_version');
  assert.match(version, /^15\./);

  // Backend: esquema y filas representativas exactos de la base productiva.
  psql('horizonst', gitShow('db/schema.sql'));
  psql('horizonst', gitShow('db/mqtt.sql'));
  psql('horizonst', `
    INSERT INTO users(id,email,password_hash,password_salt,role) VALUES(1,'fixture@example.invalid','x','x','ADMIN');
    INSERT INTO gateways(id,name,mac_address,active) VALUES(1,'production-gateway','142b2fe271b4',true);
    INSERT INTO devices(id,name,ble_mac,last_gateway_id,active) VALUES(1,'production-b5','fd9d4f8ae226',1,true);
    INSERT INTO device_records(device_id,gateway_id,rssi,raw_payload) VALUES(1,1,-55,'historical');
    INSERT INTO mqtt_messages(topic,payload,gateway_mac) VALUES('devices/MK4','{}','142b2fe271b4');
    INSERT INTO vmq_auth_acl(mountpoint,client_id,username,password,publish_acl,subscribe_acl) VALUES
      ('','cold-compliance-service-production','horizonst-production-app','fixture-hash','[{"pattern":"gw/+/subscribe"}]','[{"pattern":"gw/+/publish"}]'),
      ('','gateway-1','gateway-user','fixture-hash','[{"pattern":"gw/142b2fe271b4/publish"}]','[{"pattern":"gw/142b2fe271b4/subscribe"}]'),
      ('','mqttx-admin','admin','fixture-hash','[]','[]');
  `);
  const backendBefore = scalar('horizonst', `SELECT concat_ws(',',
    (SELECT count(*) FROM gateways),(SELECT count(*) FROM devices),(SELECT count(*) FROM device_records),
    (SELECT count(*) FROM mqtt_messages),(SELECT count(*) FROM vmq_auth_acl))`);
  const backendRunner = [
    "const { runMigrations } = require('./dist/db/migrations.js');",
    "const { pool } = require('./dist/db/pool.js');",
    "runMigrations().then(() => pool.end()).catch(async e => { console.error(e); await pool.end(); process.exit(1); });"
  ].join('');
  runNode(path.join(root, 'backend'), backendRunner, 'horizonst');
  assert.equal(scalar('horizonst', 'SELECT count(*) FROM app_schema_migrations'), '11');
  assert.equal(scalar('horizonst', `SELECT concat_ws(',',
    (SELECT count(*) FROM gateways),(SELECT count(*) FROM devices),(SELECT count(*) FROM device_records),
    (SELECT count(*) FROM mqtt_messages),(SELECT count(*) FROM vmq_auth_acl))`), backendBefore);
  assert.equal(scalar('horizonst', `SELECT count(*) FROM pg_indexes WHERE indexname='vmq_auth_acl_mount_client_unique'`), '1');
  runNode(path.join(root, 'backend'), backendRunner, 'horizonst');
  assert.equal(scalar('horizonst', 'SELECT count(*) FROM app_schema_migrations'), '11');
  psql('horizonst', `UPDATE gateways SET company_id=(SELECT id FROM companies WHERE code='horneo') WHERE id=1;
    UPDATE devices SET company_id=(SELECT id FROM companies WHERE code='horneo'), device_type='b5', status='active' WHERE id=1;`);

  // Horneo: producción tiene 001-011 aplicadas y datos históricos, no un esquema vacío.
  psql('horizonst', 'CREATE DATABASE cold_compliance');
  psql('cold_compliance', `CREATE TABLE cold_compliance_migrations (
    id SERIAL PRIMARY KEY, filename TEXT UNIQUE NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  const coldBase = readdirSync(path.join(root, 'cold-compliance-service', 'migrations'))
    .filter((file) => /^(00[1-9]|01[01])_.*\.sql$/.test(file)).sort();
  for (const file of coldBase) {
    psql('cold_compliance', `BEGIN;\n${gitShow(`cold-compliance-service/migrations/${file}`)}\nINSERT INTO cold_compliance_migrations(filename) VALUES('${file}');\nCOMMIT;`);
  }
  psql('cold_compliance', `
    INSERT INTO plants(id,code,name) VALUES('10000000-0000-4000-8000-000000000001','plant','Plant');
    INSERT INTO workers(id,dni,full_name,plant_id) VALUES('10000000-0000-4000-8000-000000000002','fixture','Worker','10000000-0000-4000-8000-000000000001');
    INSERT INTO tags(id,tag_uid,model) VALUES('10000000-0000-4000-8000-000000000003','fd9d4f8ae226','B5');
    INSERT INTO cold_rooms(id,plant_id,code,name) VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','cold','Cold');
    INSERT INTO gateways(id,gateway_mac,plant_id) VALUES('10000000-0000-4000-8000-000000000005','142b2fe271b4','10000000-0000-4000-8000-000000000001');
    INSERT INTO worker_tag_assignments(id,worker_id,tag_id,assigned_at,active) VALUES('10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',NOW()-interval '2 days',true);
    INSERT INTO presence_events(event_id,gateway_mac,tag_uid,event_type,event_ts,rssi,payload) VALUES('historical-event','142b2fe271b4','fd9d4f8ae226','enter',NOW()-interval '1 hour',-55,'{}');
    INSERT INTO cold_room_sessions(id,worker_id,tag_id,cold_room_id,started_at,source_event_id) VALUES('10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004',NOW()-interval '1 hour','historical-session');
    INSERT INTO alerts(id,worker_id,tag_id,cold_room_id,severity,alert_type,message) VALUES('10000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','high','fixture','historical');
    INSERT INTO incidents(id,worker_id,tag_id,cold_room_id,incident_type,reason) VALUES('10000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004','fixture','historical');
    INSERT INTO ble_alarm_sessions(tag_id,tag_uid,gateway_mac) VALUES('10000000-0000-4000-8000-000000000003','fd9d4f8ae226','142b2fe271b4');
    INSERT INTO presence_operational_state(tag_id,worker_id,cold_room_id,inside) VALUES('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004',true);
  `);
  const coldBefore = scalar('cold_compliance', `SELECT concat_ws(',',
    (SELECT count(*) FROM tags),(SELECT count(*) FROM gateways),(SELECT count(*) FROM worker_tag_assignments),
    (SELECT count(*) FROM cold_room_sessions),(SELECT count(*) FROM alerts),(SELECT count(*) FROM incidents),
    (SELECT count(*) FROM ble_alarm_sessions),(SELECT count(*) FROM presence_operational_state))`);
  const coldPreparatory = readdirSync(path.join(root, 'cold-compliance-service', 'migrations'))
    .filter((file) => /^01[2-6]_.*\.sql$/.test(file)).sort();
  for (const file of coldPreparatory) {
    psql('cold_compliance', `BEGIN;\n${sqlFile(`cold-compliance-service/migrations/${file}`)}\nINSERT INTO cold_compliance_migrations(filename) VALUES('${file}');\nCOMMIT;`);
  }
  psql('cold_compliance', `UPDATE tags SET hardware_device_id=1 WHERE tag_uid='fd9d4f8ae226';
    UPDATE gateways SET hardware_gateway_id=1 WHERE gateway_mac='142b2fe271b4';`);
  const coldRunner = [
    "const { runMigrations } = require('./dist/db/migrate.js');",
    "const { db } = require('./dist/db/pool.js');",
    "runMigrations().then(() => db.end()).catch(async e => { console.error(e); await db.end(); process.exit(1); });"
  ].join('');
  runNode(path.join(root, 'cold-compliance-service'), coldRunner, 'cold_compliance');
  assert.equal(scalar('cold_compliance', 'SELECT count(*) FROM cold_compliance_migrations'), '21');
  assert.equal(scalar('cold_compliance', `SELECT concat_ws(',',
    (SELECT count(*) FROM tags),(SELECT count(*) FROM gateways),(SELECT count(*) FROM worker_tag_assignments),
    (SELECT count(*) FROM cold_room_sessions),(SELECT count(*) FROM alerts),(SELECT count(*) FROM incidents),
    (SELECT count(*) FROM ble_alarm_sessions),(SELECT count(*) FROM presence_operational_state))`), coldBefore);
  assert.equal(scalar('cold_compliance', `SELECT count(*) FROM pg_constraint WHERE conname IN
    ('presence_operational_state_tag_id_fkey','ble_alarm_sessions_tag_id_fkey') AND confdeltype='r'`), '2');
  assert.equal(scalar('cold_compliance', `SELECT count(*) FROM tags WHERE hardware_device_id IS NULL`) ,'0');
  assert.equal(scalar('cold_compliance', `SELECT count(*) FROM gateways WHERE hardware_gateway_id IS NULL`) ,'0');
  runNode(path.join(root, 'cold-compliance-service'), coldRunner, 'cold_compliance');
  assert.equal(scalar('cold_compliance', 'SELECT count(*) FROM cold_compliance_migrations'), '21');

  // Store: reproduce 001-010 registered and apply only the isolated security migration 016.
  for (const file of readdirSync(path.join(root, 'horizonst-store', 'migrations')).filter((f) => /^0(?:0[1-9]|10)_.*\.sql$/.test(f)).sort()) {
    psql('horizonst', `BEGIN;\n${gitShow(`horizonst-store/migrations/${file}`)}\nCOMMIT;`);
  }
  psql('horizonst', `CREATE TABLE IF NOT EXISTS store.schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    ${readdirSync(path.join(root, 'horizonst-store', 'migrations')).filter((f) => /^0(?:0[1-9]|10)_.*\.sql$/.test(f)).sort()
      .map((file) => `INSERT INTO store.schema_migrations(filename) VALUES('${file}') ON CONFLICT DO NOTHING;`).join('\n')}`);
  const storeRunner = "import('./dist/db/migrate-security.js').then(async m => { await m.runSecurityMigration(); const p=await import('./dist/db/pool.js'); await p.closePool(); }).catch(e => { console.error(e); process.exit(1); });";
  runNode(path.join(root, 'horizonst-store'), storeRunner, 'horizonst');
  assert.equal(scalar('horizonst', `SELECT count(*) FROM store.schema_migrations WHERE filename ~ '^01[1-5]_'`), '0');
  assert.equal(scalar('horizonst', `SELECT count(*) FROM store.security_migrations WHERE filename='016_auth_rate_limits.sql'`), '1');
  runNode(path.join(root, 'horizonst-store'), storeRunner, 'horizonst');
  assert.equal(scalar('horizonst', `SELECT count(*) FROM store.security_migrations`), '1');

  console.log('PostgreSQL 15 production-like migration checks: 24 assertions passed');
} finally {
  cleanupOwnedContainer({ spawn: spawnSync, state: containerState, cwd: root });
}
