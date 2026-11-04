import { z } from 'zod';
import {
  AppliedRate,
  CurrencyCode,
  Id,
  IsoDate,
  IsoDateTime,
  LedgerAccount,
  Money,
} from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

const JournalParams = z.object({ journalId: Id }).strict();

// Ledger ---------------------------------------------------------------------------------------
export const LedgerLine = named(
  'LedgerLine',
  z
    .object({
      id: Id,
      journalId: Id,
      lineNo: z.int(),
      budgetId: Id.nullable(),
      account: LedgerAccount,
      legalEntityId: Id,
      costCenterId: Id.nullable(),
      glAccountId: Id.nullable(),
      eventCode: z.string().nullable(),
      periodId: Id,
      accountingDate: IsoDate,
      transaction: Money.describe('Signed: debit positive, credit negative.'),
      budget: Money.nullable(),
      reporting: Money,
      budgetRate: AppliedRate.nullable(),
      reportingRate: AppliedRate,
      planVersionId: Id.nullable(),
      reversalOfLineId: Id.nullable(),
    })
    .strict()
    .describe('One append-only ledger line carrying the currency triplet.'),
);

export const JournalTotals = z
  .object({
    debitTransactionMinor: z.int(),
    creditTransactionMinor: z.int(),
    debitReportingMinor: z.int(),
    creditReportingMinor: z.int(),
  })
  .strict();

export const Journal = named(
  'Journal',
  z
    .object({
      id: Id,
      type: z.string(),
      transactionCurrency: CurrencyCode,
      reportingCurrency: CurrencyCode,
      accountingDate: IsoDate,
      periodId: Id,
      periodLabel: z.string(),
      late: z
        .boolean()
        .describe('Posted to the next open period because its own period was closed.'),
      originalPeriodId: Id.nullable(),
      reversalOfJournalId: Id.nullable(),
      reversedByJournalId: Id.nullable(),
      reasonCode: z.string().nullable(),
      reason: z.string().nullable(),
      actorPersonId: Id.nullable(),
      createdAt: IsoDateTime,
      totals: JournalTotals,
      balanced: z.boolean(),
      lines: z.array(LedgerLine),
    })
    .strict()
    .describe('A balanced, append-only journal.'),
);
export type Journal = z.infer<typeof Journal>;

export const LedgerLineList = named(
  'LedgerLineList',
  z.object({ items: z.array(LedgerLine) }).strict(),
);

export const ManualJournalRequest = named(
  'ManualJournalRequest',
  z
    .object({
      transactionCurrency: CurrencyCode,
      accountingDate: IsoDate.optional(),
      reasonCode: z.string().trim().min(1).max(50),
      reason: z.string().trim().min(5).max(1000),
      lines: z
        .array(
          z
            .object({
              budgetId: Id.nullable(),
              account: LedgerAccount,
              side: z.enum(['debit', 'credit']),
              amountMinor: z.int().positive(),
              legalEntityId: Id.optional().describe(
                'Counter-account lines only; budget lines use the budget legal entity.',
              ),
            })
            .strict(),
        )
        .min(2)
        .max(50),
    })
    .strict()
    .describe(
      'Opening balances and adjustments to commitment, actual and accrual buckets (finance admins).',
    ),
);

export const ReversalRequest = named(
  'ReversalRequest',
  z
    .object({
      reasonCode: z.string().trim().min(1).max(50),
      reason: z.string().trim().min(5).max(1000),
      accountingDate: IsoDate.optional(),
    })
    .strict(),
);

export type LedgerLine = z.infer<typeof LedgerLine>;
export type LedgerLineList = z.infer<typeof LedgerLineList>;
export type ManualJournalRequest = z.infer<typeof ManualJournalRequest>;
export type ReversalRequest = z.infer<typeof ReversalRequest>;

export const ledgerEndpoints = {
  getJournal: {
    operationId: 'getJournal',
    method: 'get',
    path: '/api/ledger/journals/{journalId}',
    summary: 'A journal with its lines and totals',
    tags: ['ledger'],
    auth: true,
    params: JournalParams,
    response: { status: 200, schema: Journal },
    errors: [401, 403, 404],
  },
  postManualJournal: {
    operationId: 'postManualJournal',
    method: 'post',
    path: '/api/ledger/journals',
    summary: 'Post a manual journal (opening balances, adjustments)',
    tags: ['ledger'],
    auth: true,
    idempotent: true,
    body: ManualJournalRequest,
    response: { status: 201, schema: Journal },
    errors: [400, 401, 403, 404, 409, 422],
  },
  reverseJournal: {
    operationId: 'reverseJournal',
    method: 'post',
    path: '/api/ledger/journals/{journalId}/reversals',
    summary: 'Reverse a journal with a linked, exactly negating journal',
    tags: ['ledger'],
    auth: true,
    idempotent: true,
    params: JournalParams,
    body: ReversalRequest,
    response: { status: 201, schema: Journal },
    errors: [400, 401, 403, 404, 409, 422],
  },
} as const satisfies Record<string, Endpoint>;
