import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  BUDGET_STATUSES,
  FORECAST_METHODS,
  REPORT_IDS,
  type ForecastMethod,
  type ReportFilters,
  type ReportFormat,
  type ReportGroupBy,
  type ReportId,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { data, errorMessage, injectApi, startDownload, valueOf } from './api';
import { DrilldownPanel } from './drilldown-panel';
import {
  percentOf,
  ReportBucketBars,
  ReportChart,
  ReportKpis,
  ReportNotes,
  Reconciliation,
  ReportTable,
  ScopeNote,
  type DrillRequest,
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

const FORMAT_LABELS: Record<ReportFormat, string> = {
  csv: 'CSV file',
  xlsx: 'Excel workbook (XLSX)',
  pdf: 'PDF document',
};

const METHOD_LABELS: Record<ForecastMethod, string> = {
  run_rate: 'Run-rate',
  committed_pipeline: 'Committed plus pipeline',
  owner_input: 'Owner input',
};

/** 087 only: the columns holding a projection, so the frame can mark them as not-yet-spent money. */
const FORECAST_COLUMNS = ['forecast', 'previousForecast', 'change'];
/** 087 only: the owner's explanation is a sentence and needs room, not a label-width column. */
const PROSE_COLUMNS = ['commentary'];

/**
 * Screens 080-087 and 015a/015b: the Phase 10 and 11 reports in one frame. The server returns the
 * columns, the cells, the notes and the reconciliation; this page lays them out and never does money
 * maths of its own.
 */
@Component({
  selector: 'bf-report-page',
  imports: [
    DateTimePipe,
    DrilldownPanel,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
    Reconciliation,
    ReportBucketBars,
    ReportChart,
    ReportKpis,
    ReportNotes,
    ReportTable,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    ScopeNote,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">{{ report()?.name ?? definition()?.name ?? 'Report' }}</h1>
        <p class="bf-page__subtitle">
          {{ report()?.question ?? definition()?.question }}
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
        @if (isForecastReport()) {
          <a mat-stroked-button routerLink="/finance/forecast-cycles">
            <mat-icon svgIcon="calendar" />Forecast cycles
          </a>
        }
        <button mat-stroked-button type="button" (click)="startSave()" [disabled]="!report()">
          <mat-icon svgIcon="bookmark" />Save this view
        </button>
        <button
          mat-stroked-button
          type="button"
          [matMenuTriggerFor]="exportMenu"
          [disabled]="!report() || busy()"
        >
          <mat-icon svgIcon="download" />Download
        </button>
        <mat-menu #exportMenu="matMenu">
          @for (format of formats(); track format) {
            <button mat-menu-item type="button" (click)="download(format)">
              {{ formatLabel(format) }}
            </button>
          }
        </mat-menu>
      </div>
    </header>

    @if (notice(); as text) {
      <sat-banner variant="success" data-testid="report-notice">
        <sat-banner-message>
          <strong>{{ text }}</strong> The file carries the filters and scope on this screen. It
          stays in <a routerLink="/reports/schedules">recent exports</a> for 7 days.
        </sat-banner-message>
      </sat-banner>
    }
    @if (failure(); as text) {
      <sat-banner variant="important" data-testid="report-failure">
        <sat-banner-message>{{ text }}</sat-banner-message>
      </sat-banner>
    }

    <!-- The filters card appears once the first run and the catalog have answered: until then its
         saved views, grouping and scope note are unknown, and filling them in would push the page. -->
    @if (settled()) {
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
              <mat-select [ngModel]="shownGroupBy()" (ngModelChange)="setFilter('groupBy', $event)">
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
          @if (isForecastReport()) {
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Forecast snapshot</mat-label>
              <mat-select
                [ngModel]="forecastCycleId()"
                (ngModelChange)="setFilter('forecastCycleId', $event)"
              >
                <mat-option [value]="''">Latest accepted forecast</mat-option>
                @for (c of cycles(); track c.id) {
                  <mat-option [value]="c.id">{{ c.name }} (as of {{ c.asOfDate }})</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Compare with snapshot</mat-label>
              <mat-select
                [ngModel]="compareCycleId()"
                (ngModelChange)="setFilter('compareCycleId', $event)"
              >
                <mat-option [value]="''">No comparison</mat-option>
                @for (c of cycles(); track c.id) {
                  <mat-option [value]="c.id">{{ c.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Method</mat-label>
              <mat-select
                [ngModel]="forecastMethod()"
                (ngModelChange)="setFilter('forecastMethod', $event)"
              >
                <mat-option [value]="''">Any method</mat-option>
                @for (m of methods; track m) {
                  <mat-option [value]="m">{{ methodLabel(m) }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-checkbox
              [checked]="commentaryOnly()"
              (change)="setFilter('commentaryRequiredOnly', $event.checked ? 'true' : '')"
              >Commentary required only</mat-checkbox
            >
          }
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
    }

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
      [loading]="(run.isLoading() && !run.hasValue()) || !settled()"
      shape="cards"
      [lines]="4"
      [error]="run.error()"
      [what]="whatFailed()"
      (retry)="run.reload()"
    />

    @if (report(); as r) {
      @if (r.kpis.length) {
        <bf-report-kpis [kpis]="r.kpis" />
      }

      <section class="bf-card" aria-labelledby="rows-title">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="rows-title" tabindex="-1">
              By {{ label(r.groupBy).toLowerCase() }}
            </h2>
            <p class="bf-card__hint">
              {{ r.rowCount }} row{{ r.rowCount === 1 ? '' : 's' }}. Every figure is in
              {{ r.currency }} and comes from the ledger.
            </p>
          </div>
        </div>
        <bf-report-notes [notes]="r.notes" />
        @if (r.truncated) {
          <sat-banner class="bf-banner" variant="warning">
            <sat-banner-message
              ><strong>Showing the first {{ r.rows.length }} rows.</strong> Narrow the filters to
              see the rest. The totals below cover every row in scope.</sat-banner-message
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
            [forecastColumns]="forecastColumns()"
            [proseColumns]="proseColumns()"
            [showRowTags]="isForecastReport()"
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
        <section class="bf-card bf-chart-card" aria-labelledby="chart-title">
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title" id="chart-title">At a glance</h2>
              <p class="bf-card__hint">The table above is the full, accessible version of this.</p>
            </div>
            <button mat-button type="button" (click)="showTable()">
              <mat-icon svgIcon="table" aria-hidden="true" />View as table
            </button>
          </div>
          <div class="bf-card__body">
            <bf-report-bucket-bars [rows]="r.rows" [totals]="r.totals" [currency]="r.currency" />
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
    /* The favourite star sits at the label's size; unsized, the SVG fills the whole card. */
    .bf-view mat-icon {
      width: 18px;
      height: 18px;
      flex: none;
    }
    .bf-view--active {
      border-color: var(--mat-sys-primary);
      background: var(--mat-sys-secondary-container);
    }
    /* The heading keeps its own row width before and after the report arrives, and the subtitle
       keeps two lines at tablet width, so neither pushes the page when the question is filled in. */
    .bf-page__heading {
      flex: 1 1 32rem;
      min-width: 0;
    }
    @media (width < 1024px) {
      .bf-page__subtitle {
        min-height: 2lh;
      }
    }
    /* Below 600px the table carries the figures; the chart would be a second list. */
    @media (width < 600px) {
      .bf-chart-card {
        display: none;
      }
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly percentOf = percentOf;
  protected readonly statuses = BUDGET_STATUSES;
  protected readonly methods = FORECAST_METHODS;

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
  protected readonly forecastCycleId = computed(() => this.query().get('forecastCycleId') ?? '');
  protected readonly compareCycleId = computed(() => this.query().get('compareCycleId') ?? '');
  protected readonly forecastMethod = computed(() => this.query().get('forecastMethod') ?? '');
  protected readonly commentaryOnly = computed(
    () => this.query().get('commentaryRequiredOnly') === 'true',
  );
  protected readonly isForecastReport = computed(() => this.reportId() === 'forecast-variance');

  /**
   * 087 reports a named cycle or the latest accepted forecast per budget. The list is a close-domain
   * read that owners may make too, so an owner can pick the same snapshot finance is looking at.
   */
  protected readonly cycleList = resource({
    params: () => (this.isForecastReport() ? {} : undefined),
    loader: () => data(this.api.listForecastCycles({ query: {} })),
  });
  protected readonly cycles = computed(() => valueOf(this.cycleList)?.items ?? []);
  protected readonly forecastColumns = computed(() =>
    this.isForecastReport() ? FORECAST_COLUMNS : [],
  );
  protected readonly proseColumns = computed(() => (this.isForecastReport() ? PROSE_COLUMNS : []));

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
  /** True once the first run and the catalog have both answered (with data or an error). */
  protected readonly settled = signal(false);
  private readonly settle = effect(() => {
    const run = this.run.hasValue() || !!this.run.error();
    const catalog = this.catalog.hasValue() || !!this.catalog.error();
    if (run && catalog) this.settled.set(true);
  });
  /** Without a filter the server picks the report's default grouping; show the one it used. */
  protected readonly shownGroupBy = computed(
    () => this.groupBy() || (this.report()?.groupBy ?? ''),
  );
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
    if (this.isForecastReport()) {
      if (this.forecastCycleId()) f.forecastCycleId = this.forecastCycleId();
      if (this.compareCycleId()) f.compareCycleId = this.compareCycleId();
      if (this.forecastMethod()) f.forecastMethod = this.forecastMethod() as ForecastMethod;
      if (this.commentaryOnly()) f.commentaryRequiredOnly = 'true';
    }
    return f;
  }

  protected label(groupBy: ReportGroupBy): string {
    return GROUP_BY_LABELS[groupBy] ?? groupBy;
  }

  protected methodLabel(method: ForecastMethod): string {
    return METHOD_LABELS[method];
  }

  protected statusLabel(status: string): string {
    return status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  }

  /** "View as table": the table is the chart's text alternative (section 13). */
  protected showTable(): void {
    const heading = this.document.getElementById('rows-title');
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
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

  protected formatLabel(format: ReportFormat): string {
    return FORMAT_LABELS[format];
  }

  /**
   * Renders the file on the server with these filters and the viewer's own scope, then fetches its
   * five-minute signed link and starts the download straight away.
   */
  protected async download(format: ReportFormat): Promise<void> {
    const reportId = this.reportId();
    if (!reportId) return;
    await this.act(async () => {
      const exported = await data(
        this.api.createReportExport({
          params: { reportId },
          body: { format, filters: this.filters() },
        }),
      );
      const link = await data(
        this.api.getReportExportDownload({ params: { exportId: exported.id } }),
      );
      startDownload(this.document, link.url, link.fileName);
      this.notice.set(
        `Downloading ${link.fileName} (${exported.rowCount} ${exported.rowCount === 1 ? 'row' : 'rows'}).`,
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
