import { defineMachine } from './state-machine';

/** Commitment lifecycle (docs/architecture/state-machines.md). */
export const COMMITMENT_STATUSES = [
  'pre_encumbered',
  'encumbered',
  'partially_consumed',
  'consumed',
  'released',
  'cancelled',
  'expired',
  'carried_forward',
] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];
export const commitmentMachine = defineMachine<
  CommitmentStatus,
  | 'approve'
  | 'reject'
  | 'withdraw'
  | 'match_partial'
  | 'match_full'
  | 'release'
  | 'cancel_with_fees'
  | 'expire'
  | 'carry_forward'
>({
  name: 'commitment',
  transitions: [
    { from: 'pre_encumbered', event: 'approve', to: 'encumbered' },
    { from: 'pre_encumbered', event: 'reject', to: 'released' },
    { from: 'pre_encumbered', event: 'withdraw', to: 'released' },
    {
      from: ['encumbered', 'partially_consumed'],
      event: 'match_partial',
      to: 'partially_consumed',
    },
    { from: ['encumbered', 'partially_consumed'], event: 'match_full', to: 'consumed' },
    { from: ['encumbered', 'partially_consumed'], event: 'release', to: 'released' },
    { from: 'encumbered', event: 'cancel_with_fees', to: 'cancelled' },
    { from: 'encumbered', event: 'expire', to: 'expired' },
    { from: 'encumbered', event: 'carry_forward', to: 'carried_forward' },
  ],
});

/** Event lifecycle; cancellation consumes fees already incurred. */
export const EVENT_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'funded',
  'in_progress',
  'completed',
  'reconciling',
  'closed',
  'cancelled',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const eventMachine = defineMachine<
  EventStatus,
  'submit' | 'approve' | 'reject' | 'fund' | 'start' | 'complete' | 'reconcile' | 'close' | 'cancel'
>({
  name: 'event',
  transitions: [
    { from: 'draft', event: 'submit', to: 'submitted' },
    { from: 'submitted', event: 'approve', to: 'approved' },
    { from: 'submitted', event: 'reject', to: 'draft' },
    { from: 'approved', event: 'fund', to: 'funded' },
    { from: 'funded', event: 'start', to: 'in_progress' },
    { from: 'in_progress', event: 'complete', to: 'completed' },
    { from: 'completed', event: 'reconcile', to: 'reconciling' },
    { from: 'reconciling', event: 'close', to: 'closed' },
    {
      from: ['draft', 'submitted', 'approved', 'funded', 'in_progress'],
      event: 'cancel',
      to: 'cancelled',
    },
  ],
});

/** Requests (budget, spending, additional-fund, over-budget, exception) with resubmission and request-changes loops. */
export const REQUEST_KINDS = [
  'budget',
  'spending',
  'additional_fund',
  'over_budget',
  'exception',
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const REQUEST_STATUSES = [
  'draft',
  'submitted',
  'pending_approval',
  'changes_requested',
  'approved',
  'partially_approved',
  'rejected',
  'withdrawn',
  'cancelled',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const requestMachine = defineMachine<
  RequestStatus,
  | 'submit'
  | 'route'
  | 'approve'
  | 'approve_partial'
  | 'reject'
  | 'request_changes'
  | 'resubmit'
  | 'withdraw'
  | 'cancel'
>({
  name: 'request',
  transitions: [
    { from: 'draft', event: 'submit', to: 'submitted' },
    { from: 'submitted', event: 'route', to: 'pending_approval' },
    { from: ['submitted', 'pending_approval'], event: 'approve', to: 'approved' },
    { from: ['submitted', 'pending_approval'], event: 'approve_partial', to: 'partially_approved' },
    { from: ['submitted', 'pending_approval'], event: 'reject', to: 'rejected' },
    { from: ['submitted', 'pending_approval'], event: 'request_changes', to: 'changes_requested' },
    { from: 'changes_requested', event: 'resubmit', to: 'submitted' },
    {
      from: ['draft', 'submitted', 'pending_approval', 'changes_requested'],
      event: 'withdraw',
      to: 'withdrawn',
    },
    { from: ['approved', 'partially_approved'], event: 'cancel', to: 'cancelled' },
    // A budget set to zero cancels requests still waiting for a decision.
    {
      from: ['submitted', 'pending_approval', 'changes_requested'],
      event: 'cancel',
      to: 'cancelled',
    },
  ],
});

/** Inter-Director Budget Contribution Request lifecycle: the giving director decides; earmark (default) or transfer. */
export const CONTRIBUTION_STATUSES = [
  'draft',
  'submitted',
  'pending_approval',
  'changes_requested',
  'approved_full',
  'approved_partial',
  'rejected',
  'withdrawn',
  'earmarked',
  'transferred',
  'settled',
  'cancelled',
] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];
export const contributionMachine = defineMachine<
  ContributionStatus,
  | 'submit'
  | 'route'
  | 'approve_full'
  | 'approve_partial'
  | 'reject'
  | 'request_changes'
  | 'resubmit'
  | 'withdraw'
  | 'earmark'
  | 'transfer'
  | 'settle'
  | 'cancel'
>({
  name: 'Inter-Director Budget Contribution Request',
  transitions: [
    { from: 'draft', event: 'submit', to: 'submitted' },
    { from: 'submitted', event: 'route', to: 'pending_approval' },
    { from: ['submitted', 'pending_approval'], event: 'approve_full', to: 'approved_full' },
    { from: ['submitted', 'pending_approval'], event: 'approve_partial', to: 'approved_partial' },
    { from: ['submitted', 'pending_approval'], event: 'reject', to: 'rejected' },
    { from: ['submitted', 'pending_approval'], event: 'request_changes', to: 'changes_requested' },
    { from: 'changes_requested', event: 'resubmit', to: 'submitted' },
    {
      from: ['draft', 'submitted', 'pending_approval', 'changes_requested'],
      event: 'withdraw',
      to: 'withdrawn',
    },
    { from: ['approved_full', 'approved_partial'], event: 'earmark', to: 'earmarked' },
    { from: ['approved_full', 'approved_partial'], event: 'transfer', to: 'transferred' },
    { from: ['earmarked', 'transferred'], event: 'settle', to: 'settled' },
    { from: ['approved_full', 'approved_partial', 'earmarked'], event: 'cancel', to: 'cancelled' },
    // A giving budget set to zero cancels contribution requests still waiting for a decision.
    {
      from: ['submitted', 'pending_approval', 'changes_requested'],
      event: 'cancel',
      to: 'cancelled',
    },
  ],
});

/** Forecast snapshots: variance beyond threshold requires owner commentary before acceptance. */
export const FORECAST_METHODS = ['run_rate', 'committed_pipeline', 'owner_input'] as const;
export type ForecastMethod = (typeof FORECAST_METHODS)[number];
export const FORECAST_STATUSES = [
  'draft',
  'submitted',
  'commentary_required',
  'accepted',
  'superseded',
] as const;
export type ForecastStatus = (typeof FORECAST_STATUSES)[number];
export const forecastMachine = defineMachine<
  ForecastStatus,
  'submit' | 'require_commentary' | 'accept' | 'supersede'
>({
  name: 'forecast snapshot',
  transitions: [
    { from: 'draft', event: 'submit', to: 'submitted' },
    { from: 'submitted', event: 'require_commentary', to: 'commentary_required' },
    { from: 'commentary_required', event: 'submit', to: 'submitted' },
    { from: 'submitted', event: 'accept', to: 'accepted' },
    { from: 'accepted', event: 'supersede', to: 'superseded' },
  ],
});

/**
 * A forecast cycle is open while owners submit and finance accepts, and closed once the snapshot is
 * locked. Closing fills the budgets nobody submitted with system run-rate snapshots and supersedes
 * the previous cycle's, so reports and the board pack always read one complete, immutable set.
 */
export const FORECAST_CYCLE_STATUSES = ['open', 'closed'] as const;
export type ForecastCycleStatus = (typeof FORECAST_CYCLE_STATUSES)[number];
export const forecastCycleMachine = defineMachine<ForecastCycleStatus, 'close'>({
  name: 'forecast cycle',
  transitions: [{ from: 'open', event: 'close', to: 'closed' }],
});

/** Board and FP&A pack generation (16a): a background job renders the pages into the DocumentStore. */
export const BOARD_PACK_STATUSES = ['queued', 'running', 'ready', 'failed', 'expired'] as const;
export type BoardPackStatus = (typeof BOARD_PACK_STATUSES)[number];

/** Intercompany recharge schedule lifecycle; a tax approver signs off when the policy requires one. */
export const RECHARGE_STATUSES = [
  'proposed',
  'pending_tax_approval',
  'approved',
  'scheduled',
  'exported',
  'posted',
  'blocked',
  'cancelled',
] as const;
export type RechargeStatus = (typeof RECHARGE_STATUSES)[number];
export const rechargeMachine = defineMachine<
  RechargeStatus,
  'request_tax_approval' | 'approve' | 'schedule' | 'export' | 'post' | 'block' | 'cancel'
>({
  name: 'recharge',
  transitions: [
    { from: 'proposed', event: 'request_tax_approval', to: 'pending_tax_approval' },
    { from: ['proposed', 'pending_tax_approval'], event: 'approve', to: 'approved' },
    { from: 'approved', event: 'schedule', to: 'scheduled' },
    { from: 'scheduled', event: 'export', to: 'exported' },
    { from: ['scheduled', 'exported'], event: 'post', to: 'posted' },
    { from: ['proposed', 'pending_tax_approval'], event: 'block', to: 'blocked' },
    {
      from: ['proposed', 'pending_tax_approval', 'approved', 'scheduled'],
      event: 'cancel',
      to: 'cancelled',
    },
  ],
});
