import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluatePresenceSignal } from '../presence-signal-policy';
import { shouldClosePresenceSession } from '../presence-timeout-policy';

const complianceSource = readFileSync(join(process.cwd(), 'src/modules/compliance/compliance.service.ts'), 'utf8');

test('registered gateway without cold room accepts valid RSSI and can open a nullable session', () => {
  const decision = evaluatePresenceSignal({ gatewayRegistered: true, coldRoomId: null, hasOpenSession: false, rssi: -84, rssiThreshold: -90, entryMarginDb: 5 });
  assert.deepEqual(decision, { accepted: true, requiredRssi: -85 });
  assert.doesNotMatch(complianceSource, /!tag\.gateway_id \|\| !tag\.cold_room_id/);
  assert.match(complianceSource, /await upsertOpenSession\(tag, event\)/);
  assert.match(complianceSource, /INSERT INTO cold_room_sessions\(worker_id, tag_id, hardware_device_id, cold_room_id/);
});

test('registered gateway without cold room rejects RSSI below entry threshold plus margin', () => {
  assert.deepEqual(
    evaluatePresenceSignal({ gatewayRegistered: true, coldRoomId: null, hasOpenSession: false, rssi: -86, rssiThreshold: -90, entryMarginDb: 5 }),
    { accepted: false, requiredRssi: -85, reason: 'rssi_below_threshold' }
  );
});

test('open nullable session uses base threshold and valid heartbeat renews last_presence_at', () => {
  assert.deepEqual(
    evaluatePresenceSignal({ gatewayRegistered: true, coldRoomId: null, hasOpenSession: true, rssi: -89, rssiThreshold: -90, entryMarginDb: 5 }),
    { accepted: true, requiredRssi: -90 }
  );
  assert.match(complianceSource, /SET last_presence_at = GREATEST/);
});

test('nullable session closes after the 45 second timeout', () => {
  const lastPresenceAtMs = Date.parse('2026-08-26T11:25:31.074Z');
  assert.equal(shouldClosePresenceSession({ nowMs: lastPresenceAtMs + 45_001, lastPresenceAtMs, timeoutMs: 45_000 }), true);
  assert.match(complianceSource, /s\.cold_room_id IS NULL OR EXISTS/);
});

test('configured cold-room installations use the same accepted RSSI path', () => {
  const configuredCameraDecision = evaluatePresenceSignal({ gatewayRegistered: true, coldRoomId: 'cold-room-1', hasOpenSession: false, rssi: -70, rssiThreshold: -80, entryMarginDb: 5 });
  assert.equal(configuredCameraDecision.accepted, true);
  assert.match(complianceSource, /cr\.id as cold_room_id/);
});
