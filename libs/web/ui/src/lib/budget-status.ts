import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';

type Tone =
  | 'important-loud'
  | 'important'
  | 'success'
  | 'warning'
  | 'info'
  | 'neutral'
  | 'neutral-quiet';

const STATUS: Record<string, { label: string; tone: Tone; icon?: string }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  active: { label: 'Active', tone: 'success' },
  partially_allocated: { label: 'Partially allocated', tone: 'success' },
  fully_allocated: { label: 'Fully allocated', tone: 'success' },
  // Budget-safety rule: frozen is a lock in the info tone, everywhere it appears.
  frozen: { label: 'Frozen', tone: 'info', icon: 'lock' },
  reduced: { label: 'Reduced', tone: 'warning' },
  set_to_zero: { label: 'Set to zero', tone: 'important' },
  exhausted: { label: 'Exhausted', tone: 'important' },
  expired: { label: 'Expired', tone: 'neutral-quiet' },
  closed: { label: 'Closed', tone: 'neutral-quiet' },
  revised: { label: 'Revised', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral-quiet' },
};

/** Budget status as a Satori status tag with text (frozen: lock, info tone; set to zero: important tone). */
@Component({
  selector: 'bf-budget-status',
  imports: [MatIcon, SatStatusTag],
  template: `<sat-status-tag [status]="view().tone">
    @if (view().icon; as icon) {
      <mat-icon [svgIcon]="icon" aria-hidden="true" />
    }
    {{ view().label }}</sat-status-tag
  >`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetStatus {
  readonly status = input.required<string>();
  protected readonly view = computed(
    (): { label: string; tone: Tone; icon?: string } =>
      STATUS[this.status()] ?? { label: this.status(), tone: 'neutral' },
  );
}
