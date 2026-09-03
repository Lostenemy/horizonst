import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { manualEmergencyDeduplicationKey } from '../../alerts/manual-emergency.service';

const root = process.cwd();
const source = (relativePath: string): string => readFileSync(join(root, relativePath), 'utf8');

test('compliance prioritizes central operational identity and retains null-only legacy fallback', () => {
  const compliance = source('src/modules/compliance/compliance.service.ts');
  assert.match(compliance, /s\.hardware_device_id = \$1[\s\S]+s\.hardware_device_id IS NULL[\s\S]+s\.tag_id = \$2/);
  assert.match(compliance, /wta\.hardware_device_id = t\.hardware_device_id[\s\S]+wta\.hardware_device_id IS NULL[\s\S]+wta\.tag_id = t\.id/);
  assert.match(compliance, /FROM presence_operational_state[\s\S]+hardware_device_id = \$1[\s\S]+hardware_device_id IS NULL AND tag_id = \$2/);
  assert.match(compliance, /\[tag\.hardware_device_id, tag\.id\]/);
});

test('presence state reads by central id with legacy fallback and writes by central conflict key', () => {
  const presence = source('src/modules/presence/presence-state.service.ts');
  assert.match(presence, /WHERE hardware_device_id = \$1[\s\S]+hardware_device_id IS NULL AND tag_id = \$2/);
  assert.match(presence, /markPresenceExit\([\s\S]+hardwareDeviceId/);
  assert.match(presence, /RETURNING pos\.tag_id,[\s\S]+pos\.hardware_device_id/);
  assert.match(presence, /ON CONFLICT \(hardware_device_id\) WHERE hardware_device_id IS NOT NULL/);
});

test('manual emergency correlates and deduplicates by central identity first', () => {
  const emergency = source('src/modules/alerts/manual-emergency.service.ts');
  assert.match(emergency, /wta\.hardware_device_id = t\.hardware_device_id[\s\S]+wta\.hardware_device_id IS NULL[\s\S]+wta\.tag_id = t\.id/);
  assert.match(emergency, /pos\.hardware_device_id = t\.hardware_device_id[\s\S]+pos\.hardware_device_id IS NULL[\s\S]+pos\.tag_id = t\.id/);
  assert.match(emergency, /crs\.hardware_device_id = t\.hardware_device_id[\s\S]+crs\.hardware_device_id IS NULL[\s\S]+crs\.tag_id = t\.id/);
  assert.match(emergency, /a\.hardware_device_id = \$1[\s\S]+a\.hardware_device_id IS NULL[\s\S]+a\.tag_id = \$2/);
  assert.match(emergency, /dispatchPhysicalAlarm: false/);
  assert.equal(manualEmergencyDeduplicationKey(31, 24), 'hardware:31:24');
  assert.equal(manualEmergencyDeduplicationKey('FD:9D:4F:8A:E2:26', 24), 'tag:fd9d4f8ae226:24');
});

test('resolveTagTargets preserves strategies while central ids drive normal joins', () => {
  const repository = source('src/modules/tag-control/infrastructure/tag-control.repository.ts');
  assert.match(repository, /type GatewayStrategy = 'last_seen' \| 'camera_assigned' \| 'hybrid'/);
  assert.match(repository, /ps\.hardware_device_id = t\.hardware_device_id/);
  assert.match(repository, /g\.hardware_gateway_id = rp\.hardware_gateway_id/);
  assert.match(repository, /s\.hardware_device_id = t\.hardware_device_id[\s\S]+s\.hardware_device_id IS NULL[\s\S]+s\.tag_id = t\.id/);
  assert.match(repository, /wta\.hardware_device_id = t\.hardware_device_id[\s\S]+wta\.hardware_device_id IS NULL[\s\S]+wta\.tag_id = t\.id/);
  assert.match(repository, /ps\.hardware_device_id IS NULL[\s\S]+ps\.tag_uid/);
  assert.match(repository, /rp\.hardware_gateway_id IS NULL[\s\S]+rp\.gateway_mac/);
  assert.match(repository, /last_seen_at DESC/);
  assert.match(repository, /rssi DESC NULLS LAST/);
  assert.match(repository, /same_cold_room/);
  assert.match(repository, /recentWindowMs/);
  assert.match(repository, /LIMIT \$[45]/);
  assert.match(repository, /hardwareDeviceId\?: number/);
  assert.match(source('src/modules/tag-control/application/tag-physical-alarm.service.ts'), /hardwareDeviceId: params\.hardwareDeviceId/);
});

test('API snapshots and presentation lookups prefer central identity without changing output fields', () => {
  const realtime = source('src/modules/realtime/realtime.routes.ts');
  const dashboard = source('src/modules/dashboard/dashboard.routes.ts');
  const alerts = source('src/modules/alerts/alerts.routes.ts');
  const workers = source('src/modules/workers/workers.routes.ts');
  const reports = source('src/modules/reports/inspection-report.service.ts');

  for (const operational of [realtime, dashboard]) {
    assert.match(operational, /pos\.hardware_device_id = s\.hardware_device_id/);
    assert.match(operational, /wta\.hardware_device_id = s\.hardware_device_id/);
    assert.match(operational, /hardware_device_id IS NULL/);
  }
  assert.match(alerts, /t\.hardware_device_id = a\.hardware_device_id[\s\S]+a\.hardware_device_id IS NULL[\s\S]+t\.id = a\.tag_id/);
  assert.match(workers, /t\.hardware_device_id = a\.hardware_device_id[\s\S]+a\.hardware_device_id IS NULL[\s\S]+t\.id = a\.tag_id/);
  assert.match(reports, /t\.hardware_device_id = s\.hardware_device_id[\s\S]+s\.hardware_device_id IS NULL[\s\S]+t\.id = s\.tag_id/);
  for (const field of ['session_id', 'worker_name', 'worker_dni', 'tag_mac', 'started_at', 'ended_at', 'duration_seconds']) {
    assert.match(reports, new RegExp(field));
  }
});

test('BLE lookups and writes use central identity while the transitional local key remains intact', () => {
  const ble = source('src/modules/tag-control/infrastructure/ble-session.repository.ts');
  assert.match(ble, /isBleSessionActive\([\s\S]+hardwareDeviceId/);
  assert.match(ble, /markBleSessionDisconnected\([\s\S]+hardwareDeviceId/);
  assert.match(ble, /hardware_device_id = \$1[\s\S]+hardware_device_id IS NULL AND tag_id = \$2/);
  assert.match(ble, /ON CONFLICT \(hardware_device_id\) WHERE hardware_device_id IS NOT NULL/);
  assert.match(source('migrations/005_ble_alarm_sessions.sql'), /tag_id UUID PRIMARY KEY/);
  assert.match(source('migrations/008_presence_operational_state.sql'), /tag_id UUID PRIMARY KEY/);
  assert.match(source('migrations/012_presence_storage_hardening.sql'), /uq_cold_room_sessions_one_open_per_tag[\s\S]+cold_room_sessions\(tag_id\)/);
});

test('E.2.2 leaves local overlays, command history and receive-only MQTT intact', () => {
  const changedModules = [
    source('src/modules/compliance/compliance.service.ts'),
    source('src/modules/presence/presence-state.service.ts'),
    source('src/modules/alerts/manual-emergency.service.ts'),
    source('src/modules/tag-control/infrastructure/tag-control.repository.ts'),
    source('src/modules/tag-control/infrastructure/ble-session.repository.ts'),
    source('src/modules/realtime/realtime.routes.ts'),
    source('src/modules/dashboard/dashboard.routes.ts'),
    source('src/modules/alerts/alerts.routes.ts'),
    source('src/modules/reports/inspection-report.service.ts'),
    source('src/modules/workers/workers.routes.ts')
  ].join('\n');
  assert.doesNotMatch(changedModules, /DROP\s+(?:TABLE|COLUMN)|TRUNCATE/i);
  assert.match(source('src/modules/tags/tags.routes.ts'), /physical_alarm_followup_delay_ms/);
  assert.match(source('src/modules/gateways/gateways.routes.ts'), /cold_room_id/);
  assert.match(source('src/modules/workers/workers.routes.ts'), /dependency_tag_commands/);
  assert.doesNotMatch(source('src/app.ts'), /tagControlRouter|app\.use\(['"]\/tag-control/);
  assert.doesNotMatch(source('src/modules/mqtt/mqtt.service.ts'), /mqttPublish|gw\/\+\/publish/);
});
