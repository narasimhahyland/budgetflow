import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HEALTH_CHECKS, type BudgetHealthRow, type HealthLevel } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { BudgetStatus, DateTimePipe, Money } from '@bf/web/ui';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';
import { percentOf, Reconciliation, ScopeNote } from './report-frame';

type HealthCheck = BudgetHealthRow['reasons'][number]['check'];

const CHECK_LABELS: Record<HealthCheck, string> = {
  pace: 'Pace',
  forecast: 'Forecast',
  controls: 'Controls',
  hygiene: 'Hygiene',
  unused: 'Unused',
};
const LEVEL_LABELS: Record<HealthLevel, string> = {
  healthy: 'Healthy',
  watch: 'Watch',
  at_risk: 'At risk',
};

/**
 * Screen 013: budget health overview. Five written checks per budget, worst first, with the matrix
 * of where the problems sit. Every figure is the server's; the page only arranges them.
 */
@Component({
  selector: 'bf-budget-health-page',
  imports: [
    BudgetStatus,
    DateTimePipe,
    DecimalPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    Money,
    Reconciliation,
    RouterLink,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
    ScopeNote,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Budget health</h1>
        <p class="bf-page__subtitle">
          Five checks per budget — pace, forecast, controls, hygiene and unused money.
          @if (overview(); as o) {
            In {{ o.currency }} as of
            <span data-testid="relative-time"
              >{{ o.asOf }} · {{ o.generatedAt | bfDateTime: session.timezone() }}</span
            >
          }
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/reports">
          <mat-icon svgIcon="bar_chart" />All reports
        </a>
      </div>
    </header>

    <section class="bf-card" aria-labelledby="health-filters-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="health-filters-title">Filters</h2>
      </div>
      <div class="bf-filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Level</mat-label>
          <mat-select [ngModel]="level()" (ngModelChange)="setFilter('level', $event)">
            <mat-option [value]="''">Watch and at risk</mat-option>
            <mat-option value="watch">Watch only</mat-option>
            <mat-option value="at_risk">At risk only</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Check</mat-label>
          <mat-select [ngModel]="check()" (ngModelChange)="setFilter('check', $event)">
            <mat-option [value]="''">Any check</mat-option>
            @for (c of checks; track c) {
              <mat-option [value]="c">{{ checkLabel(c) }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
      <bf-scope-note
        [note]="overview()?.scope?.note ?? null"
        [label]="overview()?.scope?.label ?? ''"
        [budgetIds]="overview()?.scope?.budgetIds ?? 0"
      />
    </section>

    <bf-load-state
      [loading]="health.isLoading() && !health.hasValue()"
      [error]="health.error()"
      what="budget health"
      (retry)="health.reload()"
    />

    @if (overview(); as o) {
      <div class="bf-kpis" data-testid="health-summary">
        <div class="bf-kpi">
          <p class="bf-kpi__label">Budgets checked</p>
          <p class="bf-kpi__value">{{ o.summary.budgets | number }}</p>
        </div>
        <div class="bf-kpi bf-kpi--success">
          <p class="bf-kpi__label">Healthy</p>
          <p class="bf-kpi__value">{{ o.summary.healthy | number }}</p>
        </div>
        <div class="bf-kpi bf-kpi--warning">
          <p class="bf-kpi__label">Watch</p>
          <p class="bf-kpi__value">{{ o.summary.watch | number }}</p>
        </div>
        <div class="bf-kpi bf-kpi--error">
          <p class="bf-kpi__label">At risk</p>
          <p class="bf-kpi__value">{{ o.summary.atRisk | number }}</p>
        </div>
      </div>

      <section class="bf-card" aria-labelledby="matrix-title">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="matrix-title">Where the problems sit</h2>
            <p class="bf-card__hint">
              Budgets on watch and at risk per check, counted across each subtree.
            </p>
          </div>
        </div>
        <div class="bf-table-scroll">
          <table class="bf-split-table" aria-label="Health matrix">
            <thead>
              <tr>
                <th>Area</th>
                @for (c of checks; track c) {
                  <th class="bf-num" [title]="checkHint(c)">{{ checkLabel(c) }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of o.matrix; track row.key) {
                <tr>
                  <td>{{ row.label }}</td>
                  @for (c of checks; track c) {
                    <td class="bf-num">
                      @let cell = row.cells[c];
                      @if (cell && (cell.watch || cell.atRisk)) {
                        @if (cell.atRisk) {
                          <sat-status-tag status="important"
                            >{{ cell.atRisk }} at risk</sat-status-tag
                          >
                        }
                        @if (cell.watch) {
                          <sat-status-tag status="warning">{{ cell.watch }} watch</sat-status-tag>
                        }
                      } @else {
                        <span class="bf-clear">Clear</span>
                      }
                    </td>
                  }
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="checks.length + 1" class="bf-empty">
                    Nothing to show for this scope.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="bf-card" aria-labelledby="attention-title">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="attention-title">Budgets needing attention</h2>
            <p class="bf-card__hint">Worst first. Healthy budgets are not listed.</p>
          </div>
        </div>
        <bf-reconciliation [reconciliation]="o.reconciliation" />
        @if (o.rows.length) {
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Budgets needing attention">
              <thead>
                <tr>
                  <th>Budget</th>
                  <th>Health</th>
                  <th class="bf-num">Authorized</th>
                  <th class="bf-num">Committed</th>
                  <th class="bf-num">Actual</th>
                  <th class="bf-num">Available</th>
                  <th class="bf-num">Used</th>
                  <th class="bf-num">Pace</th>
                </tr>
              </thead>
              <tbody>
                @for (row of o.rows; track row.budgetId) {
                  <tr [attr.data-testid]="'health-row-' + row.budgetId">
                    <td>
                      <a class="bf-cell__primary" [routerLink]="['/budgets', row.budgetId]">{{
                        row.name
                      }}</a>
                      <span class="bf-cell__secondary">
                        {{ row.ownerName ?? 'No owner' }} ·
                        <bf-budget-status [status]="row.status" />
                      </span>
                    </td>
                    <td>
                      <sat-status-tag [status]="levelTone(row.level)">{{
                        levelLabel(row.level)
                      }}</sat-status-tag>
                      <ul class="bf-reasons">
                        @for (reason of row.reasons; track reason.check) {
                          <li [class]="'bf-reason--' + reason.level">
                            <strong>{{ checkLabel(reason.check) }}:</strong> {{ reason.text }}
                          </li>
                        }
                      </ul>
                    </td>
                    <td class="bf-num">
                      <bf-money
                        [amountMinor]="row.authorized.amountMinor"
                        [currency]="row.authorized.currency"
                      />
                    </td>
                    <td class="bf-num">
                      <bf-money
                        [amountMinor]="row.committed.amountMinor"
                        [currency]="row.committed.currency"
                      />
                    </td>
                    <td class="bf-num">
                      <bf-money
                        [amountMinor]="row.actual.amountMinor"
                        [currency]="row.actual.currency"
                      />
                    </td>
                    <td class="bf-num">
                      <bf-money
                        [amountMinor]="row.available.amountMinor"
                        [currency]="row.available.currency"
                      />
                    </td>
                    <td class="bf-num">{{ percentOf(row.utilizationBps) | number: '1.1-1' }}%</td>
                    <td class="bf-num">{{ percentOf(row.pacedToDateBps) | number: '1.1-1' }}%</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>Every budget you can see is healthy</h3>
            <p satEmptyStateDescription>
              Nothing is pacing ahead, frozen unexpectedly or sitting unused.
            </p>
          </sat-empty-state>
        }
      </section>
    }
  `,
  styles: `
    .bf-reasons {
      margin: 6px 0 0;
      padding: 0;
      list-style: none;
    }
    .bf-reasons li {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-reason--at_risk {
      color: var(--sat-sys-on-important-container);
    }
    .bf-reason--watch {
      color: var(--sat-sys-on-warning-container);
    }
    .bf-clear {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-kpi--success {
      border-color: var(--sat-sys-success-icon);
      background: var(--sat-sys-success-container);
      color: var(--sat-sys-on-success-container);
    }
    .bf-kpi--warning {
      border-color: var(--sat-sys-warning-icon);
      background: var(--sat-sys-warning-container);
      color: var(--sat-sys-on-warning-container);
    }
    .bf-kpi--error {
      border-color: var(--sat-sys-important-icon);
      background: var(--sat-sys-important-container);
      color: var(--sat-sys-on-important-container);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetHealthPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly percentOf = percentOf;
  protected readonly checks = HEALTH_CHECKS;

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly level = computed(() => this.query().get('level') ?? '');
  protected readonly check = computed(() => this.query().get('check') ?? '');

  protected readonly health = resource({
    params: () => ({ level: this.level(), check: this.check() }),
    loader: ({ params }) =>
      data(
        this.api.getBudgetHealth({
          query: {
            ...(params.level ? { level: params.level as HealthLevel } : {}),
            ...(params.check ? { check: params.check as HealthCheck } : {}),
          },
        }),
      ),
  });
  protected readonly overview = computed(() => valueOf(this.health));

  protected checkLabel(check: string): string {
    return CHECK_LABELS[check as HealthCheck] ?? check;
  }

  protected levelLabel(level: HealthLevel): string {
    return LEVEL_LABELS[level];
  }

  protected levelTone(level: HealthLevel): 'success' | 'warning' | 'important' {
    return level === 'at_risk' ? 'important' : level === 'watch' ? 'warning' : 'success';
  }

  protected checkHint(check: HealthCheck): string {
    const t = this.overview()?.thresholds;
    if (!t) return '';
    switch (check) {
      case 'pace':
        return `Watch above ${percentOf(t.paceWatchBps)}% of the phased amount to date, at risk above ${percentOf(t.paceAtRiskBps)}%.`;
      case 'forecast':
        return `Watch above ${percentOf(t.forecastWatchBps)}% forecast against authorized, at risk above ${percentOf(t.forecastAtRiskBps)}%.`;
      case 'hygiene':
        return `Commitments older than ${t.hygieneDays} days.`;
      case 'unused':
        return `Watch below ${percentOf(t.unusedWatchBps)}% used with ${t.unusedDaysLeft} days left.`;
      default:
        return 'Frozen, reduced and set-to-zero budgets.';
    }
  }

  protected rowKey(row: BudgetHealthRow): string {
    return row.budgetId;
  }

  protected setFilter(key: string, value: string): void {
    void this.router.navigate([], {
      queryParams: { [key]: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
