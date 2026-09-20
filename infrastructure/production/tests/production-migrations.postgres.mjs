import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  cleanupOwnedContainer,
  cleanupOwnedEmptyDirectory,
  redactSensitiveText,
  startIsolatedPostgres,
  waitForStablePostgres
} from './postgres-container-lifecycle.mjs';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const base = '9f5754d378491772b2730a9adc1fe88edc86dd31';
const name = `horizonst-production-parity-${randomUUID().replaceAll('-', '')}`;
const password = randomBytes(32).toString('base64url');
const backendJwtSecret = randomBytes(48).toString('base64url');
const storeJwtSecret = randomBytes(48).toString('base64url');
const containerState = { name, password, containerCreated: false };
const runnerCwd = mkdtempSync(path.join(tmpdir(), 'horizonst-production-parity-runners-'));

const docker = (args, options = {}) => execFileSync('docker', args, {
  cwd: root, encoding: 'utf8', stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'], ...options
});
const gitShow = (file) => execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' });
const sqlFile = (file) => readFileSync(path.join(root, file), 'utf8');
const runPsql = (database, sql) => spawnSync(
  'docker',
  ['exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'fixture', '-d', database, '-f', '-'],
  {
    cwd: root, input: sql, encoding: 'utf8'
  }
);
const psql = (database, sql) => {
  const result = runPsql(database, sql);
  assert.equal(result.status, 0, `psql ${database} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
const scalar = (database, query) => psql(database, `COPY (${query}) TO STDOUT;`).trim();
const runNode = ({ serviceName, code, database, extraEnv = {} }) => {
  const runnerEnv = {
    NODE_ENV: 'test',
    DB_HOST: '127.0.0.1',
    DB_PORT: String(hostPort),
    DB_USER: 'fixture',
    DB_PASSWORD: password,
    DB_NAME: database,
    ...extraEnv
  };
  const result = spawnSync(process.execPath, ['-e', code], {
    cwd: runnerCwd, encoding: 'utf8', env: runnerEnv
  });
  if (result.status !== 0) {
    const output = redactSensitiveText(
      `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
      [password, backendJwtSecret, storeJwtSecret]
    );
    throw new Error(`node migration runner failed for ${serviceName}:\n${output}`);
  }
};

let hostPort;
try {
  assert.equal(execFileSync('git', ['rev-parse', `${base}^{commit}`], { cwd: root, encoding: 'utf8' }).trim(), base);
  hostPort = startIsolatedPostgres({ docker, state: containerState });
  waitForStablePostgres({
    readLogs: () => {
      const result = spawnSync('docker', ['logs', '--tail', '80', name], {
        cwd: root, encoding: 'utf8', timeout: 2000
      });
      return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    },
    probeSql: () => {
      const result = spawnSync('docker', [
        'exec', '-i', name, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
        '-U', 'fixture', '-d', 'horizonst', '-tAc', 'SELECT 1'
      ], { cwd: root, encoding: 'utf8', timeout: 2000 });
      return result.status === 0 && result.stdout.trim() === '1';
    },
    timeoutMs: 60_000,
    redactValues: [password]
  });
  const version = scalar('horizonst', "SELECT current_setting('server_version')");
  assert.match(version, /^15\./);

  // Backend: esquema y filas representativas exactos de la base productiva.
  psql('horizonst', gitShow('db/schema.sql'));
  psql('horizonst', gitShow('db/mqtt.sql'));
  psql('horizonst', `
    INSERT INTO users(id,email,password_hash,password_salt,role) VALUES(1,'fixture@example.invalid','x','x','ADMIN');
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
    `const { runMigrations } = require(${JSON.stringify(path.join(root, 'backend', 'dist', 'db', 'migrations.js'))});`,
    `const { pool } = require(${JSON.stringify(path.join(root, 'backend', 'dist', 'db', 'pool.js'))});`,
    "runMigrations().then(() => pool.end()).catch(async e => { console.error(e); await pool.end(); process.exit(1); });"
  ].join('');
  runNode({
    serviceName: 'backend',
    code: backendRunner,
    database: 'horizonst',
    extraEnv: { JWT_SECRET: backendJwtSecret, MAIL_ENABLED: 'false' }
  });
  assert.equal(scalar('horizonst', 'SELECT count(*) FROM app_schema_migrations'), '11');
  assert.equal(scalar('horizonst', `SELECT concat_ws(',',
    (SELECT count(*) FROM gateways),(SELECT count(*) FROM devices),(SELECT count(*) FROM device_records),
    (SELECT count(*) FROM mqtt_messages),(SELECT count(*) FROM vmq_auth_acl))`), backendBefore);
  assert.equal(scalar('horizonst', `SELECT count(*) FROM pg_indexes WHERE indexname='vmq_auth_acl_mount_client_unique'`), '1');
  runNode({
    serviceName: 'backend',
    code: backendRunner,
    database: 'horizonst',
    extraEnv: { JWT_SECRET: backendJwtSecret, MAIL_ENABLED: 'false' }
  });
  assert.equal(scalar('horizonst', 'SELECT count(*) FROM app_schema_migrations'), '11');
  assert.equal(scalar('horizonst', 'SELECT count(*) FROM gateways'), '0');
  assert.equal(scalar('horizonst', 'SELECT count(*) FROM devices'), '0');

  // Horneo: producción tiene 001-011 aplicadas y datos históricos, no un esquema vacío.
  psql('horizonst', 'CREATE DATABASE cold_compliance');
  psql('cold_compliance', `CREATE TABLE cold_compliance_migrations (
    id SERIAL PRIMARY KEY, filename TEXT UNIQUE NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
  const coldBase = readdirSync(path.join(root, 'cold-compliance-service', 'migrations'))
    .filter((file) => /^(00[1-9]|01[01])_.*\.sql$/.test(file)).sort();
  for (const file of coldBase) {
    psql('cold_compliance', `BEGIN;\n${gitShow(`cold-compliance-service/migrations/${file}`)}\nINSERT INTO cold_compliance_migrations(filename) VALUES('${file}');\nCOMMIT;`);
  }
  const gatewayFixtures = Array.from({ length: 5 }, (_, index) => {
    const ordinal = String(index + 1).padStart(12, '0');
    const normalizedMac = `aa000000${(index + 1).toString(16).padStart(4, '0')}`;
    return {
      id: `20000000-0000-4000-8000-${ordinal}`,
      normalizedMac,
      sourceMac: normalizedMac.match(/../g).join(':')
    };
  });
  const tagFixtures = Array.from({ length: 13 }, (_, index) => {
    const ordinal = String(index + 1).padStart(12, '0');
    const normalizedMac = `bb000000${(index + 1).toString(16).padStart(4, '0')}`;
    return {
      id: `30000000-0000-4000-8000-${ordinal}`,
      normalizedMac,
      sourceMac: normalizedMac.match(/../g).join('-'),
      active: index !== 12
    };
  });
  const gatewayValues = gatewayFixtures.map((fixture) =>
    `('${fixture.id}','${fixture.sourceMac}','10000000-0000-4000-8000-000000000001')`
  ).join(',\n');
  const tagValues = tagFixtures.map((fixture) =>
    `('${fixture.id}','${fixture.sourceMac}','B5',${fixture.active})`
  ).join(',\n');
  const primaryGateway = gatewayFixtures[0];
  const primaryTag = tagFixtures[0];

  psql('cold_compliance', `
    INSERT INTO plants(id,code,name) VALUES('10000000-0000-4000-8000-000000000001','plant','Plant');
    INSERT INTO workers(id,dni,full_name,plant_id) VALUES('10000000-0000-4000-8000-000000000002','fixture','Worker','10000000-0000-4000-8000-000000000001');
    INSERT INTO tags(id,tag_uid,model,active) VALUES ${tagValues};
    INSERT INTO cold_rooms(id,plant_id,code,name) VALUES('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','cold','Cold');
    INSERT INTO gateways(id,gateway_mac,plant_id) VALUES ${gatewayValues};
    INSERT INTO worker_tag_assignments(id,worker_id,tag_id,assigned_at,active) VALUES('10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000002','${primaryTag.id}',NOW()-interval '2 days',true);
    INSERT INTO presence_events(event_id,gateway_mac,tag_uid,event_type,event_ts,rssi,payload) VALUES('historical-event','${primaryGateway.normalizedMac}','${primaryTag.normalizedMac}','enter',NOW()-interval '1 hour',-55,'{}');
    INSERT INTO cold_room_sessions(id,worker_id,tag_id,cold_room_id,started_at,source_event_id) VALUES('10000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000002','${primaryTag.id}','10000000-0000-4000-8000-000000000004',NOW()-interval '1 hour','historical-session');
    INSERT INTO alerts(id,worker_id,tag_id,cold_room_id,severity,alert_type,message) VALUES('10000000-0000-4000-8000-000000000008','10000000-0000-4000-8000-000000000002','${primaryTag.id}','10000000-0000-4000-8000-000000000004','high','fixture','historical');
    INSERT INTO incidents(id,worker_id,tag_id,cold_room_id,incident_type,reason) VALUES('10000000-0000-4000-8000-000000000009','10000000-0000-4000-8000-000000000002','${primaryTag.id}','10000000-0000-4000-8000-000000000004','fixture','historical');
    INSERT INTO ble_alarm_sessions(tag_id,tag_uid,gateway_mac) VALUES('${primaryTag.id}','${primaryTag.normalizedMac}','${primaryGateway.normalizedMac}');
    INSERT INTO presence_operational_state(tag_id,worker_id,cold_room_id,inside) VALUES('${primaryTag.id}','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004',true);
  `);
  psql('cold_compliance', sqlFile('infrastructure/production/sql/horneo-inventory-preflight.sql'));
  assert.equal(scalar('cold_compliance', 'SELECT count(*) FROM gateways'), '5');
  assert.equal(scalar('cold_compliance', 'SELECT count(*) FROM tags'), '13');

  const inventoryRows = [
    ...gatewayFixtures.map((fixture) =>
      `('gateway'::text,'${fixture.id}'::uuid,'${fixture.normalizedMac}'::text,NULL::boolean)`
    ),
    ...tagFixtures.map((fixture) =>
      `('tag'::text,'${fixture.id}'::uuid,'${fixture.normalizedMac}'::text,${fixture.active}::boolean)`
    )
  ];
  const centralBootstrapSql = sqlFile('infrastructure/production/sql/central-inventory-bootstrap.sql');
  const runCentralBootstrap = (rows = inventoryRows) => runPsql('horizonst', `
    BEGIN ISOLATION LEVEL SERIALIZABLE;
    SELECT pg_advisory_xact_lock(hashtext('horizonst.production.inventory_bootstrap'));
    CREATE TEMP TABLE bootstrap_horneo_inventory(
      kind TEXT NOT NULL, overlay_id UUID NOT NULL, normalized_mac TEXT NOT NULL, source_active BOOLEAN
    );
    INSERT INTO bootstrap_horneo_inventory(kind, overlay_id, normalized_mac, source_active)
    VALUES ${rows.join(',\n')};
    ${centralBootstrapSql}
    COMMIT;
  `);
  let bootstrapResult = runCentralBootstrap();
  assert.equal(bootstrapResult.status, 0, `central bootstrap failed:\n${bootstrapResult.stdout}\n${bootstrapResult.stderr}`);
  assert.equal(scalar('horizonst', 'SELECT count(*) FROM gateways'), '5');
  assert.equal(scalar('horizonst', 'SELECT count(*) FROM devices'), '13');
  assert.equal(scalar('horizonst', "SELECT count(*) FROM devices WHERE device_type='tag' AND owner_id IS NULL AND category_id IS NULL"), '13');
  assert.equal(scalar('horizonst', "SELECT count(*) FROM devices WHERE active=false AND status='inactive'"), '1');

  bootstrapResult = runCentralBootstrap();
  assert.equal(bootstrapResult.status, 0, `idempotent central bootstrap failed:\n${bootstrapResult.stdout}\n${bootstrapResult.stderr}`);
  assert.equal(scalar('horizonst', "SELECT concat_ws(',', (SELECT count(*) FROM gateways), (SELECT count(*) FROM devices))"), '5,13');

  const conflictingTag = tagFixtures[12];
  const conflictResult = runCentralBootstrap([
    `('tag'::text,'${conflictingTag.id}'::uuid,'${conflictingTag.normalizedMac}'::text,true::boolean)`
  ]);
  assert.notEqual(conflictResult.status, 0, 'a contradictory existing tag state must abort');
  assert.equal(scalar('horizonst', "SELECT concat_ws(',', (SELECT count(*) FROM gateways), (SELECT count(*) FROM devices))"), '5,13');

  const mappingSource = inventoryRows.join(',\n');
  const mappingTsv = scalar('horizonst', `WITH source(kind, overlay_id, normalized_mac, source_active) AS (
      VALUES ${mappingSource}
    )
    SELECT source.kind, source.overlay_id,
           CASE WHEN source.kind='gateway' THEN gateway.id ELSE device.id END,
           source.normalized_mac, source.source_active
    FROM source
    LEFT JOIN gateways gateway ON source.kind='gateway' AND gateway.mac_address=source.normalized_mac
    LEFT JOIN devices device ON source.kind='tag' AND device.ble_mac=source.normalized_mac
    ORDER BY source.kind, source.overlay_id`);
  const mappingValues = mappingTsv.split(/\r?\n/).filter(Boolean).map((line) => {
    const [kind, overlayId, centralId, normalizedMac, sourceActive] = line.split('\t');
    assert.match(kind, /^(gateway|tag)$/);
    assert.match(overlayId, /^[0-9a-f-]{36}$/);
    assert.match(centralId, /^\d+$/);
    assert.match(normalizedMac, /^[0-9a-f]{12}$/);
    assert.match(sourceActive, /^(t|f|\\N)$/);
    const activeSql = sourceActive === '\\N' ? 'NULL' : sourceActive === 't' ? 'true' : 'false';
    return `('${kind}','${overlayId}',${centralId},'${normalizedMac}',${activeSql})`;
  });
  assert.equal(mappingValues.length, 18);

  const coldBefore = scalar('cold_compliance', `SELECT concat_ws(',',
    (SELECT count(*) FROM tags),(SELECT count(*) FROM gateways),(SELECT count(*) FROM worker_tag_assignments),
    (SELECT count(*) FROM cold_room_sessions),(SELECT count(*) FROM alerts),(SELECT count(*) FROM incidents),
    (SELECT count(*) FROM ble_alarm_sessions),(SELECT count(*) FROM presence_operational_state))`);
  const coldPreparatory = readdirSync(path.join(root, 'cold-compliance-service', 'migrations'))
    .filter((file) => /^01[2-6]_.*\.sql$/.test(file)).sort();
  for (const file of coldPreparatory) {
    psql('cold_compliance', `BEGIN;\n${sqlFile(`cold-compliance-service/migrations/${file}`)}\nINSERT INTO cold_compliance_migrations(filename) VALUES('${file}');\nCOMMIT;`);
  }
  const horneoReconcileSql = sqlFile('infrastructure/production/sql/horneo-inventory-reconcile.sql');
  const runHorneoReconcile = () => runPsql('cold_compliance', `
    BEGIN ISOLATION LEVEL SERIALIZABLE;
    SELECT pg_advisory_xact_lock(hashtext('horizonst.production.inventory_reconcile'));
    CREATE TEMP TABLE bootstrap_central_mapping(
      kind TEXT NOT NULL, overlay_id UUID NOT NULL, central_id INTEGER NOT NULL,
      normalized_mac TEXT NOT NULL, source_active BOOLEAN
    );
    INSERT INTO bootstrap_central_mapping(kind, overlay_id, central_id, normalized_mac, source_active)
    VALUES ${mappingValues.join(',\n')};
    ${horneoReconcileSql}
    COMMIT;
  `);
  let reconcileResult = runHorneoReconcile();
  assert.equal(reconcileResult.status, 0, `Horneo reconciliation failed:\n${reconcileResult.stdout}\n${reconcileResult.stderr}`);
  const reconciledIds = scalar('cold_compliance', `SELECT concat_ws(',',
    (SELECT count(*) FROM gateways WHERE hardware_gateway_id IS NOT NULL),
    (SELECT count(*) FROM tags WHERE hardware_device_id IS NOT NULL))`);
  assert.equal(reconciledIds, '5,13');
  reconcileResult = runHorneoReconcile();
  assert.equal(reconcileResult.status, 0, `idempotent Horneo reconciliation failed:\n${reconcileResult.stdout}\n${reconcileResult.stderr}`);
  assert.equal(scalar('cold_compliance', `SELECT concat_ws(',',
    (SELECT count(DISTINCT hardware_gateway_id) FROM gateways),
    (SELECT count(DISTINCT hardware_device_id) FROM tags))`), '5,13');
  const coldRunner = [
    `const { runMigrations } = require(${JSON.stringify(path.join(root, 'cold-compliance-service', 'dist', 'db', 'migrate.js'))});`,
    `const { db } = require(${JSON.stringify(path.join(root, 'cold-compliance-service', 'dist', 'db', 'pool.js'))});`,
    "runMigrations().then(() => db.end()).catch(async e => { console.error(e); await db.end(); process.exit(1); });"
  ].join('');
  runNode({ serviceName: 'cold-compliance-service', code: coldRunner, database: 'cold_compliance' });
  assert.equal(scalar('cold_compliance', 'SELECT count(*) FROM cold_compliance_migrations'), '21');
  assert.equal(scalar('cold_compliance', `SELECT concat_ws(',',
    (SELECT count(*) FROM tags),(SELECT count(*) FROM gateways),(SELECT count(*) FROM worker_tag_assignments),
    (SELECT count(*) FROM cold_room_sessions),(SELECT count(*) FROM alerts),(SELECT count(*) FROM incidents),
    (SELECT count(*) FROM ble_alarm_sessions),(SELECT count(*) FROM presence_operational_state))`), coldBefore);
  assert.equal(scalar('cold_compliance', `SELECT count(*) FROM pg_constraint WHERE conname IN
    ('presence_operational_state_tag_id_fkey','ble_alarm_sessions_tag_id_fkey') AND confdeltype='r'`), '2');
  assert.equal(scalar('cold_compliance', `SELECT count(*) FROM tags WHERE hardware_device_id IS NULL`) ,'0');
  assert.equal(scalar('cold_compliance', `SELECT count(*) FROM gateways WHERE hardware_gateway_id IS NULL`) ,'0');
  runNode({ serviceName: 'cold-compliance-service', code: coldRunner, database: 'cold_compliance' });
  assert.equal(scalar('cold_compliance', 'SELECT count(*) FROM cold_compliance_migrations'), '21');

  // Store: production already has normal migrations 001-015; apply only isolated security 016.
  const storeNormalMigrations = readdirSync(path.join(root, 'horizonst-store', 'migrations'))
    .filter((file) => /^0(?:0[1-9]|1[0-5])_.*\.sql$/.test(file)).sort();
  for (const file of storeNormalMigrations) {
    psql('horizonst', `BEGIN;\n${sqlFile(`horizonst-store/migrations/${file}`)}\nCOMMIT;`);
  }
  psql('horizonst', `CREATE TABLE IF NOT EXISTS store.schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    ${storeNormalMigrations
      .map((file) => `INSERT INTO store.schema_migrations(filename) VALUES('${file}') ON CONFLICT DO NOTHING;`).join('\n')}`);
  assert.equal(scalar('horizonst', 'SELECT count(*) FROM store.schema_migrations'), '15');
  const storeMigrationUrl = pathToFileURL(path.join(root, 'horizonst-store', 'dist', 'db', 'migrate-security.js')).href;
  const storePoolUrl = pathToFileURL(path.join(root, 'horizonst-store', 'dist', 'db', 'pool.js')).href;
  const storeRunner = `import(${JSON.stringify(storeMigrationUrl)}).then(async m => { await m.runSecurityMigration(); const p=await import(${JSON.stringify(storePoolUrl)}); await p.closePool(); }).catch(e => { console.error(e); process.exit(1); });`;
  runNode({
    serviceName: 'horizonst-store',
    code: storeRunner,
    database: 'horizonst',
    extraEnv: { STORE_JWT_SECRET: storeJwtSecret }
  });
  assert.equal(scalar('horizonst', 'SELECT count(*) FROM store.schema_migrations'), '15');
  assert.equal(scalar('horizonst', `SELECT count(*) FROM store.schema_migrations WHERE filename ~ '^01[1-5]_'`), '5');
  assert.equal(scalar('horizonst', `SELECT count(*) FROM store.schema_migrations WHERE filename='016_auth_rate_limits.sql'`), '0');
  assert.equal(scalar('horizonst', `SELECT count(*) FROM store.security_migrations WHERE filename='016_auth_rate_limits.sql'`), '1');
  runNode({
    serviceName: 'horizonst-store',
    code: storeRunner,
    database: 'horizonst',
    extraEnv: { STORE_JWT_SECRET: storeJwtSecret }
  });
  assert.equal(scalar('horizonst', `SELECT count(*) FROM store.security_migrations`), '1');

  console.log('PostgreSQL 15 production-like migration checks: 24 assertions passed');
} finally {
  cleanupOwnedContainer({ spawn: spawnSync, state: containerState, cwd: root });
  const runnerCleanup = cleanupOwnedEmptyDirectory({ directoryPath: runnerCwd });
  if (runnerCleanup.status === 'preserved') {
    console.warn(`Runner directory preserved after safe cleanup: ${runnerCleanup.reason}`);
  }
}
