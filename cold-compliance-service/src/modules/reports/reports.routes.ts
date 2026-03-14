import { Request, Response, Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { db } from '../../db/pool';
import { requireAuth, requireRoles } from '../../middleware/auth';

interface InspectionRow {
  worker_name: string;
  worker_dni: string;
  tag_mac: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number;
}

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireRoles(['administrador', 'superadministrador']));

async function loadInspectionRows(): Promise<InspectionRow[]> {
  return (
    await db.query<InspectionRow>(
      `SELECT w.full_name as worker_name,
              w.dni as worker_dni,
              COALESCE(t.tag_uid, '') as tag_mac,
              s.started_at,
              s.ended_at,
              COALESCE(ROUND((EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at))/60)::numeric, 2), 0)::float as duration_minutes
       FROM cold_room_sessions s
       JOIN workers w ON w.id = s.worker_id
       LEFT JOIN tags t ON t.id = s.tag_id
       ORDER BY s.started_at DESC
       LIMIT 2000`
    )
  ).rows;
}

reportsRouter.get('/inspection.xlsx', async (_req: Request, res: Response, next) => {
  try {
    const rows = await loadInspectionRows();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Inspeccion');
    ws.addRow(['Trabajador', 'DNI', 'Tag MAC', 'Entrada', 'Salida', 'Minutos']);
    rows.forEach((row) => ws.addRow([row.worker_name, row.worker_dni, row.tag_mac, row.started_at, row.ended_at ?? '', row.duration_minutes]));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="inspection.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/inspection.pdf', async (_req: Request, res: Response, next) => {
  try {
    const rows = await loadInspectionRows();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="inspection.pdf"');
    const doc = new PDFDocument({ margin: 30 });
    doc.pipe(res);
    doc.fontSize(14).text('Informe inspección RD 1561/1995');
    doc.moveDown();
    rows.forEach((row) => {
      doc.fontSize(9).text(`${row.worker_name} | ${row.worker_dni} | ${row.tag_mac} | ${row.started_at} | ${row.ended_at ?? '-'} | ${row.duration_minutes}`);
    });
    doc.end();
  } catch (error) {
    next(error);
  }
});
