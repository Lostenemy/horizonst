import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const source = (relativePath: string): string => readFileSync(join(root, relativePath), 'utf8');

const centralOnlyRuntime = [
  'src/modules/alerts/alerts.routes.ts',
  'src/modules/alerts/manual-emergency.service.ts',
  'src/modules/compliance/compliance.service.ts',
  'src/modules/dashboard/dashboard.routes.ts',
  'src/modules/presence/presence-state.service.ts',
  'src/modules/realtime/realtime.routes.ts',
  'src/modules/reports/inspection-report.service.ts',
  'src/modules/tag-control/infrastructure/ble-session.repository.ts',
  'src/modules/tag-control/infrastructure/tag-control.repository.ts',
  'src/modules/workers/workers.routes.ts'
];

test('E.3 runtime has no null-only local hardware identity fallback or lazy repair', () => {
  const runtime = centralOnlyRuntime.map(source).join('\n');

  assert.doesNotMatch(runtime, /hardware_device_id IS NULL|hardware_gateway_id IS NULL/);
  assert.doesNotMatch(runtime, /SET hardware_device_id[\s\S]{0,160}WHERE tag_id/);
  assert.doesNotMatch(runtime, /JOIN[^\n]+[\s\S]{0,180}OR \([^)]*tag_id/);
  assert.doesNotMatch(runtime, /controlled local (?:event|command target) fallback/);
});

test('presence current state resolves once and writes the central device/gateway pair from the start', () => {
  const ingestion = source('src/modules/presence/presence.service.ts');

  assert.match(ingestion, /resolveEventTechnicalIdentity/);
  assert.match(ingestion, /identity\.source === 'central'/);
  assert.match(ingestion, /tag_uid, gateway_mac, hardware_device_id, hardware_gateway_id/);
  assert.match(ingestion, /ON CONFLICT \(hardware_device_id, hardware_gateway_id\)[\s\S]+WHERE hardware_device_id IS NOT NULL AND hardware_gateway_id IS NOT NULL/);
  assert.match(ingestion, /processComplianceRules\(event, identity\)/);
  assert.doesNotMatch(ingestion, /ON CONFLICT \(tag_uid, gateway_mac\)/);
});

test('central inventory outages reject operational resolution instead of using overlay MACs', () => {
  const identity = source('src/modules/hardware-manager/event-identity.service.ts');
  const emergency = source('src/modules/alerts/manual-emergency.service.ts');
  const compliance = source('src/modules/compliance/compliance.service.ts');

  assert.match(identity, /source: 'central_unavailable'/);
  assert.match(identity, /rejecting event without central identity/);
  assert.doesNotMatch(identity, /source: 'local_fallback'|using controlled local event fallback/);
  assert.match(emergency, /identity\.source !== 'central'/);
  assert.match(compliance, /identity\.source !== 'central'/);
});

test('migration 019 validates data and hardens required central references', () => {
  const sql = source('migrations/019_central_only_operational_identity.sql');

  for (const table of ['tags', 'gateways', 'worker_tag_assignments', 'cold_room_sessions', 'ble_alarm_sessions', 'presence_operational_state']) {
    assert.match(sql, new RegExp(`FROM ${table}[\\s\\S]+RAISE EXCEPTION`, 'i'));
  }
  for (const table of ['worker_tag_assignments', 'cold_room_sessions', 'ble_alarm_sessions', 'presence_operational_state']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table}[\\s\\S]+ALTER COLUMN hardware_device_id SET NOT NULL`, 'i'));
  }
  assert.match(sql, /ALTER TABLE tags[\s\S]+hardware_device_id SET NOT NULL/);
  assert.match(sql, /ALTER TABLE gateways[\s\S]+hardware_gateway_id SET NOT NULL/);
  assert.match(sql, /presence_operational_state_pkey PRIMARY KEY \(hardware_device_id\)/);
  assert.match(sql, /ble_alarm_sessions_pkey PRIMARY KEY \(hardware_device_id\)/);
  assert.match(sql, /uq_worker_tag_assignments_central_history[\s\S]+UNIQUE \(worker_id, hardware_device_id, assigned_at\)/);
  assert.match(sql, /DROP INDEX IF EXISTS uq_cold_room_sessions_one_open_per_tag/);
  assert.match(sql, /UPDATE tag_gateway_presence_state presence[\s\S]+FROM tags tag/);
  assert.match(sql, /UPDATE tag_gateway_presence_state presence[\s\S]+FROM gateways gateway/);
  assert.match(sql, /ALTER TABLE tag_gateway_presence_state[\s\S]+ALTER COLUMN hardware_device_id SET NOT NULL[\s\S]+ALTER COLUMN hardware_gateway_id SET NOT NULL/);
  assert.match(sql, /tag_gateway_presence_state_pkey[\s\S]+PRIMARY KEY \(hardware_device_id, hardware_gateway_id\)/);
});

test('migration preserves nullable untagged alerts/incidents, local metadata and command history', () => {
  const sql = source('migrations/019_central_only_operational_identity.sql');

  assert.doesNotMatch(sql, /ALTER TABLE (?:alerts|incidents)[\s\S]+SET NOT NULL/);
  assert.doesNotMatch(sql, /DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|DROP\s+COLUMN/i);
  assert.doesNotMatch(sql, /tag_commands|tag_command_attempts|tag_command_responses|tag_command_templates/);
  assert.match(source('src/modules/alerts/alerts.service.ts'), /params\.tagId \?\? null/);
  assert.match(source('src/modules/alerts/alerts.service.ts'), /params\.hardwareDeviceId \?\? null/);
  assert.match(source('src/modules/presence/presence-state.service.ts'), /tag_id, hardware_device_id/);
  assert.match(source('src/modules/tag-control/infrastructure/ble-session.repository.ts'), /tag_id, hardware_device_id, tag_uid, gateway_mac/);
  assert.match(source('src/modules/workers/workers.routes.ts'), /dependency_tag_commands/);
});

test('tags and gateways remain Horneo overlays with protected HTTP contracts', () => {
  const tags = source('src/modules/tags/tags.routes.ts');
  const gateways = source('src/modules/gateways/gateways.routes.ts');
  const migration = source('migrations/019_central_only_operational_identity.sql');

  assert.match(tags, /physical_alarm_followup_delay_ms/);
  assert.match(tags, /physical_alarm_buzzer_duration_ms/);
  assert.match(tags, /physical_alarm_vibration_duration_ms/);
  assert.match(gateways, /rssi_threshold/);
  assert.match(gateways, /cold_room_id/);
  assert.match(gateways, /plant_id/);
  assert.match(tags, /hardware_manager_authoritative/);
  assert.match(gateways, /hardware_manager_authoritative/);
  assert.match(migration, /Overlay operativo de Horneo para dispositivos/);
  assert.match(migration, /Overlay operativo de Horneo para gateways/);
});

test('MQTT and manual B5 emergency invariants are unchanged', () => {
  const mqtt = source('src/modules/mqtt/mqtt.service.ts');
  const parser = source('src/modules/presence/payload-parser.ts');
  const emergency = source('src/modules/alerts/manual-emergency.service.ts');
  const physical = source('src/modules/tag-control/application/tag-physical-alarm.service.ts');

  assert.match(mqtt, /`gw\/\$\{mac\}\/publish`/);
  assert.doesNotMatch(mqtt, /mqttPublish|gw\/\+\/publish|\/MKGW3\//);
  assert.match(parser, /typeText === 'bxp-button' && frameType === 1 && alarmStatus === 1/);
  assert.match(emergency, /dispatchPhysicalAlarm: false/);
  assert.match(emergency, /manualEmergencyDeduplicationKey\(hardwareDeviceId, event\.triggerCount\)/);
  assert.match(physical, /executeHardwareB5Command/);
  assert.doesNotMatch(physical, /mqttPublish|TAG_SESSION_PASSWORD/);
});
