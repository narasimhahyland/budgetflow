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
import { RouterLink } from '@angular/router';
import type { ReportCatalog, SavedReportView } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';
import { ScopeNote } from './report-frame';

type ReportGroup = ReportCatalog['reports'][number]['group'];

const GROUP_TITLES: Record<ReportGroup, { title: string; hint: string }> = {
  budgets: { title: 'Budgets', hint: 'What we authorized, allocated, committed and spent.' },
  comparisons: {
    title: 'Comparisons',
    hint: 'How locations and departments sit against each other.',
  },
  events: { title: 'Events', hint: 'Where event money goes and which events ran over.' },
  fairness: { title: 'Fairness and reach', hint: 'Whether the money reaches people evenly.' },
};
const GROUP_ORDER: ReportGroup[] = ['budgets', 'comparisons', 'events', 'fairness'];

/** Screen 079: the report catalog, grouped by the question people ask, with the viewer's saved views. */
@Component({
  selector: 'bf-report-catalog-page',
  imports: [
    DateTimePipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
    ScopeNote,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Reports</h1>
        <p class="bf-page__subtitle">
          Every figure is built from the ledger and shown in your reporting currency.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/reports/health">
          <mat-icon svgIcon="monitor" aria-hidden="true" />Budget health
        </a>
        <a mat-stroked-button routerLink="/reports/board-pack">
          <mat-icon svgIcon="book" />Board and FP&A pack
        </a>
        <a mat-stroked-button routerLink="/finance/forecast-cycles">
          <mat-icon svgIcon="chart_arrow_up" />Forecast cycles
        </a>
        <a mat-stroked-button routerLink="/reports/schedules">
          <mat-icon svgIcon="calendar" />Scheduled reports
        </a>
      </div>
    </header>

    @if (failure(); as text) {
      <sat-banner variant="important">
        <sat-banner-message>{{ text }}</sat-banner-message>
      </sat-banner>
    }

    <bf-load-state
      [loading]="catalog.isLoading() && !catalog.hasValue()"
      [error]="catalog.error()"
      what="reports"
      (retry)="catalog.reload()"
    />

    @if (valueOf(catalog); as c) {
      <bf-scope-note
        [note]="c.scope.note"
        [label]="c.scope.label"
        [budgetIds]="c.scope.budgetIds"
      />
      @if (!c.scope.tenantWide) {
        <p class="bf-page__subtitle" data-testid="catalog-scope-hint">
          Reports that only make sense company-wide are not listed for you.
        </p>
      }

      <div class="bf-kpis">
        <div class="bf-kpi">
          <p class="bf-kpi__label">Reports you can open</p>
          <p class="bf-kpi__value">{{ c.reports.length }}</p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">Saved views</p>
          <p class="bf-kpi__value">{{ c.savedViews.length }}</p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">Active schedules</p>
          <p class="bf-kpi__value">{{ c.activeSchedules }}</p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">Recent exports</p>
          <p class="bf-kpi__value" data-testid="recent-exports">{{ c.recentExports }}</p>
        </div>
      </div>

      @if (c.savedViews.length) {
        <section class="bf-card" aria-labelledby="views-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="views-title">Saved views</h2>
            <p class="bf-card__hint">
              A view stores filters; the figures are recomputed each time.
            </p>
          </div>
          <ul class="bf-saved-views">
            @for (view of c.savedViews; track view.id) {
              <li class="bf-view-row">
                <a class="bf-view-row__link" [routerLink]="link(view)" [queryParams]="params(view)">
                  <span class="bf-view-row__name">
                    {{ view.name }}
                    @if (view.favourite) {
                      <sat-status-tag status="info">Favourite</sat-status-tag>
                    }
                  </span>
                  <span class="bf-cell__secondary">
                    {{ reportName(view.reportId) }}
                    @if (view.lastOpenedAt) {
                      · last opened
                      <span data-testid="relative-time">{{
                        view.lastOpenedAt | bfDateTime: session.timezone()
                      }}</span>
                    }
                  </span>
                </a>
                <button mat-stroked-button type="button" [disabled]="busy()" (click)="remove(view)">
                  Delete
                </button>
              </li>
            }
          </ul>
        </section>
      }

      @for (group of groups(); track group.group) {
        <section class="bf-card" [attr.aria-labelledby]="'group-' + group.group">
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title" [id]="'group-' + group.group">{{ group.title }}</h2>
              <p class="bf-card__hint">{{ group.hint }}</p>
            </div>
          </div>
          <ul class="bf-reports">
            @for (report of group.reports; track report.reportId) {
              <li>
                <a
                  class="bf-report"
                  [attr.data-testid]="'report-card-' + report.reportId"
                  [routerLink]="['/reports', report.reportId]"
                >
                  <span class="bf-report__name">{{ report.name }}</span>
                  <span class="bf-report__question">{{ report.question }}</span>
                  <span class="bf-report__meta">Screen {{ report.screen }}</span>
                </a>
              </li>
            }
          </ul>
        </section>
      } @empty {
        <sat-empty-state>
          <h2 satEmptyStateHeadline>No reports for you yet</h2>
          <p satEmptyStateDescription>Reports open once you own a budget or hold a finance role.</p>
        </sat-empty-state>
      }
    }
  `,
  styles: `
    .bf-reports {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 12px;
      margin: 0;
      padding: 8px 20px 20px;
      list-style: none;
    }
    .bf-report {
      display: flex;
      flex-direction: column;
      gap: 4px;
      // The 100% height below is the card filling its grid row. Without border-box the row height
      // becomes the content box and the padding and border are added on top, so the card grows past
      // its row and lands on the "Screen NNN" line of the card above it.
      box-sizing: border-box;
      height: 100%;
      padding: 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-large);
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface);
      text-decoration: none;
    }
    .bf-report:hover,
    .bf-report:focus-visible {
      border-color: var(--mat-sys-primary);
      background: var(--mat-sys-surface-container-low);
    }
    .bf-report__name {
      font: var(--mat-sys-title-small);
    }
    .bf-report__question {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-report__meta {
      margin-top: auto;
      padding-top: 8px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
    }
    .bf-saved-views {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .bf-view-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 12px 20px;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    .bf-view-row__link {
      color: var(--mat-sys-on-surface);
      text-decoration: none;
    }
    .bf-view-row__name {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      font: var(--mat-sys-body-medium);
    }
    .bf-view-row__link:hover .bf-view-row__name {
      text-decoration: underline;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportCatalogPage {
  private readonly api = injectApi();
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected readonly catalog = resource({ loader: () => data(this.api.getReportCatalog({})) });

  protected readonly groups = computed(() => {
    const reports = valueOf(this.catalog)?.reports ?? [];
    return GROUP_ORDER.filter((g) => reports.some((r) => r.group === g)).map((group) => ({
      group,
      title: GROUP_TITLES[group].title,
      hint: GROUP_TITLES[group].hint,
      reports: reports.filter((r) => r.group === group),
    }));
  });

  protected reportName(reportId: string): string {
    return valueOf(this.catalog)?.reports.find((r) => r.reportId === reportId)?.name ?? reportId;
  }

  protected link(view: SavedReportView): string[] {
    return ['/reports', view.reportId];
  }

  protected params(view: SavedReportView): Record<string, string> {
    const q: Record<string, string> = { viewId: view.id };
    if (view.filters.groupBy) q['groupBy'] = view.filters.groupBy;
    if (view.filters.status) q['status'] = view.filters.status;
    if (view.filters.periodFrom) q['periodFrom'] = view.filters.periodFrom;
    if (view.filters.periodTo) q['periodTo'] = view.filters.periodTo;
    if (view.filters.rootBudgetId) q['rootBudgetId'] = view.filters.rootBudgetId;
    return q;
  }

  protected async remove(view: SavedReportView): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await data(this.api.deleteSavedView({ params: { viewId: view.id } }));
      this.catalog.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
