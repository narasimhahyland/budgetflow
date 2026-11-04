import { err, ok, type DomainErrorCode, type Result } from '../result';
import { defineMachine } from '../state-machine';

/** All 15 budget states. The UI may show a subset; the machine is complete. */
export const BUDGET_STATUSES = [
  'draft',
  'submitted',
  'pending_approval',
  'approved',
  'active',
  'partially_allocated',
  'fully_allocated',
  'frozen',
  'reduced',
  'set_to_zero',
  'exhausted',
  'expired',
  'closed',
  'revised',
  'cancelled',
] as const;
export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

export const BUDGET_EVENTS = [
  'submit',
  'route_for_approval',
  'approve',
  'reject',
  'activate',
  'mark_partially_allocated',
  'mark_fully_allocated',
  'mark_unallocated',
  'freeze',
  'unfreeze',
  'reduce',
  'set_to_zero',
  'restore',
  'exhaust',
  'replenish',
  'expire',
  'close',
  'revise',
  'approve_revision',
  'reject_revision',
  'cancel',
] as const;
export type BudgetEvent = (typeof BUDGET_EVENTS)[number];

const OPERATING = [
  'active',
  'partially_allocated',
  'fully_allocated',
  'reduced',
] as const satisfies readonly BudgetStatus[];

export const budgetMachine = defineMachine<BudgetStatus, BudgetEvent>({
  name: 'budget',
  transitions: [
    { from: 'draft', event: 'submit', to: 'submitted' },
    { from: 'submitted', event: 'route_for_approval', to: 'pending_approval' },
    { from: ['submitted', 'pending_approval'], event: 'approve', to: 'approved' },
    { from: ['submitted', 'pending_approval'], event: 'reject', to: 'draft' },
    { from: ['draft', 'approved'], event: 'activate', to: 'active' },
    {
      from: ['active', 'fully_allocated', 'reduced'],
      event: 'mark_partially_allocated',
      to: 'partially_allocated',
    },
    {
      from: ['active', 'partially_allocated', 'reduced'],
      event: 'mark_fully_allocated',
      to: 'fully_allocated',
    },
    { from: ['partially_allocated', 'fully_allocated'], event: 'mark_unallocated', to: 'active' },
    { from: [...OPERATING, 'exhausted', 'revised'], event: 'freeze', to: 'frozen' },
    { from: 'frozen', event: 'unfreeze', to: 'active' },
    { from: [...OPERATING, 'frozen', 'exhausted'], event: 'reduce', to: 'reduced' },
    {
      from: [...OPERATING, 'frozen', 'exhausted', 'revised'],
      event: 'set_to_zero',
      to: 'set_to_zero',
    },
    { from: 'set_to_zero', event: 'restore', to: 'active' },
    { from: OPERATING, event: 'exhaust', to: 'exhausted' },
    { from: 'exhausted', event: 'replenish', to: 'active' },
    { from: [...OPERATING, 'frozen', 'exhausted', 'set_to_zero'], event: 'expire', to: 'expired' },
    {
      from: [...OPERATING, 'frozen', 'exhausted', 'set_to_zero', 'expired'],
      event: 'close',
      to: 'closed',
    },
    { from: OPERATING, event: 'revise', to: 'revised' },
    { from: 'revised', event: 'approve_revision', to: 'active' },
    { from: 'revised', event: 'reject_revision', to: 'active' },
    {
      from: ['draft', 'submitted', 'pending_approval', 'approved'],
      event: 'cancel',
      to: 'cancelled',
    },
  ],
});

const BLOCKING: Partial<Record<BudgetStatus, { code: DomainErrorCode; message: string }>> = {
  frozen: {
    code: 'BUDGET_FROZEN',
    message:
      'This budget is frozen: new requests, allocations and contributions are blocked. Existing commitments can still complete.',
  },
  set_to_zero: {
    code: 'BUDGET_SET_TO_ZERO',
    message:
      'This budget is set to zero: new requests, allocations and contributions are blocked. Existing commitments can still complete.',
  },
  exhausted: {
    code: 'BUDGET_EXHAUSTED',
    message: 'This budget has no money left for new requests.',
  },
  expired: {
    code: 'BUDGET_EXPIRED',
    message: 'This budget has expired and accepts no new requests.',
  },
  closed: { code: 'BUDGET_CLOSED', message: 'This budget is closed.' },
  cancelled: { code: 'BUDGET_CANCELLED', message: 'This budget was cancelled.' },
};

/** Whether a budget accepts new requests, allocations and contributions, with a typed reason when not. */
export function acceptsNewActivity(status: BudgetStatus): Result<true> {
  const block = BLOCKING[status];
  if (block) return err(block.code, block.message, { status });
  if (
    status === 'draft' ||
    status === 'submitted' ||
    status === 'pending_approval' ||
    status === 'approved'
  ) {
    return err('BUDGET_NOT_ACTIVE', 'This budget is not active yet.', { status });
  }
  return ok(true);
}

/** Existing commitments complete under every control (frozen, zero, expired, closed); only cancelled budgets never had any. */
export function allowsCommitmentCompletion(status: BudgetStatus): boolean {
  return status !== 'cancelled' && status !== 'draft';
}

/** Allocation badge computed from balances (UI shows partially/fully allocated as computed badges). */
export function allocationBadge(
  authorizedMinor: number,
  allocatedOutMinor: number,
): 'unallocated' | 'partially_allocated' | 'fully_allocated' {
  if (allocatedOutMinor <= 0) return 'unallocated';
  return allocatedOutMinor >= authorizedMinor ? 'fully_allocated' : 'partially_allocated';
}
