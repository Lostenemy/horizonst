import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('MQTT raw retention is configurable and deletes in bounded batches', () => {
  const config = readFileSync(join(process.cwd(), 'src/config.ts'), 'utf8');
  const maintenance = readFileSync(join(process.cwd(), 'src/services/storageMaintenance.ts'), 'utf8');
  assert.match(config, /MQTT_RAW_RETENTION_HOURS, 48/);
  assert.match(maintenance, /received_at < NOW\(\) - \$1::interval/);
  assert.match(maintenance, /LIMIT \$2/);
});
