import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

test('heartbeat upserts one technical state per central device and gateway pair', () => {
  const migration = source('migrations/019_central_only_operational_identity.sql');
  const ingestion = source('src/modules/presence/presence.service.ts');
  assert.match(migration, /tag_gateway_presence_state_pkey[\s\S]+PRIMARY KEY \(hardware_device_id, hardware_gateway_id\)/);
  assert.match(ingestion, /ON CONFLICT \(hardware_device_id, hardware_gateway_id\)[\s\S]*DO UPDATE/);
  assert.match(ingestion, /last_rssi/);
  assert.match(ingestion, /last_battery/);
});

test('ordinary telemetry creates neither permanent audit nor sync duplication by default', () => {
  const ingestion = source('src/modules/presence/presence.service.ts');
  const configuration = source('src/config/env.ts');
  assert.match(configuration, /SYNC_QUEUE_ENABLED:[\s\S]*default\('false'\)/);
  assert.match(ingestion, /SYNC_QUEUE_ENABLED && !\['heartbeat', 'telemetry', 'movement'\]/);
  assert.match(ingestion, /event\.eventType === 'enter' \|\| event\.eventType === 'exit'/);
});

test('battery and BLE gateway candidates read bounded current state', () => {
  assert.match(source('src/modules/tags/tags.routes.ts'), /tag_gateway_presence_state/);
  assert.match(source('src/modules/tag-control/infrastructure/tag-control.repository.ts'), /tag_gateway_presence_state/);
});

test('maintenance uses bounded deletes and configurable retention', () => {
  const maintenance = source('src/modules/maintenance/maintenance.service.ts');
  assert.match(maintenance, /PRESENCE_HEARTBEAT_RETENTION_DAYS/);
  assert.match(maintenance, /LIMIT \$2/);
  assert.match(maintenance, /SYNC_QUEUE_SYNCED_RETENTION_HOURS/);
});
