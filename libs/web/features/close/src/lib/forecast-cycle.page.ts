import { DatePipe, DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { ForecastCycleDetail, ForecastSubmission } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { percentOfBps } from './close-format';
import {
  CloseForecastCycleDialog,
  RequestCommentaryDialog,
  SubmitForecastDialog,
} from './forecast-dialogs';
import {
  CYCLE_STATUS,
  DIRECTION_WORDS,
  FORECAST_STATUS,
  METHOD_LABELS,
  PROGRESS_SEGMENTS,
} from './forecast-format';
import { CloseTag } from './close-tag';

/**
 * Screen 87a, cycle monitor and owner submission. Every action on this page comes from the API's
 * `allowedActions` for the viewer, never from a role read in the browser: finance sees Accept and
 * Ask for commentary, an owner sees Forecast on their own lines, and a closed cycle offers nothing.
 *
 * The forecast column is hatched and labelled wherever it appears, so a projection never reads like
 * the committed and actual money beside it, and the variance direction is the word the API wrote.
 */
@Component({
  selector: 'bf-forecast-cycle-page',
  imports: [
    CloseTag,
    DatePipe,
    DecimalPipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatImportantButton,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <a class="bf-back" routerLink="/finance/forecast-cycles">All forecast cycles</a>
        <div class="bf-title-row">
          <h1 class="bf-page__title">{{ cycle()?.name ?? 'Forecast cycle' }}</h1>
          @if (cycle(); as c) {
            <bf-close-tag [tag]="cycleStatus(c.status)" />
          }
        </div>
        @if (cycle(); as c) {
          <p class="bf-page__subtitle">
            As of {{ c.asOfDate | date: 'd MMM y' : 'UTC' }} · due
            {{ c.dueDate | date: 'd MMM y' : 'UTC' }} · {{ c.scopeLabel }} · figures in
            {{ c.currency }}
          </p>
        }
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/reports/forecast-variance">
          <mat-icon svgIcon="bar_chart" />Forecast and variance report
        </a>
        @if (can('close') && cycle(); as c) {
          <button
            mat-flat-button
            satImportantButton
            type="button"
            [disabled]="busy()"
            (click)="closeCycle()"
            data-testid="close-cycle"
          >
            Close cycle
          </button>
        }
      </div>
    </header>

    @if (notice(); as text) {
      <sat-banner variant="success" data-testid="cycle-notice">
        <sat-banner-message>{{ text }}</sat-banner-message>
      </sat-banner>
    }
    @if (failure(); as text) {
      <sat-banner variant="important" data-testid="cycle-failure">
        <sat-banner-message>{{ text }}</sat-banner-message>
      </sat-banner>
    }

    <bf-load-state
      [loading]="detail.isLoading() && !detail.hasValue()"
      [error]="detail.error()"
      what="this forecast cycle"
      (retry)="detail.reload()"
    />

    @if (view(); as d) {
      @if (d.cycle.status === 'closed') {
        <sat-banner variant="info" data-testid="cycle-closed">
          <sat-banner-message>
            <strong
              >Closed{{
                d.cycle.closedAt ? ' on ' + (d.cycle.closedAt | date: 'd MMM y') : ''
              }}.</strong
            >
            This snapshot cannot change. The forecast and variance report and the board pack read it
            as it stands.
          </sat-banner-message>
        </sat-banner>
      } @else if (d.cycle.progress.overdue) {
        <sat-banner variant="warning" data-testid="cycle-overdue">
          <sat-banner-message>
            <strong
              >{{ d.cycle.progress.overdue }}
              {{ d.cycle.progress.overdue === 1 ? 'line is' : 'lines are' }} overdue.</strong
            >
            They were due on {{ d.cycle.dueDate | date: 'd MMM y' : 'UTC' }}. Closing the cycle
            fills them with the system run-rate forecast.
          </sat-banner-message>
        </sat-banner>
      }

      @if (d.scope.note) {
        <sat-banner variant="info" data-testid="cycle-scope-note">
          <sat-banner-message
            ><strong>{{ d.scope.note }}</strong> {{ d.scope.label }} · {{ d.scope.budgetIds }}
            {{ d.scope.budgetIds === 1 ? 'budget' : 'budgets' }} in scope.</sat-banner-message
          >
        </sat-banner>
      }

      <div class="bf-kpis">
        <div class="bf-kpi">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Authorized</p>
            <mat-icon class="bf-kpi__icon" svgIcon="currency_dollar" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value">
            <bf-money
              [amountMinor]="d.totals.authorized.amountMinor"
              [currency]="d.totals.authorized.currency"
            />
          </p>
        </div>
        <div class="bf-kpi">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Actual to date</p>
            <mat-icon class="bf-kpi__icon" svgIcon="check_double" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value">
            <bf-money
              [amountMinor]="d.totals.actualToDate.amountMinor"
              [currency]="d.totals.actualToDate.currency"
            />
          </p>
        </div>
        <div class="bf-kpi">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Committed</p>
            <mat-icon class="bf-kpi__icon" svgIcon="shield_lock" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value">
            <bf-money
              [amountMinor]="d.totals.committed.amountMinor"
              [currency]="d.totals.committed.currency"
            />
          </p>
        </div>
        <div class="bf-kpi bf-kpi--forecast">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Forecast at year end</p>
            <mat-icon class="bf-kpi__icon" svgIcon="trending_up" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value">
            <bf-money
              [amountMinor]="d.totals.forecast.amountMinor"
              [currency]="d.totals.forecast.currency"
            />
          </p>
          <p class="bf-kpi__delta">A projection. Never posted, never consumes budget.</p>
        </div>
        <div class="bf-kpi">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Variance against authorized</p>
            <mat-icon class="bf-kpi__icon" svgIcon="compare" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value">
            <bf-money
              [amountMinor]="d.totals.variance.amountMinor"
              [currency]="d.totals.variance.currency"
            />
          </p>
          <p class="bf-kpi__delta">{{ percent(d.totals.varianceBps) }} of authorized</p>
        </div>
      </div>

      <section class="bf-card" aria-labelledby="progress-title">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="progress-title">Where the cycle stands</h2>
            <p class="bf-card__hint">
              {{ d.cycle.progress.budgets }}
              {{ d.cycle.progress.budgets === 1 ? 'line' : 'lines' }} in scope.
            </p>
          </div>
        </div>
        <div class="bf-card__body">
          <div class="bf-progress" role="img" [attr.aria-label]="progressLabel()">
            @for (s of segments(); track s.key) {
              @if (s.count) {
                <span
                  class="bf-progress__fill"
                  [class]="'bf-progress__fill--' + s.key"
                  [style.width.%]="s.share"
                ></span>
              }
            }
          </div>
          <ul class="bf-legend">
            @for (s of segments(); track s.key) {
              <li>
                <span class="bf-legend__swatch" [class]="'bf-progress__fill--' + s.key"></span>
                {{ s.label }}: {{ s.count | number }}
              </li>
            }
          </ul>
        </div>
        <p class="bf-reconcile" data-testid="cycle-reconciliation">
          @if (d.reconciliation.ties) {
            Authorized, actual and committed tie to the ledger across
            {{ d.reconciliation.budgetsCounted }}
            {{ d.reconciliation.budgetsCounted === 1 ? 'budget' : 'budgets' }}. The forecast is not
            in this check: a forecast has no ledger bucket to tie to.
          }
        </p>
        @if (!d.reconciliation.ties) {
          <sat-banner class="bf-banner" variant="important" data-testid="cycle-reconcile-broken">
            <sat-banner-message>
              <strong>These figures do not tie to the ledger.</strong> The cycle disagrees with the
              ledger buckets for {{ d.reconciliation.differences.length }} figure{{
                d.reconciliation.differences.length === 1 ? '' : 's'
              }}. Treat them as unverified and tell finance before you use them.
            </sat-banner-message>
          </sat-banner>
        }
      </section>

      <section class="bf-card" aria-labelledby="lines-title">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="lines-title">Budgets and events</h2>
            <p class="bf-card__hint">
              Ordered by name then id, so a line never moves between two reads.
            </p>
          </div>
        </div>
        @if (d.submissions.length) {
          <div class="bf-table-scroll">
            <table
              mat-table
              class="bf-table"
              [dataSource]="d.submissions"
              aria-label="Forecast lines"
            >
              <ng-container matColumnDef="line">
                <th mat-header-cell *matHeaderCellDef>Budget or event</th>
                <td mat-cell *matCellDef="let s">
                  <span class="bf-cell__primary">{{ s.budgetName ?? s.eventName }}</span>
                  <span class="bf-cell__secondary">{{ s.ownerName ?? 'No owner' }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="authorized">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Authorized</th>
                <td mat-cell *matCellDef="let s" class="bf-num">
                  <bf-money
                    [amountMinor]="s.authorized.amountMinor"
                    [currency]="s.authorized.currency"
                  />
                </td>
              </ng-container>
              <ng-container matColumnDef="actual">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Actual to date</th>
                <td mat-cell *matCellDef="let s" class="bf-num">
                  <bf-money
                    [amountMinor]="s.actualToDate.amountMinor"
                    [currency]="s.actualToDate.currency"
                  />
                </td>
              </ng-container>
              <ng-container matColumnDef="committed">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Committed</th>
                <td mat-cell *matCellDef="let s" class="bf-num">
                  <bf-money
                    [amountMinor]="s.committed.amountMinor"
                    [currency]="s.committed.currency"
                  />
                </td>
              </ng-container>
              <ng-container matColumnDef="forecast">
                <th mat-header-cell *matHeaderCellDef class="bf-num bf-cell--forecast">
                  Forecast at year end
                  <span class="bf-forecast-mark">Forecast, not actual</span>
                </th>
                <td mat-cell *matCellDef="let s" class="bf-num bf-cell--forecast">
                  <bf-money
                    [amountMinor]="s.forecast.amountMinor"
                    [currency]="s.forecast.currency"
                  />
                  <span class="bf-cell__secondary">{{ method(s) }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="variance">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Variance</th>
                <td mat-cell *matCellDef="let s" class="bf-num">
                  <bf-money
                    [amountMinor]="s.variance.amountMinor"
                    [currency]="s.variance.currency"
                  />
                  <span class="bf-cell__secondary" [attr.data-testid]="'direction-' + lineKey(s)">
                    @if (s.authorized.amountMinor > 0) {
                      {{ percent(s.varianceBps) }} {{ direction(s) }}
                    } @else {
                      {{ direction(s) }}, nothing authorized
                    }
                  </span>
                </td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let s">
                  <span class="bf-tag-cell"><bf-close-tag [tag]="lineStatus(s)" /></span>
                  @if (s.systemGenerated) {
                    <span class="bf-tag-cell"
                      ><sat-status-tag status="neutral">System</sat-status-tag></span
                    >
                  }
                  @if (s.commentary) {
                    <span class="bf-cell__secondary">“{{ s.commentary }}”</span>
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef>Actions</th>
                <td mat-cell *matCellDef="let s">
                  <span class="bf-row-actions">
                    @if (can('submit') && s.status !== 'accepted' && s.status !== 'superseded') {
                      <button
                        mat-stroked-button
                        type="button"
                        [disabled]="busy()"
                        (click)="forecast(s)"
                        [attr.data-testid]="'forecast-' + lineKey(s)"
                      >
                        Forecast
                      </button>
                    }
                    @if (can('accept') && s.status === 'submitted') {
                      <button
                        mat-button
                        type="button"
                        [disabled]="busy()"
                        (click)="accept(s)"
                        [attr.data-testid]="'accept-' + lineKey(s)"
                      >
                        Accept
                      </button>
                    }
                    @if (can('request_commentary') && s.status === 'submitted') {
                      <button
                        mat-button
                        type="button"
                        [disabled]="busy()"
                        (click)="askForCommentary(s)"
                        [attr.data-testid]="'ask-' + lineKey(s)"
                      >
                        Ask for commentary
                      </button>
                    }
                  </span>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns()"></tr>
              <tr mat-row *matRowDef="let row; columns: columns()"></tr>
            </table>
          </div>
        } @else {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>Nothing in this cycle for you</h3>
            <p satEmptyStateDescription>
              The cycle covers no budget you can see. Finance can widen its scope.
            </p>
          </sat-empty-state>
        }
      </section>
    }
  `,
  styles: `
    .bf-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      margin: 10px 0 0;
      padding: 0;
      list-style: none;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-legend li {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .bf-legend__swatch {
      width: 12px;
      height: 12px;
      border-radius: var(--mat-sys-corner-extra-small);
    }
    .bf-progress__fill--accepted {
      background: var(--sat-sys-success-icon);
    }
    .bf-progress__fill--submitted {
      background: var(--mat-sys-primary);
    }
    .bf-progress__fill--commentaryRequired {
      background: var(--sat-sys-warning-icon);
    }
    .bf-progress {
      background: var(--mat-sys-surface-container);
    }
    /* Five figures of up to "USD 103,000.00" at the section 9 size: bf-money never wraps. */
    .bf-kpis {
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    }
    /* Row actions stay on one line: the primary action outlined, the others as text buttons. */
    .bf-row-actions {
      flex-wrap: nowrap;
      gap: 4px;
    }
    .bf-progress__fill--draft {
      background: var(--mat-sys-secondary-container);
      box-shadow: inset 0 0 0 1px var(--mat-sys-primary);
    }
    /* Not started must still be visible against the track, as a segment and as a swatch. */
    .bf-progress__fill--notStarted {
      background: var(--mat-sys-outline-variant);
    }
    /* A forecast is a projection: hatched, so it never reads like committed or actual money. */
    .bf-cell--forecast {
      background: repeating-linear-gradient(
        135deg,
        transparent 0 5px,
        var(--mat-sys-surface-container-high) 5px 7px
      );
    }
    .bf-kpi--forecast {
      background: repeating-linear-gradient(
        135deg,
        var(--mat-sys-surface-container-lowest) 0 5px,
        var(--mat-sys-surface-container-high) 5px 7px
      );
    }
    .bf-forecast-mark {
      display: block;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
    }
    .bf-reconcile {
      margin: 0;
      padding: 0 20px 16px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForecastCyclePage {
  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionStore);
  protected readonly percent = percentOfBps;

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  protected readonly cycleId = computed(() => this.params().get('cycleId') ?? '');

  protected readonly detail = resource({
    params: () => ({ cycleId: this.cycleId() }),
    loader: ({ params }) =>
      data(this.api.getForecastCycle({ params: { cycleId: params.cycleId } })),
  });
  /** A decision or a submission answers with the whole cycle, so the screen shows that answer. */
  private readonly latest = signal<ForecastCycleDetail | null>(null);
  protected readonly view = computed(() => this.latest() ?? valueOf(this.detail));
  protected readonly cycle = computed(() => this.view()?.cycle);

  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected readonly columns = computed(() => {
    const base = ['line', 'authorized', 'actual', 'committed', 'forecast', 'variance', 'status'];
    return this.view()?.allowedActions.length ? [...base, 'actions'] : base;
  });

  protected readonly segments = computed(() => {
    const p = this.view()?.cycle.progress;
    const total = Math.max(1, p?.budgets ?? 0);
    return PROGRESS_SEGMENTS.map((s) => {
      const count = p?.[s.key] ?? 0;
      return { ...s, count, share: (count / total) * 100 };
    });
  });
  protected readonly progressLabel = computed(() =>
    this.segments()
      .map((s) => `${s.label}: ${s.count}`)
      .join(', '),
  );

  protected can(action: ForecastCycleDetail['allowedActions'][number]): boolean {
    return this.view()?.allowedActions.includes(action) ?? false;
  }

  protected cycleStatus(status: 'open' | 'closed') {
    return CYCLE_STATUS[status];
  }

  protected lineStatus(s: ForecastSubmission) {
    return FORECAST_STATUS[s.status];
  }

  /**
   * A line nobody has saved yet has no snapshot, and so no id of its own; the budget or event it
   * covers is what identifies it on the screen.
   */
  protected lineKey(s: ForecastSubmission): string {
    return s.budgetId ?? s.eventId ?? s.id;
  }

  protected method(s: ForecastSubmission): string {
    return METHOD_LABELS[s.method];
  }

  /** The API writes the direction out, so the sign and the colour are never the only signal. */
  protected direction(s: ForecastSubmission): string {
    return DIRECTION_WORDS[s.varianceDirection];
  }

  protected forecast(line: ForecastSubmission): void {
    const cycle = this.cycle();
    if (!cycle) return;
    const ref = this.dialog.open(SubmitForecastDialog, {
      data: { cycle, line },
      width: '860px',
      maxHeight: '90vh',
    });
    ref.afterClosed().subscribe((submission?: ForecastSubmission) => {
      if (!submission) return;
      this.notice.set(
        submission.status === 'draft'
          ? `Draft saved for ${submission.budgetName ?? submission.eventName}.`
          : `Forecast submitted for ${submission.budgetName ?? submission.eventName}.`,
      );
      this.reload();
    });
  }

  protected askForCommentary(line: ForecastSubmission): void {
    const ref = this.dialog.open(RequestCommentaryDialog, {
      data: { cycleId: this.cycleId(), line },
      width: '560px',
    });
    ref.afterClosed().subscribe((submission?: ForecastSubmission) => {
      if (!submission) return;
      this.notice.set(`Sent back to ${submission.ownerName ?? 'the owner'} for commentary.`);
      this.reload();
    });
  }

  protected async accept(line: ForecastSubmission): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      const submission = await data(
        this.api.decideForecast({
          params: { cycleId: this.cycleId(), submissionId: line.id },
          body: { decision: 'accept' },
        }),
      );
      this.notice.set(`Accepted ${submission.budgetName ?? submission.eventName}.`);
      this.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected closeCycle(): void {
    const cycle = this.cycle();
    if (!cycle) return;
    const ref = this.dialog.open(CloseForecastCycleDialog, { data: { cycle }, width: '560px' });
    ref.afterClosed().subscribe((detail?: ForecastCycleDetail) => {
      if (!detail) return;
      this.latest.set(detail);
      this.notice.set(`${detail.cycle.name} is closed. Its snapshot cannot change now.`);
    });
  }

  private reload(): void {
    this.latest.set(null);
    this.detail.reload();
  }
}
