import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createAlert } from '../../alerts/alerts.service';

const root = process.cwd();
const source = (relativePath: string): string => readFileSync(join(root, relativePath), 'utf8');
const migration = (): string => source('migrations/017_operational_hardware_device_id.sql');

const operationalTables = [
  'worker_tag_assignments',
  'cold_room_sessions',
  'alerts',
  'incidents',
  'ble_alarm_sessions',
  'presence_operational_state'
];

test('migration adds nullable central identity and backfills all six operational tables', () => {
  const sql = migration();
  for (const table of operationalTables) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table}\\s+ADD COLUMN IF NOT EXISTS hardware_device_id INTEGER`, 'i'));
    assert.match(sql, new RegExp(`UPDATE ${table}[^;]+FROM tags t[^;]+${table}\\.tag_id = t\\.id`, 'is'));
    assert.match(sql, new RegExp(`${table}[^;]+tag_id IS NOT NULL[^;]+hardware_device_id IS NULL`, 'is'));
    assert.match(sql, new RegExp(`(?:INDEX|ON) [^;]*${table}[^;]*\\(hardware_device_id\\)[^;]*WHERE`, 'is'));
  }
});

test('migration aborts on unmapped rows and is strictly additive', () => {
  const sql = migration();
  assert.match(sql, /RAISE EXCEPTION/i);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN|CONSTRAINT)|ALTER[^;]+hardware_device_id\s+SET\s+NOT\s+NULL|DELETE\s+FROM|TRUNCATE/i);
  assert.doesNotMatch(sql, /tag_commands|tag_command_attempts|tag_command_responses|tag_command_templates/i);
  assert.doesNotMatch(sql, /ALTER TABLE gateways|UPDATE gateways/i);
});

test('central uniqueness coexists with current tag_id keys and open-session index', () => {
  const sql = migration();
  assert.match(sql, /CREATE UNIQUE INDEX[^;]+presence_operational_state\s*\(hardware_device_id\)[^;]+hardware_device_id IS NOT NULL/is);
  assert.match(sql, /CREATE UNIQUE INDEX[^;]+ble_alarm_sessions\s*\(hardware_device_id\)[^;]+hardware_device_id IS NOT NULL/is);
  assert.match(sql, /CREATE UNIQUE INDEX[^;]+cold_room_sessions\s*\(hardware_device_id\)[^;]+ended_at IS NULL[^;]+hardware_device_id IS NOT NULL/is);

  assert.match(source('migrations/005_ble_alarm_sessions.sql'), /tag_id UUID PRIMARY KEY/);
  assert.match(source('migrations/008_presence_operational_state.sql'), /tag_id UUID PRIMARY KEY/);
  assert.match(source('migrations/012_presence_storage_hardening.sql'), /uq_cold_room_sessions_one_open_per_tag[\s\S]+cold_room_sessions\(tag_id\)[\s\S]+ended_at IS NULL/);
});

test('all six active writers retain dual-write after central conflict keys are adopted', () => {
  const workers = source('src/modules/workers/workers.routes.ts');
  const compliance = source('src/modules/compliance/compliance.service.ts');
  const alerts = source('src/modules/alerts/alerts.service.ts');
  const incidents = source('src/modules/incidents/incidents.service.ts');
  const presence = source('src/modules/presence/presence-state.service.ts');
  const ble = source('src/modules/tag-control/infrastructure/ble-session.repository.ts');

  assert.match(workers, /INSERT INTO worker_tag_assignments\([^)]*hardware_device_id[^)]*\)/s);
  assert.match(workers, /central_hardware_mapping_required/);
  assert.match(compliance, /INSERT INTO cold_room_sessions\([^)]*hardware_device_id[^)]*\)/s);
  assert.match(alerts, /INSERT INTO alerts\([^)]*hardware_device_id[^)]*\)/s);
  assert.match(incidents, /INSERT INTO incidents\([^)]*hardware_device_id[^)]*\)/s);

  const presenceInserts = [...presence.matchAll(/INSERT INTO presence_operational_state\(([^]*?)\)\s*(?:VALUES|SELECT)/g)];
  assert.ok(presenceInserts.length >= 3);
  assert.ok(presenceInserts.every((match) => match[1].includes('hardware_device_id')));
  assert.match(presence, /DO UPDATE SET tag_id = EXCLUDED\.tag_id,[\s\S]+hardware_device_id = EXCLUDED\.hardware_device_id/);
  assert.match(presence, /ON CONFLICT \(hardware_device_id\) WHERE hardware_device_id IS NOT NULL/);

  assert.match(ble, /INSERT INTO ble_alarm_sessions\([^)]*hardware_device_id[^)]*\)/s);
  assert.match(ble, /DO UPDATE SET tag_id = EXCLUDED\.tag_id,[\s\S]+hardware_device_id = EXCLUDED\.hardware_device_id/);
  assert.match(ble, /ON CONFLICT \(hardware_device_id\) WHERE hardware_device_id IS NOT NULL/);
});

test('tagged alerts require central identity while legitimate untagged alerts remain supported', async () => {
  await assert.rejects(
    createAlert({
      tagId: 'tag-1',
      severity: 'info',
      alertType: 'test',
      message: 'test',
      dispatchPhysicalAlarm: false,
      queryClient: { query: async () => { throw new Error('query should not run'); } } as any
    }),
    /central_hardware_mapping_required/
  );

  let values: unknown[] | undefined;
  await createAlert({
    severity: 'info',
    alertType: 'system_test',
    message: 'without tag',
    dispatchPhysicalAlarm: false,
    queryClient: {
      query: async (_sql: string, params?: unknown[]) => {
        values = params;
        return { rows: [{ id: 'alert-1', worker_id: null, tag_id: null, hardware_device_id: null, severity: 'info', alert_type: 'system_test' }], rowCount: 1 };
      }
    } as any
  });
  assert.equal(values?.[1], null);
  assert.equal(values?.[2], null);
});

test('E.1 and B5/MQTT invariants remain in place', () => {
  const app = source('src/app.ts');
  const mqtt = source('src/modules/mqtt/mqtt.service.ts');
  const emergency = source('src/modules/alerts/manual-emergency.service.ts');
  const physical = source('src/modules/tag-control/application/tag-physical-alarm.service.ts');
  const targets = source('src/modules/tag-control/infrastructure/tag-control.repository.ts');

  assert.doesNotMatch(app, /tagControlRouter|app\.use\(['"]\/tag-control/);
  assert.doesNotMatch(mqtt, /mqttPublish|gw\/\+\/publish/);
  assert.match(emergency, /dispatchPhysicalAlarm: false/);
  assert.match(emergency, /const hardwareDeviceId = context\.hardware_device_id as number/);
  assert.match(emergency, /hardwareDeviceId,/);
  assert.match(physical, /executeHardwareB5Command/);
  assert.match(physical, /hardwareDeviceId: candidate\.hardwareDeviceId/);
  assert.doesNotMatch(physical, /mqttPublish|TAG_SESSION_PASSWORD/);
  assert.match(targets, /'last_seen' \| 'camera_assigned' \| 'hybrid'/);
  assert.match(targets, /rssi DESC NULLS LAST/);
  assert.match(targets, /same_cold_room/);
});
