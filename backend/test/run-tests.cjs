const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

function collectTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTests(path);
    return entry.name.endsWith('.test.js') ? [path] : [];
  });
}

const env = {
  ...process.env,
  JWT_SECRET: 'test-only-jwt-secret-with-at-least-32-characters',
  DB_PASSWORD: 'test-only-database-password',
  MAIL_ENABLED: 'false',
  RFID_ACCESS_ENABLED: 'false',
  MQTT_REQUIRED: 'false'
};
const tests = collectTests(join(process.cwd(), 'dist'));
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], {
  env,
  stdio: 'inherit'
});
process.exit(result.status ?? 1);
