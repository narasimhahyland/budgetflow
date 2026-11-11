/**
 * Dependency-free file writers shared by the board pack (16a) and report exports: a stored zip
 * (enough for XLSX), an XLSX workbook of inline-string and number cells, and a paginated text PDF.
 * Each is deterministic for the same input and seed, so a regenerated file is byte for byte equal.
 */

export const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const colName = (i: number): string => {
  let n = i;
  let name = '';
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Zip with stored entries: enough for XLSX and it adds no dependency. */
export function zipStore(files: readonly { name: string; body: Buffer }[], seed: string): Buffer {
  // A deterministic DOS timestamp derived from the seed: the same input regenerates byte for byte.
  const stamp = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 0xffff, 7);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const crc = crc32(f.body);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp, 10);
    local.writeUInt16LE(stamp, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(f.body.length, 18);
    local.writeUInt32LE(f.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, f.body);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp, 12);
    central.writeUInt16LE(stamp, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(f.body.length, 20);
    central.writeUInt32LE(f.body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length + f.body.length;
  }
  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDirectory, end]);
}

/** A text cell, or a number cell (`{ n }` holds a plain decimal such as `-1234.5`). */
export type XlsxCell = string | { n: string };

export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
}

const cellXml = (v: XlsxCell, ref: string): string =>
  typeof v === 'string'
    ? `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(v)}</t></is></c>`
    : `<c r="${ref}"><v>${xmlEscape(v.n)}</v></c>`;

/**
 * An XLSX workbook with one sheet per entry. Text goes in as inline strings, which a spreadsheet
 * never evaluates, so a cell that starts with `=` stays text.
 */
export function xlsxWorkbook(sheets: readonly XlsxSheet[], seed: string): Buffer {
  const sheetXml = (rows: XlsxCell[][]) =>
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map(
        (cells, r) =>
          `<row r="${r + 1}">${cells.map((v, c) => cellXml(v, `${colName(c)}${r + 1}`)).join('')}</row>`,
      )
      .join('')}</sheetData></worksheet>`;
  const files: { name: string; body: Buffer }[] = [
    {
      name: '[Content_Types].xml',
      body: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
          .map(
            (_s, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('')}</Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      body: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      body: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
          .map(
            (s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
          )
          .join('')}</sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      body: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
          .map(
            (_s, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('')}</Relationships>`,
      ),
    },
    ...sheets.map((s, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      body: Buffer.from(sheetXml(s.rows)),
    })),
  ];
  return zipStore(files, seed);
}

/** Characters outside Latin-1 cannot be shown by a standard PDF font; map the common ones. */
export function pdfSafe(s: string): string {
  return s
    .replace(/[‒-―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/−/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

const pdfEscape = (s: string) => s.replace(/([\\()])/g, '\\$1');

/** Characters per line and lines per page of `textPdf` (Courier 7.5 pt on A4 landscape). */
export const PDF_LINE_CHARS = 170;
const PDF_LINES_PER_PAGE = 50;

/**
 * A paginated, monospaced text PDF on A4 landscape: every line is placed as typed, so columns
 * padded with spaces line up. Each page carries `footer` with its page number.
 */
export function textPdf(lines: readonly string[], footer: string): Buffer {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += PDF_LINES_PER_PAGE)
    pages.push(lines.slice(i, i + PDF_LINES_PER_PAGE) as string[]);
  if (!pages.length) pages.push([]);
  const fontId = 3 + pages.length * 2;
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_p, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  ];
  pages.forEach((page, p) => {
    const text = [
      ...page.map(
        (l, i) =>
          `BT /F1 7.5 Tf 36 ${552 - i * 10} Td (${pdfEscape(pdfSafe(l).slice(0, PDF_LINE_CHARS))}) Tj ET`,
      ),
      `BT /F1 7.5 Tf 36 24 Td (${pdfEscape(pdfSafe(`${footer} - page ${p + 1} of ${pages.length}`))}) Tj ET`,
    ].join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4 + p * 2} 0 R >>`,
      `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
    );
  });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
