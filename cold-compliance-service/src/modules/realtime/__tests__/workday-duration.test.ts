import test from 'node:test';
import assert from 'node:assert/strict';
import { accumulateWorkerWorkday, madridExposureSegments, madridWorkdayWindow, WorkdaySession, WORKDAY_LIMIT_SECONDS } from '../workday-duration';

const worker = (started_at: string, exposure_ended_at: string, worker_id = 'worker-1'): WorkdaySession => ({
  worker_id, full_name: worker_id, dni: worker_id, started_at, exposure_ended_at
});

test('sums entries and exits, keeps a worker after leaving, and includes an open session', () => {
  const rows = accumulateWorkerWorkday([
    worker('2026-09-25T07:00:00Z', '2026-09-25T08:00:00Z'),
    worker('2026-09-25T08:30:00Z', '2026-09-25T09:00:00Z'),
    worker('2026-09-25T09:15:00Z', '2026-09-25T10:00:00Z'),
    worker('2026-09-25T07:00:00Z', '2026-09-25T07:20:00Z', 'already-left')
  ], new Date('2026-09-25T10:00:00Z'));
  assert.equal(rows.find((row) => row.worker_id === 'worker-1')?.accumulated_seconds, 2 * 3600 + 15 * 60);
  assert.equal(rows.find((row) => row.worker_id === 'already-left')?.accumulated_seconds, 20 * 60);
});

test('a worker appears from the first detection, even before one second has accrued', () => {
  const rows = accumulateWorkerWorkday([
    worker('2026-09-25T09:00:00Z', '2026-09-25T09:00:00Z')
  ], new Date('2026-09-25T09:00:00Z'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].accumulated_seconds, 0);
});

test('overlapping and duplicate gateway sessions count only once per worker', () => {
  const rows = accumulateWorkerWorkday([
    worker('2026-09-25T08:00:00Z', '2026-09-25T09:00:00Z'),
    worker('2026-09-25T08:30:00Z', '2026-09-25T09:30:00Z'),
    worker('2026-09-25T08:00:00Z', '2026-09-25T09:00:00Z')
  ], new Date('2026-09-25T10:00:00Z'));
  assert.equal(rows[0].accumulated_seconds, 90 * 60);
});

test('six hours is 100 percent and extra time remains visible without capping or triggering action', () => {
  const atLimit = accumulateWorkerWorkday([
    worker('2026-09-25T05:00:00Z', '2026-09-25T11:00:00Z')
  ], new Date('2026-09-25T11:00:00Z'))[0];
  const overLimit = accumulateWorkerWorkday([
    worker('2026-09-25T05:00:00Z', '2026-09-25T11:06:00Z')
  ], new Date('2026-09-25T11:06:00Z'))[0];
  assert.equal(atLimit.accumulated_seconds, WORKDAY_LIMIT_SECONDS);
  assert.equal(atLimit.progress_percent, 100);
  assert.equal(overLimit.accumulated_seconds, WORKDAY_LIMIT_SECONDS + 360);
  assert.equal(overLimit.progress_percent, 101.6);
});

test('quiet time after the last packet does not turn 5h59m30 of exposure into six hours', () => {
  const nearLimit = accumulateWorkerWorkday([
    worker('2026-09-25T04:00:00Z', '2026-09-25T09:59:30Z')
  ], new Date('2026-09-25T10:00:30Z'))[0];
  assert.equal(nearLimit.accumulated_seconds, WORKDAY_LIMIT_SECONDS - 30);
  assert.equal(nearLimit.progress_percent, 99.8);
});

test('a closed timeout interval and a later reentry are added without counting the quiet gap', () => {
  const rows = accumulateWorkerWorkday([
    worker('2026-09-25T08:00:00Z', '2026-09-25T08:10:00Z'),
    worker('2026-09-25T08:10:20Z', '2026-09-25T08:12:00Z')
  ], new Date('2026-09-25T08:12:40Z'));
  assert.equal(rows[0].accumulated_seconds, 11 * 60 + 40);
});

test('Madrid midnight clips sessions and excludes a worker with no time in the current day', () => {
  const rows = accumulateWorkerWorkday([
    worker('2026-09-24T21:00:00Z', '2026-09-24T23:30:00Z'),
    worker('2026-09-24T20:00:00Z', '2026-09-24T21:00:00Z', 'previous-day')
  ], new Date('2026-09-25T00:00:00Z'));
  assert.equal(rows[0].accumulated_seconds, 90 * 60);
  assert.equal(rows.some((row) => row.worker_id === 'previous-day'), false);
});

test('Madrid spring and autumn clock changes use real elapsed time and local calendar boundaries', () => {
  assert.deepEqual(madridWorkdayWindow(new Date('2026-03-29T12:00:00Z')), {
    start: new Date('2026-03-28T23:00:00Z'), end: new Date('2026-03-29T22:00:00Z')
  });
  assert.deepEqual(madridWorkdayWindow(new Date('2026-10-25T12:00:00Z')), {
    start: new Date('2026-10-24T22:00:00Z'), end: new Date('2026-10-25T23:00:00Z')
  });
  const spring = accumulateWorkerWorkday([
    worker('2026-03-28T22:30:00Z', '2026-03-29T02:30:00Z')
  ], new Date('2026-03-29T03:00:00Z'));
  const autumn = accumulateWorkerWorkday([
    worker('2026-10-25T00:30:00Z', '2026-10-25T02:30:00Z')
  ], new Date('2026-10-25T03:00:00Z'));
  assert.equal(spring[0].accumulated_seconds, 3 * 3600 + 30 * 60);
  assert.equal(autumn[0].accumulated_seconds, 2 * 3600);
});

test('closed exposure is allocated to both Madrid dates across midnight and DST', () => {
  assert.deepEqual(madridExposureSegments('2026-09-24T21:30:00Z', '2026-09-24T22:30:00Z'), [
    { date: '2026-09-24', seconds: 1800 }, { date: '2026-09-25', seconds: 1800 }
  ]);
  assert.deepEqual(madridExposureSegments('2026-03-28T22:30:00Z', '2026-03-29T01:30:00Z'), [
    { date: '2026-03-28', seconds: 1800 }, { date: '2026-03-29', seconds: 9000 }
  ]);
  assert.deepEqual(madridExposureSegments('2026-10-24T21:30:00Z', '2026-10-25T01:30:00Z'), [
    { date: '2026-10-24', seconds: 1800 }, { date: '2026-10-25', seconds: 12600 }
  ]);
  assert.deepEqual(madridExposureSegments('2026-09-24T21:30:00.500Z', '2026-09-24T22:30:00.500Z'), [
    { date: '2026-09-24', seconds: 1799 }, { date: '2026-09-25', seconds: 1801 }
  ]);
});
