import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import type { AiEvaluationResult } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { AiLabel } from './ai-output';
import { AiTabs } from './ai-tabs';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const METRIC_LABELS: Record<string, string> = {
  cites_only_permitted_records: 'Cites only records the asker may read',
  refuses_out_of_scope: 'Refuses out-of-scope questions',
  figures_traceable: 'Every figure traceable to a record',
  schema_valid: 'Model output passes its schema',
  no_workaround_advice: 'Never advises a way around a control',
  high_confidence_precision: 'Precision of High-confidence suggestions',
  field_accuracy: 'Field accuracy (totals and dates)',
  flag_precision: 'Flag precision',
  split_totals_exactly: 'Split totals exactly to the amount',
  range_contains_likely: 'Range contains the most likely value',
};

/**
 * Screen 113a, Accuracy tab: the latest evaluation run per feature and metric against its threshold.
 * A metric below its threshold is shown in the error tone, and for anomaly flags the kind is paused
 * automatically rather than flooding reviewers.
 */
@Component({
  selector: 'bf-accuracy-page',
  imports: [
    AiLabel,
    AiTabs,
    DateTimePipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <div class="bf-title-row">
          <h1 class="bf-page__title">AI accuracy</h1>
          <bf-ai-label text="AI evaluations" />
        </div>
        <p class="bf-page__subtitle">
          Each feature's evaluation set against its threshold, run against the configured provider.
          A metric below its threshold is a reason to turn the feature off, not to lower the bar.
        </p>
      </div>
      <div class="bf-page__actions">
        @if (session.can('tenant.settings.manage')) {
          <button
            mat-stroked-button
            type="button"
            [disabled]="running()"
            (click)="run()"
            data-testid="run-evaluations"
          >
            <mat-icon svgIcon="refresh" />Run evaluations
          </button>
        }
      </div>
    </header>

    <bf-ai-tabs class="bf-tabs" />

    <bf-load-state
      [loading]="accuracy.isLoading() && !accuracy.hasValue()"
      [error]="accuracy.error()"
      what="the AI accuracy results"
      (retry)="accuracy.reload()"
    />

    @if (accuracy.hasValue()) {
      @if (failing().length) {
        <sat-banner variant="important" data-testid="below-threshold">
          <sat-banner-message>
            Below threshold: {{ failingNames() }}. Anomaly flag kinds below their threshold stop
            raising new flags until they are re-evaluated.
          </sat-banner-message>
        </sat-banner>
      } @else if (rows().length) {
        <sat-banner variant="success" data-testid="all-passed">
          <sat-banner-message>
            Every evaluated metric is at or above its threshold.
          </sat-banner-message>
        </sat-banner>
      }

      <section class="bf-card" aria-labelledby="accuracy-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="accuracy-title">Latest result per feature and metric</h2>
        </div>
        @if (rows().length === 0) {
          <sat-empty-state data-testid="accuracy-empty">
            <h2 satEmptyStateHeadline>No evaluation has run yet</h2>
            <p satEmptyStateDescription>
              Run the evaluation sets to measure each feature against its threshold.
            </p>
          </sat-empty-state>
        } @else {
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="AI evaluation results">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Metric</th>
                  <th>Kind</th>
                  <th class="bf-num">Threshold</th>
                  <th class="bf-num">Result</th>
                  <th class="bf-num">Cases</th>
                  <th>Outcome</th>
                  <th>Failed cases</th>
                  <th>Run</th>
                </tr>
              </thead>
              <tbody>
                @for (r of rows(); track r.id) {
                  <tr
                    [class.bf-accuracy__row--failed]="!r.passed"
                    [attr.data-testid]="'accuracy-row-' + r.feature + '-' + r.metric"
                  >
                    <td>{{ r.feature }}</td>
                    <td>{{ metric(r) }}</td>
                    <td>{{ r.kind ?? '—' }}</td>
                    <td class="bf-num">{{ ratio(r.thresholdBps) }}</td>
                    <td class="bf-num">{{ ratio(r.resultBps) }}</td>
                    <td class="bf-num">{{ r.cases }}</td>
                    <td>
                      <sat-status-tag [status]="r.passed ? 'success' : 'important'">
                        {{ r.passed ? 'Pass' : 'Below threshold' }}
                      </sat-status-tag>
                    </td>
                    <td>
                      <span class="bf-cell__secondary">{{
                        r.failures.length ? r.failures.join(', ') : 'None'
                      }}</span>
                    </td>
                    <td>
                      <span class="bf-cell__primary">{{ r.provider }}</span>
                      <span class="bf-cell__secondary">
                        {{ r.modelId }} {{ r.modelVersion }} ·
                        <span data-testid="relative-time">{{
                          r.runAt | bfDateTime: session.timezone() : 'd MMM y, HH:mm'
                        }}</span>
                      </span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    }
  `,
  styles: `
    .bf-accuracy__row--failed td {
      background: var(--sat-sys-important-container);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccuracyPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly running = signal(false);

  protected readonly accuracy = resource({
    loader: () => data(this.api.getAiAccuracy({})),
  });
  protected readonly rows = computed(() => valueOf(this.accuracy)?.results ?? []);
  protected readonly failing = computed(() => this.rows().filter((r) => !r.passed));
  protected readonly failingNames = computed(() =>
    this.failing()
      .map((r) => `${r.feature} ${this.metric(r)}${r.kind ? ` (${r.kind})` : ''}`)
      .join(', '),
  );

  protected metric(r: AiEvaluationResult): string {
    return METRIC_LABELS[r.metric] ?? r.metric;
  }

  protected ratio(bps: number): string {
    return (bps / 10000).toFixed(2);
  }

  protected async run(): Promise<void> {
    this.running.set(true);
    try {
      const result = await data(this.api.runAiEvaluations({ body: {} }));
      this.accuracy.reload();
      this.snack.open(
        result.allPassed
          ? 'Evaluations finished: every metric is at or above its threshold.'
          : 'Evaluations finished: some metrics are below their threshold.',
        'Dismiss',
        { duration: 6000 },
      );
    } catch (error) {
      this.snack.open(errorMessage(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.running.set(false);
    }
  }
}
