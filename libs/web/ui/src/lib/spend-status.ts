import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import type { StatusView } from './budget-status';

export type SpendStatusKind =
  | 'request'
  | 'contribution'
  | 'event'
  | 'commitment'
  | 'task'
  | 'recharge';

const DRAFT: StatusView = { label: 'Draft', tone: 'neutral', icon: 'note_edit' };
const SUBMITTED: StatusView = { label: 'Submitted', tone: 'neutral', icon: 'send' };
const PENDING: StatusView = { label: 'Pending approval', tone: 'warning', icon: 'clock' };
const APPROVED: StatusView = { label: 'Approved', tone: 'success', icon: 'circle_check' };
const CHANGES: StatusView = { label: 'Changes requested', tone: 'info', icon: 'note_edit' };
const REJECTED: StatusView = { label: 'Rejected', tone: 'important', icon: 'circle_x' };
const WITHDRAWN: StatusView = { label: 'Withdrawn', tone: 'neutral', icon: 'circle_minus' };
const CANCELLED: StatusView = { label: 'Cancelled', tone: 'neutral', icon: 'circle_x' };

// Section 5 tones and icons; commitment tones follow the section 10 bucket colours so a tag and a
// bar segment for the same bucket read the same (pre-encumbered info, encumbered warning).
const STATUS: Record<SpendStatusKind, Record<string, StatusView>> = {
  request: {
    draft: DRAFT,
    submitted: SUBMITTED,
    pending_approval: PENDING,
    changes_requested: CHANGES,
    approved: APPROVED,
    partially_approved: { ...APPROVED, label: 'Partially approved' },
    rejected: REJECTED,
    withdrawn: WITHDRAWN,
    cancelled: CANCELLED,
  },
  contribution: {
    draft: DRAFT,
    submitted: SUBMITTED,
    pending_approval: { ...PENDING, label: 'Pending' },
    changes_requested: CHANGES,
    approved_full: APPROVED,
    approved_partial: { ...APPROVED, label: 'Approved in part' },
    earmarked: { label: 'Earmarked', tone: 'success', icon: 'bookmark' },
    transferred: { label: 'Transferred', tone: 'success', icon: 'arrow_right' },
    settled: { label: 'Settled', tone: 'neutral', icon: 'archive' },
    rejected: { ...REJECTED, label: 'Declined' },
    withdrawn: WITHDRAWN,
    cancelled: CANCELLED,
  },
  event: {
    draft: DRAFT,
    submitted: SUBMITTED,
    approved: { label: 'Funding in progress', tone: 'warning', icon: 'clock' },
    funded: { label: 'Funded', tone: 'success', icon: 'circle_check' },
    in_progress: { label: 'In progress', tone: 'info', icon: 'calendar' },
    completed: { label: 'Completed', tone: 'info', icon: 'check_double' },
    reconciling: { label: 'Reconciling', tone: 'info', icon: 'sync' },
    closed: { label: 'Closed', tone: 'neutral', icon: 'archive' },
    cancelled: CANCELLED,
  },
  commitment: {
    pre_encumbered: { label: 'Pending', tone: 'info', icon: 'clock' },
    encumbered: { label: 'Committed', tone: 'warning', icon: 'shield_lock' },
    partially_consumed: { label: 'Partly spent', tone: 'neutral', icon: 'trending_flat' },
    consumed: { label: 'Spent', tone: 'neutral', icon: 'check_double' },
    released: { label: 'Released', tone: 'neutral', icon: 'circle_minus' },
    cancelled: CANCELLED,
    expired: { label: 'Expired', tone: 'neutral', icon: 'timer_off' },
    carried_forward: { label: 'Carried forward', tone: 'neutral', icon: 'redo' },
  },
  task: {
    waiting: { label: 'Waiting', tone: 'neutral', icon: 'clock' },
    pending: { ...PENDING, label: 'Pending' },
    approved: APPROVED,
    partially_approved: { ...APPROVED, label: 'Approved in part' },
    rejected: REJECTED,
    changes_requested: CHANGES,
    escalated: { label: 'Escalated', tone: 'info', icon: 'arrow_up' },
    cancelled: CANCELLED,
  },
  recharge: {
    proposed: { label: 'Proposed', tone: 'warning', icon: 'clock' },
    pending_tax_approval: { label: 'Waiting for tax approval', tone: 'warning', icon: 'clock' },
    approved: APPROVED,
    scheduled: { label: 'Scheduled', tone: 'info', icon: 'calendar' },
    exported: { label: 'Exported', tone: 'info', icon: 'upload' },
    posted: { label: 'Posted', tone: 'success', icon: 'check_double' },
    blocked: { label: 'Blocked', tone: 'important', icon: 'block' },
    cancelled: CANCELLED,
  },
};

export function spendStatus(kind: SpendStatusKind, status: string): StatusView {
  return (
    STATUS[kind][status] ?? {
      label: status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' '),
      tone: 'neutral',
      icon: 'circle_minus',
    }
  );
}

/** Request, contribution, event, commitment, approval-step and recharge statuses as Satori tags with their own icon. */
@Component({
  selector: 'bf-spend-status',
  imports: [SatStatusTag, MatIconModule],
  template: `<sat-status-tag [status]="view().tone"
    ><mat-icon [svgIcon]="view().icon" aria-hidden="true" />{{ view().label }}</sat-status-tag
  >`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpendStatus {
  readonly kind = input.required<SpendStatusKind>();
  readonly status = input.required<string>();
  protected readonly view = computed(() => spendStatus(this.kind(), this.status()));
}
