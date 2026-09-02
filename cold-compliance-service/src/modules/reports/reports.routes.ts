import path from 'node:path';
import { Request, Response, Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { PoolClient } from 'pg';
import { db } from '../../db/pool';
import { requireAuth, requireRoles } from '../../middleware/auth';
import { formatDateTimeMadrid } from '../../utils/datetime';
import {
  InspectionFilters,
  InspectionRow,
  assertInspectionIntegrity,
  consumeInspectionRows,
  loadInspectionSummary
} from './inspection-report.service';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireRoles(['supervisor', 'administrador', 'superadministrador']));

function requestFilters(req: Request): InspectionFilters {
  return {
    from: typeof req.query.from === 'string' ? req.query.from : undefined,
    to: typeof req.query.to === 'string' ? req.query.to : undefined,
    workerDni: typeof req.query.workerDni === 'string' ? req.query.workerDni : undefined
  };
}

async function withInspectionSnapshot<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function formatDurationMmSs(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function applyCellBorder(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
    };
  });
}

reportsRouter.get('/inspection.xlsx', async (req: Request, res: Response, next) => {
  try {
    await withInspectionSnapshot(async (client) => {
      const filters = requestFilters(req);
      const summary = await loadInspectionSummary(
        async (sql, values) => (await client.query(sql, values)).rows[0] ?? {},
        filters
      );

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="inspection.xlsx"');
      const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
      wb.creator = 'HorizonST';
      wb.created = new Date();
      const ws = wb.addWorksheet('Inspección', { views: [{ state: 'frozen', ySplit: 3 }] });
      ws.columns = [
        { width: 30 },
        { width: 14 },
        { width: 18 },
        { width: 22 },
        { width: 22 },
        { width: 12 }
      ];

      ws.mergeCells('A1:F1');
      const titleRow = ws.getRow(1);
      titleRow.getCell(1).value = 'Horneo · Informe de inspección de presencia';
      titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: 'FF0F3D5E' } };
      titleRow.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
      titleRow.commit();

      ws.mergeCells('A2:F2');
      const generatedRow = ws.getRow(2);
      generatedRow.getCell(1).value = `Generado: ${formatDateTimeMadrid(new Date())}`;
      generatedRow.getCell(1).font = { size: 10, color: { argb: 'FF4B5563' } };
      generatedRow.commit();

      const headerRow = ws.addRow(['Trabajador', 'DNI', 'Tag', 'Entrada', 'Salida', 'Minutos']);
      headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2A7AB9' } };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
      applyCellBorder(headerRow);
      headerRow.commit();
      ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 6 } };

      const included = await consumeInspectionRows(
        async (sql, values) => (await client.query<InspectionRow>(sql, values)).rows,
        filters,
        (row) => {
          const reportRow = ws.addRow([
            row.worker_name,
            row.worker_dni,
            row.tag_mac,
            formatDateTimeMadrid(row.started_at),
            formatDateTimeMadrid(row.ended_at),
            row.duration_seconds / 60
          ]);
          reportRow.getCell(6).numFmt = '0.00';
          if (row.duration_seconds >= 45 * 60) {
            reportRow.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE5E5' } };
            reportRow.getCell(6).font = { color: { argb: 'FFC62828' }, bold: true };
          }
          applyCellBorder(reportRow);
          reportRow.commit();
        }
      );
      assertInspectionIntegrity(summary.totalRows, included);
      ws.commit();
      await wb.commit();
    });
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/inspection.pdf', async (req: Request, res: Response, next) => {
  try {
    await withInspectionSnapshot(async (client) => {
      const filters = requestFilters(req);
      const summary = await loadInspectionSummary(
        async (sql, values) => (await client.query(sql, values)).rows[0] ?? {},
        filters
      );
      const generatedAt = new Date();

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="inspection.pdf"');
      const doc = new PDFDocument({ margin: 36, size: 'A4', bufferPages: false });
      doc.pipe(res);

      const margin = 36;
      const headerTop = 28;
      const summaryTop = 95;
      const tableTop = 185;
      const rowHeight = 18;
      const footerHeight = 16;
      const bottomGap = 10;
      const logoPath = path.resolve(process.cwd(), 'web', 'logo 360.jpeg');
      let pageNumber = 1;
      let y = tableTop;

      const drawPageHeader = () => {
        try {
          doc.image(logoPath, margin, headerTop, { fit: [90, 45] });
        } catch {
          // El logo es opcional.
        }
        doc.fillColor('#0F3D5E').fontSize(18).text('Informe de inspección', 140, 36);
        doc.fillColor('#4B5563').fontSize(10).text(`Generado: ${formatDateTimeMadrid(generatedAt)}`, 140, 58);
      };

      const drawFooter = () => {
        const footerY = doc.page.height - margin - footerHeight;
        doc.save();
        doc.fillColor('#6B7280').fontSize(8);
        doc.text('HorizonST · Cold Compliance', margin, footerY, { width: 260, lineBreak: false });
        doc.text(`Página ${pageNumber}`, margin, footerY, {
          width: doc.page.width - margin * 2,
          align: 'right',
          lineBreak: false
        });
        doc.restore();
      };

      const headers = ['Trabajador', 'DNI', 'Tag', 'Entrada', 'Salida', 'Min'];
      const colX = [36, 185, 250, 320, 410, 525];
      const drawTableHeader = () => {
        doc.fillColor('#2A7AB9').rect(36, y, 523, 20).fill();
        doc.fillColor('white').fontSize(9).font('Helvetica-Bold');
        headers.forEach((header, index) =>
          doc.text(header, colX[index], y + 6, {
            width: index === 5 ? 34 : colX[index + 1] - colX[index] - 4
          })
        );
        y += 22;
        doc.font('Helvetica');
      };

      drawPageHeader();
      doc.roundedRect(36, summaryTop, 523, 70, 8).fillAndStroke('#EDF4FB', '#D9E7F5');
      doc.fillColor('#0F3D5E').fontSize(11).text(`Sesiones analizadas: ${summary.totalRows}`, 52, 115);
      doc.text(`Sesiones >= 45 min: ${summary.criticalRows}`, 240, 115);
      doc.text(`Promedio: ${formatDurationMmSs(summary.averageSeconds)}`, 400, 115, {
        width: 145,
        align: 'right'
      });
      drawTableHeader();

      let rowIndex = 0;
      const maxRowY = doc.page.height - margin - footerHeight - bottomGap;
      const included = await consumeInspectionRows(
        async (sql, values) => (await client.query<InspectionRow>(sql, values)).rows,
        filters,
        (row) => {
          if (y + rowHeight > maxRowY) {
            drawFooter();
            doc.addPage();
            pageNumber += 1;
            drawPageHeader();
            y = tableTop;
            drawTableHeader();
          }
          if (rowIndex % 2 === 0) {
            doc.fillColor('#F8FAFC').rect(36, y - 2, 523, 18).fill();
          }
          doc.fillColor('#111827').fontSize(8);
          doc.text(row.worker_name, colX[0], y, { width: 145, ellipsis: true });
          doc.text(row.worker_dni, colX[1], y, { width: 60 });
          doc.text(row.tag_mac, colX[2], y, { width: 66, ellipsis: true });
          doc.text(formatDateTimeMadrid(row.started_at), colX[3], y, { width: 86 });
          doc.text(formatDateTimeMadrid(row.ended_at), colX[4], y, { width: 106 });
          doc
            .fillColor(row.duration_seconds >= 45 * 60 ? '#C62828' : '#111827')
            .text(formatDurationMmSs(row.duration_seconds), colX[5], y, { width: 34, align: 'right' });
          y += rowHeight;
          rowIndex += 1;
        }
      );
      assertInspectionIntegrity(summary.totalRows, included);
      drawFooter();
      doc.end();
    });
  } catch (error) {
    next(error);
  }
});
