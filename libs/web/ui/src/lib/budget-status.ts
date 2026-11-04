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

const STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  active: { label: 'Active', tone: 'success' },
  partially_allocated: { label: 'Partially allocated', tone: 'success' },
  fully_allocated: { label: 'Fully allocated', tone: 'success' },
  frozen: { label: 'Frozen', tone: 'info' },
  reduced: { label: 'Reduced', tone: 'warning' },
  set_to_zero: { label: 'Set to zero', tone: 'important' },
  exhausted: { label: 'Exhausted', tone: 'important' },
  expired: { label: 'Expired', tone: 'neutral-quiet' },
  closed: { label: 'Closed', tone: 'neutral-quiet' },
  revised: { label: 'Revised', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral-quiet' },
};

/** Budget status as a Satori status tag with text (frozen info tone, set to zero important tone). */
@Component({
  selector: 'bf-budget-status',
  imports: [SatStatusTag],
  template: `<sat-status-tag [status]="view().tone">{{ view().label }}</sat-status-tag>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetStatus {
  readonly status = input.required<string>();
  protected readonly view = computed(
    () => STATUS[this.status()] ?? { label: this.status(), tone: 'neutral' as Tone },
  );
}
