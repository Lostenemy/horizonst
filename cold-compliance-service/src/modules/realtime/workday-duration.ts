import { MADRID_TIMEZONE } from '../../utils/datetime';

export const WORKDAY_LIMIT_SECONDS = 6 * 60 * 60;

const madridParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: MADRID_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function localParts(instant: Date): Record<string, number> {
  return Object.fromEntries(madridParts.formatToParts(instant)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)]));
}

function madridMidnightUtc(year: number, month: number, day: number): number {
  const wallTime = Date.UTC(year, month - 1, day);
  let instant = wallTime;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = localParts(new Date(instant));
    const observedWallTime = Date.UTC(parts.year, parts.month - 1, parts.day,
      parts.hour, parts.minute, parts.second);
    instant += wallTime - observedWallTime;
  }
  return instant;
}

export function madridWorkdayWindow(now: Date): { start: Date; end: Date } {
  const { year, month, day } = localParts(now);
  return {
    start: new Date(madridMidnightUtc(year, month, day)),
    end: new Date(madridMidnightUtc(year, month, day + 1))
  };
}

export interface WorkdaySession {
  worker_id: string;
  full_name: string;
  dni: string;
  started_at: Date | string;
  ended_at: Date | string | null;
}

export interface WorkerWorkdayTotal {
  worker_id: string;
  full_name: string;
  dni: string;
  accumulated_seconds: number;
  limit_seconds: number;
  progress_percent: number;
}

export function accumulateWorkerWorkday(sessions: WorkdaySession[], now: Date): WorkerWorkdayTotal[] {
  const { start, end } = madridWorkdayWindow(now);
  const dayStart = start.getTime();
  const dayEnd = Math.min(now.getTime(), end.getTime());
  const workers = new Map<string, { name: string; dni: string; intervals: Array<[number, number]> }>();

  for (const session of sessions) {
    if (!session.worker_id) continue;
    const started = new Date(session.started_at).getTime();
    const ended = session.ended_at === null ? dayEnd : new Date(session.ended_at).getTime();
    if (!Number.isFinite(started) || !Number.isFinite(ended)) continue;
    const from = Math.max(started, dayStart);
    const to = Math.min(ended, dayEnd);
    if (to < from) continue;
    const worker = workers.get(session.worker_id) ?? {
      name: session.full_name, dni: session.dni, intervals: []
    };
    worker.intervals.push([from, to]);
    workers.set(session.worker_id, worker);
  }

  return [...workers].map(([workerId, worker]) => {
    worker.intervals.sort((a, b) => a[0] - b[0]);
    let totalMs = 0;
    let [from, to] = worker.intervals[0];
    for (const [nextFrom, nextTo] of worker.intervals.slice(1)) {
      if (nextFrom <= to) to = Math.max(to, nextTo);
      else {
        totalMs += to - from;
        [from, to] = [nextFrom, nextTo];
      }
    }
    totalMs += to - from;
    const accumulatedSeconds = Math.floor(totalMs / 1000);
    return {
      worker_id: workerId, full_name: worker.name, dni: worker.dni,
      accumulated_seconds: accumulatedSeconds,
      limit_seconds: WORKDAY_LIMIT_SECONDS,
      progress_percent: Math.round(accumulatedSeconds / WORKDAY_LIMIT_SECONDS * 100)
    };
  }).sort((a, b) => b.accumulated_seconds - a.accumulated_seconds || a.full_name.localeCompare(b.full_name));
}
