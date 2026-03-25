import path from 'node:path';
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
  duration_seconds: number;
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
              COALESCE(EXTRACT(EPOCH FROM (COALESCE(s.ended_at, NOW()) - s.started_at))::int, 0) as duration_seconds
       FROM cold_room_sessions s
       JOIN workers w ON w.id = s.worker_id
       LEFT JOIN tags t ON t.id = s.tag_id
       ORDER BY s.started_at DESC
       LIMIT 2000`
    )
  ).rows;
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-ES');
}

function formatDurationMmSs(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

reportsRouter.get('/inspection.xlsx', async (_req: Request, res: Response, next) => {
  try {
    const rows = await loadInspectionRows();
    const wb = new ExcelJS.Workbook();
    wb.creator = 'HorizonST';
    wb.created = new Date();

    const ws = wb.addWorksheet('Inspección', {
      views: [{ state: 'frozen', ySplit: 3 }]
    });

    ws.mergeCells('A1:F1');
    ws.getCell('A1').value = 'Horneo · Informe de inspección de presencia';
    ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF0F3D5E' } };
    ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };

    ws.mergeCells('A2:F2');
    ws.getCell('A2').value = `Generado: ${new Date().toLocaleString('es-ES')}`;
    ws.getCell('A2').font = { size: 10, color: { argb: 'FF4B5563' } };

    const headers = ['Trabajador', 'DNI', 'Tag', 'Entrada', 'Salida', 'Minutos'];
    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2A7AB9' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    rows.forEach((row) => {
      const r = ws.addRow([
        row.worker_name,
        row.worker_dni,
        row.tag_mac,
        new Date(row.started_at),
        row.ended_at ? new Date(row.ended_at) : null,
        row.duration_seconds / 60
      ]);
      r.getCell(4).numFmt = 'dd/mm/yyyy hh:mm:ss';
      r.getCell(5).numFmt = 'dd/mm/yyyy hh:mm:ss';
      r.getCell(6).numFmt = '0.00';
      if (row.duration_seconds >= 45 * 60) {
        r.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE5E5' } };
        r.getCell(6).font = { color: { argb: 'FFC62828' }, bold: true };
      }
    });

    ws.columns = [
      { width: 30 },
      { width: 14 },
      { width: 18 },
      { width: 22 },
      { width: 22 },
      { width: 12 }
    ];

    ws.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: 3, column: 6 }
    };

    ws.eachRow((row, rowNumber) => {
      if (rowNumber < 3) return;
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
      });
    });

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
    const generatedAt = new Date();
    const totalRows = rows.length;
    const criticalRows = rows.filter((row) => row.duration_seconds >= 45 * 60).length;
    const avgSeconds = rows.length ? Math.round(rows.reduce((acc, row) => acc + row.duration_seconds, 0) / rows.length) : 0;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="inspection.pdf"');
    const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: true });
    doc.pipe(res);

    const margin = 36;
    const headerTop = 28;
    const summaryTop = 95;
    const tableTop = 185;
    const rowHeight = 18;
    const footerHeight = 16;
    const bottomGap = 10;

    const logoPath = path.resolve(process.cwd(), 'web', 'logo 360.jpeg');

    const drawPageHeader = () => {
      try {
        doc.image(logoPath, margin, headerTop, { fit: [90, 45] });
      } catch {
        // logo optional
      }

      doc.fillColor('#0F3D5E').fontSize(18).text('Informe de inspección', 140, 36);
      doc.fillColor('#4B5563').fontSize(10).text(`Generado: ${generatedAt.toLocaleString('es-ES')}`, 140, 58);
    };

    drawPageHeader();

    doc.roundedRect(36, summaryTop, 523, 70, 8).fillAndStroke('#EDF4FB', '#D9E7F5');
    doc.fillColor('#0F3D5E').fontSize(11).text(`Sesiones analizadas: ${totalRows}`, 52, 115);
    doc.text(`Sesiones >= 45 min: ${criticalRows}`, 240, 115);
    doc.text(`Promedio: ${formatDurationMmSs(avgSeconds)}`, 400, 115, { width: 145, align: 'right' });

    let y = tableTop;
    const headers = ['Trabajador', 'DNI', 'Tag', 'Entrada', 'Salida', 'Min'];
    const colX = [36, 185, 250, 320, 410, 525];
    const maxRowY = doc.page.height - margin - footerHeight - bottomGap;

    const drawHeader = () => {
      doc.fillColor('#2A7AB9').rect(36, y, 523, 20).fill();
      doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
      headers.forEach((header, i) => doc.text(header, colX[i], y + 6, { width: i === 5 ? 34 : colX[i + 1] - colX[i] - 4 }));
      y += 22;
      doc.font('Helvetica');
    };

    drawHeader();

    rows.slice(0, 120).forEach((row, idx) => {
      if (y + rowHeight > maxRowY) {
        doc.addPage();
        drawPageHeader();
        y = tableTop;
        drawHeader();
      }

      if (idx % 2 === 0) {
        doc.fillColor('#F8FAFC').rect(36, y - 2, 523, 18).fill();
      }

      doc.fillColor('#111827').fontSize(8);
      doc.text(row.worker_name, colX[0], y, { width: 145, ellipsis: true });
      doc.text(row.worker_dni, colX[1], y, { width: 60 });
      doc.text(row.tag_mac, colX[2], y, { width: 66, ellipsis: true });
      doc.text(formatDate(row.started_at), colX[3], y, { width: 86 });
      doc.text(formatDate(row.ended_at), colX[4], y, { width: 106 });
      doc.fillColor(row.duration_seconds >= 45 * 60 ? '#C62828' : '#111827').text(formatDurationMmSs(row.duration_seconds), colX[5], y, { width: 34, align: 'right' });
      y += 18;
    });

    const pageRange = doc.bufferedPageRange();
    for (let i = pageRange.start; i < pageRange.start + pageRange.count; i += 1) {
      doc.switchToPage(i);
      const footerY = doc.page.height - margin + 2;
      doc.save();
      doc.fillColor('#6B7280').fontSize(8);
      doc.text('HorizonST · Cold Compliance', margin, footerY, {
        width: 260,
        align: 'left',
        lineBreak: false
      });
      doc.text(`Página ${i - pageRange.start + 1} / ${pageRange.count}`, margin, footerY, {
        width: doc.page.width - margin * 2,
        align: 'right',
        lineBreak: false
      });
      doc.restore();
    }

    doc.end();
  } catch (error) {
    next(error);
  }
});
