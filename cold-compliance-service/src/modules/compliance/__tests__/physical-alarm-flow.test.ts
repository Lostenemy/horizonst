import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('manual tag-control routes remain the only direct sendTagCommand entry point for UI/API commands', () => {
  const routes = source('modules/tag-control/tag-control.routes.ts');
  const tagControlService = source('modules/tag-control/application/tag-control.service.ts');

  assert.match(routes, /sendTagCommand/);
  assert.match(tagControlService, /export async function sendTagCommand/);
  assert.doesNotMatch(tagControlService, /export async function sendPreLimitAlert|export async function sendCriticalExposureAlert|export async function sendEarlyReentryBlockedAlert|export async function sendManDownAlert/);
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
