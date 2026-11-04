import { splitByWeights } from '../money/split';
import { divRoundHalfEven } from '../money/rate';
import { err, ok, type Result } from '../result';
import { checkApprovalHygiene } from '../authority/doa';

export const CONTRIBUTION_MODES = ['earmark', 'transfer'] as const;
export type ContributionMode = (typeof CONTRIBUTION_MODES)[number];

export type ContributionDecision =
  | { kind: 'approve_full'; mode?: ContributionMode }
  | { kind: 'approve_partial'; approvedMinor: number; mode?: ContributionMode; reason?: string }
  | { kind: 'reject'; reason: string }
  | { kind: 'request_changes'; reason: string };

export interface ContributionOutcome {
  status: 'approved_full' | 'approved_partial' | 'rejected' | 'changes_requested';
  approvedMinor: number;
  mode: ContributionMode | null;
}

/**
 * The giving director decides an Inter-Director Budget Contribution Request: approve full, approve a
 * different amount, request changes, or reject with a reason. Never automatic; earmark is the default.
 */
export function decideContribution(input: {
  requestedMinor: number;
  giverAvailableMinor: number;
  deciderId: string;
  requesterId: string;
  decision: ContributionDecision;
}): Result<ContributionOutcome> {
  const hygiene = checkApprovalHygiene({
    approverId: input.deciderId,
    requesterId: input.requesterId,
  });
  if (!hygiene.ok) return hygiene;
  const d = input.decision;
  if ((d.kind === 'reject' || d.kind === 'request_changes') && !d.reason?.trim()) {
    return err('REASON_REQUIRED', 'Give a reason so the requester knows what to change.');
  }
  if (d.kind === 'reject') return ok({ status: 'rejected', approvedMinor: 0, mode: null });
  if (d.kind === 'request_changes')
    return ok({ status: 'changes_requested', approvedMinor: 0, mode: null });
  const approved = d.kind === 'approve_full' ? input.requestedMinor : d.approvedMinor;
  if (
    d.kind === 'approve_partial' &&
    (!Number.isSafeInteger(approved) || approved <= 0 || approved >= input.requestedMinor)
  ) {
    return err(
      'CONTRIBUTION_AMOUNT_INVALID',
      'A partial approval is more than zero and less than the requested amount.',
      {
        requestedMinor: input.requestedMinor,
        approvedMinor: approved,
      },
    );
  }
  if (approved > input.giverAvailableMinor) {
    return err('INSUFFICIENT_AVAILABLE', 'The giving budget does not have that much available.', {
      availableMinor: input.giverAvailableMinor,
      approvedMinor: approved,
    });
  }
  return ok({
    status: d.kind === 'approve_full' ? 'approved_full' : 'approved_partial',
    approvedMinor: approved,
    mode: d.mode ?? 'earmark',
  });
}

export const INTERCOMPANY_MODES = ['block', 'recharge_at_cost', 'recharge_with_markup'] as const;
export type IntercompanyMode = (typeof INTERCOMPANY_MODES)[number];

export interface IntercompanyPolicy {
  mode: IntercompanyMode;
  markupBps: number;
  taxApproverPersonId: string | null;
}

export type IntercompanyTreatment =
  | { kind: 'none' }
  | { kind: 'recharge'; rechargeMinor: number; markupMinor: number; requiresTaxApproval: boolean };

/** Cross-entity contributions follow the tenant's intercompany policy: block, recharge at cost, or with markup. */
export function resolveIntercompany(
  policy: IntercompanyPolicy,
  giverEntityId: string,
  receiverEntityId: string,
  amountMinor: number,
): Result<IntercompanyTreatment> {
  if (giverEntityId === receiverEntityId) return ok({ kind: 'none' });
  if (policy.mode === 'block') {
    return err(
      'INTERCOMPANY_BLOCKED',
      'Contributions between different legal entities are blocked by the intercompany policy.',
      { giverEntityId, receiverEntityId },
    );
  }
  const markupMinor =
    policy.mode === 'recharge_with_markup'
      ? Number(divRoundHalfEven(BigInt(amountMinor) * BigInt(policy.markupBps), 10_000n))
      : 0;
  return ok({
    kind: 'recharge',
    rechargeMinor: amountMinor + markupMinor,
    markupMinor,
    requiresTaxApproval: policy.taxApproverPersonId !== null,
  });
}

/** Funding cap = min(own funds + contributions, estimate + tolerance). */
export function fundingCap(input: {
  ownFundsMinor: number;
  contributionsMinor: number;
  estimateMinor: number;
  toleranceBps: number;
}): number {
  const tolerance = Math.floor((input.estimateMinor * input.toleranceBps) / 10_000);
  return Math.min(input.ownFundsMinor + input.contributionsMinor, input.estimateMinor + tolerance);
}

export function checkFundingCap(input: {
  ownFundsMinor: number;
  contributionsMinor: number;
  estimateMinor: number;
  toleranceBps: number;
  committedMinor: number;
  requestedMinor: number;
}): Result<true> {
  const cap = fundingCap(input);
  if (input.committedMinor + input.requestedMinor > cap) {
    return err('FUNDING_CAP_EXCEEDED', 'This would take the event above its funding cap.', {
      capMinor: cap,
      committedMinor: input.committedMinor,
      requestedMinor: input.requestedMinor,
    });
  }
  return ok(true);
}

/** Surplus returns to contributors by share of what they funded; parts sum exactly to the surplus. */
export function surplusReturns(
  contributors: readonly { id: string; fundedMinor: number }[],
  surplusMinor: number,
): Result<{ id: string; returnMinor: number }[]> {
  if (surplusMinor === 0) return ok(contributors.map((c) => ({ id: c.id, returnMinor: 0 })));
  const parts = splitByWeights(
    surplusMinor,
    contributors.map((c) => c.fundedMinor),
  );
  return parts.ok
    ? ok(contributors.map((c, i) => ({ id: c.id, returnMinor: parts.value[i] })))
    : parts;
}

/** Events cannot close with unmatched actuals or with a cross-entity contribution that lacks its recharge. */
export function canCloseEvent(input: {
  unmatchedActuals: number;
  crossEntityContributionsWithoutRecharge: number;
}): Result<true> {
  if (input.unmatchedActuals > 0)
    return err(
      'EVENT_HAS_UNMATCHED_ACTUALS',
      'Match or exclude every actual before closing the event.',
      { unmatchedActuals: input.unmatchedActuals },
    );
  if (input.crossEntityContributionsWithoutRecharge > 0) {
    return err(
      'EVENT_MISSING_RECHARGE',
      'Cross-entity contributions need their recharge before the event can close.',
      { missing: input.crossEntityContributionsWithoutRecharge },
    );
  }
  return ok(true);
}

/** An actual is matched once. */
export function checkMatchOnce(
  actual: {
    matchStatus: 'unmatched' | 'partially_matched' | 'matched' | 'excluded';
    unmatchedMinor: number;
  },
  matchMinor: number,
): Result<true> {
  if (
    actual.matchStatus === 'matched' ||
    actual.matchStatus === 'excluded' ||
    matchMinor > actual.unmatchedMinor
  ) {
    return err('ACTUAL_ALREADY_MATCHED', 'This actual is already fully matched.', {
      unmatchedMinor: actual.unmatchedMinor,
    });
  }
  return ok(true);
}

/** Key used to flag cross-source duplicates (card, travel and expense, AP) before matching. */
export function duplicateKey(a: {
  transactionDate: string;
  amountMinor: number;
  currency: string;
  merchant: string | null;
}): string {
  const merchant = (a.merchant ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${a.transactionDate}|${a.currency}|${Math.abs(a.amountMinor)}|${merchant}`;
}
