import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ALERT_KINDS,
  type AlertKind,
  type AlertSeverity,
  type AlertTab,
  type BudgetAlert,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState } from '@bf/web/ui';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from '../api';
import { ScopeNote } from '../report-frame';

const KIND_LABELS: Record<AlertKind, string> = {
  threshold: 'Threshold crossed',
  hard_block: 'Hard block',
  pace: 'Pace ahead of plan',
  forecast: 'Forecast overrun',
  lapse: 'Money at risk of lapsing',
  frozen: 'Frozen',
  set_to_zero: 'Set to zero',
  approvals_overdue: 'Approvals past SLA',
  stale_commitments: 'Stale commitments',
};
const SEVERITY_LABELS: Record<AlertSeverity, string> = {
  hard_block: 'Hard block',
  warning: 'Warning',
  information: 'Information',
};
const TABS: { tab: AlertTab; label: string }[] = [
  { tab: 'open', label: 'Open' },
  { tab: 'acknowledged', label: 'Acknowledged' },
  { tab: 'resolved', label: 'Resolved (last 30 days)' },
];

/**
 * Screen 017: every alert on the budgets the viewer is responsible for, with what it means and the
 * one action that resolves it. Alerts are derived by the API on every read, so they resolve
 * themselves when the condition clears; acknowledging or snoozing only records that you saw it.
 */
@Component({
  selector: 'bf-alerts-page',
  imports: [
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    RouterLink,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
    SatStatusTag,
    ScopeNote,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Alerts</h1>
        <p class="bf-page__subtitle">
          Thresholds, controls, pace, forecasts, lapsing money and overdue approvals on your
          budgets.
          @if (overview(); as o) {
            As of
            <span data-testid="relative-time">{{
              o.generatedAt | bfDateTime: session.timezone()
            }}</span>
          }
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/reports/health"
          ><mat-icon svgIcon="graph_radial" />Budget health</a
        >
      </div>
    </header>

    <sat-navigation-tabs aria-label="Alert status">
      @for (t of tabs; track t.tab) {
        <a
          satNavigationTab
          routerLink="."
          [queryParams]="{ tab: t.tab === 'open' ? null : t.tab }"
          queryParamsHandling="merge"
          [active]="tab() === t.tab"
          >{{ t.label }}
          @if (overview(); as o) {
            ({{ o.counts[t.tab] }})
          }
        </a>
      }
    </sat-navigation-tabs>

    <section class="bf-card" aria-labelledby="alert-filters-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="alert-filters-title">Filters</h2>
      </div>
      <div class="bf-filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Alert type</mat-label>
          <mat-select [ngModel]="kind()" (ngModelChange)="setFilter('kind', $event)">
            <mat-option [value]="''">Any type</mat-option>
            @for (k of kinds; track k) {
              <mat-option [value]="k">{{ kindLabel(k) }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Severity</mat-label>
          <mat-select [ngModel]="severity()" (ngModelChange)="setFilter('severity', $event)">
            <mat-option [value]="''">Any severity</mat-option>
            <mat-option value="hard_block">Hard block</mat-option>
            <mat-option value="warning">Warning</mat-option>
            <mat-option value="information">Information</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-checkbox
          [ngModel]="ownedOnly()"
          (ngModelChange)="setFilter('owned', $event ? 'true' : '')"
          >Only budgets I own</mat-checkbox
        >
      </div>
      <bf-scope-note
        [note]="overview()?.scope?.note ?? null"
        [label]="overview()?.scope?.label ?? ''"
        [budgetIds]="overview()?.scope?.budgetIds ?? 0"
      />
    </section>

    <bf-load-state
      [loading]="alerts.isLoading() && !alerts.hasValue()"
      [error]="alerts.error()"
      what="alerts"
      shape="cards"
      [lines]="3"
      (retry)="alerts.reload()"
    />

    @if (overview(); as o) {
      @if (tab() === 'open') {
        <p class="bf-severity" data-testid="severity-summary">
          <sat-status-tag status="important">Hard block {{ o.severity.hardBlock }}</sat-status-tag>
          <sat-status-tag status="warning">Warning {{ o.severity.warning }}</sat-status-tag>
          <sat-status-tag status="info">Information {{ o.severity.information }}</sat-status-tag>
        </p>
      }
      @if (problem(); as p) {
        <p class="bf-error-text" role="alert">{{ p }}</p>
      }
      <ul class="bf-alerts" aria-label="Alerts">
        @for (a of o.items; track a.key) {
          <li
            class="bf-alert"
            [class]="'bf-alert bf-alert--' + a.tone"
            [class.bf-alert--quiet]="tab() !== 'open'"
            [attr.data-testid]="'alert-' + a.key"
          >
            <div class="bf-alert__head">
              <sat-status-tag [status]="severityTone(a)">{{
                severityLabel(a.severity)
              }}</sat-status-tag>
              @if (a.kind === 'frozen') {
                <mat-icon svgIcon="lock" aria-label="Frozen" />
              }
              <span class="bf-cell__secondary">{{ kindLabel(a.kind) }}</span>
            </div>
            <p class="bf-alert__text">{{ a.text }}</p>
            <p class="bf-cell__secondary">
              <a [routerLink]="['/budgets', a.budgetId]">{{ a.budgetName }}</a> ·
              {{ a.ownerName ?? 'No owner' }} · {{ a.rule }}
            </p>
            @if (a.acknowledgedAt) {
              <p class="bf-cell__secondary">
                You acknowledged this {{ a.acknowledgedAt | bfDateTime: session.timezone() }}.
              </p>
            }
            @if (a.snoozedUntil) {
              <p class="bf-cell__secondary">
                Snoozed until {{ a.snoozedUntil | bfDateTime: session.timezone() }}.
              </p>
            }
            @if (a.resolvedAt) {
              <p class="bf-cell__secondary">
                Last seen by you {{ a.resolvedAt | bfDateTime: session.timezone() }}.
              </p>
            }
            <div class="bf-alert__actions">
              <a mat-flat-button [routerLink]="a.action.link">{{ a.action.label }}</a>
              @if (tab() === 'open') {
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="busy() === a.key"
                  (click)="decide(a, 'acknowledge')"
                >
                  Acknowledge
                </button>
                @if (a.snoozable) {
                  <button
                    mat-button
                    type="button"
                    [disabled]="busy() === a.key"
                    (click)="decide(a, 'snooze')"
                  >
                    Snooze 7 days
                  </button>
                }
              }
            </div>
          </li>
        } @empty {
          <li>
            <sat-empty-state>
              <h3 satEmptyStateHeadline>{{ emptyTitle() }}</h3>
              <p satEmptyStateDescription>{{ emptyText() }}</p>
            </sat-empty-state>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .bf-severity {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0;
    }
    .bf-alerts {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .bf-alert {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-left-width: 4px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-lowest);
    }
    .bf-alert--error {
      border-left-color: var(--mat-sys-error);
      background: var(--mat-sys-error-container);
    }
    .bf-alert--warning {
      border-left-color: var(--sat-sys-warning-icon);
    }
    .bf-alert--info {
      border-left-color: var(--sat-sys-info-icon);
    }
    .bf-alert--important {
      border-left-color: var(--sat-sys-important-icon);
    }
    .bf-alert--quiet {
      background: var(--mat-sys-surface-container);
    }
    .bf-alert__head {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .bf-alert__text {
      margin: 0;
      font: var(--mat-sys-title-small);
    }
    .bf-alert__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .bf-error-text {
      color: var(--mat-sys-error);
    }
    .bf-cell__secondary {
      margin: 0;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertsPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  protected readonly tabs = TABS;
  protected readonly kinds = ALERT_KINDS;
  protected readonly busy = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly tab = computed<AlertTab>(() => {
    const t = this.query().get('tab');
    return t === 'acknowledged' || t === 'resolved' ? t : 'open';
  });
  protected readonly kind = computed(() => this.query().get('kind') ?? '');
  protected readonly severity = computed(() => this.query().get('severity') ?? '');
  protected readonly ownedOnly = computed(() => this.query().get('owned') === 'true');

  protected readonly alerts = resource({
    params: () => ({
      tab: this.tab(),
      kind: this.kind(),
      severity: this.severity(),
      owned: this.ownedOnly(),
    }),
    loader: ({ params }) =>
      data(
        this.api.getAlerts({
          query: {
            ...(params.tab !== 'open' ? { tab: params.tab } : {}),
            ...(params.kind ? { kind: params.kind as AlertKind } : {}),
            ...(params.severity ? { severity: params.severity as AlertSeverity } : {}),
            ...(params.owned ? { ownedOnly: 'true' as const } : {}),
          },
        }),
      ),
  });
  protected readonly overview = computed(() => valueOf(this.alerts));

  protected readonly emptyTitle = computed(() =>
    this.tab() === 'open'
      ? 'No alerts on your budgets'
      : this.tab() === 'acknowledged'
        ? 'Nothing acknowledged'
        : 'Nothing resolved in the last 30 days',
  );
  protected readonly emptyText = computed(() =>
    this.tab() === 'open'
      ? 'Every budget you are responsible for is within its thresholds and controls.'
      : this.tab() === 'acknowledged'
        ? 'Alerts you acknowledge or snooze appear here while their condition holds.'
        : 'Alerts you acknowledged whose condition has since cleared appear here.',
  );

  protected kindLabel(k: string): string {
    return KIND_LABELS[k as AlertKind] ?? k;
  }

  protected severityLabel(s: AlertSeverity): string {
    return SEVERITY_LABELS[s];
  }

  protected severityTone(a: BudgetAlert): 'important' | 'warning' | 'info' {
    return a.severity === 'hard_block'
      ? 'important'
      : a.severity === 'warning'
        ? 'warning'
        : 'info';
  }

  protected setFilter(key: string, value: string): void {
    void this.router.navigate([], {
      queryParams: { [key]: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected async decide(a: BudgetAlert, decision: 'acknowledge' | 'snooze'): Promise<void> {
    this.busy.set(a.key);
    this.problem.set(null);
    try {
      await data(this.api.decideAlert({ body: { key: a.key, decision } }));
      this.snack.open(
        decision === 'snooze' ? 'Alert snoozed for 7 days.' : 'Alert acknowledged.',
        undefined,
        { duration: 4000 },
      );
      this.alerts.reload();
    } catch (e) {
      this.problem.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }
}
