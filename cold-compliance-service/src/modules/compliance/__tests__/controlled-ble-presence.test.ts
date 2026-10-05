import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldClosePresenceSession } from '../presence-timeout-policy';
import { evaluatePresenceSignal } from '../presence-signal-policy';
import { closeStaleSessions, processComplianceRules } from '../compliance.service';
import { db } from '../../../db/pool';
import { env } from '../../../config/env';
import { beginControlledPresenceOperation, finishControlledPresenceOperation, withControlledClient } from '../../tag-control/infrastructure/controlled-presence.repository';
import { executeAlarmSequence, executeConnectedTagCommandSequence } from '../../tag-control/application/tag-physical-alarm.service';
import { validateTechnicalTargets } from '../../tag-control/infrastructure/tag-control.repository';

test('a controlled 37 second BLE sequence retains the session until advertising can resume', () => {
  const start = Date.parse('2026-10-05T07:22:09.951Z');
  assert.equal(shouldClosePresenceSession({ nowMs: start + 31_000, lastPresenceAtMs: start,
    timeoutMs: 30_000, controlledOperation: { startedAtMs: start, hardDeadlineMs: start + 120_000,
      protectUntilMs: start + 120_000 } }), false);
  assert.equal(evaluatePresenceSignal({ gatewayRegistered: true, coldRoomId: null,
    hasOpenSession: true, rssi: -75, rssiThreshold: -75, entryMarginDb: 5 }).accepted, true);
});

const START = Date.parse('2026-10-05T07:22:09.951Z');
const sessionId = '11111111-1111-4111-8111-111111111111';
const tagId = '22222222-2222-4222-8222-222222222222';
const companyId = '33333333-3333-4333-8333-333333333333';
const candidate = { tagId, tagUid: 'c65b52531bdc', gatewayId: 'gw-1', gatewayMac: '142b2fe271b4', hardwareDeviceId: 13, hardwareGatewayId: 41 };

function databaseFixture() {
  const originalQuery = db.query; const originalConnect = db.connect;
  let lastPresence = START; let open = true; let opens = 1; let closes = 0;
  const detections = new Map<number, number>([[41, START]]);
  let operation: any = null; const writes: unknown[][] = []; const releases: boolean[] = [];
  const session = () => ({ id: sessionId, tag_id: tagId, hardware_device_id: 13, started_at: new Date(START).toISOString(),
    worker_id: null, cold_room_id: null, max_continuous_minutes: 10000, pre_alert_minutes: 10000, max_daily_minutes: 10000 });
  const query = async (sql: string, params: any[] = []) => {
    const result = (rows: unknown[]) => ({ rows, rowCount: rows.length });
    if (['BEGIN','COMMIT'].includes(sql)) return result([]);
    if (sql.startsWith('SELECT id FROM cold_room_sessions')) return result(open ? [{ id: sessionId }] : []);
    if (sql.includes('INSERT INTO controlled_b5_presence_operations')) {
      assert.match(sql, /ON CONFLICT \(hardware_device_id\)/);
      assert.match(sql, /last_presence_at.*protect_until/s);
      if (!open || Date.now() - lastPresence >= env.PRESENCE_EXIT_TIMEOUT_MS
          || (operation && (operation.until > Date.now() || lastPresence <= operation.until))) return result([]);
      operation = { id: params[1], started: Date.now(), deadline: Date.now() + 120_000, until: Date.now() + 120_000, outcome: 'running' };
      return result([{ hard_deadline: new Date(operation.deadline) }]);
    }
    if (sql.includes('UPDATE controlled_b5_presence_operations')) {
      if (operation?.id === params[1] && operation.outcome === 'running') {
        operation.until = Math.min(operation.deadline, Date.now() + 10_000); operation.outcome = params[2];
      }
      return result([]);
    }
    if (sql.includes('INSERT INTO ble_alarm_sessions') || sql.includes('UPDATE ble_alarm_sessions')) return result([{}]);
    if (sql.includes('SELECT physical_alarm_followup_delay_ms')) return result([{ physical_alarm_followup_delay_ms: 35000,
      physical_alarm_buzzer_duration_ms: 30000, physical_alarm_vibration_duration_ms: 30000 }]);
    if (sql.includes('MAX(ps.last_presence_at)') && sql.includes('FROM cold_room_sessions s')) return result(open ? [{ ...session(),
      last_seen_at: new Date(lastPresence).toISOString(), control_started_at: operation ? new Date(operation.started).toISOString() : null,
      timeout_ended_at: new Date(Math.max(lastPresence + env.PRESENCE_EXIT_TIMEOUT_MS, Math.min(Date.now(), operation?.until ?? 0))).toISOString(),
      control_deadline: operation ? new Date(operation.deadline).toISOString() : null,
      control_until: operation ? new Date(operation.until).toISOString() : null }] : []);
    if (sql.startsWith('UPDATE cold_room_sessions')) {
      assert.match(sql, /op\.session_id = cold_room_sessions\.id/);
      assert.match(sql, /\$5::text <> 'timeout'/);
      if (!open || (operation?.until > Date.now()) || lastPresence > Date.parse(params[3])) return result([]);
      writes.push(params); open = false; closes++; return result([session()]);
    }
    if (sql.includes('FROM tags t') && sql.includes('g.rssi_threshold')) return result([{ id: tagId, hardware_device_id: 13,
      gateway_id: 'gw-1', hardware_gateway_id: params[0], rssi_threshold: -75, cold_room_id: null }]);
    if (sql.includes('SELECT 1') && sql.includes('FROM cold_room_sessions s')) return result(open ? [{}] : []);
    if (sql.includes('UPDATE tag_gateway_presence_state')) {
      detections.set(params[2], Math.max(detections.get(params[2]) ?? -Infinity, Date.parse(params[0])));
      lastPresence = Math.max(...detections.values()); return result([{}]);
    }
    if (sql.includes('INSERT INTO cold_room_sessions')) { if (!open) { open = true; opens++; } return result([]); }
    if (sql.includes('FROM cold_room_sessions s') && sql.includes('ORDER BY s.started_at')) return result(open ? [session()] : []);
    if (sql.includes('FROM alarm_rules') && sql.includes('SELECT id, description')) return result([]);
    if (sql.includes('grace_minutes')) return result([{ grace_minutes: 15 }]);
    if (sql.includes('presence_operational_state') || sql.includes('workday_accumulators')) return result([]);
    throw new Error('unexpected simulated SQL');
  };
  (db as any).query = query;
  (db as any).connect = async () => ({ query, release: (destroy = false) => releases.push(destroy) });
  return { query, get operation() { return operation; }, get lastPresence() { return lastPresence; },
    get opens() { return opens; }, get closes() { return closes; }, writes, releases, detections,
    restore() { db.query = originalQuery; db.connect = originalConnect; } };
}

async function heartbeat(time: number, rssi: number, gateway = 41) {
  await processComplianceRules({ eventId: `event-${time}-${gateway}`, tagId: candidate.tagUid, gatewayMac: candidate.gatewayMac,
    eventType: 'heartbeat', timestamp: new Date(time).toISOString(), rssi, rawPayload: {} }, {
    source: 'central', tagMac: candidate.tagUid, gatewayMac: candidate.gatewayMac,
    hardwareDeviceId: 13, hardwareGatewayId: gateway, device: null, gateway: null
  });
}

test('sweep transports exact SQL timestamps without reconstructing concurrency or confirmation boundaries as Date', async t => {
  t.mock.timers.enable({ apis: ['Date','setTimeout'], now: START + 40_000 });
  const fixture = databaseFixture();
  const exact = '2026-10-05 07:22:09.951456+00';
  const confirmed = '2026-10-05 07:22:39.951456+00';
  const intercepted = async (sql: string, values: any[] = []) => {
    if (sql.includes('AS last_seen_at')) {
      assert.match(sql, /COALESCE\(MAX\(ps\.last_presence_at\), s\.started_at\)::text/);
      assert.match(sql, /::text AS timeout_ended_at/);
      assert.equal(values[3],30_000);
      const result = await fixture.query(sql,values);
      return { ...result, rows: result.rows.map((row: any) => ({...row,last_seen_at:exact,timeout_ended_at:confirmed})) };
    }
    if (sql.startsWith('UPDATE cold_room_sessions')) {
      assert.equal(values[0],confirmed); assert.equal(values[3],exact);
      assert.equal(values[5],30_000);
      assert.match(sql, /ps\.last_presence_at > \$4::timestamptz/);
      assert.match(sql, /\$4::timestamptz \+ \(\$6::double precision \* INTERVAL '1 millisecond'\) < clock_timestamp\(\)/);
    }
    return fixture.query(sql,values);
  };
  (db as any).connect = async () => ({query:intercepted,release() {}});
  try { await closeStaleSessions(); assert.equal(fixture.closes,1); }
  finally { fixture.restore(); }
});

test('actual sweep and connected executor preserve a nullable session through 37s silence and -75 maintenance heartbeat', async t => {
  t.mock.timers.enable({ apis: ['Date','setTimeout'], now: START });
  const fixture = databaseFixture(); const calls: string[] = [];
  try {
    const operation = await beginControlledPresenceOperation({ tagId, hardwareDeviceId: 13, companyId, alertId: 'alert-one' });
    assert.ok(operation && operation !== 'busy');
    assert.equal(await beginControlledPresenceOperation({ tagId, hardwareDeviceId: 13, companyId, alertId: 'concurrent' }), 'busy');
    const result = await executeConnectedTagCommandSequence({ tagId, tagUid: candidate.tagUid, candidates: [candidate],
      deps: { connect: async () => { calls.push('1150'); return 'accepted_unverified'; },
        disconnect: async () => { calls.push('1200'); return 'confirmed'; }, markActive: async () => {}, markDisconnected: async () => {} },
      runActions: async () => {
        calls.push('1160'); t.mock.timers.tick(31_000); await closeStaleSessions(); assert.equal(fixture.closes, 0);
        await heartbeat(START + 30_000, -76); assert.equal(fixture.lastPresence, START);
        t.mock.timers.tick(6000); calls.push('1169'); return 'confirmed';
      } });
    assert.equal(result.status, 'attempted_unverified');
    await finishControlledPresenceOperation(operation, 'unverified');
    t.mock.timers.tick(2000); await closeStaleSessions(); assert.equal(fixture.closes, 0);
    await heartbeat(START + 39_000, -75); // would fail entry at -70 if the session had closed
    await heartbeat(START + 35_000, -70, 42); // older packet from another gateway cannot move time backwards
    await heartbeat(START + 39_000, -75); // duplicate
    assert.equal(fixture.lastPresence, START + 39_000);
    assert.equal(fixture.detections.get(42), START + 35_000);
    assert.equal(fixture.opens, 1); assert.deepEqual(calls, ['1150','1160','1169','1200']);
    t.mock.timers.tick(31_000); await closeStaleSessions();
    assert.equal(fixture.closes, 1); assert.equal(fixture.writes[0][3], new Date(START + 39_000).toISOString());
  } finally { fixture.restore(); }
});

test('failure, ambiguous disconnect and restart retain only bounded recovery; expiry cannot be renewed without detection', async t => {
  t.mock.timers.enable({ apis: ['Date','setTimeout'], now: START });
  const fixture = databaseFixture();
  try {
    const operation = await beginControlledPresenceOperation({ tagId, hardwareDeviceId: 13, companyId, alertId: 'failure' });
    assert.ok(operation && operation !== 'busy');
    t.mock.timers.tick(37_000); await finishControlledPresenceOperation(operation, 'failed');
    t.mock.timers.tick(10_000); await closeStaleSessions(); assert.equal(fixture.closes, 1);
    // A restarted process reads persisted deadlines, not an in-memory Set or is_active flag.
    assert.equal(shouldClosePresenceSession({ nowMs: START + 120_000, lastPresenceAtMs: START, timeoutMs: 30_000,
      controlledOperation: { startedAtMs: START, hardDeadlineMs: START + 120_000, protectUntilMs: START + 120_000 } }), true);
    assert.equal(await beginControlledPresenceOperation({ tagId, hardwareDeviceId: 13, companyId, alertId: 'closed' }), null);
  } finally { fixture.restore(); }
});

test('an abandoned executor cannot hold presence beyond 120s and the persisted deadline survives restart', async t => {
  t.mock.timers.enable({ apis: ['Date','setTimeout'], now: START });
  const fixture = databaseFixture();
  try {
    assert.ok(await beginControlledPresenceOperation({ tagId, hardwareDeviceId: 13, companyId, alertId: 'first' }));
    t.mock.timers.tick(119_000); await closeStaleSessions(); assert.equal(fixture.closes, 0);
    t.mock.timers.tick(1000); await closeStaleSessions(); assert.equal(fixture.closes, 1);
  } finally { fixture.restore(); }
});

test('a stalled disconnect has its own finite budget and cannot leave the local sequence pending', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const controller = new AbortController(); let closed = false;
  const run = executeConnectedTagCommandSequence({ tagId, tagUid: candidate.tagUid, candidates: [candidate], signal: controller.signal,
    deps: { connect: async () => 'ambiguous', disconnect: async () => new Promise(() => {}),
      markActive: async () => {}, markDisconnected: async args => { assert.equal(args.confirmed, false); closed = true; } },
    runActions: async () => 'confirmed' });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  t.mock.timers.tick(env.HARDWARE_MANAGER_COMMAND_TIMEOUT_MS);
  assert.equal((await run).status, 'attempted_unverified'); assert.equal(closed, true);
});

test('a new accepted packet after recovery permits a legitimate later alarm; an old completion cannot release its protection', async t => {
  t.mock.timers.enable({ apis: ['Date','setTimeout'], now: START }); const fixture = databaseFixture();
  try {
    const first = await beginControlledPresenceOperation({ tagId, hardwareDeviceId: 13, companyId, alertId: 'first' });
    assert.ok(first && first !== 'busy'); t.mock.timers.tick(37000); await finishControlledPresenceOperation(first, 'unverified');
    t.mock.timers.tick(15000); await heartbeat(START + 52_000, -70, 42);
    const second = await beginControlledPresenceOperation({ tagId, hardwareDeviceId: 13, companyId, alertId: 'legitimate-later' });
    assert.ok(second && second !== 'busy'); assert.notEqual(second.operationId, first.operationId);
    await finishControlledPresenceOperation(first, 'failed'); assert.equal(fixture.operation.outcome, 'running');
    await finishControlledPresenceOperation(second, 'confirmed'); assert.equal(fixture.operation.outcome, 'confirmed');
  } finally { fixture.restore(); }
});

test('the complete automatic alarm uses its persisted guard and the original durations with a simulated transport', async t => {
  t.mock.timers.enable({ apis: ['Date','setTimeout'], now: START }); const fixture = databaseFixture();
  const repository = require('../../tag-control/infrastructure/tag-control.repository');
  const ble = require('../../tag-control/infrastructure/ble-session.repository');
  const transport = require('../../hardware-manager/hardware-command.client');
  const originals = [repository.resolveTagTargets, ble.isBleSessionActive, transport.executeHardwareB5Command];
  const physicalEnabled = env.TAG_ALARM_PHYSICAL_ENABLED; (env as any).TAG_ALARM_PHYSICAL_ENABLED = true;
  const calls: Array<{ command: string; durationMs?: number }> = [];
  repository.resolveTagTargets = async () => [{ ...candidate, companyId }]; ble.isBleSessionActive = async () => false;
  transport.executeHardwareB5Command = async (args: any) => { calls.push({ command: args.command, durationMs: args.durationMs });
    return args.command === 'connect' ? 'accepted_unverified' : 'confirmed'; };
  const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
  try {
    const running = executeAlarmSequence({ tagId, severity: 'critical', alertType: 'alarm_rule_alarm', alertId: 'automatic' });
    await flush(); assert.equal(calls[0].command, 'connect');
    assert.equal((await executeAlarmSequence({ tagId, severity: 'critical', alertType: 'alarm_rule_alarm', alertId: 'concurrent-alarm' })).status, 'skipped');
    assert.equal(calls.filter(c => c.command === 'connect').length, 1);
    t.mock.timers.tick(env.TAG_ALARM_POST_CONNECT_DELAY_MS); await flush();
    assert.equal(calls[1].command, 'buzzer');
    t.mock.timers.tick(31_000); await closeStaleSessions(); assert.equal(fixture.closes, 0);
    t.mock.timers.tick(4000); await flush();
    const result = await running; assert.equal(result.status, 'attempted_unverified');
    assert.deepEqual(calls.map(c => c.command), ['connect','buzzer','vibration','disconnect']);
    assert.deepEqual(calls.filter(c => c.durationMs).map(c => c.durationMs), [30000,30000]);
    assert.equal(fixture.operation.outcome, 'unverified');
    await heartbeat(Date.now(), -75); assert.equal(fixture.opens, 1);
  } finally {
    [repository.resolveTagTargets, ble.isBleSessionActive, transport.executeHardwareB5Command] = originals;
    (env as any).TAG_ALARM_PHYSICAL_ENABLED = physicalEnabled; fixture.restore();
  }
});

test('expired control aborts a pending connect once without another gateway attempt or action', async () => {
  const controller = new AbortController(); let connects = 0; let disconnects = 0; let actions = 0;
  const run = executeConnectedTagCommandSequence({ tagId, tagUid: candidate.tagUid, candidates: [candidate, candidate], signal: controller.signal,
    deps: { connect: async () => { connects++; return new Promise(() => {}); },
      disconnect: async () => { disconnects++; }, markActive: async () => {}, markDisconnected: async () => {} },
    runActions: async () => { actions++; } });
  controller.abort(); await assert.rejects(run, /controlled_ble_operation_expired/);
  assert.deepEqual([connects,disconnects,actions], [1,1,0]);
});

test('invalid/unbounded protection is ignored and ordinary BLE active state has no presence authority', () => {
  for (const guard of [{ startedAtMs: START, hardDeadlineMs: START + 121_000, protectUntilMs: START + 121_000 },
    { startedAtMs: START, hardDeadlineMs: NaN, protectUntilMs: Infinity }]) {
    assert.equal(shouldClosePresenceSession({ nowMs: START + 31_000, lastPresenceAtMs: START, timeoutMs: 30_000, controlledOperation: guard }), true);
  }
});

test('failed connection and failed/ambiguous disconnect leave only finite recovery, without retrying the sequence', async t => {
  t.mock.timers.enable({ apis: ['Date','setTimeout'], now: START });
  for (const failure of ['connect', 'disconnect', 'ambiguous']) {
    t.mock.timers.setTime(START); const fixture = databaseFixture(); let connects = 0;
    try {
      const operation = await beginControlledPresenceOperation({ tagId, hardwareDeviceId: 13, companyId, alertId: failure });
      assert.ok(operation && operation !== 'busy');
      const result = await executeConnectedTagCommandSequence({ tagId, tagUid: candidate.tagUid, candidates: [candidate],
        deps: { connect: async () => { connects++; if (failure === 'connect') throw new Error('connect rejected'); return 'ambiguous'; },
          disconnect: async () => { if (failure === 'disconnect') throw new Error('disconnect failed'); return 'ambiguous'; },
          markActive: async () => {}, markDisconnected: async args => assert.equal(args.confirmed, false) },
        runActions: async () => { t.mock.timers.tick(37_000); return 'confirmed'; } });
      assert.equal(result.status, failure === 'connect' ? 'failed_no_gateway_connected' : 'attempted_unverified');
      await finishControlledPresenceOperation(operation, failure === 'connect' ? 'failed' : 'unverified');
      assert.equal(connects, 1); assert.ok(fixture.operation.until <= operation.deadlineMs);
      t.mock.timers.tick(40_000); await closeStaleSessions(); assert.equal(fixture.closes, 1);
    } finally { fixture.restore(); }
  }
});

test('technical command targets reject cross-company pairs before any protection or physical action', async () => {
  const previous = env.HARDWARE_MANAGER_ENABLED; (env as any).HARDWARE_MANAGER_ENABLED = true;
  try {
    const found = (company: string) => ({ kind: 'found' as const, value: { id: 13, active: true, status: 'active', device_type: 'b5',
      ble_mac: candidate.tagUid, mac_address: candidate.gatewayMac, company_id: company,
      type_policy: { known: true, typeActive: true, companyAllowed: true, horneoCompatible: true } } as any });
    assert.deepEqual(await validateTechnicalTargets([candidate], { lookupDeviceById: async () => found(companyId),
      lookupGatewayById: async () => found('44444444-4444-4444-8444-444444444444') }), []);
    assert.equal((await validateTechnicalTargets([candidate], { lookupDeviceById: async () => found(companyId),
      lookupGatewayById: async () => found(companyId) }))[0].companyId, companyId);
  } finally { (env as any).HARDWARE_MANAGER_ENABLED = previous; }
});

test('stalled acquisition destroys a late connection once and cannot leave a borrowed session lock', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originalConnect = db.connect; let resolve!: (value: any) => void; const releases: boolean[] = [];
  (db as any).connect = () => new Promise(value => { resolve = value; });
  try {
    const pending = withControlledClient(async () => 'should-not-run');
    const rejected = assert.rejects(pending, /controlled_presence_database_timeout/);
    t.mock.timers.tick(2000); await rejected;
    resolve({ release: (destroy: boolean) => releases.push(destroy) }); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(releases, [true]);
  } finally { db.connect = originalConnect; }
});

test('stalled query destroys the borrowed connection; ordinary completion releases it only once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); const originalConnect = db.connect; const released: boolean[] = [];
  (db as any).connect = async () => ({ release: (destroy: boolean) => released.push(destroy) });
  try {
    const pending = withControlledClient(async () => new Promise(() => {}));
    const rejected = assert.rejects(pending, /controlled_presence_database_timeout/);
    await Promise.resolve(); t.mock.timers.tick(2000); await rejected;
    assert.deepEqual(released, [true]);
    assert.equal(await withControlledClient(async () => 42), 42); assert.deepEqual(released, [true,false]);
  } finally { db.connect = originalConnect; }
});
