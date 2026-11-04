import type { CurrencyCode } from '../money/currency';
import { requirePositive, type Money } from '../money/money';
import type { FxRate } from '../money/rate';
import { buildTriplet, type CurrencyTriplet } from '../money/triplet';
import { err, ok, type Result } from '../result';
import { isBudgetBucket, type LedgerAccount } from './accounts';
import {
  applyDelta,
  checkAllocation,
  checkNotOverdrawn,
  type BucketBalances,
  type ControlSettings,
} from './balances';
import {
  buildJournal,
  type JournalDraft,
  type JournalLine,
  type JournalType,
  type LineProvenance,
} from './journal';

/**
 * Posting builders: pure functions that turn a business event into a balanced journal draft or a
 * typed rejection. Posting tables for each event are documented in docs/architecture/ledger.md.
 */
export interface BudgetRef {
  id: string;
  currency: CurrencyCode;
  legalEntityId: string;
  costCenterId: string | null;
}

export interface PostingContext {
  reportingCurrency: CurrencyCode;
  /** Locked plan rates for the fiscal year (quoted against the reporting currency). */
  rates: readonly FxRate[];
  accountingDate: string;
}

type Side = 1 | -1;

function budgetLine(
  budget: BudgetRef,
  account: LedgerAccount,
  side: Side,
  t: CurrencyTriplet,
  prov: LineProvenance = {},
): JournalLine {
  return {
    budgetId: budget.id,
    account,
    legalEntityId: budget.legalEntityId,
    costCenterId: budget.costCenterId,
    transaction: {
      amountMinor: side * t.transaction.amountMinor,
      currency: t.transaction.currency,
    },
    budget: { amountMinor: side * t.budget.amountMinor, currency: t.budget.currency },
    reporting: { amountMinor: side * t.reporting.amountMinor, currency: t.reporting.currency },
    budgetRate: t.budgetRate,
    reportingRate: t.reportingRate,
    ...prov,
  };
}

function counterLine(
  account: LedgerAccount,
  legalEntityId: string,
  side: Side,
  t: CurrencyTriplet,
  prov: LineProvenance = {},
): JournalLine {
  return {
    budgetId: null,
    account,
    legalEntityId,
    transaction: {
      amountMinor: side * t.transaction.amountMinor,
      currency: t.transaction.currency,
    },
    budget: null,
    reporting: { amountMinor: side * t.reporting.amountMinor, currency: t.reporting.currency },
    budgetRate: null,
    reportingRate: t.reportingRate,
    ...prov,
  };
}

function triplet(
  amount: Money,
  budgetCurrency: CurrencyCode,
  ctx: PostingContext,
): Result<CurrencyTriplet> {
  return buildTriplet(amount, {
    budgetCurrency,
    reportingCurrency: ctx.reportingCurrency,
    rates: ctx.rates,
  });
}

function draft(
  type: JournalType,
  amount: Money,
  ctx: PostingContext,
  lines: JournalLine[],
  extra: Partial<JournalDraft> = {},
): Result<JournalDraft> {
  const built = buildJournal({
    type,
    transactionCurrency: amount.currency,
    reportingCurrency: ctx.reportingCurrency,
    accountingDate: ctx.accountingDate,
    lines,
    ...extra,
  });
  if (!built.ok) return built;
  const { totals: _totals, ...journal } = built.value;
  return ok(journal);
}

/** Original root budget: Dr plan funding (plan version) / Cr root authorized. */
export function postOriginalBudget(
  input: { budget: BudgetRef; planVersionId: string; amount: Money },
  ctx: PostingContext,
): Result<JournalDraft> {
  const pos = requirePositive(input.amount);
  if (!pos.ok) return pos;
  if (!input.planVersionId)
    return err('ROOT_REQUIRES_PLAN_VERSION', 'A root budget ties to an approved plan version.');
  const t = triplet(input.amount, input.budget.currency, ctx);
  if (!t.ok) return t;
  const prov = { planVersionId: input.planVersionId };
  return draft('original_budget', input.amount, ctx, [
    counterLine('plan_funding', input.budget.legalEntityId, 1, t.value, prov),
    budgetLine(input.budget, 'authorized', -1, t.value, prov),
  ]);
}

export interface AllocationInput {
  parent: BudgetRef & { balances: BucketBalances; control: ControlSettings };
  child: BudgetRef & { parentId: string | null };
  /** In the parent's or the child's budget currency. */
  amount: Money;
}

/**
 * Allocation: Dr parent allocated out / Cr child authorized, one balanced journal. The parent's
 * available is checked at the locked plan rate in the parent's currency (hard block, no tolerance).
 */
export function postAllocation(
  input: AllocationInput,
  ctx: PostingContext,
): Result<{
  journal: JournalDraft;
  parentAmount: Money;
  childAmount: Money;
  parentAvailableAfterMinor: number;
}> {
  const pos = requirePositive(input.amount);
  if (!pos.ok) return pos;
  if (input.child.parentId !== input.parent.id) {
    return err('NOT_A_CHILD', 'Money can only be allocated to a direct child budget.', {
      parentId: input.parent.id,
      childId: input.child.id,
    });
  }
  if (
    input.amount.currency !== input.parent.currency &&
    input.amount.currency !== input.child.currency
  ) {
    return err(
      'CURRENCY_MISMATCH',
      `Allocate in ${input.parent.currency} or ${input.child.currency}.`,
      { currency: input.amount.currency },
    );
  }
  const pt = triplet(input.amount, input.parent.currency, ctx);
  if (!pt.ok) return pt;
  const ct = triplet(input.amount, input.child.currency, ctx);
  if (!ct.ok) return ct;
  const check = checkAllocation(
    input.parent.balances,
    input.parent.control,
    pt.value.budget.amountMinor,
    input.parent.currency,
  );
  if (!check.ok) return check;
  const journal = draft('allocation', input.amount, ctx, [
    budgetLine(input.parent, 'allocated_out', 1, pt.value),
    budgetLine(input.child, 'authorized', -1, ct.value),
  ]);
  if (!journal.ok) return journal;
  return ok({
    journal: journal.value,
    parentAmount: pt.value.budget,
    childAmount: ct.value.budget,
    parentAvailableAfterMinor: check.value.availableAfterMinor,
  });
}

/** Buckets a manual journal (opening balances, adjustments) may touch. Hierarchy buckets are excluded. */
export const MANUAL_JOURNAL_ACCOUNTS = [
  'held',
  'pre_encumbered',
  'encumbered',
  'actual',
  'accrued',
  'obligations',
  'earmark_reserve',
  'fx_variance',
] as const satisfies readonly LedgerAccount[];

export interface ManualLineInput {
  budget: (BudgetRef & { balances: BucketBalances; control: ControlSettings }) | null;
  account: LedgerAccount;
  side: 'debit' | 'credit';
  /** Positive amount in the journal's transaction currency. */
  amountMinor: number;
  legalEntityId: string;
}

export function postManualJournal(
  input: {
    transactionCurrency: CurrencyCode;
    lines: ManualLineInput[];
    reasonCode: string;
    reason: string;
  },
  ctx: PostingContext,
): Result<JournalDraft> {
  if (!input.reasonCode.trim() || !input.reason.trim())
    return err('REASON_REQUIRED', 'A reason code and a typed reason are required.');
  const lines: JournalLine[] = [];
  for (const [i, l] of input.lines.entries()) {
    if (!(MANUAL_JOURNAL_ACCOUNTS as readonly string[]).includes(l.account)) {
      return err(
        'MANUAL_JOURNAL_BUCKET_NOT_ALLOWED',
        `Line ${i + 1}: ${l.account.replace(/_/g, ' ')} can only change through budget and allocation commands.`,
        {
          line: i + 1,
          account: l.account,
        },
      );
    }
    if (!Number.isSafeInteger(l.amountMinor) || l.amountMinor <= 0) {
      return err(
        'AMOUNT_NOT_POSITIVE',
        `Line ${i + 1}: amounts are positive whole minor units; use the side for direction.`,
        { line: i + 1 },
      );
    }
    if (isBudgetBucket(l.account) !== Boolean(l.budget)) {
      return err(
        'JOURNAL_LINE_INVALID',
        `Line ${i + 1}: budget buckets need a budget and counter accounts must not have one.`,
        { line: i + 1 },
      );
    }
    const side: Side = l.side === 'debit' ? 1 : -1;
    const amount: Money = { amountMinor: l.amountMinor, currency: input.transactionCurrency };
    const t = triplet(amount, l.budget ? l.budget.currency : ctx.reportingCurrency, ctx);
    if (!t.ok) return t;
    lines.push(
      l.budget
        ? budgetLine(l.budget, l.account, side, t.value)
        : counterLine(l.account, l.legalEntityId, side, t.value),
    );
  }
  const built = draft(
    'manual',
    { amountMinor: 0, currency: input.transactionCurrency },
    ctx,
    lines,
    { reasonCode: input.reasonCode, reason: input.reason },
  );
  if (!built.ok) return built;
  const budgets = new Map(
    input.lines.filter((l) => l.budget).map((l) => [l.budget!.id, l.budget!]),
  );
  for (const b of budgets.values()) {
    const deltas = built.value.lines
      .filter((l) => l.budgetId === b.id)
      .map((l) => ({ account: l.account, budgetAmountMinor: l.budget!.amountMinor }));
    const check = checkNotOverdrawn(
      applyDelta(b.balances, deltas),
      b.control,
      b.id,
      'INSUFFICIENT_AVAILABLE',
    );
    if (!check.ok) return check;
  }
  return built;
}

/** Reduction posting with destination parent (Dr child authorized / Cr parent allocated out) or savings. */
export function postReduction(
  input: {
    budget: BudgetRef;
    parent: BudgetRef | null;
    destination: 'parent' | 'savings';
    amount: Money;
    reasonCode: string;
    reason: string;
  },
  ctx: PostingContext,
): Result<JournalDraft> {
  const pos = requirePositive(input.amount);
  if (!pos.ok) return pos;
  if (input.destination === 'parent' && !input.parent)
    return err(
      'REDUCTION_DESTINATION_REQUIRED',
      'A root budget cannot return money to a parent; choose savings.',
    );
  const t = triplet(input.amount, input.budget.currency, ctx);
  if (!t.ok) return t;
  const counter =
    input.destination === 'parent'
      ? (() => {
          const pt = triplet(input.amount, input.parent!.currency, ctx);
          return pt.ok ? ok(budgetLine(input.parent!, 'allocated_out', -1, pt.value)) : pt;
        })()
      : ok(counterLine('savings', input.budget.legalEntityId, -1, t.value));
  if (!counter.ok) return counter;
  return draft(
    'reduction',
    input.amount,
    ctx,
    [budgetLine(input.budget, 'authorized', 1, t.value), counter.value],
    { reasonCode: input.reasonCode, reason: input.reason },
  );
}

/** Commitment lifecycle postings: each moves an amount between buckets with paired lines in one journal. */
export type CommitmentPosting =
  | 'pre_encumber'
  | 'encumber'
  | 'release_pre_encumbrance'
  | 'consume'
  | 'release_encumbrance'
  | 'accrue'
  | 'reverse_accrual'
  | 'hold'
  | 'release_hold';

const COMMITMENT_PAIRS: Record<CommitmentPosting, { debit: LedgerAccount; credit: LedgerAccount }> =
  {
    pre_encumber: { debit: 'pre_encumbered', credit: 'obligations' },
    encumber: { debit: 'encumbered', credit: 'pre_encumbered' },
    release_pre_encumbrance: { debit: 'obligations', credit: 'pre_encumbered' },
    consume: { debit: 'actual', credit: 'encumbered' },
    release_encumbrance: { debit: 'obligations', credit: 'encumbered' },
    accrue: { debit: 'accrued', credit: 'obligations' },
    reverse_accrual: { debit: 'obligations', credit: 'accrued' },
    hold: { debit: 'held', credit: 'earmark_reserve' },
    release_hold: { debit: 'earmark_reserve', credit: 'held' },
  };

export function postCommitmentMovement(
  input: {
    kind: CommitmentPosting;
    budget: BudgetRef & { balances: BucketBalances; control: ControlSettings };
    amount: Money;
    provenance?: LineProvenance;
  },
  ctx: PostingContext,
): Result<JournalDraft> {
  const pos = requirePositive(input.amount);
  if (!pos.ok) return pos;
  const t = triplet(input.amount, input.budget.currency, ctx);
  if (!t.ok) return t;
  const pair = COMMITMENT_PAIRS[input.kind];
  const make = (account: LedgerAccount, side: Side) =>
    isBudgetBucket(account)
      ? budgetLine(input.budget, account, side, t.value, input.provenance)
      : counterLine(account, input.budget.legalEntityId, side, t.value, input.provenance);
  const type: JournalType =
    input.kind === 'accrue' || input.kind === 'reverse_accrual'
      ? 'accrual'
      : input.kind === 'hold' || input.kind === 'release_hold'
        ? 'contribution'
        : 'commitment';
  const built = draft(type, input.amount, ctx, [make(pair.debit, 1), make(pair.credit, -1)]);
  if (!built.ok) return built;
  if (input.kind === 'pre_encumber' || input.kind === 'hold') {
    const deltas = built.value.lines
      .filter((l) => l.budgetId)
      .map((l) => ({ account: l.account, budgetAmountMinor: l.budget!.amountMinor }));
    const check = checkNotOverdrawn(
      applyDelta(input.budget.balances, deltas),
      input.budget.control,
      input.budget.id,
      'INSUFFICIENT_AVAILABLE',
    );
    if (!check.ok) return check;
  }
  return built;
}

/**
 * Intercompany recharge: the charging entity (`from`) records a receivable (due from) and the charged
 * entity (`to`) a payable (due to); the pair nets to zero at group level.
 */
export function postIntercompanyRecharge(
  input: {
    fromLegalEntityId: string;
    toLegalEntityId: string;
    amount: Money;
    contributionId?: string | null;
  },
  ctx: PostingContext,
): Result<JournalDraft> {
  const pos = requirePositive(input.amount);
  if (!pos.ok) return pos;
  if (input.fromLegalEntityId === input.toLegalEntityId)
    return err('VALIDATION_FAILED', 'A recharge needs two different legal entities.');
  const t = triplet(input.amount, ctx.reportingCurrency, ctx);
  if (!t.ok) return t;
  const prov = { contributionId: input.contributionId ?? null };
  return draft('recharge', input.amount, ctx, [
    counterLine('intercompany_due_from', input.fromLegalEntityId, 1, t.value, prov),
    counterLine('intercompany_due_to', input.toLegalEntityId, -1, t.value, prov),
  ]);
}
