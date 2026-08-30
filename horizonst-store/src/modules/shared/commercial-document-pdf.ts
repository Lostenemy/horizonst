import PDFDocument from 'pdfkit';
import { commercialCompany, horizonBrandColors as colors } from '../../resources/commercial-company.js';

export type CommercialDocumentType = 'quote' | 'delivery_note';

export type CommercialDocumentPdfData = {
  type: CommercialDocumentType;
  document: {
    number: string;
    createdAt: string | Date;
    status?: string | null;
    sourceReference?: string | null;
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    totalCents: number;
    notes?: string | null;
  };
  customer: {
    fullName: string;
    email: string;
    companyName?: string | null;
    taxId?: string | null;
    address?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    country?: string | null;
  };
  items: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number | null;
    discountPercent?: string | number | null;
    lineSubtotalCents: number;
    lineDiscountCents?: number | null;
    lineTaxCents: number;
    lineTotalCents: number;
  }>;
};

const labels = {
  quote: { title: 'PRESUPUESTO', number: 'Número de presupuesto' },
  delivery_note: { title: 'ALBARÁN', number: 'Número de albarán' }
} as const;

const money = (cents: number | null | undefined): string => `${((cents ?? 0) / 100).toFixed(2)} €`;
const formatDate = (value: string | Date): string => new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeZone: 'Europe/Madrid' }).format(new Date(value));
const hasValue = (value: string | null | undefined): value is string => Boolean(value?.trim());

const customerAddressLines = (customer: CommercialDocumentPdfData['customer']): string[] => {
  const locality = [customer.postalCode, customer.city, customer.province].filter(hasValue).join(' · ');
  return [customer.address, locality || null, customer.country].filter(hasValue);
};

export const buildCommercialDocumentPdfLines = (data: CommercialDocumentPdfData): string[] => {
  const label = labels[data.type];
  return [
    label.title,
    `${label.number}: ${data.document.number}`,
    `Fecha: ${formatDate(data.document.createdAt)}`,
    ...(data.type === 'delivery_note' && data.document.sourceReference ? [`Referencia de origen: ${data.document.sourceReference}`] : []),
    ...(data.document.status ? [`Estado: ${data.document.status}`] : []),
    `${commercialCompany.legalName} · NIF ${commercialCompany.taxId}`,
    ...commercialCompany.addressLines,
    `${commercialCompany.email} · ${commercialCompany.website}`,
    `Cliente: ${data.customer.fullName}`,
    `Email: ${data.customer.email}`,
    ...(data.customer.companyName ? [`Empresa: ${data.customer.companyName}`] : []),
    ...(data.customer.taxId ? [`NIF / VAT: ${data.customer.taxId}`] : []),
    ...customerAddressLines(data.customer),
    ...data.items.map((item) => `${item.description} | ${item.quantity} x ${money(item.unitPriceCents)} | Dto. ${item.discountPercent ?? 0}% | IVA ${money(item.lineTaxCents)} | Total ${money(item.lineTotalCents)}`),
    `Subtotal: ${money(data.document.subtotalCents)}`,
    `Descuento: ${money(data.document.discountCents)}`,
    `IVA: ${money(data.document.taxCents)}`,
    `Total: ${money(data.document.totalCents)}`,
    `Observaciones: ${data.document.notes ?? '-'}`
  ];
};

const collectPdf = (doc: PDFKit.PDFDocument): Promise<Buffer> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
});

const drawPageHeader = (doc: PDFKit.PDFDocument, title: string, number: string, continued = false) => {
  doc.rect(0, 0, doc.page.width, 104).fill(colors.navy);
  doc.fillColor(colors.white).font('Helvetica-Bold').fontSize(24).text(commercialCompany.brandName, 42, 31, { width: 260 });
  doc.fillColor(colors.turquoise).fontSize(9).text('TRAZABILIDAD · FRÍO · RFID', 42, 62, { characterSpacing: 1.1 });
  doc.fillColor(colors.white).fontSize(continued ? 13 : 18).text(continued ? `${title} · CONTINUACIÓN` : title, 300, continued ? 34 : 28, { width: 253, align: 'right', lineBreak: false });
  doc.fillColor('#c9e5e8').font('Helvetica').fontSize(9).text(number, 320, 60, { width: 233, align: 'right' });
};

const drawTableHeader = (doc: PDFKit.PDFDocument, y: number) => {
  doc.roundedRect(42, y, 511, 25, 4).fill(colors.navy);
  doc.fillColor(colors.white).font('Helvetica-Bold').fontSize(8);
  doc.text('DESCRIPCIÓN', 50, y + 8, { width: 220 });
  doc.text('CANT.', 275, y + 8, { width: 38, align: 'right' });
  doc.text('PRECIO', 320, y + 8, { width: 66, align: 'right' });
  doc.text('DTO.', 393, y + 8, { width: 42, align: 'right' });
  doc.text('IVA', 442, y + 8, { width: 42, align: 'right' });
  doc.text('TOTAL', 491, y + 8, { width: 54, align: 'right' });
  return y + 25;
};

export const generateCommercialDocumentPdf = async (data: CommercialDocumentPdfData): Promise<Buffer> => {
  const label = labels[data.type];
  const doc = new PDFDocument({ autoFirstPage: true, margin: 42, size: 'A4', bufferPages: true, info: { Title: `${label.title} ${data.document.number}`, Author: commercialCompany.brandName, Subject: label.title } });
  const result = collectPdf(doc);
  drawPageHeader(doc, label.title, data.document.number);

  let y = 126;
  doc.fillColor(colors.teal).font('Helvetica-Bold').fontSize(9).text('DATOS DEL DOCUMENTO', 42, y);
  doc.fillColor(colors.ink).fontSize(10).text(`${label.number}: ${data.document.number}`, 42, y + 17, { width: 245 });
  doc.font('Helvetica').text(`Fecha: ${formatDate(data.document.createdAt)}`, 42, y + 34, { width: 245 });
  if (data.type === 'delivery_note' && data.document.sourceReference) doc.text(`Referencia de origen: ${data.document.sourceReference}`, 42, y + 51, { width: 245 });
  if (data.document.status) doc.text(`Estado: ${data.document.status}`, 42, y + (data.type === 'delivery_note' && data.document.sourceReference ? 68 : 51), { width: 245 });

  doc.fillColor(colors.teal).font('Helvetica-Bold').fontSize(9).text('EMISOR', 310, y);
  doc.fillColor(colors.ink).fontSize(10).text(commercialCompany.legalName, 310, y + 17, { width: 243 });
  doc.font('Helvetica').fontSize(8.5).text(`NIF ${commercialCompany.taxId}`, 310, y + 34, { width: 243 });
  doc.text(commercialCompany.addressLines.join('\n'), 310, y + 48, { width: 243, lineGap: 1 });
  doc.text(`${commercialCompany.email} · ${commercialCompany.website}`, 310, y + 78, { width: 243 });

  y = 224;
  const customerLines = [data.customer.companyName, data.customer.fullName, data.customer.taxId ? `NIF / VAT: ${data.customer.taxId}` : null, ...customerAddressLines(data.customer), data.customer.email].filter(hasValue);
  const customerHeight = Math.max(76, 36 + customerLines.length * 12);
  doc.roundedRect(42, y, 511, customerHeight, 7).fillAndStroke(colors.pale, colors.border);
  doc.fillColor(colors.teal).font('Helvetica-Bold').fontSize(9).text('CLIENTE / DISTRIBUIDOR', 55, y + 13);
  doc.fillColor(colors.ink).font('Helvetica').fontSize(9).text(customerLines.join('\n'), 55, y + 31, { width: 485, lineGap: 2 });
  y += customerHeight + 18;

  const addContinuationPage = () => {
    doc.addPage();
    drawPageHeader(doc, label.title, data.document.number, true);
    y = drawTableHeader(doc, 126);
  };

  y = drawTableHeader(doc, y);
  data.items.forEach((item, index) => {
    doc.font('Helvetica').fontSize(8.5);
    const rowHeight = Math.max(31, doc.heightOfString(item.description, { width: 220 }) + 14);
    if (y + rowHeight > 728) addContinuationPage();
    if (index % 2 === 1) doc.rect(42, y, 511, rowHeight).fill('#f5f9fb');
    doc.fillColor(colors.ink).font('Helvetica').fontSize(8.5);
    doc.text(item.description, 50, y + 8, { width: 220 });
    doc.text(String(item.quantity), 275, y + 8, { width: 38, align: 'right' });
    doc.text(item.unitPriceCents === null ? 'Consultar' : money(item.unitPriceCents), 320, y + 8, { width: 66, align: 'right' });
    doc.text(`${item.discountPercent ?? 0}%`, 393, y + 8, { width: 42, align: 'right' });
    doc.text(money(item.lineTaxCents), 442, y + 8, { width: 42, align: 'right' });
    doc.font('Helvetica-Bold').text(money(item.lineTotalCents), 491, y + 8, { width: 54, align: 'right' });
    doc.moveTo(42, y + rowHeight).lineTo(553, y + rowHeight).strokeColor(colors.border).lineWidth(0.5).stroke();
    y += rowHeight;
  });

  const notesHeight = data.document.notes ? Math.min(70, doc.heightOfString(data.document.notes, { width: 300 }) + 28) : 0;
  if (y + 128 + notesHeight > 728) {
    doc.addPage();
    drawPageHeader(doc, label.title, data.document.number, true);
    y = 126;
  } else y += 18;

  if (data.document.notes) {
    doc.fillColor(colors.teal).font('Helvetica-Bold').fontSize(9).text('OBSERVACIONES', 42, y);
    doc.roundedRect(42, y + 15, 300, notesHeight - 15, 5).fillAndStroke('#f5f9fb', colors.border);
    doc.fillColor(colors.ink).font('Helvetica').fontSize(8.5).text(data.document.notes, 53, y + 26, { width: 278, height: notesHeight - 34, ellipsis: true });
  }

  const totalsX = 363;
  doc.roundedRect(totalsX, y, 190, 112, 7).fillAndStroke(colors.pale, colors.border);
  const totalRows: Array<[string, string, boolean?]> = [['Subtotal', money(data.document.subtotalCents)], ['Descuento', `-${money(data.document.discountCents)}`], ['IVA', money(data.document.taxCents)], ['TOTAL', money(data.document.totalCents), true]];
  totalRows.forEach(([name, value, strong], index) => {
    const rowY = y + 14 + index * 23;
    doc.fillColor(strong ? colors.navy : colors.muted).font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 11 : 9).text(name, totalsX + 12, rowY, { width: 75 });
    doc.text(value, totalsX + 87, rowY, { width: 90, align: 'right' });
  });

  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    doc.moveTo(42, 770).lineTo(553, 770).strokeColor(colors.border).lineWidth(0.5).stroke();
    doc.fillColor(colors.muted).font('Helvetica').fontSize(7.5).text(`${commercialCompany.legalName} · NIF ${commercialCompany.taxId} · ${commercialCompany.email} · ${commercialCompany.website}`, 42, 781, { width: 430, lineBreak: false });
    doc.text(`Página ${pageIndex + 1} de ${range.count}`, 475, 781, { width: 78, align: 'right', lineBreak: false });
  }

  doc.end();
  return result;
};

export const commercialDocumentFilename = (type: CommercialDocumentType, number: string): string => {
  const safeNumber = number.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'DOCUMENTO';
  return `${type === 'quote' ? 'PRESUPUESTO' : 'ALBARAN'}-${safeNumber}.pdf`;
};
