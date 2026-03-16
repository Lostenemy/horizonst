import type { ReadEventRow } from '../types.js';

interface ActiveRow {
  epc: string;
  is_registered: boolean;
  last_direction: 'IN' | 'OUT';
  last_reader_mac: string;
  last_antenna: number | null;
  last_event_ts: Date;
}

interface UnregisteredRow {
  epc: string;
  is_active: boolean;
  last_reader_mac: string;
  last_antenna: number | null;
  last_seen_at: Date;
}

interface RegisteredTagRow {
  epc: string;
  name: string | null;
  description: string | null;
  createdAt: string;
}

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const colName = (index: number): string => {
  let n = index;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
};

type Cell = { value: string | number; style?: number; numeric?: boolean };

const buildSheetXml = (rows: Cell[][]): string => {
  const rowXml = rows
    .map((cells, rowIndex) => {
      const cols = cells
        .map((cell, colIndex) => {
          const ref = `${colName(colIndex + 1)}${rowIndex + 1}`;
          const style = cell.style ? ` s="${cell.style}"` : '';
          if (cell.numeric && typeof cell.value === 'number') {
            return `<c r="${ref}" t="n"${style}><v>${cell.value}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"${style}><is><t>${escapeXml(String(cell.value ?? ''))}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowIndex + 1}">${cols}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:G${rows.length}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="16"/>
  <cols>
    <col min="1" max="1" width="30" customWidth="1"/>
    <col min="2" max="2" width="18" customWidth="1"/>
    <col min="3" max="3" width="18" customWidth="1"/>
    <col min="4" max="4" width="26" customWidth="1"/>
    <col min="5" max="5" width="12" customWidth="1"/>
    <col min="6" max="6" width="24" customWidth="1"/>
    <col min="7" max="7" width="36" customWidth="1"/>
  </cols>
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
};

const buildStylesXml = (): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF111111"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF111111"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF0C800"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7DF75"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD9D9D9"/></left>
      <right style="thin"><color rgb="FFD9D9D9"/></right>
      <top style="thin"><color rgb="FFD9D9D9"/></top>
      <bottom style="thin"><color rgb="FFD9D9D9"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (data: Buffer): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const makeZip = (files: Array<{ name: string; data: string }>): Buffer => {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  files.forEach((file) => {
    const name = Buffer.from(file.name, 'utf8');
    const content = Buffer.from(file.data, 'utf8');
    const checksum = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, name, content);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(checksum, 16);
    cd.writeUInt32LE(content.length, 20);
    cd.writeUInt32LE(content.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + content.length;
  });

  const centralSize = central.reduce((acc, part) => acc + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...central, end]);
};

export const buildExecutiveReportXlsx = (payload: {
  summary: { activeCount: number; registeredActiveCount: number; unregisteredActiveCount: number; totalReadings24h: number };
  activeRows: ActiveRow[];
  registeredRows: RegisteredTagRow[];
  recentEvents: ReadEventRow[];
  unregisteredRows: UnregisteredRow[];
}): Buffer => {
  const generated = new Date().toLocaleString('es-ES');

  const rows: Cell[][] = [
    [{ value: '360 PROTECTIVE · Reporte RFID Ejecutivo', style: 1 }],
    [{ value: `Generado: ${generated}` }],
    [{ value: '' }],
    [{ value: 'Resumen', style: 3 }],
    [{ value: 'KPI', style: 3 }, { value: 'Valor', style: 3 }, { value: 'Detalle', style: 3 }],
    [{ value: 'Activos en seguimiento', style: 2 }, { value: payload.summary.activeCount, style: 4, numeric: true }, { value: 'Activos con estado activo actualmente.', style: 2 }],
    [{ value: 'Activos registrados', style: 2 }, { value: payload.summary.registeredActiveCount, style: 4, numeric: true }, { value: 'Activos activos vinculados en catálogo.', style: 2 }],
    [{ value: 'Sin identificar', style: 2 }, { value: payload.summary.unregisteredActiveCount, style: 4, numeric: true }, { value: 'Activos activos sin alta en catálogo.', style: 2 }],
    [{ value: 'Eventos 24h', style: 2 }, { value: payload.summary.totalReadings24h, style: 4, numeric: true }, { value: 'Lecturas procesadas en las últimas 24 horas.', style: 2 }],
    [{ value: '' }],
    [{ value: 'Activos en seguimiento', style: 3 }],
    [{ value: 'EPC', style: 3 }, { value: 'Registrado', style: 3 }, { value: 'Dirección', style: 3 }, { value: 'Lector', style: 3 }, { value: 'Antena', style: 3 }, { value: 'Última lectura', style: 3 }]
  ];

  payload.activeRows.forEach((row) => {
    rows.push([
      { value: row.epc, style: 2 },
      { value: row.is_registered ? 'Sí' : 'No', style: 2 },
      { value: row.last_direction, style: 2 },
      { value: row.last_reader_mac, style: 2 },
      { value: row.last_antenna ?? '-', style: 2 },
      { value: row.last_event_ts.toLocaleString('es-ES'), style: 2 }
    ]);
  });

  rows.push([{ value: '' }]);
  rows.push([{ value: 'Activos registrados', style: 3 }]);
  rows.push([{ value: 'EPC', style: 3 }, { value: 'Nombre', style: 3 }, { value: 'Descripción', style: 3 }, { value: 'Alta', style: 3 }]);

  payload.registeredRows.forEach((row) => {
    rows.push([
      { value: row.epc, style: 2 },
      { value: row.name ?? '-', style: 2 },
      { value: row.description ?? '-', style: 2 },
      { value: new Date(row.createdAt).toLocaleString('es-ES'), style: 2 }
    ]);
  });

  rows.push([{ value: '' }]);
  rows.push([{ value: 'Últimas lecturas', style: 3 }]);
  rows.push([{ value: 'EPC', style: 3 }, { value: 'Dirección', style: 3 }, { value: 'Registrado', style: 3 }, { value: 'Lector', style: 3 }, { value: 'Antena', style: 3 }, { value: 'Hora evento', style: 3 }]);

  payload.recentEvents.forEach((event) => {
    rows.push([
      { value: event.epc, style: 2 },
      { value: event.direction, style: 2 },
      { value: event.is_registered ? 'Sí' : 'No', style: 2 },
      { value: event.reader_mac, style: 2 },
      { value: event.antenna ?? '-', style: 2 },
      { value: event.event_ts.toLocaleString('es-ES'), style: 2 }
    ]);
  });

  rows.push([{ value: '' }]);
  rows.push([{ value: 'Sin identificar', style: 3 }]);
  rows.push([{ value: 'EPC', style: 3 }, { value: 'Activo', style: 3 }, { value: 'Lector', style: 3 }, { value: 'Antena', style: 3 }, { value: 'Última lectura', style: 3 }]);

  payload.unregisteredRows.forEach((row) => {
    rows.push([
      { value: row.epc, style: 2 },
      { value: row.is_active ? 'Sí' : 'No', style: 2 },
      { value: row.last_reader_mac, style: 2 },
      { value: row.last_antenna ?? '-', style: 2 },
      { value: row.last_seen_at.toLocaleString('es-ES'), style: 2 }
    ]);
  });

  const sheetXml = buildSheetXml(rows);

  return makeZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Reporte Ejecutivo" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
    { name: 'xl/styles.xml', data: buildStylesXml() }
  ]);
};
