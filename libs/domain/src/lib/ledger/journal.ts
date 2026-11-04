import type { CurrencyCode } from '../money/currency';
import type { Money } from '../money/money';
import type { AppliedRate } from '../money/rate';
import { err, ok, type Result } from '../result';
import { isBudgetBucket, type LedgerAccount } from './accounts';

export const JOURNAL_TYPES = [
  'original_budget',
  'allocation',
  'transfer',
  'reduction',
  'increase',
  'commitment',
  'actual',
  'accrual',
  'contribution',
  'recharge',
  'surplus_return',
  'rollover',
  'manual',
  'reversal',
] as const;
export type JournalType = (typeof JOURNAL_TYPES)[number];

export interface LineDimensions {
  legalEntityId: string;
  costCenterId?: string | null;
  glAccountId?: string | null;
  eventCode?: string | null;
}

export interface LineProvenance {
  planVersionId?: string | null;
  commitmentId?: string | null;
  eventId?: string | null;
  contributionId?: string | null;
  actualId?: string | null;
  requestId?: string | null;
  approvalId?: string | null;
  importLineId?: string | null;
}

/** One journal line. Amounts are signed (debit +, credit −) in every currency view. */
export interface JournalLine extends LineDimensions, LineProvenance {
  budgetId: string | null;
  account: LedgerAccount;
  transaction: Money;
  /** Budget-currency amount; null on counter-account lines. */
  budget: Money | null;
  reporting: Money;
  budgetRate: AppliedRate | null;
  reportingRate: AppliedRate;
  reversalOfLineId?: string | null;
}

export interface JournalDraft {
  type: JournalType;
  transactionCurrency: CurrencyCode;
  reportingCurrency: CurrencyCode;
  accountingDate: string;
  lines: JournalLine[];
  reasonCode?: string | null;
  reason?: string | null;
  reversalOfJournalId?: string | null;
}

export interface JournalTotals {
  debitTransactionMinor: number;
  creditTransactionMinor: number;
  debitReportingMinor: number;
  creditReportingMinor: number;
}

export function journalTotals(
  lines: readonly { transaction: { amountMinor: number }; reporting: { amountMinor: number } }[],
): JournalTotals {
  const t = {
    debitTransactionMinor: 0,
    creditTransactionMinor: 0,
    debitReportingMinor: 0,
    creditReportingMinor: 0,
  };
  for (const l of lines) {
    if (l.transaction.amountMinor >= 0) t.debitTransactionMinor += l.transaction.amountMinor;
    else t.creditTransactionMinor -= l.transaction.amountMinor;
    if (l.reporting.amountMinor >= 0) t.debitReportingMinor += l.reporting.amountMinor;
    else t.creditReportingMinor -= l.reporting.amountMinor;
  }
  return t;
}

/**
 * Validates a journal: at least two lines, one transaction and one reporting currency, budget
 * buckets carry a budget and a budget amount, counter accounts carry neither, and the journal
 * balances in transaction and reporting currency.
 */
export function buildJournal(
  draft: JournalDraft,
): Result<JournalDraft & { totals: JournalTotals }> {
  if (draft.lines.length < 2)
    return err('JOURNAL_TOO_FEW_LINES', 'A journal needs at least two lines.');
  for (const [i, l] of draft.lines.entries()) {
    const where = { line: i + 1 };
    if (l.transaction.currency !== draft.transactionCurrency) {
      return err(
        'JOURNAL_LINE_INVALID',
        `Line ${i + 1} is not in the journal's transaction currency.`,
        where,
      );
    }
    if (l.reporting.currency !== draft.reportingCurrency) {
      return err('JOURNAL_LINE_INVALID', `Line ${i + 1} is not in the reporting currency.`, where);
    }
    for (const m of [l.transaction, l.reporting, ...(l.budget ? [l.budget] : [])]) {
      if (!Number.isSafeInteger(m.amountMinor))
        return err('AMOUNT_NOT_SAFE_INTEGER', `Line ${i + 1} has a non-integer amount.`, where);
    }
    if (isBudgetBucket(l.account)) {
      if (!l.budgetId || !l.budget || !l.budgetRate) {
        return err(
          'JOURNAL_LINE_INVALID',
          `Line ${i + 1} posts to a budget bucket without a budget amount.`,
          where,
        );
      }
      if (
        Math.sign(l.budget.amountMinor) !== Math.sign(l.transaction.amountMinor) &&
        l.budget.amountMinor !== 0
      ) {
        return err(
          'JOURNAL_LINE_INVALID',
          `Line ${i + 1} has budget and transaction amounts with different signs.`,
          where,
        );
      }
    } else if (l.budgetId || l.budget) {
      return err(
        'JOURNAL_LINE_INVALID',
        `Line ${i + 1} posts a counter account against a budget.`,
        where,
      );
    }
  }
  const totals = journalTotals(draft.lines);
  if (
    totals.debitTransactionMinor !== totals.creditTransactionMinor ||
    totals.debitReportingMinor !== totals.creditReportingMinor
  ) {
    return err(
      'JOURNAL_UNBALANCED',
      'Debits and credits must be equal in transaction and reporting currency.',
      {
        debitTransactionMinor: totals.debitTransactionMinor,
        creditTransactionMinor: totals.creditTransactionMinor,
        debitReportingMinor: totals.debitReportingMinor,
        creditReportingMinor: totals.creditReportingMinor,
      },
    );
  }
  return ok({ ...draft, totals });
}

const neg = (m: Money): Money => ({
  amountMinor: m.amountMinor === 0 ? 0 : -m.amountMinor,
  currency: m.currency,
});

/**
 * A reversal exactly negates every line of the original and links to it. It is posted in an open
 * period (resolved by the caller), never by editing the original.
 */
export function reverseJournal(
  original: {
    id: string;
    type: JournalType;
    reversalOfJournalId?: string | null;
    transactionCurrency: CurrencyCode;
    reportingCurrency: CurrencyCode;
    lines: (JournalLine & { id: string })[];
  },
  ctx: { accountingDate: string; reasonCode: string; reason: string; alreadyReversed: boolean },
): Result<JournalDraft> {
  if (original.type === 'reversal' || original.reversalOfJournalId) {
    return err(
      'CANNOT_REVERSE_REVERSAL',
      'A reversal cannot be reversed; post a new correcting entry instead.',
    );
  }
  if (ctx.alreadyReversed)
    return err('ALREADY_REVERSED', 'This journal has already been reversed.', {
      journalId: original.id,
    });
  if (!ctx.reasonCode.trim() || !ctx.reason.trim())
    return err('REASON_REQUIRED', 'A reason code and a typed reason are required.');
  return ok({
    type: 'reversal',
    transactionCurrency: original.transactionCurrency,
    reportingCurrency: original.reportingCurrency,
    accountingDate: ctx.accountingDate,
    reasonCode: ctx.reasonCode,
    reason: ctx.reason,
    reversalOfJournalId: original.id,
    lines: original.lines.map(({ id, ...l }) => ({
      ...l,
      transaction: neg(l.transaction),
      budget: l.budget ? neg(l.budget) : null,
      reporting: neg(l.reporting),
      reversalOfLineId: id,
    })),
  });
}
