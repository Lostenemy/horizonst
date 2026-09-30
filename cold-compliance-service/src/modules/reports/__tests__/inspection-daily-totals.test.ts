import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkerDailyAccumulator, accumulateWorkerWorkday } from '../../realtime/workday-duration';
import { InspectionRow, loadInspectionDailyTotals, consumeInspectionRows, loadInspectionSummary } from '../inspection-report.service';

const fixedNow = new Date('2026-09-30T12:00:00Z');
const row = (id: number, workerId: string, start: string, end: string, dni = 'DNI1'): InspectionRow => ({
  session_id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  worker_id: workerId, worker_name: `Trabajador ${workerId}`, worker_dni: dni, tag_mac: `TAG${id}`,
  started_at: start, exposure_ended_at: end, ended_at: end, duration_seconds: (Date.parse(end) - Date.parse(start)) / 1000
});
const single = (worker: string, start: string, end: string, id = 1) => row(id, worker, start, end);
function toDaily(sessions: InspectionRow[], filters: { from?: string; to?: string } = {}, now = fixedNow) {
  const accumulator = createWorkerDailyAccumulator(filters, now);
  for (const session of sessions) accumulator.add({ worker_id: session.worker_id, full_name: session.worker_name,
    dni: session.worker_dni, started_at: session.started_at, exposure_ended_at: session.exposure_ended_at });
  return accumulator.rows();
}

test('sesiones a ambos lados de medianoche: tramo diario, solapamiento y DNI independientes', () => {
  const sessions = [
    single('A', '2026-09-24T21:30:00Z', '2026-09-24T22:30:00Z', 1),
    single('A', '2026-09-24T22:10:00Z', '2026-09-24T23:15:00Z', 2),
    single('A', '2026-09-24T22:10:00Z', '2026-09-24T23:15:00Z', 3), // segunda gateway
    row(4, 'B', '2026-09-24T22:00:00Z', '2026-09-24T22:30:00Z', 'DNI2')
  ];
  const totals = toDaily(sessions);
  assert.deepEqual(totals.map((value) => [value.workday_date, value.worker_id, value.accumulated_seconds]), [
    ['2026-09-25', 'A', 75 * 60], ['2026-09-25', 'B', 30 * 60], ['2026-09-24', 'A', 30 * 60]
  ]);
  assert.deepEqual(toDaily(sessions, { from: '2026-09-25', to: '2026-09-25' }).map((value) => value.accumulated_seconds),
    [75 * 60, 30 * 60]);
  assert.deepEqual(toDaily(sessions, { to: '2026-09-24' }).map((value) => value.accumulated_seconds), [30 * 60]);
});

test('primera detección produce fila de cero; sesión abierta no suma silencio posterior', () => {
  const sessions = [
    single('A', '2026-09-25T07:00:00Z', '2026-09-25T07:00:00Z'),
    { ...single('B', '2026-09-25T07:00:00Z', '2026-09-25T07:10:00Z', 2), ended_at: null },
    single('B', '2026-09-25T07:05:00Z', '2026-09-25T07:15:00Z', 3)
  ];
  const totals = toDaily(sessions, {}, new Date('2026-09-25T08:00:00Z'));
  assert.equal(totals.find((value) => value.worker_id === 'A')?.accumulated_seconds, 0);
  assert.equal(totals.find((value) => value.worker_id === 'B')?.accumulated_seconds, 15 * 60);
});

test('el horario de verano/invierno conserva segundos reales en los días Madrid', () => {
  assert.deepEqual(toDaily([single('A', '2026-03-28T22:30:00Z', '2026-03-29T01:30:00Z')], {},
    new Date('2026-03-29T12:00:00Z')).map((value) => [value.workday_date, value.accumulated_seconds]),
  [['2026-03-29', 9000], ['2026-03-28', 1800]]);
  assert.deepEqual(toDaily([single('A', '2026-10-24T21:30:00Z', '2026-10-25T01:30:00Z')], {},
    new Date('2026-10-25T12:00:00Z')).map((value) => [value.workday_date, value.accumulated_seconds]),
  [['2026-10-25', 12600], ['2026-10-24', 1800]]);
});

test('las salidas simultáneas se unen también al superar seis horas, sin crear alarma', () => {
  const totals = toDaily([
    single('A', '2026-09-25T04:00:00Z', '2026-09-25T09:59:30Z'),
    single('A', '2026-09-25T08:00:00Z', '2026-09-25T09:00:00Z')
  ]);
  assert.equal(totals[0].accumulated_seconds, 6 * 3600 - 30);
  assert.equal(totals[0].progress_percent, 99.8);
});

test('la lista e informes leen exactamente el mismo agregado paginado que el panel', async () => {
  const rows = [single('A', '2026-09-25T08:00:00Z', '2026-09-25T08:40:00Z'),
    single('A', '2026-09-25T08:20:00Z', '2026-09-25T09:00:00Z', 2)];
  let page = 0;
  const query = async (sql: string, values: unknown[]) => {
    assert.match(sql, /ORDER BY s\.started_at DESC, s\.id DESC/);
    assert.equal(values.at(-1), 1);
    return rows.slice(page++, page);
  };
  const daily = await loadInspectionDailyTotals(query, { from: '2026-09-25', to: '2026-09-25' }, fixedNow, 1);
  const panel = accumulateWorkerWorkday(rows.map((value) => ({ worker_id: value.worker_id, full_name: value.worker_name,
    dni: value.worker_dni, started_at: value.started_at, exposure_ended_at: value.exposure_ended_at })),
    new Date('2026-09-25T12:00:00Z'));
  assert.equal(page, 3);
  assert.equal(daily[0].accumulated_seconds, 3600);
  assert.equal(daily[0].accumulated_seconds, panel[0].accumulated_seconds);
});

test('más de 2000 sesiones alimentan el acumulado sin límite lógico de registros', async () => {
  const fixture = Array.from({ length: 2505 }, (_, index) =>
    single('A', '2026-09-25T08:00:00Z', '2026-09-25T08:00:01Z', index + 1));
  let offset = 0;
  let calls = 0;
  const totals = await loadInspectionDailyTotals(async (_sql, values) => {
    calls++;
    const size = Number(values.at(-1));
    const page = fixture.slice(offset, offset + size);
    offset += page.length;
    return page;
  }, {}, fixedNow);
  assert.equal(offset, 2505);
  assert.equal(calls, 3);
  assert.equal(totals.length, 1);
  assert.equal(totals[0].accumulated_seconds, 1, 'simultaneous gateways count only once');
});

test('filtros idénticos en detalle y resumen: solapamiento y DNI literal', async () => {
  const calls: string[] = [];
  const filters = { from: '2026-09-25', to: '2026-09-26', workerDni: '12_%' };
  await consumeInspectionRows(async (sql, values) => { calls.push(sql); assert.deepEqual(values.slice(0, 3),
    ['2026-09-25', '2026-09-26', '%12\\_\\%%']); return []; }, filters, () => {});
  await loadInspectionSummary(async (sql, values) => { calls.push(sql); assert.deepEqual(values,
    ['2026-09-25', '2026-09-26', '%12\\_\\%%']); return {}; }, filters);
  assert.equal(calls.length, 2);
  for (const sql of calls) {
    assert.match(sql, /s\.started_at >= \(\$1::date::timestamp AT TIME ZONE 'Europe\/Madrid'\)/);
    assert.match(sql, /MAX\(ps\.last_presence_at\)/);
    assert.match(sql, /s\.started_at < \(\(\(\$2::date \+ 1\)::timestamp\) AT TIME ZONE 'Europe\/Madrid'\)/);
    assert.match(sql, /w\.dni ILIKE \$3 ESCAPE/);
  }
});
