import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type { ReportId } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';
import type { DrillRequest } from './report-frame';

type Bucket = 'held' | 'pre_encumbered' | 'encumbered' | 'actual' | 'authorized' | 'allocated_out';

const BUCKETS: Record<string, Bucket> = {
  held: 'held',
  pre_encumbered: 'pre_encumbered',
  encumbered: 'encumbered',
  actual: 'actual',
  authorized: 'authorized',
  allocated_out: 'allocated_out',
};

/**
 * The ledger lines behind one figure, newest first. The total comes from the API with the lines, so
 * the panel never adds the rows up itself.
 */
@Component({
  selector: 'bf-drilldown-panel',
  imports: [DatePipe, LoadState, MatButtonModule, MatIconModule, Money, SAT_BANNER_IMPORTS],
  template: `
    <section class="bf-card" aria-labelledby="drill-title" data-testid="report-drilldown">
      <div class="bf-card__header">
        <div>
          <h2 class="bf-card__title" id="drill-title">
            {{ request().columnLabel }} · {{ request().rowLabel }}
          </h2>
          <p class="bf-card__hint">
            The ledger lines behind this figure, newest first. Amounts are signed as the ledger
            holds them: a debit is positive and a credit is negative.
          </p>
        </div>
        <button mat-icon-button type="button" aria-label="Close drill-down" (click)="closed.emit()">
          <mat-icon svgIcon="x_small" />
        </button>
      </div>
      <bf-load-state
        [loading]="lines.isLoading() && !lines.hasValue()"
        [error]="lines.error()"
        what="these ledger lines"
        [lines]="3"
        (retry)="lines.reload()"
      />
      @if (valueOf(lines); as d) {
        <p class="bf-card__hint bf-drill__total">
          {{ d.lineCount }} line{{ d.lineCount === 1 ? '' : 's' }} totalling
          <bf-money [amountMinor]="d.total.amountMinor" [currency]="d.total.currency" />
          in the {{ bucketLabel(d.bucket) }} bucket.
        </p>
        @if (d.truncated) {
          <sat-banner class="bf-banner" variant="info">
            <sat-banner-message
              ><strong>Showing the most recent lines only.</strong> This figure has more lines than
              the drill-down shows. Open the budget for the full history.</sat-banner-message
            >
          </sat-banner>
        }
        <div class="bf-table-scroll">
          <table class="bf-split-table" aria-label="Ledger lines">
            <thead>
              <tr>
                <th>Accounting date</th>
                <th>Account</th>
                <th>Event</th>
                <th class="bf-num">Reporting amount</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              @for (line of d.lines; track line.id) {
                <tr>
                  <td>{{ line.accountingDate | date: 'mediumDate' : 'UTC' }}</td>
                  <td>{{ line.account }}</td>
                  <td>{{ line.eventCode ?? '—' }}</td>
                  <td class="bf-num">
                    <bf-money
                      [amountMinor]="line.reporting.amountMinor"
                      [currency]="line.reporting.currency"
                    />
                  </td>
                  <td>{{ line.reversalOfLineId ? 'Reversal' : '—' }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="bf-empty">No ledger lines behind this figure yet.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: `
    .bf-drill__total {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 0 20px 8px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DrilldownPanel {
  private readonly api = injectApi();
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  readonly reportId = input.required<ReportId>();
  readonly request = input.required<DrillRequest>();
  readonly closed = output<void>();

  protected readonly lines = resource({
    params: () => ({ reportId: this.reportId(), request: this.request() }),
    loader: ({ params }) =>
      data(
        this.api.drillDownReport({
          params: { reportId: params.reportId },
          query: {
            budgetId: params.request.budgetId,
            bucket: BUCKETS[params.request.bucket] ?? 'actual',
            subtree: 'true',
          },
        }),
      ),
  });

  protected bucketLabel(bucket: string): string {
    return bucket.replace(/_/g, ' ');
  }
}
