import { err, ok, type Result } from '../result';
import {
  allocationAvailable,
  committedOf,
  type BucketBalances,
  type ControlSettings,
} from '../ledger/balances';

export const BUDGET_TYPES = ['operating', 'event', 'shared_event', 'contingency'] as const;
export type BudgetType = (typeof BUDGET_TYPES)[number];

export const REDUCTION_DESTINATIONS = ['parent', 'savings', 'reallocation'] as const;
export type ReductionDestination = (typeof REDUCTION_DESTINATIONS)[number];

export const ALLOCATION_DRIVERS = ['fixed', 'per_head'] as const;
export type AllocationDriver = (typeof ALLOCATION_DRIVERS)[number];

export interface ReductionRequest {
  kind: 'reduce' | 'set_to_zero';
  /** For `reduce`: amount to remove in the budget currency. Ignored for set to zero. */
  amountMinor?: number;
  destination?: ReductionDestination | null;
  destinationBudgetId?: string | null;
  reasonCode?: string | null;
  reason?: string | null;
  cascade?: boolean;
  /** The impact preview the user confirmed (its floor must match the current one). */
  confirmedPreview?: { floorMinor: number } | null;
}

export interface ReductionImpact {
  currentAuthorizedMinor: number;
  floorMinor: number;
  reductionMinor: number;
  newAuthorizedMinor: number;
  committedMinor: number;
  actualMinor: number;
  childrenAllocatedMinor: number;
  cascade: boolean;
  blocksNewRequests: boolean;
}

/**
 * Impact preview for reduce / set to zero. The floor is committed + actual + children unless the
 * change cascades to children (whose own floors then apply, checked by the caller per child).
 */
export function previewReduction(
  balances: BucketBalances,
  control: ControlSettings,
  req: Pick<ReductionRequest, 'kind' | 'amountMinor' | 'cascade'>,
): Result<ReductionImpact> {
  const cascade = Boolean(req.cascade);
  const committed = committedOf(balances);
  const floor = committed + balances.actual + (cascade ? 0 : balances.allocated_out);
  const reduction =
    req.kind === 'set_to_zero' ? balances.authorized - floor : (req.amountMinor ?? 0);
  if (req.kind === 'reduce' && (!Number.isSafeInteger(reduction) || reduction <= 0)) {
    return err('AMOUNT_NOT_POSITIVE', 'Enter an amount greater than zero to reduce.');
  }
  if (balances.authorized - reduction < floor) {
    return err(
      'REDUCTION_BELOW_FLOOR',
      'The budget cannot go below what is already committed, spent and allocated to children.',
      {
        floorMinor: floor,
        maxReductionMinor: Math.max(balances.authorized - floor, 0),
        availableMinor: allocationAvailable(balances, control),
      },
    );
  }
  return ok({
    currentAuthorizedMinor: balances.authorized,
    floorMinor: floor,
    reductionMinor: Math.max(reduction, 0),
    newAuthorizedMinor: balances.authorized - Math.max(reduction, 0),
    committedMinor: committed,
    actualMinor: balances.actual,
    childrenAllocatedMinor: balances.allocated_out,
    cascade,
    blocksNewRequests: req.kind === 'set_to_zero',
  });
}

/** Reduce and set to zero need a reason code, a typed reason, a destination and a confirmed impact preview. */
export function validateReduction(
  balances: BucketBalances,
  control: ControlSettings,
  req: ReductionRequest,
): Result<ReductionImpact> {
  if (!req.reasonCode?.trim() || !req.reason?.trim())
    return err('REASON_REQUIRED', 'Choose a reason code and type the reason.');
  if (!req.destination)
    return err(
      'REDUCTION_DESTINATION_REQUIRED',
      'Choose where the cut money goes: parent, savings or reallocation.',
    );
  if (req.destination === 'reallocation' && !req.destinationBudgetId) {
    return err(
      'REDUCTION_DESTINATION_REQUIRED',
      'Choose the budget that receives the reallocated money.',
    );
  }
  const impact = previewReduction(balances, control, req);
  if (!impact.ok) return impact;
  if (!req.confirmedPreview || req.confirmedPreview.floorMinor !== impact.value.floorMinor) {
    return err('IMPACT_PREVIEW_REQUIRED', 'Review the current impact preview before confirming.', {
      floorMinor: impact.value.floorMinor,
    });
  }
  return impact;
}
