import { ChangeDetectionStrategy, Component, input, resource } from '@angular/core';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';

/**
 * 061 with 094: the ERP budget check line on the approval card ("Workday budget check: passed" or
 * the reason it failed). In Block mode a failed or unreachable check also stops the approval; the
 * API enforces it, this line says why before the approver tries. Shows nothing when no ERP check
 * is switched on.
 */
@Component({
  selector: 'bf-budget-check-line',
  imports: [SAT_BANNER_IMPORTS, SatStatusTag],
  template: `
    @for (c of items(); track c.provider) {
      @if (c.blocksApproval) {
        <sat-banner variant="important" class="bf-banner" data-testid="budget-check">
          <sat-banner-message>{{ c.message }}</sat-banner-message>
        </sat-banner>
      } @else {
        <p class="bf-check" data-testid="budget-check">
          <sat-status-tag [status]="c.status === 'passed' ? 'success' : 'warning'">{{
            c.status === 'passed' ? 'Passed' : c.status === 'failed' ? 'Failed' : 'Unavailable'
          }}</sat-status-tag>
          {{ c.message }}
          @if (c.status !== 'passed') {
            <span> You can still approve: the check is set to warn.</span>
          }
        </p>
      }
    }
  `,
  styles: `
    .bf-check {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin: 0 0 12px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetCheckLine {
  readonly taskId = input.required<string>();
  private readonly api = injectApi();
  private readonly checks = resource({
    params: () => ({ taskId: this.taskId() }),
    loader: ({ params }) => data(this.api.listExternalBudgetChecks({ params })),
  });
  protected readonly items = () => valueOf(this.checks)?.items ?? [];
}
