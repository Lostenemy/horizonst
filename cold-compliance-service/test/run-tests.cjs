const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { environment, collect } = require('../../infrastructure/testing/run-suites.cjs');
const tests = collect(join(process.cwd(), 'dist'));
const result = spawnSync(process.execPath, [
  '--require', join(__dirname, '../../infrastructure/testing/offline-preload.cjs'),
  '--test', '--test-concurrency=1', '--test-reporter=tap', ...tests
], { env: environment(), stdio: 'inherit', timeout: 150_000, windowsHide: true });
process.exit(result.status ?? 1);
