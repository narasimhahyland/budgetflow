import { canCloseEvent } from '../cofunding/cofunding';
import type { Money } from '../money/money';
import { buildTriplet } from '../money/triplet';
import { err, ok, type Result } from '../result';
import {
  applyDelta,
  checkNotOverdrawn,
  type BucketBalances,
  type ControlSettings,
} from '../ledger/balances';
import { buildJournal, type JournalDraft, type JournalLine } from '../ledger/journal';
import type { BudgetRef, PostingContext } from '../ledger/postings';

export interface ActualDimensions {
  actualId: string;
  costCenterId: string | null;
  glAccountId: string | null;
  eventCode: string | null;
}

/**
 * An actual charged to a budget: Dr actual (budget) / Cr obligations, in the actual's transaction
 * currency with the currency triplet at the locked plan rate. Refunds and credit notes (negative)
 * post the opposite sides. Lines carry the actual's cost center, GL account and event code so the GL
 * tie-out can compare by entity, cost center, account and period. FX against the actual rate is
 * posted separately (`postFxEffect`) and never consumes budget.
 */
export function postActualCharge(
  input: {
    budget: BudgetRef;
    amount: Money;
    dims: ActualDimensions;
    commitmentId: string | null;
  },
  ctx: PostingContext,
): Result<{ journal: JournalDraft; budgetAmount: Money }> {
  if (input.amount.amountMinor === 0)
    return err('AMOUNT_NOT_POSITIVE', 'The amount cannot be zero.');
  const side = input.amount.amountMinor > 0 ? 1 : -1;
  const abs: Money = {
    amountMinor: Math.abs(input.amount.amountMinor),
    currency: input.amount.currency,
  };
  const t = buildTriplet(abs, {
    budgetCurrency: input.budget.currency,
    reportingCurrency: ctx.reportingCurrency,
    rates: ctx.rates,
  });
  if (!t.ok) return t;
  if (t.value.budget.amountMinor === 0)
    return err(
      'AMOUNT_ROUNDS_TO_ZERO',
      `The amount converts to less than one minor unit of ${input.budget.currency} at the locked plan rate.`,
    );
  const s = (m: Money, sign: number): Money => ({
    amountMinor: sign * m.amountMinor,
    currency: m.currency,
  });
  const shared = {
    legalEntityId: input.budget.legalEntityId,
    costCenterId: input.dims.costCenterId ?? input.budget.costCenterId,
    glAccountId: input.dims.glAccountId,
    eventCode: input.dims.eventCode,
    actualId: input.dims.actualId,
    commitmentId: input.commitmentId,
    reportingRate: t.value.reportingRate,
  };
  const lines: JournalLine[] = [
    {
      ...shared,
      budgetId: input.budget.id,
      account: 'actual',
      transaction: s(t.value.transaction, side),
      budget: s(t.value.budget, side),
      reporting: s(t.value.reporting, side),
      budgetRate: t.value.budgetRate,
    },
    {
      ...shared,
      budgetId: null,
      account: 'obligations',
      transaction: s(t.value.transaction, -side),
      budget: null,
      reporting: s(t.value.reporting, -side),
      budgetRate: null,
    },
  ];
  const built = buildJournal({
    type: 'actual',
    transactionCurrency: abs.currency,
    reportingCurrency: ctx.reportingCurrency,
    accountingDate: ctx.accountingDate,
    lines,
  });
  if (!built.ok) return built;
  const { totals: _t, ...journal } = built.value;
  return ok({ journal, budgetAmount: s(t.value.budget, side) });
}

/**
 * FX effect of an actual (reporting currency at the actual rate minus at the locked plan rate) on
 * counter accounts only: Dr fx_variance / Cr obligations when unfavourable, the reverse when
 * favourable. No budget line, so FX never consumes budget; it is reported separately.
 */
export function postFxEffect(
  input: { legalEntityId: string; fxMinor: number; dims: ActualDimensions },
  ctx: Pick<PostingContext, 'reportingCurrency' | 'accountingDate'>,
): Result<JournalDraft | null> {
  if (input.fxMinor === 0) return ok(null);
  const side = input.fxMinor > 0 ? 1 : -1;
  const abs = Math.abs(input.fxMinor);
  const rate = {
    type: 'plan' as const,
    from: ctx.reportingCurrency,
    to: ctx.reportingCurrency,
    value: '1.000000000000',
    rateIds: [],
  };
  const line = (account: 'fx_variance' | 'obligations', sign: number): JournalLine => ({
    budgetId: null,
    account,
    legalEntityId: input.legalEntityId,
    costCenterId: input.dims.costCenterId,
    glAccountId: input.dims.glAccountId,
    eventCode: input.dims.eventCode,
    actualId: input.dims.actualId,
    transaction: { amountMinor: sign * abs, currency: ctx.reportingCurrency },
    budget: null,
    reporting: { amountMinor: sign * abs, currency: ctx.reportingCurrency },
    budgetRate: null,
    reportingRate: rate,
  });
  const built = buildJournal({
    type: 'actual',
    transactionCurrency: ctx.reportingCurrency,
    reportingCurrency: ctx.reportingCurrency,
    accountingDate: ctx.accountingDate,
    lines: [line('fx_variance', side), line('obligations', -side)],
  });
  if (!built.ok) return built;
  const { totals: _t, ...journal } = built.value;
  return ok(journal);
}

/**
 * After a match's journals: no bucket below zero, and a hard-mode budget's available stays within
 * tolerance unless an approved over-budget request covers the extra consumption.
 */
export function checkMatchAvailability(input: {
  budgetId: string;
  balances: BucketBalances;
  control: ControlSettings;
  deltas: readonly { account: JournalLine['account']; budgetAmountMinor: number }[];
  overBudgetApproved: boolean;
}): Result<true> {
  const after = applyDelta(input.balances, input.deltas);
  const control = input.overBudgetApproved
    ? { ...input.control, mode: 'track' as const }
    : input.control;
  const r = checkNotOverdrawn(after, control, input.budgetId, 'INSUFFICIENT_AVAILABLE');
  if (!r.ok && r.error.code === 'INSUFFICIENT_AVAILABLE')
    return err(
      'INSUFFICIENT_AVAILABLE',
      "This would make the budget's available amount negative. Request over-budget approval first.",
      r.error.params,
    );
  return r;
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

/**
 * Prepaids and deposits are consumed in their service period: straight-line by day, nothing before
 * the service start, everything from the service end on. Returns the amount recognized up to and
 * including `asOf`.
 */
export function recognizedToDate(input: {
  amountMinor: number;
  serviceStart: string;
  serviceEnd: string;
  asOf: string;
}): number {
  const start = dayNumber(input.serviceStart);
  const end = dayNumber(input.serviceEnd);
  const at = dayNumber(input.asOf);
  if (at < start) return 0;
  if (at >= end) return input.amountMinor;
  const total = end - start + 1;
  const elapsed = at - start + 1;
  return Number((BigInt(input.amountMinor) * BigInt(elapsed)) / BigInt(total));
}

export const AGING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Commitment aging from the service end (or creation when there is none): days past and bucket. */
export function commitmentAging(input: {
  serviceEnd: string | null;
  createdOn: string;
  asOf: string;
}): { daysPast: number; bucket: AgingBucket } {
  const from = input.serviceEnd ?? input.createdOn;
  const days = dayNumber(input.asOf) - dayNumber(from);
  if (days <= 0) return { daysPast: Math.max(days, 0), bucket: 'current' };
  const bucket: AgingBucket =
    days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
  return { daysPast: days, bucket };
}

/** Days after the service end without actuals from which BudgetFlow prompts the owner to release. */
export const AUTO_RELEASE_PROMPT_DAYS = 30;

/** Accrual proposals: commitments past their service end with encumbrance left and no live accrual. */
export function needsAccrual(input: {
  serviceEnd: string | null;
  remainingMinor: number;
  hasLiveAccrual: boolean;
  asOf: string;
}): boolean {
  return (
    input.serviceEnd !== null &&
    input.serviceEnd < input.asOf &&
    input.remainingMinor > 0 &&
    !input.hasLiveAccrual
  );
}

/** Cancellation consumes the larger of the fee charged and any non-refundable deposit, capped at what remains. */
export function cancellationFee(input: {
  feeMinor: number;
  nonRefundableDepositMinor: number;
  remainingMinor: number;
}): Result<number> {
  if (!Number.isSafeInteger(input.feeMinor) || input.feeMinor < 0)
    return err('VALIDATION_FAILED', 'The cancellation fee is zero or a positive amount.');
  const fee = Math.max(input.feeMinor, input.nonRefundableDepositMinor);
  if (fee > input.remainingMinor)
    return err(
      'VALIDATION_FAILED',
      'The fee is larger than what is still encumbered on the commitment.',
      {
        feeMinor: fee,
        remainingMinor: input.remainingMinor,
      },
    );
  return ok(fee);
}

export interface TieOutKey {
  costCenterId: string | null;
  glAccountId: string | null;
}

export interface TieOutRow extends TieOutKey {
  glMinor: number;
  budgetflowMinor: number;
  differenceMinor: number;
  withinTolerance: boolean;
}

/**
 * BudgetFlow-to-GL tie-out for one entity and period: general ledger balances against posted actuals,
 * by cost center and GL account, in the reporting currency at the locked plan rate. A difference above
 * the tolerance is an exception.
 */
export function compareTieOut(
  gl: readonly (TieOutKey & { amountMinor: number })[],
  budgetflow: readonly (TieOutKey & { amountMinor: number })[],
  toleranceMinor: number,
): { rows: TieOutRow[]; glTotalMinor: number; budgetflowTotalMinor: number; exceptions: number } {
  const key = (k: TieOutKey) => `${k.glAccountId ?? '-'}|${k.costCenterId ?? '-'}`;
  const rows = new Map<string, TieOutRow>();
  const at = (k: TieOutKey) => {
    const id = key(k);
    let r = rows.get(id);
    if (!r) {
      r = {
        costCenterId: k.costCenterId,
        glAccountId: k.glAccountId,
        glMinor: 0,
        budgetflowMinor: 0,
        differenceMinor: 0,
        withinTolerance: true,
      };
      rows.set(id, r);
    }
    return r;
  };
  for (const g of gl) at(g).glMinor += g.amountMinor;
  for (const b of budgetflow) at(b).budgetflowMinor += b.amountMinor;
  let exceptions = 0;
  for (const r of rows.values()) {
    r.differenceMinor = r.glMinor - r.budgetflowMinor;
    r.withinTolerance = Math.abs(r.differenceMinor) <= toleranceMinor;
    if (!r.withinTolerance) exceptions++;
  }
  const sorted = [...rows.values()].sort((a, b) => key(a).localeCompare(key(b)));
  return {
    rows: sorted,
    glTotalMinor: sorted.reduce((s, r) => s + r.glMinor, 0),
    budgetflowTotalMinor: sorted.reduce((s, r) => s + r.budgetflowMinor, 0),
    exceptions,
  };
}

/** Sign-off needs every difference above tolerance explained, and someone other than the preparer. */
export function checkTieOutSignOff(input: {
  status: 'draft' | 'reconciled' | 'exceptions' | 'signed_off';
  preparedBy: string | null;
  signerId: string;
  unexplainedExceptions: number;
}): Result<true> {
  if (input.status === 'signed_off')
    return err('TIEOUT_SIGNED_OFF', 'This tie-out is already signed off and locked.');
  if (input.preparedBy && input.preparedBy === input.signerId)
    return err('SIGNOFF_BY_PREPARER', 'The person who prepared the tie-out cannot sign it off.');
  if (input.unexplainedExceptions > 0)
    return err(
      'TIEOUT_SIGNOFF_BLOCKED',
      'Resolve differences above tolerance or add an explanation before signing off.',
      { unexplainedExceptions: input.unexplainedExceptions },
    );
  return ok(true);
}

/**
 * Events close only when every actual is matched or excluded, cross-entity contributions have their
 * recharge, and every open commitment is either released or accrued.
 */
export function checkEventClose(input: {
  status: string;
  unmatchedActuals: number;
  crossEntityContributionsWithoutRecharge: number;
  unaccruedOpenCommitments: number;
}): Result<true> {
  if (!['completed', 'reconciling'].includes(input.status))
    return err('INVALID_TRANSITION', 'Only completed events in reconciliation can close.', {
      status: input.status,
    });
  const base = canCloseEvent(input);
  if (!base.ok) return base;
  if (input.unaccruedOpenCommitments > 0)
    return err(
      'EVENT_HAS_OPEN_COMMITMENTS',
      'Release or accrue every open commitment before closing the event.',
      { openCommitments: input.unaccruedOpenCommitments },
    );
  return ok(true);
}
