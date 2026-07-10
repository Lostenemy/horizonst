import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'resources', 'appcc-guide', 'guia-appcc-2026.md');
const output = path.join(root, 'web', 'public', 'recursos', 'guia-appcc-2026.pdf');
const markdown = await readFile(source, 'utf8');
const pages = markdown.split('<!-- page -->').map((page) => page.trim()).filter(Boolean);
const chunks = [];
const doc = new PDFDocument({ size: 'A4', margin: 54, compress: false, pdfVersion: '1.7', info: { Title: 'Guía APPCC 2026 para cámaras frigoríficas', Author: 'HorizonST', Subject: 'Seguridad, trazabilidad y control operativo', CreationDate: new Date('2026-01-01T00:00:00Z'), ModDate: new Date('2026-01-01T00:00:00Z') } });
doc.on('data', (chunk) => chunks.push(chunk));
const done = new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });

const dark = '#08233f'; const teal = '#008d99'; const muted = '#536471';
const footer = (page) => {
  doc.font('Helvetica').fontSize(8).fillColor(muted).text('HorizonST | Guía APPCC 2026', 54, 770, { width: 300 });
  doc.text(String(page), 500, 770, { width: 40, align: 'right' });
};
const heading = (text, level) => {
  const size = level === 1 ? 24 : level === 2 ? 15 : 11;
  doc.moveDown(level === 1 ? 0.15 : 0.35).font('Helvetica-Bold').fontSize(size).fillColor(level === 1 ? dark : teal).text(text, { width: 487 });
  doc.moveDown(0.3);
};
const body = (text, indent = 0) => doc.font('Helvetica').fontSize(10.2).fillColor('#182a34').text(text, 54 + indent, doc.y, { width: 487 - indent, lineGap: 3, align: 'left' }).moveDown(0.45);

pages.forEach((page, pageIndex) => {
  if (pageIndex) doc.addPage();
  doc.rect(54, 42, 487, 4).fill(teal);
  const lines = page.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { doc.moveDown(0.18); continue; }
    if (line.startsWith('# ')) heading(line.slice(2), 1);
    else if (line.startsWith('## ')) heading(line.slice(3), 2);
    else if (line.startsWith('> ')) { doc.rect(54, doc.y, 4, 42).fill(teal); doc.fillColor('#eef8f8').rect(62, doc.y - 0.5, 479, 42).fill(); doc.fillColor(dark); doc.font('Helvetica-Oblique').fontSize(9.2).text(line.slice(2), 72, doc.y + 7, { width: 455, lineGap: 2 }); doc.y += 48; }
    else if (line.startsWith('- ')) { doc.fillColor(teal).circle(60, doc.y + 6, 2).fill(); body(line.slice(2), 14); }
    else if (/^\d+\. \*\*/.test(line)) body(line.replace(/\*\*/g, ''), 0);
    else if (line.startsWith('|')) body(line.replaceAll('|', '  |  ').replace(/^\s*\|\s*/, ''), 0);
    else if (!line.startsWith('<!--')) body(line.replace(/\*\*/g, ''), 0);
  }
  footer(pageIndex + 1);
});
doc.end();
await done;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, Buffer.concat(chunks));
