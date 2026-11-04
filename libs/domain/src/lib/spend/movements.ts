import type { CurrencyCode } from '../money/currency';
import { requirePositive, type Money } from '../money/money';
import { convert, type AppliedRate } from '../money/rate';
import { buildTriplet, type CurrencyTriplet } from '../money/triplet';
import { err, ok, type Result } from '../result';
import { isBudgetBucket, type LedgerAccount } from '../ledger/accounts';
import {
  applyDelta,
  checkNotOverdrawn,
  type BucketBalances,
  type ControlSettings,
} from '../ledger/balances';
import {
  buildJournal,
  type JournalDraft,
  type JournalLine,
  type JournalType,
  type LineProvenance,
} from '../ledger/journal';
import { budgetRoundingFor, type BudgetRef, type PostingContext } from '../ledger/postings';

/**
 * Spend movements: requests, commitments and event funding move an amount between two buckets of one
 * budget (or a bucket and its counter account) in one balanced journal. Posting tables are in
 * docs/architecture/ledger.md ("Phase 5 postings").
 */
export const SPEND_MOVEMENTS = {
  pre_encumber: { debit: 'pre_encumbered', credit: 'obligations' },
  encumber: { debit: 'encumbered', credit: 'pre_encumbered' },
  release_pre_encumbrance: { debit: 'obligations', credit: 'pre_encumbered' },
  release_encumbrance: { debit: 'obligations', credit: 'encumbered' },
  consume: { debit: 'actual', credit: 'encumbered' },
  hold: { debit: 'held', credit: 'earmark_reserve' },
  release_hold: { debit: 'earmark_reserve', credit: 'held' },
  hold_from_pre_encumbrance: { debit: 'held', credit: 'pre_encumbered' },
  encumber_from_hold: { debit: 'encumbered', credit: 'held' },
  release_encumbrance_to_hold: { debit: 'held', credit: 'encumbered' },
} as const satisfies Record<string, { debit: LedgerAccount; credit: LedgerAccount }>;
export type SpendMovement = keyof typeof SPEND_MOVEMENTS;

/** Movements that add consumption to a budget and therefore check its available amount. */
const CONSUMING_MOVEMENTS: readonly SpendMovement[] = ['pre_encumber', 'hold'];

export interface StoredRates {
  budgetRate: AppliedRate;
  reportingRate: AppliedRate;
}

/** What a commitment line still has posted in the bucket a movement relieves. */
export interface PostedRemainder {
  transactionMinor: number;
  budgetMinor: number;
  reportingMinor: number;
}

export interface SpendMovementResult {
  /** The movement journal, then a budget-currency true-up journal when one is needed. */
  journals: JournalDraft[];
  /** Budget-currency amount moved, true-up included. */
  budgetAmount: Money;
  reportingAmount: Money;
  /** Triplet of the main movement (store it on a new commitment line; later movements reuse its rates). */
  triplet: CurrencyTriplet;
}

type Side = 1 | -1;

function line(
  budget: BudgetRef,
  account: LedgerAccount,
  side: Side,
  t: Pick<CurrencyTriplet, 'transaction' | 'budget' | 'reporting' | 'budgetRate' | 'reportingRate'>,
  prov: LineProvenance,
): JournalLine {
  const signed = (m: Money): Money => ({ amountMinor: side * m.amountMinor, currency: m.currency });
  return isBudgetBucket(account)
    ? {
        budgetId: budget.id,
        account,
        legalEntityId: budget.legalEntityId,
        costCenterId: budget.costCenterId,
        transaction: signed(t.transaction),
        budget: signed(t.budget),
        reporting: signed(t.reporting),
        budgetRate: t.budgetRate,
        reportingRate: t.reportingRate,
        ...prov,
      }
    : {
        budgetId: null,
        account,
        legalEntityId: budget.legalEntityId,
        transaction: signed(t.transaction),
        budget: null,
        reporting: signed(t.reporting),
        budgetRate: null,
        reportingRate: t.reportingRate,
        ...prov,
      };
}

function withStoredRates(amount: Money, rates: StoredRates): Result<CurrencyTriplet> {
  if (rates.budgetRate.from !== amount.currency || rates.reportingRate.from !== amount.currency) {
    return err(
      'CURRENCY_MISMATCH',
      `This commitment is in ${rates.budgetRate.from}; enter the amount in ${rates.budgetRate.from}.`,
      { currency: amount.currency },
    );
  }
  const b = convert(amount, rates.budgetRate);
  if (!b.ok) return b;
  const r = convert(amount, rates.reportingRate);
  if (!r.ok) return r;
  return ok({ transaction: amount, budget: b.value, reporting: r.value, ...rates });
}

function journal(
  type: JournalType,
  currency: CurrencyCode,
  ctx: PostingContext,
  lines: JournalLine[],
  reason?: string,
): Result<JournalDraft> {
  const built = buildJournal({
    type,
    transactionCurrency: currency,
    reportingCurrency: ctx.reportingCurrency,
    accountingDate: ctx.accountingDate,
    lines,
    reason: reason ?? null,
  });
  if (!built.ok) return built;
  const { totals: _totals, ...draft } = built.value;
  return ok(draft);
}

/**
 * Moves an amount between the two buckets of `kind` on one budget. The first posting of a commitment
 * line converts at the locked plan rate (`ctx.rates`); every later movement passes the line's stored
 * rates so a rate change never moves it (no FX drift). When the movement relieves the line's whole
 * remaining transaction amount, it relieves exactly the budget and reporting amounts still posted:
 * if per-line rounding left a difference, a true-up journal in the budget currency moves it, so the
 * bucket returns to zero and every line still re-converts exactly from its stored rate.
 */
export function postSpendMovement(
  input: {
    kind: SpendMovement;
    budget: BudgetRef & { balances: BucketBalances; control: ControlSettings };
    amount: Money;
    journalType: JournalType;
    provenance?: LineProvenance;
    rates?: StoredRates;
    remaining?: PostedRemainder;
    reason?: string;
  },
  ctx: PostingContext,
): Result<SpendMovementResult> {
  const pos = requirePositive(input.amount);
  if (!pos.ok) return pos;
  const t = input.rates
    ? withStoredRates(input.amount, input.rates)
    : buildTriplet(input.amount, {
        budgetCurrency: input.budget.currency,
        reportingCurrency: ctx.reportingCurrency,
        rates: ctx.rates,
      });
  if (!t.ok) return t;
  if (t.value.budget.amountMinor === 0) {
    return err(
      'AMOUNT_ROUNDS_TO_ZERO',
      `The amount converts to less than one minor unit of ${input.budget.currency} at the locked plan rate; enter a larger amount.`,
      { currency: input.budget.currency },
    );
  }
  if (input.remaining && input.amount.amountMinor > input.remaining.transactionMinor) {
    return err('VALIDATION_FAILED', 'The amount is more than this commitment still has posted.', {
      remainingMinor: input.remaining.transactionMinor,
      amountMinor: input.amount.amountMinor,
    });
  }
  const pair = SPEND_MOVEMENTS[input.kind];
  const prov = input.provenance ?? {};
  const main = journal(
    input.journalType,
    input.amount.currency as CurrencyCode,
    ctx,
    [
      line(input.budget, pair.debit, 1, t.value, prov),
      line(input.budget, pair.credit, -1, t.value, prov),
    ],
    input.reason,
  );
  if (!main.ok) return main;
  const journals = [main.value];
  let budgetMinor = t.value.budget.amountMinor;
  let reportingMinor = t.value.reporting.amountMinor;
  const clears =
    input.remaining !== undefined && input.amount.amountMinor === input.remaining.transactionMinor;
  if (clears) {
    const diff = input.remaining!.budgetMinor - budgetMinor;
    if (diff !== 0) {
      const trueUp = trueUpJournal(input, Math.abs(diff), diff > 0 ? 1 : -1, ctx, prov);
      if (!trueUp.ok) return trueUp;
      journals.push(trueUp.value.journal);
      budgetMinor += diff;
      reportingMinor += trueUp.value.reportingMinor;
    }
  }
  if (CONSUMING_MOVEMENTS.includes(input.kind)) {
    const deltas = journals
      .flatMap((j) => j.lines)
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
  return ok({
    journals,
    budgetAmount: { amountMinor: budgetMinor, currency: input.budget.currency },
    reportingAmount: { amountMinor: reportingMinor, currency: ctx.reportingCurrency },
    triplet: t.value,
  });
}

/** The rounding difference left by partial movements, moved in the budget currency in the same direction (or back). */
function trueUpJournal(
  input: {
    kind: SpendMovement;
    budget: BudgetRef;
    journalType: JournalType;
  },
  amountMinor: number,
  direction: Side,
  ctx: PostingContext,
  prov: LineProvenance,
): Result<{ journal: JournalDraft; reportingMinor: number }> {
  const amount: Money = { amountMinor, currency: input.budget.currency };
  const t = buildTriplet(amount, {
    budgetCurrency: input.budget.currency,
    reportingCurrency: ctx.reportingCurrency,
    rates: ctx.rates,
  });
  if (!t.ok) return t;
  const pair = SPEND_MOVEMENTS[input.kind];
  const j = journal(
    input.journalType,
    input.budget.currency,
    ctx,
    [
      line(input.budget, pair.debit, direction, t.value, prov),
      line(input.budget, pair.credit, direction === 1 ? -1 : 1, t.value, prov),
    ],
    'Rounding true-up: relieves exactly the amount originally posted',
  );
  if (!j.ok) return j;
  return ok({ journal: j.value, reportingMinor: direction * t.value.reporting.amountMinor });
}

/**
 * Inter-Director Budget Contribution Request in transfer mode (and its surplus return): Dr giver
 * authorized / Cr receiver authorized, journal type `contribution` (outside the parent/child
 * reconciliation). Across currencies the giver rounds up and the receiver down.
 */
export function postContributionTransfer(
  input: {
    giver: BudgetRef & { balances: BucketBalances; control: ControlSettings };
    receiver: BudgetRef;
    amount: Money;
    provenance?: LineProvenance;
    reason?: string;
  },
  ctx: PostingContext,
): Result<{ journal: JournalDraft; giverAmount: Money; receiverAmount: Money }> {
  const pos = requirePositive(input.amount);
  if (!pos.ok) return pos;
  if (input.giver.id === input.receiver.id)
    return err('VALIDATION_FAILED', 'A transfer needs two different budgets.');
  const make = (budget: BudgetRef, side: Side) =>
    buildTriplet(input.amount, {
      budgetCurrency: budget.currency,
      reportingCurrency: ctx.reportingCurrency,
      rates: ctx.rates,
      budgetRounding: budgetRoundingFor('authorized', side),
    });
  const gt = make(input.giver, 1);
  if (!gt.ok) return gt;
  const rt = make(input.receiver, -1);
  if (!rt.ok) return rt;
  if (gt.value.budget.amountMinor === 0 || rt.value.budget.amountMinor === 0) {
    return err(
      'AMOUNT_ROUNDS_TO_ZERO',
      'The amount is too small to transfer between these budgets.',
    );
  }
  const prov = input.provenance ?? {};
  const j = journal(
    'contribution',
    input.amount.currency,
    ctx,
    [
      line(input.giver, 'authorized', 1, gt.value, prov),
      line(input.receiver, 'authorized', -1, rt.value, prov),
    ],
    input.reason,
  );
  if (!j.ok) return j;
  const check = checkNotOverdrawn(
    applyDelta(input.giver.balances, [
      { account: 'authorized', budgetAmountMinor: gt.value.budget.amountMinor },
    ]),
    input.giver.control,
    input.giver.id,
    'INSUFFICIENT_AVAILABLE',
  );
  if (!check.ok) return check;
  return ok({ journal: j.value, giverAmount: gt.value.budget, receiverAmount: rt.value.budget });
}
