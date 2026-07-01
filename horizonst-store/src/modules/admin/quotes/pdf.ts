import PDFDocument from 'pdfkit';

export type QuotePdfData = {
  quote: {
    quote_number: string;
    created_at: string | Date;
    full_name: string;
    email: string;
    company_name: string | null;
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
    notes: string | null;
  };
  items: Array<{
    description: string;
    quantity: number;
    unit_price_cents: number | null;
    line_subtotal_cents: number;
    line_tax_cents: number;
    line_total_cents: number;
  }>;
};

const money = (cents: number | null): string => `${((cents ?? 0) / 100).toFixed(2)} €`;
const formatDate = (value: string | Date): string => new Intl.DateTimeFormat('es-ES', { dateStyle: 'short' }).format(new Date(value));

export const buildQuotePdfLines = ({ quote, items }: QuotePdfData): string[] => [
  'HorizonST - Presupuesto',
  `Presupuesto nº: ${quote.quote_number}`,
  `Fecha: ${formatDate(quote.created_at)}`,
  `Cliente: ${quote.full_name} <${quote.email}>`,
  `Empresa: ${quote.company_name ?? '-'}`,
  '',
  'Líneas:',
  ...items.map((item) => `${item.description} | ${item.quantity} x ${money(item.unit_price_cents)} | Subtotal ${money(item.line_subtotal_cents)} | IVA ${money(item.line_tax_cents)} | Total ${money(item.line_total_cents)}`),
  '',
  `Subtotal: ${money(quote.subtotal_cents)}`,
  `IVA: ${money(quote.tax_cents)}`,
  `Total: ${money(quote.total_cents)}`,
  '',
  `Notas: ${quote.notes ?? '-'}`
];

const collectPdf = (doc: PDFKit.PDFDocument): Promise<Buffer> => new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);
});

export const generateQuotePdf = async (data: QuotePdfData): Promise<Buffer> => {
  const doc = new PDFDocument({ autoFirstPage: true, margin: 50, size: 'A4', bufferPages: false });
  const result = collectPdf(doc);

  doc.font('Helvetica');
  doc.fontSize(18).text('HorizonST - Presupuesto', { underline: true });
  doc.moveDown();
  doc.fontSize(11);

  for (const line of buildQuotePdfLines(data).slice(1)) {
    if (line === '') {
      doc.moveDown(0.5);
    } else if (line === 'Líneas:') {
      doc.moveDown(0.5).font('Helvetica-Bold').text(line).font('Helvetica');
    } else if (line.startsWith('Total:')) {
      doc.moveDown(0.5).font('Helvetica-Bold').text(line).font('Helvetica');
    } else {
      doc.text(line, { width: 495 });
    }
  }

  doc.end();
  return result;
};
