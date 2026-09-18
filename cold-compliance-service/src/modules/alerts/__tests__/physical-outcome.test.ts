import assert from 'node:assert/strict';
import test from 'node:test';
import { executeAndRecordPhysicalAlarm } from '../alerts.service';
import { executeConnectedTagCommandSequence } from '../../tag-control/application/tag-physical-alarm.service';

test('an ambiguous simulated B5 connect persists attempted_unverified without changing alert acknowledgement or repeating dispatch', async () => {
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  let connectCalls = 0;
  let actionCalls = 0;
  const result = await executeAndRecordPhysicalAlarm({
    alertId: 'alert-1', tagId: 'tag-1', severity: 'critical', alertType: 'continuous_limit_exceeded'
  }, {
    execute: async () => {
      const attempt = await executeConnectedTagCommandSequence({
        tagId: 'tag-1', tagUid: 'fd9d4f8ae226',
        candidates: [{ tagId: 'tag-1', tagUid: 'fd9d4f8ae226', gatewayId: 'gw-1', gatewayMac: '142b2fe271b4' }],
        deps: {
          connect: async () => { connectCalls += 1; return 'ambiguous'; },
          disconnect: async () => 'confirmed',
          markActive: async () => undefined,
          markDisconnected: async () => undefined
        },
        runActions: async () => { actionCalls += 1; return 'confirmed'; }
      });
      return { status: attempt.status === 'attempted_unverified' ? 'attempted_unverified' : 'success', selectedGatewayMac: attempt.selectedGatewayMac };
    },
    query: (async (sql: string, params: unknown[]) => {
      writes.push({ sql, params });
      return { rows: [], rowCount: 1 };
    }) as any
  });
  assert.equal(result.status, 'attempted_unverified');
  assert.equal(connectCalls, 1);
  assert.equal(actionCalls, 1);
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /SET metadata = jsonb_set/);
  assert.doesNotMatch(writes[0].sql, /acknowledged_at|INSERT INTO alerts/);
  assert.equal(writes[0].params[0], 'alert-1');
  assert.deepEqual(JSON.parse(String(writes[0].params[1])).status, 'attempted_unverified');
  assert.deepEqual(JSON.parse(String(writes[0].params[1])).gatewayMac, '142b2fe271b4');
});

test('a physical dispatch error is persisted as failed and never retried by the recorder', async () => {
  const statuses: string[] = [];
  let calls = 0;
  await assert.rejects(() => executeAndRecordPhysicalAlarm({
    alertId: 'alert-2', severity: 'critical', alertType: 'continuous_limit_exceeded'
  }, {
    execute: async () => { calls += 1; throw new Error('simulated physical rejection'); },
    query: (async (_sql: string, params: unknown[]) => {
      statuses.push(JSON.parse(String(params[1])).status);
      return { rows: [], rowCount: 1 };
    }) as any
  }), /simulated physical rejection/);
  assert.equal(calls, 1);
  assert.deepEqual(statuses, ['failed']);
});

test('a persistence failure never repeats a simulated physical dispatch', async () => {
  let calls = 0;
  const result = await executeAndRecordPhysicalAlarm({
    alertId: 'alert-3', severity: 'warning', alertType: 'low_battery'
  }, {
    execute: async () => { calls += 1; return { status: 'attempted_unverified' }; },
    query: (async () => { throw new Error('simulated database outage'); }) as any
  });
  assert.equal(result.status, 'attempted_unverified');
  assert.equal(calls, 1);
});
