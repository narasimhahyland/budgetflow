import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
} from '@angular/core';
import type { AiScanFeature, AiScanRun } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateOnlyPipe, DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { data, injectApi, valueOf } from './api';

/**
 * Gap B9: which nightly scan the screen is showing (016b, 017c). The results on the screen are
 * the stored ones, so the note says when they were produced; when the newest run could not reach
 * the model it says so, and that the previous results are still the ones shown.
 */
@Component({
  selector: 'bf-scan-run-note',
  imports: [DateOnlyPipe, DateTimePipe, SAT_BANNER_IMPORTS],
  template: `
    @if (runs.hasValue()) {
      @if (problem(); as p) {
        <sat-banner variant="warning" data-testid="scan-run-problem">
          <sat-banner-message>
            @if (p.status === 'failed') {
              The scan for {{ p.runDate | bfDate: 'UTC' }} could not reach the AI model after
              {{ p.attempts }} attempts.
            } @else {
              The scan for {{ p.runDate | bfDate: 'UTC' }} could not reach the AI model and will be
              retried.
            }
            @if (latest(); as l) {
              Showing the results of {{ l.runDate | bfDate: 'UTC' }}.
            }
          </sat-banner-message>
        </sat-banner>
      }
      <p class="bf-scan-note" data-testid="scan-run-note">
        @if (latest(); as l) {
          Last scan {{ l.trigger === 'nightly' ? '(nightly)' : '(manual)' }}:
          <span data-testid="relative-time">{{
            l.completedAt | bfDateTime: session.timezone() : 'd MMM y, HH:mm'
          }}</span>
          · {{ l.evaluatedCount }} budgets checked · {{ l.resultCount }} {{ resultUnit() }}
        } @else if (skipped()) {
          The latest scan was skipped:
          {{ feature() === 'outlook' ? 'Spending outlook' : 'Anomaly flags' }}
          is switched off for this company.
        } @else {
          No nightly scan has run yet. Results appear here after the first one.
        }
      </p>
    }
  `,
  styles: `
    .bf-scan-note {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScanRunNote {
  readonly feature = input.required<AiScanFeature>();
  private readonly api = injectApi();
  protected readonly session = inject(SessionStore);

  protected readonly runs = resource({
    params: () => ({ feature: this.feature(), limit: 1 }),
    loader: ({ params }) => data(this.api.listAiScanRuns({ query: params })),
  });

  protected readonly latest = computed<AiScanRun | null>(
    () => valueOf(this.runs)?.latestCompleted[0] ?? null,
  );
  private readonly newest = computed<AiScanRun | null>(() => valueOf(this.runs)?.items[0] ?? null);
  protected readonly problem = computed(() => {
    const n = this.newest();
    return n && (n.status === 'failed' || n.status === 'retrying') ? n : null;
  });
  protected readonly skipped = computed(() => {
    const n = this.newest();
    return n?.status === 'skipped' && !this.latest() ? n : null;
  });
  protected readonly resultUnit = computed(() =>
    this.feature() === 'outlook' ? 'outlooks updated' : 'flags raised or refreshed',
  );

  reload(): void {
    this.runs.reload();
  }
}
