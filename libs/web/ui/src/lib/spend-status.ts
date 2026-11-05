import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';

type Tone =
  | 'important-loud'
  | 'important'
  | 'success'
  | 'warning'
  | 'info'
  | 'neutral'
  | 'neutral-quiet';
export type SpendStatusKind =
  | 'request'
  | 'contribution'
  | 'event'
  | 'commitment'
  | 'task'
  | 'recharge';

const PENDING = { tone: 'warning' as Tone };
const STATUS: Record<SpendStatusKind, Record<string, { label: string; tone: Tone }>> = {
  request: {
    draft: { label: 'Draft', tone: 'neutral' },
    submitted: { label: 'Submitted', ...PENDING },
    pending_approval: { label: 'Pending approval', ...PENDING },
    changes_requested: { label: 'Changes requested', tone: 'info' },
    approved: { label: 'Approved', tone: 'success' },
    partially_approved: { label: 'Partially approved', tone: 'success' },
    rejected: { label: 'Rejected', tone: 'important' },
    withdrawn: { label: 'Withdrawn', tone: 'neutral-quiet' },
    cancelled: { label: 'Cancelled', tone: 'neutral-quiet' },
  },
  contribution: {
    draft: { label: 'Draft', tone: 'neutral' },
    submitted: { label: 'Submitted', ...PENDING },
    pending_approval: { label: 'Pending', ...PENDING },
    changes_requested: { label: 'Changes requested', tone: 'info' },
    approved_full: { label: 'Approved', tone: 'success' },
    approved_partial: { label: 'Approved in part', tone: 'success' },
    earmarked: { label: 'Earmarked', tone: 'success' },
    transferred: { label: 'Transferred', tone: 'success' },
    settled: { label: 'Settled', tone: 'neutral' },
    rejected: { label: 'Declined', tone: 'important' },
    withdrawn: { label: 'Withdrawn', tone: 'neutral-quiet' },
    cancelled: { label: 'Cancelled', tone: 'neutral-quiet' },
  },
  event: {
    draft: { label: 'Draft', tone: 'neutral' },
    submitted: { label: 'Submitted', ...PENDING },
    approved: { label: 'Funding in progress', ...PENDING },
    funded: { label: 'Funded', tone: 'success' },
    in_progress: { label: 'In progress', tone: 'info' },
    completed: { label: 'Completed', tone: 'info' },
    reconciling: { label: 'Reconciling', tone: 'info' },
    closed: { label: 'Closed', tone: 'neutral-quiet' },
    cancelled: { label: 'Cancelled', tone: 'neutral-quiet' },
  },
  commitment: {
    pre_encumbered: { label: 'Pending', ...PENDING },
    encumbered: { label: 'Committed', tone: 'success' },
    partially_consumed: { label: 'Partly spent', tone: 'info' },
    consumed: { label: 'Spent', tone: 'neutral' },
    released: { label: 'Released', tone: 'neutral-quiet' },
    cancelled: { label: 'Cancelled', tone: 'neutral-quiet' },
    expired: { label: 'Expired', tone: 'neutral-quiet' },
    carried_forward: { label: 'Carried forward', tone: 'neutral' },
  },
  task: {
    waiting: { label: 'Waiting', tone: 'neutral-quiet' },
    pending: { label: 'Pending your action', ...PENDING },
    approved: { label: 'Approved', tone: 'success' },
    partially_approved: { label: 'Approved in part', tone: 'success' },
    rejected: { label: 'Rejected', tone: 'important' },
    changes_requested: { label: 'Changes requested', tone: 'info' },
    escalated: { label: 'Escalated', tone: 'info' },
    cancelled: { label: 'Cancelled', tone: 'neutral-quiet' },
  },
  recharge: {
    proposed: { label: 'Proposed', ...PENDING },
    pending_tax_approval: { label: 'Waiting for tax approval', ...PENDING },
    approved: { label: 'Approved', tone: 'success' },
    scheduled: { label: 'Scheduled', tone: 'info' },
    exported: { label: 'Exported', tone: 'info' },
    posted: { label: 'Posted', tone: 'success' },
    blocked: { label: 'Blocked', tone: 'important' },
    cancelled: { label: 'Cancelled', tone: 'neutral-quiet' },
  },
};

export function spendStatus(kind: SpendStatusKind, status: string): { label: string; tone: Tone } {
  return STATUS[kind][status] ?? { label: status.replace(/_/g, ' '), tone: 'neutral' };
}

/** Request, contribution, event, commitment, approval-step and recharge statuses as Satori tags (pending warning, approved success, rejected important). */
@Component({
  selector: 'bf-spend-status',
  imports: [SatStatusTag],
  template: `<sat-status-tag [status]="view().tone">{{ view().label }}</sat-status-tag>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpendStatus {
  readonly kind = input.required<SpendStatusKind>();
  readonly status = input.required<string>();
  protected readonly view = computed(() => spendStatus(this.kind(), this.status()));
}
