import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { db } from '../../db/pool';

export const reportsRouter = Router();
const outDir = path.resolve(process.cwd(), 'tmp-reports');
fs.mkdirSync(outDir, { recursive: true });

reportsRouter.get('/daily-summary.xlsx', async (req, res, next) => {
  try {
    const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
    const rows = (
      await db.query(
        `SELECT w.full_name, w.dni, cr.name as cold_room, wa.accumulated_seconds
         FROM workday_accumulators wa
         JOIN workers w ON w.id = wa.worker_id
         LEFT JOIN cold_rooms cr ON cr.id = wa.cold_room_id
         WHERE wa.workday_date = $1
         ORDER BY wa.accumulated_seconds DESC`,
        [date]
      )
    ).rows;

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Resumen diario');
    ws.addRow(['Trabajador', 'DNI', 'Cámara', 'Minutos efectivos']);
    rows.forEach((r) => ws.addRow([r.full_name, r.dni, r.cold_room, Number(r.accumulated_seconds) / 60]));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="daily-summary-${date}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { next(e); }
});

reportsRouter.get('/incidents.pdf', async (_req, res, next) => {
  try {
    const rows = (await db.query(`SELECT created_at, incident_type, reason, status FROM incidents ORDER BY created_at DESC LIMIT 200`)).rows;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="incidents.pdf"');
    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);
    doc.fontSize(16).text('Informe de incidencias PRL', { underline: true });
    doc.moveDown();
    rows.forEach((row) => {
      doc.fontSize(10).text(`${new Date(row.created_at).toISOString()} | ${row.incident_type} | ${row.status}`);
      doc.text(`Motivo: ${row.reason}`);
      doc.moveDown(0.5);
    });
    doc.end();
  } catch (e) { next(e); }
});
