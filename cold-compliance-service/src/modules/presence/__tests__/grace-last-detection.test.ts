import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../../../db/pool';
import { graceWindow } from '../grace-window';
import { markPresenceExit } from '../presence-state.service';

test('grace starts exactly at the last detection, not at timeout closure', () => {
  const lastDetection = '2026-09-25T10:00:17.000Z';
  assert.deepEqual(graceWindow(lastDetection, 15), {
    startedAt: lastDetection, until: '2026-09-25T10:15:17.000Z'
  });
  assert.deepEqual(graceWindow(lastDetection, 15), graceWindow(lastDetection, 15));
  assert.deepEqual(graceWindow(new Date(lastDetection), 15), graceWindow(lastDetection, 15));
  assert.equal(graceWindow('2026-09-25T10:00:16.000Z', 15).until, '2026-09-25T10:15:16.000Z');
});

test('exit persists the last packet timestamp and exact expiry while retaining alarm-only grace conditions', async () => {
  const originalQuery = db.query;
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  db.query = (async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    return calls.length === 1 ? { rows: [{ grace_minutes: 15 }] } : { rows: [], rowCount: 1 };
  }) as typeof db.query;
  try {
    await markPresenceExit('tag-1', 42, '2026-09-25T10:00:17Z');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].values, [42, '2026-09-25T10:00:17.000Z', '2026-09-25T10:15:17.000Z']);
    assert.match(calls[1].sql, /in_grace = CASE WHEN in_alarm OR last_alarm_at IS NOT NULL THEN TRUE/);
    assert.match(calls[1].sql, /AND inside = TRUE/);
    assert.match(calls[1].sql, /NOT EXISTS \([\s\S]*cold_room_sessions s[\s\S]*s\.ended_at IS NULL/);
  } finally {
    db.query = originalQuery;
  }
});

test('timeout uses the latest relevant gateway packet and stale exits cannot close a newer presence', () => {
  const source = readFileSync(join(process.cwd(), 'src/modules/compliance/compliance.service.ts'), 'utf8');
  assert.match(source, /MAX\(ps\.last_presence_at\)/);
  assert.match(source, /ps\.last_presence_at >= s\.started_at/);
  assert.match(source, /seen_gateway\.cold_room_id = s\.cold_room_id/);
  assert.match(source, /finalizeSession\(session, closedAt, null, 'timeout', session\.last_seen_at\)/);
  assert.match(source, /ps\.last_presence_at > \$4::timestamptz/);
  assert.match(source, /new Date\(event\.timestamp\)\.getTime\(\) <= new Date\(latestClosed\.rows\[0\]\.ended_at\)\.getTime\(\)/);
  assert.ok(source.indexOf('await upsertOpenSession(tag, event);') < source.indexOf('await markPresenceEnter(tag, event.timestamp);'));
});

test('timeout closure remains delayed while stored exposure, daily accumulation and grace use the packet time', () => {
  const source = readFileSync(join(process.cwd(), 'src/modules/compliance/compliance.service.ts'), 'utf8');
  assert.match(source, /shouldClosePresenceSession\(\{ nowMs, lastPresenceAtMs: referenceTs, timeoutMs \}\)/);
  assert.match(source, /const closedAt = new Date\(referenceTs \+ timeoutMs\)\.toISOString\(\)/);
  assert.match(source, /const exposureEndedAt = reason === 'timeout' \? lastDetectionAt : endedAt/);
  assert.match(source, /duration_seconds = CASE WHEN \$5::text = 'timeout'[\s\S]*\$4::timestamptz - started_at[\s\S]*ELSE GREATEST\(0, EXTRACT\(EPOCH FROM \(\$1::timestamptz - started_at\)\)\)::int/);
  assert.match(source, /madridExposureSegments\(closed\.started_at, exposureEndedAt\)/);
  assert.match(source, /jsonb_array_elements\(\$1::jsonb\)/);
  assert.match(source, /\[JSON\.stringify\(daySegments\), closed\.worker_id, closed\.cold_room_id\]/);
  assert.match(source, /markPresenceExit\(closed\.tag_id, closed\.hardware_device_id, lastDetectionAt\)/);
  assert.match(source, /finalizeSession\(activeSessionRes\.rows\[0\], event\.timestamp, event\.eventId, 'event', event\.timestamp\)/);
  assert.match(source, /SET last_presence_at = GREATEST/);
});
