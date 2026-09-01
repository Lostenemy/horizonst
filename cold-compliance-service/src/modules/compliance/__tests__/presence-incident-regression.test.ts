import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { shouldClosePresenceSession } from '../presence-timeout-policy';
import { executeConnectedTagCommandSequence } from '../../tag-control/application/tag-physical-alarm.service';

test('orphaned BLE state cannot extend the 45 second presence timeout', () => {
  const lastHeartbeat = Date.parse('2026-08-26T11:25:31.074Z');
  assert.equal(shouldClosePresenceSession({ nowMs: lastHeartbeat + 45_000, lastPresenceAtMs: lastHeartbeat, timeoutMs: 45_000 }), false);
  assert.equal(shouldClosePresenceSession({ nowMs: lastHeartbeat + 45_001, lastPresenceAtMs: lastHeartbeat, timeoutMs: 45_000 }), true);

  const compliance = readFileSync(join(process.cwd(), 'src/modules/compliance/compliance.service.ts'), 'utf8');
  assert.doesNotMatch(compliance, /presence timeout skipped due to active BLE session/);
  assert.doesNotMatch(compliance, /FROM presence_events pe[\s\S]*presence timeout/);
  assert.match(compliance, /tag_gateway_presence_state/);
});

test('failed vibration and disconnect close operational BLE state without claiming physical confirmation', async () => {
  const outcomes: Array<{ confirmed?: boolean; error?: string }> = [];
  await assert.rejects(
    executeConnectedTagCommandSequence({
      tagId: 'b63980f2-1f0e-422c-aa18-a0ce3db38402',
      tagUid: 'e5cb649d8b01',
      candidates: [{ tagId: 'b63980f2-1f0e-422c-aa18-a0ce3db38402', tagUid: 'e5cb649d8b01', gatewayId: 'gw', gatewayMac: '2805a55efa74' }],
      deps: {
        connect: async () => undefined,
        disconnect: async () => { throw new Error('disconnect timeout'); },
        markActive: async () => undefined,
        markDisconnected: async (outcome) => { outcomes.push(outcome); }
      },
      runActions: async () => { throw new Error('vibration timeout'); }
    }),
    /vibration timeout/
  );
  assert.deepEqual(outcomes, [{ tagId: 'b63980f2-1f0e-422c-aa18-a0ce3db38402', confirmed: false, error: 'disconnect timeout' }]);
});

test('grace reentry dispatches BLE work after the presence transition', () => {
  const source = readFileSync(join(process.cwd(), 'src/modules/presence/presence-state.service.ts'), 'utf8');
  assert.match(source, /function dispatchPhysicalAlarm/);
  assert.match(source, /setImmediate/);
  assert.doesNotMatch(source, /await triggerPhysicalAlarmSequence/);
});

test('database constraint serializes concurrent attempts to open a session', () => {
  const migration = readFileSync(join(process.cwd(), 'migrations/012_presence_storage_hardening.sql'), 'utf8');
  const compliance = readFileSync(join(process.cwd(), 'src/modules/compliance/compliance.service.ts'), 'utf8');
  assert.match(migration, /UNIQUE INDEX[\s\S]*cold_room_sessions\(tag_id\)[\s\S]*WHERE ended_at IS NULL/i);
  assert.match(compliance, /INSERT INTO cold_room_sessions[\s\S]*ON CONFLICT DO NOTHING/);
});
