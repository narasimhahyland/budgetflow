import { err, ok, type Result } from '../result';

/**
 * Year-end roll-forward rules. What a budget does with the money it still has when its fiscal year
 * ends is decided by its rollover policy; the amounts here only split one available balance, they
 * never create money. The commands post the split as a reduction in the ending year (to the sweep
 * target or to savings) and, for carries, a mirror posting in the target year.
 */
export const ROLLOVER_MODES = [
  'lapse',
  'carry_full',
  'carry_capped',
  'carry_with_approval',
] as const;
export type RolloverMode = (typeof ROLLOVER_MODES)[number];

export type SweepTarget = 'parent' | 'corporate';

/** Lifecycle of one budget's line in a year-end run. */
export const YEAR_END_LINE_STATUSES = [
  'planned',
  'awaiting_approval',
  'approved',
  'declined',
  'blocked',
  'executed',
] as const;
export type YearEndLineStatus = (typeof YEAR_END_LINE_STATUSES)[number];

export interface RolloverPolicyRef {
  code: string;
  mode: RolloverMode;
  /** Carry cap in basis points of the budget's authorized amount (`carry_capped` only). */
  capBps: number | null;
  sweepTo: SweepTarget;
}

export interface RolloverOutcome {
  carryMinor: number;
  lapseMinor: number;
  sweepTo: SweepTarget;
  /** A Finance Controller decides the carry before it posts. */
  needsApproval: boolean;
}

/**
 * Splits what a budget has left between carry and lapse. The two always add up to the available
 * amount, so the year-end postings move exactly what the budget had: nothing is minted and nothing
 * disappears. A capped carry rounds the cap down, so the carry never exceeds the policy.
 */
export function rolloverOutcome(
  policy: RolloverPolicyRef | null,
  input: { availableMinor: number; authorizedMinor: number },
): Result<RolloverOutcome> {
  if (!policy) {
    return err(
      'ROLLOVER_POLICY_MISSING',
      'This budget has no rollover policy; assign one before the year-end run.',
    );
  }
  const available = Math.max(0, input.availableMinor);
  if (!Number.isSafeInteger(available)) {
    return err('AMOUNT_NOT_SAFE_INTEGER', 'The available amount is not a whole minor-unit value.');
  }
  const split = (carry: number): RolloverOutcome => ({
    carryMinor: carry,
    lapseMinor: available - carry,
    sweepTo: policy.sweepTo,
    needsApproval: policy.mode === 'carry_with_approval',
  });
  switch (policy.mode) {
    case 'lapse':
      return ok(split(0));
    case 'carry_full':
    case 'carry_with_approval':
      return ok(split(available));
    case 'carry_capped': {
      if (policy.capBps === null || policy.capBps < 0) {
        return err(
          'ROLLOVER_POLICY_MISSING',
          `Rollover policy ${policy.code} caps the carry but has no cap; fix the policy.`,
          { policy: policy.code },
        );
      }
      const cap = Number(
        (BigInt(Math.max(0, input.authorizedMinor)) * BigInt(policy.capBps)) / 10_000n,
      );
      return ok(split(Math.min(available, cap)));
    }
  }
}

/**
 * The carry a decision settles on. Approving part never raises the requested carry, and whatever is
 * not carried lapses, so the two still add up to what the budget had.
 */
export function decideCarry(
  outcome: Pick<RolloverOutcome, 'carryMinor' | 'lapseMinor'>,
  decision: { decision: 'approve' | 'approve_part' | 'decline'; approvedCarryMinor?: number },
): Result<{ carryMinor: number; lapseMinor: number }> {
  const total = outcome.carryMinor + outcome.lapseMinor;
  if (decision.decision === 'approve') return ok({ ...outcome });
  if (decision.decision === 'decline') return ok({ carryMinor: 0, lapseMinor: total });
  const approved = decision.approvedCarryMinor;
  if (approved === undefined || !Number.isSafeInteger(approved) || approved < 0) {
    return err('VALIDATION_FAILED', 'Give the amount to carry when approving part of a request.', {
      field: 'approvedCarryMinor',
    });
  }
  if (approved > outcome.carryMinor) {
    return err(
      'LIMIT_EXCEEDED',
      'That is more than was requested to carry forward; approve the requested amount or less.',
      { requestedMinor: outcome.carryMinor },
    );
  }
  return ok({ carryMinor: approved, lapseMinor: total - approved });
}

/**
 * A carried commitment keeps its own funding: the money that backed it in the ending year moves to
 * the target year with it. Carrying budget and carrying the commitment are therefore two sides of
 * the same amount, and the target budget's available is unchanged by the carry itself.
 */
export function commitmentCarryTotal(commitments: readonly { remainingMinor: number }[]): number {
  return commitments.reduce((s, c) => s + Math.max(0, c.remainingMinor), 0);
}
