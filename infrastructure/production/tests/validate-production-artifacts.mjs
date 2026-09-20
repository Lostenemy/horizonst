import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const composeFile = path.join(root, 'infrastructure', 'production', 'docker-compose.production.yml');
const env = {
  ...process.env,
  DB_USER: 'fixture_user', DB_PASSWORD: 'fixture_password_not_a_secret', DB_NAME: 'horizonst',
  COLD_COMPLIANCE_DB_NAME: 'cold_compliance', TRUSTED_PROXY_IP: '172.31.0.1',
  JWT_SECRET: 'fixture_jwt_secret_with_more_than_32_chars', MQTT_USER: 'fixture_mqtt',
  MQTT_PASS: 'fixture_mqtt_password', B5_SESSION_PASSWORD: 'fixture_b5_password',
  STORE_CORS_ORIGIN: 'https://example.invalid', STORE_PUBLIC_BASE_URL: 'https://example.invalid',
  STORE_JWT_SECRET: 'fixture_store_jwt_secret_with_32_chars',
};

const rendered = execFileSync('docker', [
  'compose', '-f', composeFile, 'config', '--format', 'json',
  '--no-env-resolution', '--no-path-resolution'
], { cwd: root, env, encoding: 'utf8' });
const config = JSON.parse(rendered);
assert.equal(config.name, 'horizonst-production');
assert.deepEqual(Object.keys(config.services).sort(), [
  'app', 'cold_compliance_service', 'horizonst_store', 'postgres', 'vernemq'
]);

const loopbackPorts = {
  app: [3000, 3000], cold_compliance_service: [3100, 3100],
  horizonst_store: [4020, 4020], postgres: [5432, 5432], vernemq: [1887, 1883]
};
for (const [name, [published, target]] of Object.entries(loopbackPorts)) {
  const ports = config.services[name].ports;
  assert.equal(ports.length, 1, `${name} must expose one port`);
  assert.equal(ports[0].host_ip, '127.0.0.1', `${name} must bind loopback`);
  assert.equal(Number(ports[0].published), published);
  assert.equal(Number(ports[0].target), target);
  assert.equal(config.services[name].restart, 'unless-stopped');
  assert.ok(config.services[name].healthcheck, `${name} healthcheck`);
}

assert.equal(config.networks['horizonst-production'].name, 'horizonst-production');
assert.equal(config.networks['horizonst-production'].external, true);
assert.equal(config.volumes.postgres_data.name, 'horizonst-production-postgres-data');
assert.equal(config.volumes.vernemq_data.name, 'horizonst-production-vernemq-data');
assert.equal(config.volumes.vernemq_log.name, 'horizonst-production-vernemq-log');

const app = config.services.app;
assert.equal(app.build.context, '/opt/horizonst/backend');
assert.equal(app.environment.MQTT_CLIENT_ID, 'acces_control_server_backend');
assert.equal(app.environment.MQTT_REQUIRED, 'true');
assert.equal(app.environment.MQTT_PERSISTENCE_MODE, 'app');
assert.equal(app.environment.MQTT_HOST, 'vernemq');
assert.equal(app.environment.TRUSTED_PROXY_IP, '172.31.0.1');
assert.match(JSON.stringify(app.depends_on), /postgres/);
assert.match(JSON.stringify(app.depends_on), /vernemq/);
assert.ok(!JSON.stringify(app.env_file).includes('backend/.env'));

const cold = config.services.cold_compliance_service.environment;
assert.equal(cold.MQTT_CLIENT_ID, 'cold-compliance-service-production');
assert.notEqual(cold.MQTT_CLIENT_ID, app.environment.MQTT_CLIENT_ID);
assert.equal(cold.SYNC_QUEUE_ENABLED, 'false');
assert.equal(cold.HARDWARE_MANAGER_BASE_URL, 'http://app:3000');
assert.equal(cold.HARDWARE_MANAGER_B5_CONFIGURATION_TIMEOUT_MS, '45000');

const tracked = [
  composeFile,
  path.join(root, 'infrastructure', 'production', 'production.env.example'),
  path.join(root, 'infrastructure', 'production', 'provision-hardware-manager.sql'),
  path.join(root, 'infrastructure', 'production', 'nginx-hardware-manager.options.conf'),
  path.join(root, 'infrastructure', 'production', 'bootstrap-horneo-inventory.sh'),
  path.join(root, 'infrastructure', 'production', 'sql', 'horneo-inventory-preflight.sql'),
  path.join(root, 'infrastructure', 'production', 'sql', 'central-inventory-bootstrap.sql'),
  path.join(root, 'infrastructure', 'production', 'sql', 'horneo-inventory-reconcile.sql'),
  path.join(root, 'infrastructure', 'production', 'runbook.md')
];
const combined = tracked.map((file) => readFileSync(file, 'utf8')).join('\n');
assert.doesNotMatch(combined, /gho_[A-Za-z0-9]+|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|hst_svc_[A-Za-z0-9_-]{20,}/);
assert.doesNotMatch(combined, /e-?coordina|elecnor|RFID_ACCESS|devices\/RF1/i);
assert.match(combined, /proxy_set_header X-Real-IP \$remote_addr/);
assert.match(combined, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for/);
assert.match(combined, /TRUSTED_PROXY_IP/);

const provisioning = readFileSync(path.join(root, 'infrastructure', 'production', 'provision-hardware-manager.sql'), 'utf8');
assert.match(provisioning, /\[\{"pattern":"gw\/\+\/subscribe"\}\]/);
assert.match(provisioning, /\[\{"pattern":"devices\/MK4"\},\{"pattern":"gw\/\+\/publish"\}\]/);
assert.doesNotMatch(provisioning, /"qos"|DELETE\s+FROM\s+vmq_auth_acl/i);
assert.match(provisioning, /ARRAY\['hardware\.read', 'hardware\.command'\]/);

const bootstrap = readFileSync(path.join(root, 'infrastructure', 'production', 'bootstrap-horneo-inventory.sh'), 'utf8');
const centralBootstrap = readFileSync(path.join(root, 'infrastructure', 'production', 'sql', 'central-inventory-bootstrap.sql'), 'utf8');
const horneoReconcile = readFileSync(path.join(root, 'infrastructure', 'production', 'sql', 'horneo-inventory-reconcile.sql'), 'utf8');
const runbook = readFileSync(path.join(root, 'infrastructure', 'production', 'runbook.md'), 'utf8');
assert.match(bootstrap, /umask 077/);
assert.match(bootstrap, /chmod 0600/);
assert.doesNotMatch(bootstrap, /rm\s+-[A-Za-z]*r|rm\s+--recursive/);
assert.match(centralBootstrap, /WHERE code = 'horneo'/);
assert.match(centralBootstrap, /device_type, active, status/);
assert.doesNotMatch(centralBootstrap, /owner_id|category_id/);
assert.match(horneoReconcile, /hardware_gateway_id = mapping\.central_id/);
assert.match(horneoReconcile, /hardware_device_id = mapping\.central_id/);
assert.match(runbook, /Store normal debe tener exactamente 001–015/);
assert.match(runbook, /Las dos bases no comparten una transacción/);
assert.match(runbook, /modo explícito `0600`/);
assert.match(runbook, /No ejecutar `npm run migrate`/);

console.log('production artifact checks: 51 assertions passed');
