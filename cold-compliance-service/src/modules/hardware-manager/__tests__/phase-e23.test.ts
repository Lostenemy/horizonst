import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath: string): string => readFileSync(join(root, relativePath), 'utf8');

test('migration 018 validates central identities before adding active assignment uniqueness', () => {
  const sql = source('migrations/018_central_operational_conflict_keys.sql');

  assert.match(sql, /FROM presence_operational_state\s+WHERE hardware_device_id IS NULL/i);
  assert.match(sql, /FROM presence_operational_state[\s\S]+GROUP BY hardware_device_id[\s\S]+HAVING COUNT\(\*\) > 1/i);
  assert.match(sql, /FROM ble_alarm_sessions\s+WHERE hardware_device_id IS NULL/i);
  assert.match(sql, /FROM ble_alarm_sessions[\s\S]+GROUP BY hardware_device_id[\s\S]+HAVING COUNT\(\*\) > 1/i);
  assert.match(sql, /FROM worker_tag_assignments\s+WHERE active = TRUE\s+AND hardware_device_id IS NULL/i);
  assert.match(sql, /RAISE EXCEPTION/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_tag_assignments_one_active_hardware_device\s+ON worker_tag_assignments\(hardware_device_id\)\s+WHERE active = TRUE\s+AND hardware_device_id IS NOT NULL/i);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_worker_tag_assignments_one_active_worker\s+ON worker_tag_assignments\(worker_id\)\s+WHERE active = TRUE/i);
});

test('migration is additive and leaves local hardware overlays and command history untouched', () => {
  const sql = source('migrations/018_central_operational_conflict_keys.sql');

  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN|CONSTRAINT)|DELETE\s+FROM|TRUNCATE/i);
  assert.doesNotMatch(sql, /(?:ALTER|UPDATE|DELETE|TRUNCATE)[\s\S]*(?:tags|gateways|tag_commands|tag_command_attempts|tag_command_responses|tag_command_templates)/i);
  assert.match(source('migrations/005_ble_alarm_sessions.sql'), /tag_id UUID PRIMARY KEY REFERENCES tags\(id\)/);
  assert.match(source('migrations/008_presence_operational_state.sql'), /tag_id UUID PRIMARY KEY REFERENCES tags\(id\)/);
  assert.match(source('migrations/001_init.sql'), /CREATE TABLE IF NOT EXISTS worker_tag_assignments[\s\S]+tag_id UUID NOT NULL REFERENCES tags\(id\)/);
  assert.match(source('migrations/001_init.sql'), /CREATE TABLE IF NOT EXISTS cold_room_sessions[\s\S]+tag_id UUID REFERENCES tags\(id\)/);
});

test('presence operational UPSERTs use central identity without lazy legacy repair', () => {
  const presence = source('src/modules/presence/presence-state.service.ts');
  const centralConflicts = presence.match(/ON CONFLICT \(hardware_device_id\) WHERE hardware_device_id IS NOT NULL/g) ?? [];

  assert.equal(centralConflicts.length, 3);
  assert.doesNotMatch(presence, /ON CONFLICT \(tag_id\)/);
  assert.match(presence, /INSERT INTO presence_operational_state\(\s*tag_id, hardware_device_id/);
  assert.match(presence, /DO UPDATE SET tag_id = EXCLUDED\.tag_id,[\s\S]+hardware_device_id = EXCLUDED\.hardware_device_id/);
  assert.doesNotMatch(presence, /WHERE tag_id = \$\d|hardware_device_id IS NULL/);
  for (const field of ['worker_id', 'cold_room_id', 'inside', 'in_alarm', 'in_grace', 'grace_until', 'grace_started_at', 'last_alarm_at', 'reminder_sent_at', 'updated_at']) {
    assert.match(presence, new RegExp(field));
  }
});

test('BLE UPSERT uses central identity without lazy legacy repair', () => {
  const ble = source('src/modules/tag-control/infrastructure/ble-session.repository.ts');

  assert.match(ble, /central_hardware_mapping_required: BLE sessions require hardwareDeviceId/);
  assert.match(ble, /ON CONFLICT \(hardware_device_id\) WHERE hardware_device_id IS NOT NULL/);
  assert.doesNotMatch(ble, /ON CONFLICT \(tag_id\)/);
  assert.match(ble, /DO UPDATE SET tag_id = EXCLUDED\.tag_id,[\s\S]+hardware_device_id = EXCLUDED\.hardware_device_id/);
  assert.doesNotMatch(ble, /WHERE tag_id = \$\d|hardware_device_id IS NULL/);
  for (const field of ['tag_uid', 'gateway_mac', 'is_active', 'connected_at', 'disconnected_at', 'lease_expires_at', 'disconnect_requested_at', 'disconnect_confirmed_at', 'last_error']) {
    assert.match(ble, new RegExp(field));
  }
});

test('worker assignment replacement is central-only and preserves the HTTP and dual-write contracts', () => {
  const workers = source('src/modules/workers/workers.routes.ts');

  assert.match(workers, /WHERE hardware_device_id = \$1\s+AND active = true/);
  assert.match(workers, /\[tag\.rows\[0\]\.hardware_device_id\]/);
  assert.match(workers, /INSERT INTO worker_tag_assignments\(worker_id, tag_id, hardware_device_id, assigned_at, active\)/);
  assert.match(workers, /central_hardware_mapping_required/);
  assert.match(workers, /dependency_tag_commands/);
});

test('cold room sessions retain central uniqueness with unchanged conflict handling', () => {
  const compliance = source('src/modules/compliance/compliance.service.ts');
  const central = source('migrations/017_operational_hardware_device_id.sql');
  const hardening = source('migrations/019_central_only_operational_identity.sql');

  assert.match(compliance, /INSERT INTO cold_room_sessions\(worker_id, tag_id, hardware_device_id/);
  assert.match(compliance, /ON CONFLICT DO NOTHING/);
  assert.match(compliance, /s\.hardware_device_id = \$1/);
  assert.doesNotMatch(compliance, /s\.hardware_device_id IS NULL/);
  assert.match(central, /uq_cold_room_sessions_one_open_per_hardware_device[\s\S]+ON cold_room_sessions\(hardware_device_id\)[\s\S]+ended_at IS NULL[\s\S]+hardware_device_id IS NOT NULL/);
  assert.match(hardening, /DROP INDEX IF EXISTS uq_cold_room_sessions_one_open_per_tag/);
});

test('E.2.2 central-first reads, D.2 receive-only MQTT and B5 emergency invariants remain intact', () => {
  const repository = source('src/modules/tag-control/infrastructure/tag-control.repository.ts');
  const mqtt = source('src/modules/mqtt/mqtt.service.ts');
  const parser = source('src/modules/presence/payload-parser.ts');
  const emergency = source('src/modules/alerts/manual-emergency.service.ts');
  const physical = source('src/modules/tag-control/application/tag-physical-alarm.service.ts');

  assert.match(repository, /ps\.hardware_device_id = t\.hardware_device_id/);
  assert.match(repository, /g\.hardware_gateway_id = rp\.hardware_gateway_id/);
  assert.doesNotMatch(repository, /hardware_device_id IS NULL|hardware_gateway_id IS NULL/);
  assert.match(mqtt, /`gw\/\$\{mac\}\/publish`/);
  assert.doesNotMatch(mqtt, /mqttPublish|gw\/\+\/publish|\/MKGW3\//);
  assert.match(parser, /numericValue\(payload\?\.msg_id\) !== 3070/);
  assert.match(parser, /typeText === 'bxp-button' && frameType === 1 && alarmStatus === 1/);
  assert.match(emergency, /dispatchPhysicalAlarm: false/);
  assert.match(emergency, /hardware_device_id/);
  assert.match(physical, /executeHardwareB5Command/);
  assert.doesNotMatch(physical, /mqttPublish|TAG_SESSION_PASSWORD/);
});
