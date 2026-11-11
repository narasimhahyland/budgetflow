import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';

export type StatusTone =
  | 'important-loud'
  | 'important'
  | 'success'
  | 'warning'
  | 'info'
  | 'neutral'
  | 'neutral-quiet';

export interface StatusView {
  label: string;
  tone: StatusTone;
  /** Satori sprite name; section 5 of the design system pairs every status with its own icon. */
  icon: string;
}

// Tones and icons from section 5 of the design system sheet. Satori has no error tone, so
// exhausted takes important-loud to stay distinct from set to zero.
const STATUS: Record<string, StatusView> = {
  draft: { label: 'Draft', tone: 'neutral', icon: 'note_edit' },
  submitted: { label: 'Submitted', tone: 'neutral', icon: 'send' },
  pending_approval: { label: 'Pending approval', tone: 'warning', icon: 'clock' },
  approved: { label: 'Approved', tone: 'success', icon: 'circle_check' },
  active: { label: 'Active', tone: 'success', icon: 'circle_check' },
  partially_allocated: { label: 'Partially allocated', tone: 'info', icon: 'graph_radial' },
  fully_allocated: { label: 'Fully allocated', tone: 'neutral', icon: 'graph_radial' },
  // Budget-safety rule: frozen is a lock in the info tone, everywhere it appears.
  frozen: { label: 'Frozen', tone: 'info', icon: 'lock' },
  reduced: { label: 'Reduced', tone: 'warning', icon: 'trending_down' },
  set_to_zero: { label: 'Set to zero', tone: 'important', icon: 'circle_stop' },
  exhausted: { label: 'Exhausted', tone: 'important-loud', icon: 'error' },
  expired: { label: 'Expired', tone: 'neutral', icon: 'timer_off' },
  closed: { label: 'Closed', tone: 'neutral', icon: 'archive' },
  revised: { label: 'Revised', tone: 'neutral', icon: 'restore' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'circle_x' },
};

const BY_LABEL = new Map(Object.values(STATUS).map((v) => [v.label.toLowerCase(), v]));

/** The section 5 view of a budget status from its enum key or its label, if it is one. */
export function findBudgetStatus(status: string): StatusView | undefined {
  return STATUS[status] ?? BY_LABEL.get(status.toLowerCase());
}

/** The section 5 view of a budget status, from its enum key or (for report rows) its label. */
export function budgetStatus(status: string): StatusView {
  return (
    findBudgetStatus(status) ?? {
      label: status.replace(/_/g, ' '),
      tone: 'neutral',
      icon: 'circle_minus',
    }
  );
}

/** Budget status as a Satori status tag with its own icon and text (frozen lock/info, set to zero stop/important). */
@Component({
  selector: 'bf-budget-status',
  imports: [SatStatusTag, MatIconModule],
  template: `<sat-status-tag [status]="view().tone"
    ><mat-icon [svgIcon]="view().icon" aria-hidden="true" />{{ view().label }}</sat-status-tag
  >`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetStatus {
  readonly status = input.required<string>();
  protected readonly view = computed(() => budgetStatus(this.status()));
}
