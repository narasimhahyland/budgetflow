import { err, ok, type Result } from '../result';
import { allocationAvailable, type BucketBalances, type ControlSettings } from '../ledger/balances';

export const BUDGET_TYPES = ['operating', 'event', 'shared_event', 'contingency'] as const;
export type BudgetType = (typeof BUDGET_TYPES)[number];

export const REDUCTION_DESTINATIONS = ['parent', 'savings', 'reallocation'] as const;
export type ReductionDestination = (typeof REDUCTION_DESTINATIONS)[number];

export const ALLOCATION_DRIVERS = ['fixed', 'per_head'] as const;
export type AllocationDriver = (typeof ALLOCATION_DRIVERS)[number];

export const CONTROL_ACTIONS = ['freeze', 'reduce', 'set_to_zero'] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

export interface ReductionRequest {
  kind: 'reduce' | 'set_to_zero';
  /** For `reduce`: amount to remove in the budget currency. Ignored for set to zero. */
  amountMinor?: number;
  destination?: ReductionDestination | null;
  destinationBudgetId?: string | null;
  reasonCode?: string | null;
  reason?: string | null;
  cascade?: boolean;
  /**
   * With cascade: what the children keep after their own set to zero (their floors), which stays
   * allocated out of this budget.
   */
  childrenRetainedMinor?: number;
  /** The impact preview the user confirmed (its floor must match the current one). */
  confirmedPreview?: { floorMinor: number } | null;
}

export interface ReductionImpact {
  currentAuthorizedMinor: number;
  floorMinor: number;
  reductionMinor: number;
  newAuthorizedMinor: number;
  /** Held (earmarks) + encumbered (approved commitments): part of the floor. */
  committedMinor: number;
  heldMinor: number;
  encumberedMinor: number;
  actualMinor: number;
  /** Allocated to children and kept by them (all of it without cascade). */
  childrenAllocatedMinor: number;
  /** Pending requests (pre-encumbered): listed, never part of the floor. */
  pendingMinor: number;
  availableBeforeMinor: number;
  availableAfterMinor: number;
  cascade: boolean;
  blocksNewRequests: boolean;
}

/**
 * The floor a reduction or set to zero cannot go below: allocated out (unless cascaded, then what the
 * children keep) + held + encumbered + actual. Pending requests are excluded from the floor; the
 * impact preview lists them because a set to zero cancels them and a reduction may leave them short.
 */
export function reductionFloor(
  balances: BucketBalances,
  cascade: boolean,
  childrenRetainedMinor = 0,
): number {
  const children = cascade ? childrenRetainedMinor : balances.allocated_out;
  return children + balances.held + balances.encumbered + balances.actual;
}

/** Impact preview for reduce / set to zero. */
export function previewReduction(
  balances: BucketBalances,
  control: ControlSettings,
  req: Pick<ReductionRequest, 'kind' | 'amountMinor' | 'cascade' | 'childrenRetainedMinor'>,
): Result<ReductionImpact> {
  const cascade = req.kind === 'set_to_zero' && Boolean(req.cascade);
  const floor = reductionFloor(balances, cascade, req.childrenRetainedMinor ?? 0);
  const reduction =
    req.kind === 'set_to_zero' ? Math.max(balances.authorized - floor, 0) : (req.amountMinor ?? 0);
  if (req.kind === 'reduce' && (!Number.isSafeInteger(reduction) || reduction <= 0)) {
    return err('AMOUNT_NOT_POSITIVE', 'Enter an amount greater than zero to reduce.');
  }
  if (balances.authorized - reduction < floor) {
    return err(
      'REDUCTION_BELOW_FLOOR',
      'The budget cannot go below what is already allocated to children, committed and spent.',
      {
        floorMinor: floor,
        maxReductionMinor: Math.max(balances.authorized - floor, 0),
        availableMinor: allocationAvailable(balances, control),
      },
    );
  }
  const availableBefore = allocationAvailable(balances, control);
  return ok({
    currentAuthorizedMinor: balances.authorized,
    floorMinor: floor,
    reductionMinor: reduction,
    newAuthorizedMinor: balances.authorized - reduction,
    committedMinor: balances.held + balances.encumbered,
    heldMinor: balances.held,
    encumberedMinor: balances.encumbered,
    actualMinor: balances.actual,
    childrenAllocatedMinor: cascade ? (req.childrenRetainedMinor ?? 0) : balances.allocated_out,
    pendingMinor: balances.pre_encumbered,
    availableBeforeMinor: availableBefore,
    availableAfterMinor:
      availableBefore -
      reduction +
      (cascade ? balances.allocated_out - (req.childrenRetainedMinor ?? 0) : 0),
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

/**
 * What happens to pending requests on the budget after a control change (consumed by Phase 5 requests):
 * set to zero cancels them, freeze holds them, unfreeze and restore release them, and a reduction
 * returns to their requesters the ones that no longer fit (`unfitPendingRequests`).
 */
export type PendingRequestPolicy = 'cancel' | 'hold' | 'release' | 'return_unfit';

export function pendingRequestPolicy(
  action: 'frozen' | 'unfrozen' | 'reduced' | 'set_to_zero' | 'restored',
): PendingRequestPolicy {
  if (action === 'set_to_zero') return 'cancel';
  if (action === 'frozen') return 'hold';
  if (action === 'unfrozen' || action === 'restored') return 'release';
  return 'return_unfit';
}

export interface PendingRequestAmount {
  requestId: string;
  openMinor: number;
  submittedAt: string;
}

/**
 * Pending requests that no longer fit after a reduction leaves `availableAfterMinor` below zero: the
 * most recently submitted are returned first until what remains fits; earlier requests keep their place.
 */
export function unfitPendingRequests(
  pending: readonly PendingRequestAmount[],
  availableAfterMinor: number,
): string[] {
  let shortfall = -availableAfterMinor;
  const out: string[] = [];
  const newestFirst = [...pending].sort(
    (a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.requestId.localeCompare(a.requestId),
  );
  for (const p of newestFirst) {
    if (shortfall <= 0) break;
    out.push(p.requestId);
    shortfall -= p.openMinor;
  }
  return out;
}
