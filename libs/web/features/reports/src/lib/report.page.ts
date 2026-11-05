import { DecimalPipe } from '@angular/common';
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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BUDGET_STATUSES,
  REPORT_IDS,
  type ReportFilters,
  type ReportFormat,
  type ReportGroupBy,
  type ReportId,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { data, errorMessage, injectApi, valueOf } from './api';
import { DrilldownPanel } from './drilldown-panel';
import { LoadState } from './load-state';
import {
  percentOf,
  ReportChart,
  Reconciliation,
  ReportTable,
  ScopeNote,
  type DrillRequest,
  type ReportKpi,
} from './report-frame';

const GROUP_BY_LABELS: Record<ReportGroupBy, string> = {
  budget: 'Budget',
  location: 'Location',
  department: 'Department',
  legal_entity: 'Legal entity',
  cost_center: 'Cost center',
  category: 'Category',
  month: 'Month',
  status: 'Status',
  event: 'Event',
  none: 'No grouping',
};

const isReportId = (value: string | null): value is ReportId =>
  (REPORT_IDS as readonly string[]).includes(value ?? '');

/**
 * Screens 080-086 and 015a/015b: the nine Phase 10 reports in one frame. The server returns the
 * columns, the cells and the reconciliation; this page lays them out and never does money maths of
 * its own.
 */
@Component({
  selector: 'bf-report-page',
  imports: [
    DateTimePipe,
    DecimalPipe,
    DrilldownPanel,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    Money,
    Reconciliation,
    ReportChart,
    ReportTable,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    ScopeNote,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">{{ report()?.name ?? 'Report' }}</h1>
        <p class="bf-page__subtitle">
          {{ report()?.question }}
          @if (report(); as r) {
            · In {{ r.currency }} ·
            <span data-testid="relative-time">{{
              r.generatedAt | bfDateTime: session.timezone()
            }}</span>
          }
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/reports">
          <mat-icon svgIcon="arrow_left" />All reports
        </a>
        <button mat-stroked-button type="button" (click)="startSave()" [disabled]="!report()">
          <mat-icon svgIcon="bookmark" />Save this view
        </button>
        <button
          mat-stroked-button
          type="button"
          [matMenuTriggerFor]="exportMenu"
          [disabled]="!report()"
        >
          <mat-icon svgIcon="download" />Record an export
        </button>
        <mat-menu #exportMenu="matMenu">
          @for (format of formats(); track format) {
            <button mat-menu-item type="button" (click)="recordExport(format)">
              {{ format.toUpperCase() }}
            </button>
          }
        </mat-menu>
      </div>
    </header>

    @if (notice(); as text) {
      <sat-banner status="success" data-testid="report-notice">
        <span satBannerTitle>{{ text }}</span>
        <span satBannerDescription>
          Exports are recorded for audit and expire after 7 days. BudgetFlow does not produce a file
          yet — the figures stay on this screen and in
          <a routerLink="/reports/schedules">scheduled reports</a>.
        </span>
      </sat-banner>
    }
    @if (failure(); as text) {
      <sat-banner status="error" data-testid="report-failure">
        <span satBannerTitle>{{ text }}</span>
      </sat-banner>
    }

    <section class="bf-card" aria-labelledby="filters-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="filters-title">Filters</h2>
        @if (savedViews().length) {
          <div class="bf-views">
            @for (view of savedViews(); track view.id) {
              <button
                class="bf-view"
                type="button"
                [class.bf-view--active]="viewId() === view.id"
                (click)="applyView(view.id)"
              >
                @if (view.favourite) {
                  <mat-icon svgIcon="star" inline />
                }
                {{ view.name }}
              </button>
            }
          </div>
        }
      </div>
      <div class="bf-filters">
        @if (groupBys().length > 1) {
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Group by</mat-label>
            <mat-select [ngModel]="groupBy()" (ngModelChange)="setFilter('groupBy', $event)">
              @for (g of groupBys(); track g) {
                <mat-option [value]="g">{{ label(g) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Budget status</mat-label>
          <mat-select [ngModel]="status()" (ngModelChange)="setFilter('status', $event)">
            <mat-option [value]="''">Any status</mat-option>
            @for (s of statuses; track s) {
              <mat-option [value]="s">{{ statusLabel(s) }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Accounting date from</mat-label>
          <input
            matInput
            type="date"
            [ngModel]="periodFrom()"
            (ngModelChange)="setFilter('periodFrom', $event)"
          />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Accounting date to</mat-label>
          <input
            matInput
            type="date"
            [ngModel]="periodTo()"
            (ngModelChange)="setFilter('periodTo', $event)"
          />
        </mat-form-field>
        @if (rootBudgetId()) {
          <button mat-stroked-button type="button" (click)="setFilter('rootBudgetId', '')">
            <mat-icon svgIcon="clear_filter" aria-hidden="true" />Clear budget scope
          </button>
        }
      </div>
      <bf-scope-note
        [note]="report()?.scope?.note ?? null"
        [label]="report()?.scope?.label ?? ''"
        [budgetIds]="report()?.scope?.budgetIds ?? 0"
      />
    </section>

    @if (!reportId()) {
      <sat-404-error-state>
        <h2 satErrorStateHeadline>That report does not exist</h2>
        <p satErrorStateDescription>
          Pick one from <a routerLink="/reports">the report catalog</a>.
        </p>
      </sat-404-error-state>
    }

    @if (saving()) {
      <section class="bf-card" aria-labelledby="save-view-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="save-view-title">Save this view</h2>
          <p class="bf-card__hint">
            A saved view stores the filters only. The figures are recomputed every time it is
            opened.
          </p>
        </div>
        <div class="bf-form">
          <mat-form-field appearance="outline" class="bf-form__wide">
            <mat-label>View name</mat-label>
            <input matInput [(ngModel)]="viewName" maxlength="120" />
          </mat-form-field>
        </div>
        <div class="bf-form__actions">
          <button
            mat-flat-button
            type="button"
            [disabled]="busy() || !viewName().trim()"
            (click)="saveView()"
          >
            Save view
          </button>
          <button mat-stroked-button type="button" (click)="saving.set(false)">Cancel</button>
        </div>
      </section>
    }

    <bf-load-state
      [loading]="run.isLoading() && !run.hasValue()"
      [error]="run.error()"
      [what]="whatFailed()"
      (retry)="run.reload()"
    />

    @if (report(); as r) {
      @if (r.kpis.length) {
        <div class="bf-kpis">
          @for (kpi of r.kpis; track kpi.key) {
            <div class="bf-kpi" [class]="kpiClass(kpi)">
              <p class="bf-kpi__label">{{ kpi.label }}</p>
              <p class="bf-kpi__value">
                @if (kpi.money) {
                  <bf-money [amountMinor]="kpi.money.amountMinor" [currency]="kpi.money.currency" />
                } @else if (kpi.bps !== null && kpi.bps !== undefined) {
                  {{ percentOf(kpi.bps) | number: '1.1-1' }}%
                } @else if (kpi.number !== null && kpi.number !== undefined) {
                  {{ kpi.number | number }}
                } @else {
                  —
                }
              </p>
              @if (kpi.hint) {
                <p class="bf-kpi__delta">{{ kpi.hint }}</p>
              }
            </div>
          }
        </div>
      }

      <section class="bf-card" aria-labelledby="rows-title">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="rows-title">By {{ label(r.groupBy).toLowerCase() }}</h2>
            <p class="bf-card__hint">
              {{ r.rowCount }} row{{ r.rowCount === 1 ? '' : 's' }}. Every figure is in
              {{ r.currency }} and comes from the ledger.
            </p>
          </div>
        </div>
        @if (r.truncated) {
          <sat-banner class="bf-banner" status="warning">
            <span satBannerTitle>Showing the first {{ r.rows.length }} rows</span>
            <span satBannerDescription
              >Narrow the filters to see the rest. The totals below cover every row in scope.</span
            >
          </sat-banner>
        }
        <bf-reconciliation [reconciliation]="r.reconciliation" />
        @if (r.rows.length) {
          <bf-report-table
            [columns]="r.columns"
            [rows]="r.rows"
            [totals]="r.totals"
            [caption]="r.name"
            [timezone]="session.timezone()"
            (drill)="drill.set($event)"
          />
        } @else {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>Nothing to report yet</h3>
            <p satEmptyStateDescription>
              No budgets match these filters in what you can see. Clear a filter or widen the dates.
            </p>
          </sat-empty-state>
        }
      </section>

      @if (drill(); as request) {
        <bf-drilldown-panel
          [reportId]="r.reportId"
          [request]="request"
          (closed)="drill.set(null)"
        />
      }

      @if (r.series.length) {
        <section class="bf-card" aria-labelledby="chart-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="chart-title">At a glance</h2>
            <p class="bf-card__hint">The table above is the full, accessible version of this.</p>
          </div>
          <div class="bf-card__body">
            <bf-report-chart [series]="r.series" [currency]="r.currency" />
          </div>
        </section>
      }
    }
  `,
  styles: `
    .bf-views {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .bf-view {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface);
      cursor: pointer;
      font: var(--mat-sys-label-large);
    }
    .bf-view--active {
      border-color: var(--mat-sys-primary);
      background: var(--mat-sys-secondary-container);
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
    .bf-kpi--success {
      border-color: var(--sat-sys-success-icon);
      background: var(--sat-sys-success-container);
      color: var(--sat-sys-on-success-container);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly percentOf = percentOf;
  protected readonly statuses = BUDGET_STATUSES;

  /** Route param and query string as signals, so changing any filter re-runs the report. */
  private readonly pathParams = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  protected readonly reportId = computed<ReportId | null>(() => {
    const id = this.pathParams().get('reportId');
    return isReportId(id) ? id : null;
  });
  protected readonly groupBy = computed(() => this.query().get('groupBy') ?? '');
  protected readonly status = computed(() => this.query().get('status') ?? '');
  protected readonly periodFrom = computed(() => this.query().get('periodFrom') ?? '');
  protected readonly periodTo = computed(() => this.query().get('periodTo') ?? '');
  protected readonly rootBudgetId = computed(() => this.query().get('rootBudgetId') ?? '');
  protected readonly viewId = computed(() => this.query().get('viewId') ?? '');

  protected readonly catalog = resource({ loader: () => data(this.api.getReportCatalog({})) });
  protected readonly definition = computed(() =>
    valueOf(this.catalog)?.reports.find((r) => r.reportId === this.reportId()),
  );
  protected readonly groupBys = computed(() => this.definition()?.groupBys ?? []);
  protected readonly formats = computed<readonly ReportFormat[]>(
    () => this.definition()?.formats ?? ['csv'],
  );
  protected readonly savedViews = computed(() =>
    (valueOf(this.catalog)?.savedViews ?? []).filter((v) => v.reportId === this.reportId()),
  );

  protected readonly run = resource({
    params: () => {
      const reportId = this.reportId();
      return reportId ? { reportId, filters: this.filters() } : undefined;
    },
    loader: ({ params }) =>
      data(this.api.runReport({ params: { reportId: params.reportId }, query: params.filters })),
  });
  protected readonly report = computed(() => valueOf(this.run));
  protected readonly drill = signal<DrillRequest | null>(null);

  protected readonly saving = signal(false);
  protected readonly viewName = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected readonly whatFailed = computed(
    () => `the ${this.definition()?.name.toLowerCase() ?? 'report'} report`,
  );

  private filters(): ReportFilters {
    const f: ReportFilters = {};
    const groupBy = this.groupBy();
    if (groupBy) f.groupBy = groupBy as ReportGroupBy;
    const status = this.status();
    if (status) f.status = status as ReportFilters['status'];
    if (this.periodFrom()) f.periodFrom = this.periodFrom();
    if (this.periodTo()) f.periodTo = this.periodTo();
    if (this.rootBudgetId()) f.rootBudgetId = this.rootBudgetId();
    return f;
  }

  protected label(groupBy: ReportGroupBy): string {
    return GROUP_BY_LABELS[groupBy] ?? groupBy;
  }

  protected statusLabel(status: string): string {
    return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  }

  protected kpiClass(kpi: ReportKpi): string {
    return kpi.tone && kpi.tone !== 'neutral' && kpi.tone !== 'info' ? `bf-kpi--${kpi.tone}` : '';
  }

  protected setFilter(key: string, value: string): void {
    this.drill.set(null);
    void this.router.navigate([], {
      queryParams: { [key]: value || null, viewId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected applyView(viewId: string): void {
    const view = this.savedViews().find((v) => v.id === viewId);
    if (!view) return;
    this.drill.set(null);
    void this.router.navigate([], {
      queryParams: {
        viewId,
        groupBy: view.filters.groupBy ?? null,
        status: view.filters.status ?? null,
        periodFrom: view.filters.periodFrom ?? null,
        periodTo: view.filters.periodTo ?? null,
        rootBudgetId: view.filters.rootBudgetId ?? null,
      },
      replaceUrl: true,
    });
  }

  protected startSave(): void {
    this.viewName.set(this.definition()?.name ?? 'My view');
    this.saving.set(true);
  }

  protected async saveView(): Promise<void> {
    const reportId = this.reportId();
    if (!reportId) return;
    await this.act(async () => {
      const view = await data(
        this.api.createSavedView({
          body: { reportId, name: this.viewName().trim(), filters: this.filters() },
        }),
      );
      this.saving.set(false);
      this.notice.set(`Saved “${view.name}”. It stores the filters, not the figures.`);
      this.catalog.reload();
    });
  }

  protected async recordExport(format: ReportFormat): Promise<void> {
    const reportId = this.reportId();
    if (!reportId) return;
    await this.act(async () => {
      const record = await data(
        this.api.createReportExport({
          params: { reportId },
          body: { format, filters: this.filters() },
        }),
      );
      this.notice.set(
        `${record.format.toUpperCase()} export recorded for ${record.rowCount} rows.`,
      );
    });
  }

  private async act(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
