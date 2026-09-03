import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const serviceRoot = join(process.cwd(), 'src');

function source(relativePath: string): string {
  return readFileSync(join(serviceRoot, relativePath), 'utf8');
}

test('compliance automatic alerts rely on createAlert physical sequence and do not send template commands directly', () => {
  const compliance = source('modules/compliance/compliance.service.ts');

  assert.match(compliance, /alertType: prelimit \? 'continuous_limit_prewarning' : 'continuous_limit_exceeded'/);
  assert.doesNotMatch(compliance, /sendPreLimitAlert|sendCriticalExposureAlert|sendEarlyReentryBlockedAlert|sendManDownAlert/);
  assert.doesNotMatch(compliance, /template:pre_limit|template:critical|template:early_reentry_blocked|template:man_down/);
});

test('presence grace and reminder alarms use the connected physical sequence without template duplication', () => {
  const presenceState = source('modules/presence/presence-state.service.ts');

  assert.match(presenceState, /triggerPhysicalAlarmSequence/);
  assert.doesNotMatch(presenceState, /sendCriticalExposureAlert|sendPreLimitAlert|sendEarlyReentryBlockedAlert|sendManDownAlert/);
});

test('physical alarm delegates in Hardware Manager without direct MQTT execution', () => {
  const physicalAlarm = source('modules/tag-control/application/tag-physical-alarm.service.ts');

  assert.match(physicalAlarm, /executeHardwareB5Command/);
  assert.doesNotMatch(physicalAlarm, /mqttPublish|TAG_SESSION_PASSWORD/);
});

test('resolveTagTargets preserves functional gateway selection strategies and signals', () => {
  const repository = source('modules/tag-control/infrastructure/tag-control.repository.ts');

  assert.match(repository, /export async function resolveTagTargets/);
  assert.match(repository, /'last_seen' \| 'camera_assigned' \| 'hybrid'/);
  assert.match(repository, /recent_presence/);
  assert.match(repository, /last_seen_at DESC/);
  assert.match(repository, /rssi DESC NULLS LAST/);
  assert.match(repository, /same_cold_room/);
  assert.match(repository, /validateTechnicalTargets/);
  assert.match(repository, /controlled local command target fallback/);
});

test('historical tag command tables have no destructive migration', () => {
  const migrationsDir = join(process.cwd(), 'migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
    .join('\n');

  assert.doesNotMatch(migrations, /(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\s+(?:IF\s+EXISTS\s+)?tag_command(?:s|_attempts|_responses|_templates)\b/i);
});

test('createAlert logs and dispatches the robust physical alarm sequence once per alert', () => {
  const alerts = source('modules/alerts/alerts.service.ts');
  const executeCalls = alerts.match(/executeAlarmSequence\(/g) ?? [];

  assert.match(alerts, /compliance alert dispatching physical alarm sequence/);
  assert.match(alerts, /alertId: alert\.id/);
  assert.match(alerts, /alertType: alert\.alert_type/);
  assert.match(alerts, /severity: alert\.severity/);
  assert.match(alerts, /tagId: alert\.tag_id/);
  assert.match(alerts, /workerId: alert\.worker_id/);
  assert.equal(executeCalls.length, 2, 'createAlert and triggerPhysicalAlarmSequence should each call executeAlarmSequence once');
});
