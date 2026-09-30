import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { db } from '../../../db/pool';
import { reportsRouter } from '../reports.routes';
import { InspectionRow } from '../inspection-report.service';

test('API, Excel y PDF presentan el mismo acumulado con autenticación y detalle intacto', async () => {
  const originalConnect = db.connect;
  const originalQuery = db.query;
  const originalPdfText = PDFDocument.prototype.text;
  const pdfText: string[] = [];
  const sqlCalls: string[] = [];
  let role = 'supervisor';
  let releases = 0;
  const rows: InspectionRow[] = [
    { session_id: '00000000-0000-4000-8000-000000000001', worker_id: 'worker-a', worker_name: 'Ana', worker_dni: 'DNI1',
      tag_mac: 'TAG1', started_at: '2026-09-25T08:00:00Z', ended_at: '2026-09-25T08:30:10Z',
      exposure_ended_at: '2026-09-25T08:30:00Z', duration_seconds: 1800 },
    { session_id: '00000000-0000-4000-8000-000000000002', worker_id: 'worker-a', worker_name: 'Ana', worker_dni: 'DNI1',
      tag_mac: 'TAG2', started_at: '2026-09-25T08:15:00Z', ended_at: null,
      exposure_ended_at: '2026-09-25T09:00:00Z', duration_seconds: 2700 },
    { session_id: '00000000-0000-4000-8000-000000000003', worker_id: 'worker-b', worker_name: 'Bea', worker_dni: 'DNI2',
      tag_mac: 'TAG3', started_at: '2026-09-25T09:00:00Z', ended_at: null,
      exposure_ended_at: '2026-09-25T09:00:00Z', duration_seconds: 0 }
  ];
  const fakeClient = {
    async query(sql: string) {
      sqlCalls.push(sql);
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
      if (sql.includes('COUNT(*)::bigint AS total_rows')) return { rows: [{ total_rows: 3, critical_rows: 1, average_seconds: 1500 }] };
      if (sql.includes('ORDER BY s.started_at DESC')) return { rows };
      throw new Error('unexpected fixture query');
    },
    release() { releases++; }
  };
  (db as any).connect = async () => fakeClient;
  (db as any).query = async (_sql: string) => ({ rows: [{ id: 'fixture-user', email: 'fixture@example.invalid', role }] });
  (PDFDocument.prototype as any).text = function (...args: unknown[]) {
    if (typeof args[0] === 'string') pdfText.push(args[0]);
    return (originalPdfText as any).apply(this, args);
  };
  const app = express();
  app.use('/reports', reportsRouter);
  app.use((_error: unknown, _req: unknown, res: any, _next: unknown) => res.status(500).json({ error: 'fixture_failed' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as { port: number }).port;
  const fetchReport = (suffix: string, authenticated = true) => fetch(`http://127.0.0.1:${port}/reports/${suffix}`, {
    headers: authenticated ? { Authorization: 'Bearer fixture-token' } : {}
  });
  try {
    assert.equal((await fetchReport('inspection/daily', false)).status, 401);
    role = 'trabajador'; assert.equal((await fetchReport('inspection/daily')).status, 403);
    role = 'supervisor';
    assert.equal((await fetchReport('inspection/daily?from=2026-02-30')).status, 400);
    assert.equal((await fetchReport('inspection/daily?from=2026-10-01&to=2026-09-01')).status, 400);
    const json = await fetchReport('inspection/daily?from=2026-09-25&to=2026-09-25');
    assert.equal(json.status, 200);
    assert.equal(json.headers.get('cache-control'), 'private, no-store');
    const list = (await json.json()).rows;
    assert.deepEqual(list.map((entry: any) => [entry.workday_date, entry.full_name, entry.dni, entry.accumulated_seconds]),
      [['2026-09-25', 'Ana', 'DNI1', 3600], ['2026-09-25', 'Bea', 'DNI2', 0]]);

    const excel = await fetchReport('inspection.xlsx?from=2026-09-25&to=2026-09-25');
    assert.equal(excel.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await excel.arrayBuffer()) as any);
    assert.ok(workbook.getWorksheet('Inspección'));
    const sheet = workbook.getWorksheet('Acumulado por jornada')!;
    assert.deepEqual([sheet.getRow(3).getCell(1).value, sheet.getRow(3).getCell(2).value,
      sheet.getRow(3).getCell(3).value, sheet.getRow(3).getCell(4).value, sheet.getRow(3).getCell(5).value],
      ['2026-09-25', 'Ana', 'DNI1', '1:00:00', list[0].accumulated_seconds]);
    assert.equal(sheet.getRow(4).getCell(5).value, 0);
    assert.equal(workbook.getWorksheet('Inspección')!.rowCount, 6, 'session detail retains three sessions');

    const pdf = await fetchReport('inspection.pdf?from=2026-09-25&to=2026-09-25');
    assert.equal(pdf.status, 200);
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
    assert.ok(pdfText.includes('Acumulado por jornada · Europe/Madrid'));
    assert.ok(pdfText.includes(list[0].workday_date));
    assert.ok(pdfText.includes(list[0].full_name));
    assert.ok(pdfText.includes('1:00:00'));
    assert.ok(pdfText.includes('Salida confirmada'), 'session detail is still present');
    assert.ok(sqlCalls.some((sql) => sql.includes('s.started_at >=') && sql.includes('MAX(ps.last_presence_at)')));
    assert.ok(releases >= 3, 'snapshot client released after each export/list');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    (db as any).connect = originalConnect;
    (db as any).query = originalQuery;
    PDFDocument.prototype.text = originalPdfText;
  }
});
