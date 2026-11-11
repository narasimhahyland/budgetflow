import { csvCell } from '@bf/api/actuals';
import type { ReportFilters, ReportFormat, ReportResult } from '@bf/contracts';
import { exponentOf, formatAmount, isCurrencyCode } from '@bf/domain';
import { PDF_LINE_CHARS, textPdf, xlsxWorkbook, type XlsxCell } from './file-writers';

/**
 * Report exports (A1): the file a person downloads is rendered from the same `ReportResult` the
 * screen shows, run with that person's filters and scope, so a file never carries a row the screen
 * would not. Money is written in major units of the report currency, which each header names.
 */

/** Exports and attachments carry every row of the run (the screen pages at 200). */
export const EXPORT_ROW_LIMIT = 10_000;

export const EXPORT_CONTENT_TYPES: Record<ReportFormat, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** One cell of the exported table: text, or a number written as a plain decimal. */
type Value = { text: string } | { number: string; display: string };

interface ExportTable {
  headers: string[];
  numeric: boolean[];
  rows: Value[][];
  totals: Value[] | null;
}

/** `-123456` minor units of INR as `-1234.56`: integer arithmetic only, no floating point. */
export function plainDecimal(amountMinor: number, currency: string): string {
  const exp = isCurrencyCode(currency) ? exponentOf(currency) : 2;
  const digits = Math.abs(Math.trunc(amountMinor))
    .toString()
    .padStart(exp + 1, '0');
  const whole = digits.slice(0, digits.length - exp);
  const fraction = exp > 0 ? `.${digits.slice(digits.length - exp)}` : '';
  return `${amountMinor < 0 ? '-' : ''}${whole}${fraction}`;
}

/** Basis points as a percentage with two decimals (`1234` → `12.34`), again in integers. */
const bpsDecimal = (bps: number): string => {
  const abs = Math.abs(Math.trunc(bps));
  return `${bps < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

type Row = ReportResult['rows'][number];
type Column = ReportResult['columns'][number];

function value(row: Row, column: Column): Value {
  const cell = row.cells[column.key] ?? (column.key === 'label' ? { text: row.label } : undefined);
  if (!cell) return { text: '' };
  if (cell.money)
    return {
      number: plainDecimal(cell.money.amountMinor, cell.money.currency),
      display: formatAmount(cell.money.amountMinor, cell.money.currency).replace(/^[A-Z]{3} /, ''),
    };
  if (cell.bps !== null && cell.bps !== undefined)
    return { number: bpsDecimal(cell.bps), display: `${bpsDecimal(cell.bps)}%` };
  if (cell.number !== null && cell.number !== undefined)
    return { number: String(cell.number), display: String(cell.number) };
  return { text: cell.text ?? '' };
}

function table(result: ReportResult): ExportTable {
  const headers = result.columns.map((c) =>
    c.type === 'money'
      ? `${c.label} (${result.currency})`
      : c.type === 'percent'
        ? `${c.label} (%)`
        : c.label,
  );
  return {
    headers,
    numeric: result.columns.map((c) => c.align === 'end'),
    rows: result.rows.map((r) => result.columns.map((c) => value(r, c))),
    totals: result.totals ? result.columns.map((c) => value(result.totals!, c)) : null,
  };
}

const plain = (v: Value): string => ('text' in v ? v.text : v.number);

/** The filters as `name: value` pairs, in a stable order, for the file's about block. */
export function filterLines(filters: ReportFilters): [string, string][] {
  return Object.entries(filters)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]);
}

function about(result: ReportResult): [string, string][] {
  return [
    ['Report', result.name],
    ['Question', result.question],
    ['Scope', result.scope.label + (result.scope.note ? ` (${result.scope.note})` : '')],
    ['Reporting currency', result.currency],
    ['Generated at', result.generatedAt],
    ['Rows', String(result.rowCount)],
    ...filterLines(result.filters).map(([k, v]): [string, string] => [`Filter ${k}`, v]),
    [
      'Reconciles to the ledger',
      result.reconciliation.ties
        ? 'yes'
        : `no, ${result.reconciliation.differences.length} difference(s)`,
    ],
    ...result.notes.map((n): [string, string] => ['Note', n]),
  ];
}

/**
 * CSV: the table with one header row and a totals row. Every cell goes through `csvCell`, which
 * neutralises formulas (`=`, `+`, `-`, `@`, tab, carriage return) while plain numbers stay numbers.
 */
function renderCsv(result: ReportResult): Buffer {
  const t = table(result);
  const lines = [
    t.headers.map(csvCell).join(','),
    ...t.rows.map((r) => r.map((v) => csvCell(plain(v))).join(',')),
    ...(t.totals ? [t.totals.map((v, i) => csvCell(i === 0 ? 'Total' : plain(v))).join(',')] : []),
  ];
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
}

function renderXlsx(result: ReportResult): Buffer {
  const t = table(result);
  const cell = (v: Value): XlsxCell => ('text' in v ? v.text : { n: v.number });
  return xlsxWorkbook(
    [
      {
        name: 'Report',
        rows: [
          t.headers,
          ...t.rows.map((r) => r.map(cell)),
          ...(t.totals ? [t.totals.map((v, i) => (i === 0 ? 'Total' : cell(v)))] : []),
        ],
      },
      { name: 'About', rows: about(result) },
    ],
    `${result.reportId}:${result.generatedAt}`,
  );
}

const ellipsis = (s: string, width: number) =>
  s.length <= width ? s : `${s.slice(0, Math.max(0, width - 1))}~`;

function renderPdf(result: ReportResult): Buffer {
  const t = table(result);
  const shown = (v: Value) => ('text' in v ? v.text : v.display);
  const all = [
    t.headers,
    ...t.rows.map((r) => r.map(shown)),
    ...(t.totals ? [t.totals.map(shown)] : []),
  ];
  const widths = t.headers.map((_h, c) =>
    Math.min(40, Math.max(...all.map((r) => (r[c] ?? '').length))),
  );
  // Fit the line: shrink the widest columns first, never below 8 characters.
  const gap = 2;
  const total = () => widths.reduce((a, w) => a + w, 0) + gap * (widths.length - 1);
  while (total() > PDF_LINE_CHARS) {
    const widest = widths.indexOf(Math.max(...widths));
    if (widths[widest] <= 8) break;
    widths[widest] -= 1;
  }
  const line = (cells: string[]) =>
    cells
      .map((v, c) => {
        const s = ellipsis(v, widths[c]);
        return t.numeric[c] ? s.padStart(widths[c]) : s.padEnd(widths[c]);
      })
      .join(' '.repeat(gap))
      .trimEnd();
  const lines = [
    result.name,
    result.question,
    '',
    ...about(result)
      .filter(([k]) => !['Report', 'Question', 'Note'].includes(k))
      .map(([k, v]) => `${k}: ${v}`),
    '',
    line(t.headers),
    line(widths.map((w) => '-'.repeat(w))),
    ...t.rows.map((r) => line(r.map(shown))),
    ...(t.totals
      ? [
          line(widths.map((w) => '-'.repeat(w))),
          line(t.totals.map((v, i) => (i === 0 ? 'Total' : shown(v)))),
        ]
      : []),
    ...(result.notes.length ? ['', ...result.notes.map((n) => `Note: ${n}`)] : []),
  ];
  return textPdf(lines, `${result.name} - ${result.scope.label} - generated ${result.generatedAt}`);
}

export function renderReportFile(result: ReportResult, format: ReportFormat): Buffer {
  if (format === 'csv') return renderCsv(result);
  if (format === 'xlsx') return renderXlsx(result);
  return renderPdf(result);
}

/** Where an export's file lives: under the tenant's own prefix, so no other tenant can address it. */
export const exportStorageKey = (tenantId: string, exportId: string, format: string): string =>
  `tenants/${tenantId}/report-exports/${exportId}.${format}`;

/** The download name, derived from the export row so it needs no column of its own. */
export const exportFileName = (
  reportId: string,
  requestedAt: Date,
  exportId: string,
  format: string,
): string =>
  `${reportId}-${requestedAt.toISOString().slice(0, 10)}-${exportId.slice(0, 8)}.${format}`;
