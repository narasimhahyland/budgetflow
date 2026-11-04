import { exponentOf, isCurrencyCode, type CurrencyCode } from '../money/currency';
import { err, ok, type Result } from '../result';
import type { ImportIssue } from '../org/imports';

/**
 * Actuals file import (card, expense and ERP exports): canonical columns, column mapping from the
 * source headers, and row validation into typed lines. Pure: the API resolves codes to ids.
 */
export const ACTUAL_KINDS = ['charge', 'refund', 'credit_note', 'reversal'] as const;
export type ActualKind = (typeof ACTUAL_KINDS)[number];

export const ACTUAL_IMPORT_FIELDS = [
  'source_ref',
  'transaction_date',
  'accounting_date',
  'amount',
  'currency',
  'legal_entity',
  'cost_center',
  'gl_account',
  'event_code',
  'vendor',
  'merchant',
  'memo',
  'reference',
  'original_ref',
  'kind',
  'card_program',
] as const;
export type ActualImportField = (typeof ACTUAL_IMPORT_FIELDS)[number];

export const REQUIRED_ACTUAL_FIELDS: readonly ActualImportField[] = [
  'source_ref',
  'transaction_date',
  'amount',
  'currency',
  'legal_entity',
];

/** Header names commonly used by card, expense and ERP exports for each canonical field. */
const SYNONYMS: Record<ActualImportField, readonly string[]> = {
  source_ref: ['source_ref', 'line_id', 'transaction_id', 'id', 'document_line', 'reference_id'],
  transaction_date: ['transaction_date', 'date', 'posting_date', 'txn_date', 'expense_date'],
  accounting_date: ['accounting_date', 'gl_date'],
  amount: ['amount', 'transaction_amount', 'amount_local', 'value'],
  currency: ['currency', 'transaction_currency', 'ccy'],
  legal_entity: ['legal_entity', 'entity', 'company', 'company_code'],
  cost_center: ['cost_center', 'cost_centre', 'cc'],
  gl_account: ['gl_account', 'account', 'gl'],
  event_code: ['event_code', 'event', 'project_code'],
  vendor: ['vendor', 'supplier', 'vendor_name'],
  merchant: ['merchant', 'merchant_name', 'payee'],
  memo: ['memo', 'description', 'narrative'],
  reference: ['reference', 'po_number', 'po', 'commitment_ref'],
  original_ref: ['original_ref', 'original_reference', 'reverses', 'applies_to'],
  kind: ['kind', 'type', 'line_type'],
  card_program: ['card_program', 'program', 'card'],
};

export type ColumnMapping = Partial<Record<ActualImportField, string>>;

/**
 * Resolves which source header feeds each canonical field: an explicit mapping wins, then exact and
 * synonym header names. Reports required fields left without a column.
 */
export function resolveColumnMapping(
  headers: readonly string[],
  explicit: ColumnMapping = {},
): { mapping: Record<ActualImportField, string | null>; missing: ActualImportField[] } {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const mapping = {} as Record<ActualImportField, string | null>;
  for (const field of ACTUAL_IMPORT_FIELDS) {
    const chosen = explicit[field]?.trim().toLowerCase();
    if (chosen) {
      mapping[field] = lower.includes(chosen) ? chosen : null;
      continue;
    }
    mapping[field] = SYNONYMS[field].find((s) => lower.includes(s)) ?? null;
  }
  const missing = REQUIRED_ACTUAL_FIELDS.filter((f) => !mapping[f]);
  return { mapping, missing };
}

/** Parses a decimal amount ("1,24,500.00", "-640", "(18.50)") into minor units of the currency. */
export function parseDecimalAmount(raw: string, currency: CurrencyCode): Result<number> {
  let s = raw.trim().replace(/[\s,]/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  const exp = exponentOf(currency);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return err('VALIDATION_FAILED', `"${raw}" is not an amount.`);
  const frac = m[2] ?? '';
  if (frac.length > exp)
    return err(
      'VALIDATION_FAILED',
      `${currency} amounts have at most ${exp} decimal place${exp === 1 ? '' : 's'}.`,
    );
  const minor = Number(m[1] + frac.padEnd(exp, '0'));
  if (!Number.isSafeInteger(minor))
    return err('AMOUNT_NOT_SAFE_INTEGER', 'The amount is too large to represent safely.');
  if (minor === 0) return err('AMOUNT_NOT_POSITIVE', 'The amount cannot be zero.');
  return ok(negative ? -minor : minor);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDate = (s: string) =>
  ISO_DATE.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  s === new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10);

/** Codes the API knows, resolved to ids (case-insensitive keys). */
export interface ActualImportRefs {
  legalEntities: ReadonlyMap<string, string>;
  /** Cost centers by code. */
  costCenters: ReadonlyMap<string, string>;
  /** GL accounts by `${legalEntityId}|${code}`. */
  glAccounts: ReadonlyMap<string, string>;
  /** Vendors by lower-cased name. */
  vendors: ReadonlyMap<string, string>;
}

export interface ParsedActualLine {
  line: number;
  sourceRef: string;
  kind: ActualKind;
  transactionDate: string;
  accountingDate: string;
  amountMinor: number;
  currency: CurrencyCode;
  legalEntityId: string;
  costCenterId: string | null;
  glAccountId: string | null;
  eventCode: string | null;
  vendorId: string | null;
  merchant: string | null;
  memo: string | null;
  reference: string | null;
  originalRef: string | null;
  cardProgram: string | null;
}

/**
 * Validates mapped rows into typed lines. Rows with problems are reported (file line, field, message)
 * and left out; refunds and credit notes are negative, charges positive, reversals take the sign of
 * the line they reverse (negative in the source file).
 */
export function validateActualRows(
  rows: readonly { line: number; values: Record<string, string> }[],
  mapping: Record<ActualImportField, string | null>,
  refs: ActualImportRefs,
): { lines: ParsedActualLine[]; issues: ImportIssue[] } {
  const lines: ParsedActualLine[] = [];
  const issues: ImportIssue[] = [];
  const get = (values: Record<string, string>, f: ActualImportField) => {
    const col = mapping[f];
    const v = col ? (values[col] ?? '').trim() : '';
    return v === '' ? null : v;
  };
  for (const row of rows) {
    const problems: ImportIssue[] = [];
    const issue = (field: ActualImportField, message: string) =>
      problems.push({ line: row.line, field, message });
    const sourceRef = get(row.values, 'source_ref');
    if (!sourceRef) issue('source_ref', 'Each line needs its source reference.');
    else if (sourceRef.length > 200)
      issue('source_ref', 'Source references are at most 200 characters.');
    const transactionDate = get(row.values, 'transaction_date');
    if (!transactionDate || !isIsoDate(transactionDate))
      issue('transaction_date', 'Use a date as YYYY-MM-DD.');
    const accountingRaw = get(row.values, 'accounting_date');
    if (accountingRaw && !isIsoDate(accountingRaw))
      issue('accounting_date', 'Use a date as YYYY-MM-DD.');
    const currencyRaw = (get(row.values, 'currency') ?? '').toUpperCase();
    const currency = isCurrencyCode(currencyRaw) ? currencyRaw : null;
    if (!currency)
      issue('currency', `${currencyRaw || 'The currency'} is not a supported ISO 4217 code.`);
    let amountMinor = 0;
    const amountRaw = get(row.values, 'amount');
    if (!amountRaw) issue('amount', 'Each line needs an amount.');
    else if (currency) {
      const a = parseDecimalAmount(amountRaw, currency);
      if (a.ok) amountMinor = a.value;
      else issue('amount', a.error.message);
    }
    const entityCode = get(row.values, 'legal_entity');
    const legalEntityId = entityCode ? refs.legalEntities.get(entityCode.toLowerCase()) : undefined;
    if (!legalEntityId)
      issue('legal_entity', `Legal entity ${entityCode ?? '(blank)'} is not known.`);
    const ccCode = get(row.values, 'cost_center');
    const costCenterId = ccCode ? (refs.costCenters.get(ccCode.toLowerCase()) ?? null) : null;
    if (ccCode && !costCenterId) issue('cost_center', `Cost center ${ccCode} is not known.`);
    const glCode = get(row.values, 'gl_account');
    const glAccountId =
      glCode && legalEntityId
        ? (refs.glAccounts.get(`${legalEntityId}|${glCode.toLowerCase()}`) ?? null)
        : null;
    if (glCode && legalEntityId && !glAccountId)
      issue('gl_account', `GL account ${glCode} does not exist for this legal entity.`);
    const vendorName = get(row.values, 'vendor');
    const vendorId = vendorName ? (refs.vendors.get(vendorName.toLowerCase()) ?? null) : null;
    const kindRaw = (get(row.values, 'kind') ?? '').toLowerCase().replace(/[\s-]/g, '_');
    let kind: ActualKind;
    if (kindRaw) {
      if (!(ACTUAL_KINDS as readonly string[]).includes(kindRaw)) {
        issue('kind', 'Kind is charge, refund, credit_note or reversal.');
        kind = 'charge';
      } else kind = kindRaw as ActualKind;
    } else kind = amountMinor < 0 ? 'refund' : 'charge';
    if (kind === 'charge' && amountMinor < 0)
      issue(
        'amount',
        'Charges are positive; use kind refund, credit_note or reversal for negative lines.',
      );
    if ((kind === 'refund' || kind === 'credit_note') && amountMinor > 0)
      amountMinor = -amountMinor;
    const originalRef = get(row.values, 'original_ref');
    if (kind === 'reversal' && !originalRef)
      issue('original_ref', 'A reversal names the source reference of the line it reverses.');
    if (problems.length > 0) {
      issues.push(...problems);
      continue;
    }
    lines.push({
      line: row.line,
      sourceRef: sourceRef!,
      kind,
      transactionDate: transactionDate!,
      accountingDate: accountingRaw ?? transactionDate!,
      amountMinor,
      currency: currency!,
      legalEntityId: legalEntityId!,
      costCenterId,
      glAccountId,
      eventCode: get(row.values, 'event_code'),
      vendorId,
      merchant: get(row.values, 'merchant') ?? vendorName,
      memo: get(row.values, 'memo'),
      reference: get(row.values, 'reference'),
      originalRef,
      cardProgram: get(row.values, 'card_program'),
    });
  }
  return { lines, issues };
}
