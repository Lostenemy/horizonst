'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const services = ['backend', 'cold-compliance-service'];
const pattern = 'a delayed valid response completes';

function environment() {
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return Object.assign(env, {
    NODE_ENV: 'test', JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    DB_PASSWORD: crypto.randomBytes(24).toString('hex'), DB_HOST: '127.0.0.1', DB_PORT: '9',
    DB_USER: 'isolated_test', DB_NAME: 'isolated_test', MAIL_ENABLED: 'false', MQTT_REQUIRED: 'false',
    HARDWARE_MANAGER_ENABLED: 'false'
  });
}
function collect(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? collect(file) : entry.name.endsWith('.test.js') ? [file] : [];
  }).sort();
}
function prepare(workspace, baseline) {
  // Explicit allowlist; preserve all pre-existing dist and untracked files in the checkout.
  for (const service of services) {
    const dest = path.join(workspace, service);
    fs.mkdirSync(dest);
    for (const item of ['package.json', 'package-lock.json', 'tsconfig.json', 'src', 'migrations', 'test',
      ...(service === 'backend' ? ['public'] : ['web'])]) {
      fs.cpSync(path.join(root, service, item), path.join(dest, item), {
        recursive: true, filter: file => !path.basename(file).startsWith('.env')
      });
    }
    fs.symlinkSync(path.join(root, service, 'node_modules'), path.join(dest, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir');
  }
  fs.mkdirSync(path.join(workspace, 'scripts'));
  for (const item of ['auth-rate-limit-contract.cjs', 'trusted-proxy-contract.cjs', 'reset-transaction-fixture.cjs']) {
    fs.copyFileSync(path.join(root, 'scripts', item), path.join(workspace, 'scripts', item));
  }
  fs.mkdirSync(path.join(workspace, 'db'));
  fs.copyFileSync(path.join(root, 'db/mqtt-init.sh'), path.join(workspace, 'db/mqtt-init.sh'));
  fs.copyFileSync(path.join(root, 'docker-compose.yml'), path.join(workspace, 'docker-compose.yml'));
  fs.mkdirSync(path.join(workspace, 'docs'));
  fs.copyFileSync(path.join(root, 'docs/hardware-manager-mqtt-1030.md'), path.join(workspace, 'docs/hardware-manager-mqtt-1030.md'));
  fs.mkdirSync(path.join(workspace, 'rfid-demo-dashboard/src/mqtt'), { recursive: true });
  fs.copyFileSync(path.join(root, 'rfid-demo-dashboard/src/mqtt/parser.ts'), path.join(workspace, 'rfid-demo-dashboard/src/mqtt/parser.ts'));
  fs.mkdirSync(path.join(workspace, 'infrastructure/testing'), { recursive: true });
  for (const item of ['run-suites.cjs', 'offline-preload.cjs']) {
    fs.copyFileSync(path.join(__dirname, item), path.join(workspace, 'infrastructure/testing', item));
  }
  if (baseline) {
    const relative = 'backend/src/__tests__/gatewayObservedReads.test.ts';
    fs.writeFileSync(path.join(workspace, relative), execFileSync('git', ['show', `HEAD:${relative}`], { cwd: root }));
  }
}
function run(args, cwd, env, evidence, name) {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8',
    timeout: 150_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  const output = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(path.join(evidence, `${name}.log`), output);
  const counts = {};
  for (const match of output.matchAll(/^# (tests|pass|fail|skipped|cancelled) (\d+)$/gm)) counts[match[1]] = Number(match[2]);
  const summary = { name, exitCode: result.status, signal: result.signal, ...counts,
    ...(result.error ? { errorCode: result.error.code || 'PROCESS_ERROR' } : {}) };
  console.log(JSON.stringify(summary));
  return summary;
}
function main() {
  if (process.versions.node !== '22.23.4') throw new Error('Run with exactly Node 22.23.4');
  const baseline = process.argv.includes('--baseline');
  const repeatOnly = process.argv.includes('--repeat-only');
  const evidenceIndex = process.argv.indexOf('--evidence-root');
  const evidenceRoot = evidenceIndex < 0 ? os.tmpdir() : process.argv[evidenceIndex + 1];
  if (!evidenceRoot || !fs.statSync(evidenceRoot).isDirectory()) throw new Error('Evidence root must be an existing directory');
  const evidence = fs.mkdtempSync(path.join(evidenceRoot, 'horizonst-tests-evidence-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'horizonst-tests-workspace-'));
  const env = environment();
  console.log(JSON.stringify({ runtime: process.version, platform: process.platform, evidence, workspace, baseline }));
  const results = [];
  try {
    prepare(workspace, baseline);
    for (const service of services) {
      const cwd = path.join(workspace, service);
      const compiler = path.join(cwd, 'node_modules/typescript/bin/tsc');
      results.push(run([compiler, '-p', 'tsconfig.json', '--noEmit'], cwd, env, evidence, `${service}-typecheck`));
      results.push(run([compiler, '-p', 'tsconfig.json'], cwd, env, evidence, `${service}-build`));
      if (results.at(-1).exitCode !== 0) throw new Error(`Test build failed: ${service}`);
      if (!repeatOnly) results.push(run(['test/run-tests.cjs'], cwd, env, evidence, `${service}-suite`));
    }
    for (let i = 1; i <= 20; i++) {
      results.push(run(['--require', path.join(__dirname, 'offline-preload.cjs'), '--test', '--test-reporter=tap',
        `--test-name-pattern=${pattern}`, 'dist/__tests__/gatewayObservedReads.test.js'],
      path.join(workspace, 'backend'), env, evidence, `timing-${String(i).padStart(2, '0')}`));
    }
  } finally {
    // Retain exact owned workspace and all logs, including failures; no recursive cleanup.
    fs.writeFileSync(path.join(evidence, 'summary.json'), JSON.stringify({ runtime: process.version,
      platform: process.platform, workspace, baseline, results }, null, 2));
  }
  process.exitCode = results.some(result => result.exitCode !== 0) ? 1 : 0;
}
module.exports = { collect, environment, prepare };
if (require.main === module) main();
