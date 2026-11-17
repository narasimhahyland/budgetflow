import { z } from 'zod';
import { CurrencyCode, Id, IsoDate, IsoDateTime, Money } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

/**
 * Gap B5: finance and payroll exports (screen 094b). Exports hand the ERP and payroll the entries
 * BudgetFlow already posted, as balanced, period-stamped files. They never change a balance: lines are
 * read from posted journals (and, for payroll, from the employee benefit ledger), each source item is
 * exported once, and sending one again needs a reason and is marked as a duplicate send.
 */

export const FINANCE_EXPORT_TYPES = [
  'intercompany_recharges',
  'chargeback_reclass',
  'payroll_benefits',
] as const;
export const FinanceExportType = z
  .enum(FINANCE_EXPORT_TYPES)
  .describe(
    'What the export carries: intercompany recharge journals, chargeback and reclass journals, or reportable employee benefits for payroll.',
  );
export type FinanceExportType = z.infer<typeof FinanceExportType>;

export const FINANCE_EXPORT_STATUSES = [
  'draft',
  'sent',
  'acknowledged',
  'posted',
  'failed',
] as const;
export const FinanceExportStatus = z
  .enum(FINANCE_EXPORT_STATUSES)
  .describe(
    'Draft, Sent (the file was produced and handed over), Acknowledged by the receiving system, Posted in the ERP (with its document number), or Failed.',
  );
export type FinanceExportStatus = z.infer<typeof FinanceExportStatus>;

export const FinanceExportFormat = z.enum(['csv', 'xlsx']).describe('File format to download.');
export type FinanceExportFormat = z.infer<typeof FinanceExportFormat>;

const Month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe('Calendar month of the accounting dates, YYYY-MM (October 2026 is 2026-10).');
const Reason = z.string().trim().min(5).max(500);
const BoolString = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .describe('true or false.');
const ExportParams = z.object({ exportId: Id }).strict();

export const FinanceExportLine = named(
  'FinanceExportLine',
  z
    .object({
      lineNo: z.int(),
      sourceType: z
        .enum(['ledger_line', 'benefit'])
        .describe('A posted ledger line, or a person’s reportable benefit for a threshold.'),
      sourceRef: z.string().describe('Stable reference of the source item (exported once).'),
      journalId: Id.nullable().describe('The posted journal the line comes from.'),
      journalLineNo: z.int().nullable(),
      accountingDate: IsoDate.nullable(),
      periodLabel: z.string().nullable().describe('The legal entity’s own fiscal period.'),
      legalEntityId: Id,
      legalEntityCode: z.string(),
      account: z
        .string()
        .nullable()
        .describe('ERP account code; null when the line has no account mapping.'),
      accountName: z.string().nullable(),
      costCenter: z.string().nullable(),
      eventCode: z.string().nullable(),
      description: z.string(),
      debit: Money.describe('Debit in the reporting currency (zero on a credit line).'),
      credit: Money.describe('Credit in the reporting currency (zero on a debit line).'),
      transaction: Money.describe('Signed amount in the transaction currency (debit positive).'),
      rate: z.string().nullable().describe('Reporting rate used on the posted line.'),
      personId: Id.nullable(),
      personName: z.string().nullable(),
      benefit: z.string().nullable().describe('Payroll lines: the benefit threshold.'),
      taxYear: z
        .object({ fromDate: IsoDate, toDate: IsoDate })
        .strict()
        .nullable()
        .describe('Payroll lines: the threshold’s tax year.'),
      reportable: Money.nullable().describe(
        'Payroll lines: reportable amount newly due to payroll in this export.',
      ),
      alreadyExported: z
        .boolean()
        .describe('The item is already in an earlier export; sending it again is a duplicate.'),
      exportedIn: z
        .string()
        .nullable()
        .describe('Number of the earlier export, when there is one.'),
    })
    .strict(),
);
export type FinanceExportLine = z.infer<typeof FinanceExportLine>;

export const FinanceExportPersonTotal = named(
  'FinanceExportPersonTotal',
  z
    .object({ personId: Id, personName: z.string(), reportable: Money })
    .strict()
    .describe('Payroll exports total per person instead of balancing debits and credits.'),
);

export const FinanceExportPrevious = named(
  'FinanceExportPrevious',
  z
    .object({
      id: Id,
      number: z.string(),
      status: FinanceExportStatus,
      sentAt: IsoDateTime.nullable(),
      acknowledgedAt: IsoDateTime.nullable(),
      postedAt: IsoDateTime.nullable(),
    })
    .strict(),
);

export const FinanceExportPreview = named(
  'FinanceExportPreview',
  z
    .object({
      type: FinanceExportType,
      period: Month,
      periodLabel: z.string().describe('The month in words, for example October 2026.'),
      legalEntityId: Id.nullable(),
      legalEntityCode: z.string().nullable(),
      includeExported: z.boolean(),
      lines: z.array(FinanceExportLine),
      lineCount: z.int(),
      debitTotal: Money,
      creditTotal: Money,
      reportableTotal: Money.nullable().describe(
        'Payroll: total reportable in the entity currency.',
      ),
      personTotals: z.array(FinanceExportPersonTotal),
      balanced: z
        .boolean()
        .describe('Debits equal credits and every line has an account (payroll: always true).'),
      unmappedLines: z.int().describe('Lines with no account mapping.'),
      problem: z
        .string()
        .nullable()
        .describe('Plain-English reason the export cannot be created, when it cannot.'),
      nothingToExport: z.boolean(),
      message: z.string().nullable().describe('Info line, for example when there is nothing new.'),
      duplicates: z.int().describe('Lines already exported (only when includeExported).'),
      previousExports: z.array(FinanceExportPrevious),
      canCreate: z.boolean(),
    })
    .strict(),
);
export type FinanceExportPreview = z.infer<typeof FinanceExportPreview>;

export const FinanceExportSummary = named(
  'FinanceExportSummary',
  z
    .object({
      id: Id,
      number: z.string().describe('Export number, for example EXP-2026-0141.'),
      type: FinanceExportType,
      period: Month,
      periodLabel: z.string(),
      legalEntityId: Id.nullable(),
      entityLabel: z
        .string()
        .describe('Entity or entity pair, for example HYL-DE to HYL-IN, or All entities.'),
      lineCount: z.int(),
      personCount: z.int().nullable(),
      debitTotal: Money,
      creditTotal: Money,
      reportableTotal: Money.nullable(),
      target: z
        .enum(['file'])
        .describe('Delivered as a CSV and XLSX file. ERP connector delivery is planned.'),
      status: FinanceExportStatus,
      duplicate: z.boolean().describe('A re-export: the receiving system may already hold lines.'),
      duplicateReason: z.string().nullable(),
      erpDocumentNumber: z.string().nullable(),
      acknowledgementRef: z.string().nullable(),
      failureMessage: z.string().nullable(),
      createdByName: z.string().nullable(),
      createdAt: IsoDateTime,
      sentAt: IsoDateTime.nullable(),
      postedAt: IsoDateTime.nullable(),
      canDownload: z
        .boolean()
        .describe('The reader may open the lines and files (personal data needs benefits.read).'),
      canMarkPosted: z.boolean(),
      canResend: z.boolean(),
    })
    .strict(),
);
export type FinanceExportSummary = z.infer<typeof FinanceExportSummary>;

export const FinanceExportDetail = named(
  'FinanceExportDetail',
  z
    .object({
      export: FinanceExportSummary,
      lines: z.array(FinanceExportLine),
      personTotals: z.array(FinanceExportPersonTotal),
    })
    .strict(),
);
export type FinanceExportDetail = z.infer<typeof FinanceExportDetail>;

export const FinanceExportList = named(
  'FinanceExportList',
  z
    .object({
      period: Month,
      periodLabel: z.string(),
      periods: z
        .array(z.object({ value: Month, label: z.string() }).strict())
        .describe('Months to choose from, newest first.'),
      items: z.array(FinanceExportSummary),
      reportingCurrency: CurrencyCode,
      canCreate: z.boolean(),
    })
    .strict(),
);
export type FinanceExportList = z.infer<typeof FinanceExportList>;

export const FinanceExportListQuery = z
  .object({ period: Month.optional(), type: FinanceExportType.optional() })
  .strict();
export type FinanceExportListQuery = z.infer<typeof FinanceExportListQuery>;

export const FinanceExportPreviewQuery = z
  .object({
    type: FinanceExportType,
    period: Month,
    legalEntityId: Id.optional(),
    includeExported: BoolString.optional(),
  })
  .strict();
export type FinanceExportPreviewQuery = z.infer<typeof FinanceExportPreviewQuery>;

export const CreateFinanceExportRequest = named(
  'CreateFinanceExportRequest',
  z
    .object({
      type: FinanceExportType,
      period: Month,
      legalEntityId: Id.optional().describe('Required for payroll exports.'),
      includeExported: z
        .boolean()
        .default(false)
        .describe('Include items already exported (a duplicate send; needs a reason).'),
      reason: Reason.optional().describe('Why items already exported are sent again.'),
    })
    .strict(),
);
export type CreateFinanceExportRequest = z.infer<typeof CreateFinanceExportRequest>;

export const MarkFinanceExportPostedRequest = named(
  'MarkFinanceExportPostedRequest',
  z
    .object({
      erpDocumentNumber: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .describe('Document number the ERP or payroll gave the posting.'),
    })
    .strict(),
);
export type MarkFinanceExportPostedRequest = z.infer<typeof MarkFinanceExportPostedRequest>;

export const FinanceExportDownloadQuery = z.object({ format: FinanceExportFormat }).strict();

export const FinanceExportDownload = named(
  'FinanceExportDownload',
  z
    .object({ url: z.string(), fileName: z.string(), expiresAt: IsoDateTime })
    .strict()
    .describe('A short-lived signed URL (5 minutes) for the export file.'),
);
export type FinanceExportDownload = z.infer<typeof FinanceExportDownload>;

export const financeExportEndpoints = {
  listFinanceExports: {
    operationId: 'listFinanceExports',
    method: 'get',
    path: '/api/finance/exports',
    summary: 'Finance and payroll exports for a month',
    tags: ['finance-exports'],
    auth: true,
    query: FinanceExportListQuery,
    response: { status: 200, schema: FinanceExportList },
    errors: [400, 401, 403],
  },
  previewFinanceExport: {
    operationId: 'previewFinanceExport',
    method: 'get',
    path: '/api/finance/exports/preview',
    summary: 'The lines a new export would carry, with the balance check',
    tags: ['finance-exports'],
    auth: true,
    query: FinanceExportPreviewQuery,
    response: { status: 200, schema: FinanceExportPreview },
    errors: [400, 401, 403, 422],
  },
  createFinanceExport: {
    operationId: 'createFinanceExport',
    method: 'post',
    path: '/api/finance/exports',
    summary: 'Create a balanced export and produce its files',
    tags: ['finance-exports'],
    auth: true,
    idempotent: true,
    body: CreateFinanceExportRequest,
    response: { status: 201, schema: FinanceExportDetail },
    errors: [400, 401, 403, 409, 422],
  },
  getFinanceExport: {
    operationId: 'getFinanceExport',
    method: 'get',
    path: '/api/finance/exports/{exportId}',
    summary: 'One export with its lines',
    tags: ['finance-exports'],
    auth: true,
    params: ExportParams,
    response: { status: 200, schema: FinanceExportDetail },
    errors: [401, 403, 404],
  },
  markFinanceExportPosted: {
    operationId: 'markFinanceExportPosted',
    method: 'post',
    path: '/api/finance/exports/{exportId}/posted',
    summary: 'Record that the ERP or payroll posted the export',
    tags: ['finance-exports'],
    auth: true,
    idempotent: true,
    params: ExportParams,
    body: MarkFinanceExportPostedRequest,
    response: { status: 200, schema: FinanceExportSummary },
    errors: [400, 401, 403, 404, 409],
  },
  getFinanceExportDownload: {
    operationId: 'getFinanceExportDownload',
    method: 'get',
    path: '/api/finance/exports/{exportId}/download',
    summary: 'A short-lived signed link to the export file',
    tags: ['finance-exports'],
    auth: true,
    params: ExportParams,
    query: FinanceExportDownloadQuery,
    response: { status: 200, schema: FinanceExportDownload },
    errors: [400, 401, 403, 404],
  },
} as const satisfies Record<string, Endpoint>;
