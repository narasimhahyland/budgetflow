import type { CurrencyCode } from '../money/currency';
import { requirePositive, type Money } from '../money/money';
import type { FxRate, Rounding } from '../money/rate';
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

/**
 * Budget-currency rounding per line. On hierarchy buckets the budget giving value up (a debit:
 * allocated out on the parent, authorized on a child returning money) rounds away from zero and the
 * budget receiving it (a credit) rounds toward zero, so children never hold more than their parent
 * gave up at the locked plan rate. Every other line rounds half-even. The rebuild check re-verifies
 * stored amounts with this rule.
 */
export function budgetRoundingFor(
  account: LedgerAccount,
  signedTransactionMinor: number,
): Rounding {
  if (account !== 'authorized' && account !== 'allocated_out') return 'half_even';
  return signedTransactionMinor > 0 ? 'up' : 'down';
}

function triplet(
  amount: Money,
  budgetCurrency: CurrencyCode,
  ctx: PostingContext,
  budgetRounding: Rounding = 'half_even',
): Result<CurrencyTriplet> {
  return buildTriplet(amount, {
    budgetCurrency,
    reportingCurrency: ctx.reportingCurrency,
    rates: ctx.rates,
    budgetRounding,
  });
}

function hierarchyTriplet(
  amount: Money,
  budgetCurrency: CurrencyCode,
  account: 'authorized' | 'allocated_out',
  side: Side,
  ctx: PostingContext,
): Result<CurrencyTriplet> {
  const t = triplet(amount, budgetCurrency, ctx, budgetRoundingFor(account, side));
  if (t.ok && t.value.budget.amountMinor === 0) {
    return err(
      'AMOUNT_ROUNDS_TO_ZERO',
      `The amount converts to less than one minor unit of ${budgetCurrency} at the locked plan rate; enter a larger amount.`,
      { currency: budgetCurrency },
    );
  }
  return t;
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
 * Across currencies the parent is charged rounding up and the child credited rounding down; an
 * amount worth less than one minor unit of either budget currency is rejected.
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
  const pt = hierarchyTriplet(input.amount, input.parent.currency, 'allocated_out', 1, ctx);
  if (!pt.ok) return pt;
  const ct = hierarchyTriplet(input.amount, input.child.currency, 'authorized', -1, ctx);
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

/**
 * Manual journal (opening balances, adjustments): budget lines only exchange amounts with counter
 * accounts, so all budget lines sit on one side; no bucket may go below zero. Each line converts
 * half-even; if that leaves the reporting view unbalanced, a rounding line to `fx_variance` absorbs
 * the difference (at most half a minor unit per line).
 */
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
  const budgetSides = new Set(input.lines.filter((l) => l.budget).map((l) => l.side));
  if (budgetSides.size > 1) {
    return err(
      'MANUAL_JOURNAL_NEEDS_COUNTER_ACCOUNT',
      'A manual journal cannot move amounts between budgets or buckets: put every budget line on the same side and offset it with counter accounts. Allocations and commitments have their own commands.',
    );
  }
  const sum = (view: 'transaction' | 'reporting') =>
    lines.reduce((acc, l) => acc + l[view].amountMinor, 0);
  const reportingDifference = sum('reporting');
  if (lines.length > 0 && sum('transaction') === 0 && reportingDifference !== 0) {
    lines.push({
      budgetId: null,
      account: 'fx_variance',
      legalEntityId: lines[0].legalEntityId,
      transaction: { amountMinor: 0, currency: input.transactionCurrency },
      budget: null,
      reporting: { amountMinor: -reportingDifference, currency: ctx.reportingCurrency },
      budgetRate: null,
      reportingRate: lines[0].reportingRate,
    });
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
  const t = hierarchyTriplet(input.amount, input.budget.currency, 'authorized', 1, ctx);
  if (!t.ok) return t;
  const counter =
    input.destination === 'parent'
      ? (() => {
          const pt = hierarchyTriplet(
            input.amount,
            input.parent!.currency,
            'allocated_out',
            -1,
            ctx,
          );
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

export type HierarchyDestination =
  | { kind: 'budget'; chain: readonly BudgetRef[] }
  | { kind: 'savings'; planVersionId: string | null };

/**
 * Moves money between two budgets of one tree along the hierarchy, in one journal: up from the source
 * to the lowest common ancestor (child `authorized` Dr / parent `allocated_out` Cr), then down to the
 * destination (parent `allocated_out` Dr / child `authorized` Cr). Every parent keeps allocated out
 * equal to its children's authorized and budgets in between keep their available. With savings as the
 * destination the money goes up to the root and leaves it (root `authorized` Dr / `savings` Cr).
 * Chains list the budget first and the root last. Balance checks belong to the caller.
 */
export function postHierarchyMove(
  input: {
    type: 'transfer' | 'reduction';
    sourceChain: readonly BudgetRef[];
    destination: HierarchyDestination;
    /** In the source budget's currency. */
    amount: Money;
    reasonCode?: string | null;
    reason?: string | null;
    /** True when releasing a root contingency reserve into another root's tree. */
    allowCrossRoot?: boolean;
  },
  ctx: PostingContext,
): Result<JournalDraft> {
  const pos = requirePositive(input.amount);
  if (!pos.ok) return pos;
  const source = input.sourceChain[0];
  if (!source) return err('TRANSFER_INVALID', 'Choose the budget the money comes from.');
  let up: readonly BudgetRef[];
  let down: BudgetRef[] = [];
  let crossRoot = false;
  if (input.destination.kind === 'budget') {
    const dest = input.destination.chain;
    if (dest.length === 0 || dest[0].id === source.id)
      return err('TRANSFER_INVALID', 'Choose a different budget to receive the money.');
    const lcaIdx = input.sourceChain.findIndex((b) => dest.some((d) => d.id === b.id));
    if (lcaIdx < 0) {
      if (!input.allowCrossRoot)
        return err('TRANSFER_INVALID', 'Money can only move between budgets of the same tree.');
      crossRoot = true;
      up = input.sourceChain;
      down = [...dest].reverse();
    } else {
      const lcaId = input.sourceChain[lcaIdx].id;
      up = input.sourceChain.slice(0, lcaIdx + 1);
      down = [...dest.slice(0, dest.findIndex((d) => d.id === lcaId) + 1)].reverse();
    }
  } else {
    up = input.sourceChain;
  }
  const lines: JournalLine[] = [];
  for (let i = 0; i + 1 < up.length; i++) {
    const child = up[i];
    const parent = up[i + 1];
    const ct = hierarchyTriplet(input.amount, child.currency, 'authorized', 1, ctx);
    if (!ct.ok) return ct;
    const pt = hierarchyTriplet(input.amount, parent.currency, 'allocated_out', -1, ctx);
    if (!pt.ok) return pt;
    lines.push(budgetLine(child, 'authorized', 1, ct.value));
    lines.push(budgetLine(parent, 'allocated_out', -1, pt.value));
  }
  if (crossRoot) {
    const sourceRoot = up[up.length - 1];
    const destRoot = down[0];
    const st = hierarchyTriplet(input.amount, sourceRoot.currency, 'authorized', 1, ctx);
    if (!st.ok) return st;
    const dt = hierarchyTriplet(input.amount, destRoot.currency, 'authorized', -1, ctx);
    if (!dt.ok) return dt;
    lines.push(budgetLine(sourceRoot, 'authorized', 1, st.value));
    lines.push(budgetLine(destRoot, 'authorized', -1, dt.value));
  }
  for (let i = 0; i + 1 < down.length; i++) {
    const parent = down[i];
    const child = down[i + 1];
    const pt = hierarchyTriplet(input.amount, parent.currency, 'allocated_out', 1, ctx);
    if (!pt.ok) return pt;
    const ct = hierarchyTriplet(input.amount, child.currency, 'authorized', -1, ctx);
    if (!ct.ok) return ct;
    lines.push(budgetLine(parent, 'allocated_out', 1, pt.value));
    lines.push(budgetLine(child, 'authorized', -1, ct.value));
  }
  if (input.destination.kind === 'savings') {
    const root = up[up.length - 1];
    const rt = hierarchyTriplet(input.amount, root.currency, 'authorized', 1, ctx);
    if (!rt.ok) return rt;
    lines.push(budgetLine(root, 'authorized', 1, rt.value));
    lines.push(
      counterLine('savings', root.legalEntityId, -1, rt.value, {
        planVersionId: input.destination.planVersionId,
      }),
    );
  }
  // The common ancestor gives and receives the same allocation: drop the pair when it nets to zero.
  const netted = lines.filter((l, i) => {
    if (l.account !== 'allocated_out') return true;
    return !lines.some(
      (o, j) =>
        j !== i &&
        o.account === 'allocated_out' &&
        o.budgetId === l.budgetId &&
        o.budget!.amountMinor === -l.budget!.amountMinor,
    );
  });
  return draft(input.type, input.amount, ctx, netted, {
    reasonCode: input.reasonCode ?? undefined,
    reason: input.reason ?? undefined,
  });
}

/**
 * Applying a plan version to a root budget: an increase is Dr `plan_funding` / Cr root `authorized`,
 * a decrease the opposite; both lines carry the plan version so the root ties to it.
 */
export function postPlanAdjustment(
  input: { root: BudgetRef; planVersionId: string; deltaMinor: number; reason: string },
  ctx: PostingContext,
): Result<JournalDraft> {
  if (!Number.isSafeInteger(input.deltaMinor) || input.deltaMinor === 0)
    return err('AMOUNT_NOT_POSITIVE', 'The plan adjustment must change the root budget.');
  const amount: Money = { amountMinor: Math.abs(input.deltaMinor), currency: input.root.currency };
  const t = triplet(amount, input.root.currency, ctx);
  if (!t.ok) return t;
  const side: Side = input.deltaMinor > 0 ? 1 : -1;
  const prov = { planVersionId: input.planVersionId };
  return draft(
    input.deltaMinor > 0 ? 'increase' : 'reduction',
    amount,
    ctx,
    [
      counterLine('plan_funding', input.root.legalEntityId, side, t.value, prov),
      budgetLine(input.root, 'authorized', side === 1 ? -1 : 1, t.value, prov),
    ],
    { reason: input.reason },
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
