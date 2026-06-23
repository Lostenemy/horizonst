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

const money = (cents: number | null): string => `${((cents ?? 0) / 100).toFixed(2)} EUR`;
const formatDate = (value: string | Date): string => new Date(value).toISOString().slice(0, 10);
const pdfEscape = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
const stripUnsupported = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '');

const line = (text: string): string => `(${pdfEscape(stripUnsupported(text).slice(0, 110))}) Tj`;

export const buildQuotePdfLines = ({ quote, items }: QuotePdfData): string[] => {
  const lines = [
    'HorizonST - Presupuesto',
    `Numero: ${quote.quote_number}`,
    `Fecha: ${formatDate(quote.created_at)}`,
    `Cliente: ${quote.full_name} <${quote.email}>`,
    `Empresa: ${quote.company_name ?? '-'}`,
    '',
    'Lineas:',
    ...items.map((item) => `${item.description} | ${item.quantity} x ${money(item.unit_price_cents)} | Subtotal ${money(item.line_subtotal_cents)} | IVA ${money(item.line_tax_cents)} | Total ${money(item.line_total_cents)}`),
    '',
    `Subtotal: ${money(quote.subtotal_cents)}`,
    `IVA: ${money(quote.tax_cents)}`,
    `Total: ${money(quote.total_cents)}`,
    '',
    `Notas: ${quote.notes ?? '-'}`
  ];
  return lines;
};

export const generateQuotePdf = (data: QuotePdfData): Buffer => {
  const textCommands = buildQuotePdfLines(data).map((text, index) => `${index === 0 ? 'BT /F1 12 Tf 50 790 Td' : '0 -18 Td'} ${line(text)}`).join('\n') + '\nET';
  const stream = Buffer.from(textCommands, 'ascii');
  const objects = [
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj\n',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n',
    `5 0 obj << /Length ${stream.length} >> stream\n${textCommands}\nendstream endobj\n`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(pdf, 'ascii')); pdf += object; }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${offset.toString().padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
};
