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
import { RouterLink } from '@angular/router';
import type { BudgetOutlook } from '@bf/contracts';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatInteractiveTag, SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { AI_OUTPUT_IMPORTS, isFeatureDisabled } from './ai-output';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

/** `OutlookCategory` is exported from the contract as a schema only, so the union lives here. */
type OutlookCategory = BudgetOutlook['category'];

const CATEGORIES: { value: '' | OutlookCategory; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'likely_overspend', label: 'Likely overspend' },
  { value: 'likely_unused', label: 'Likely unused' },
  { value: 'on_track', label: 'On track' },
  { value: 'no_history', label: 'Not enough history' },
];

const CATEGORY_LABELS: Record<OutlookCategory, string> = {
  likely_overspend: 'Likely overspend',
  likely_unused: 'Likely unused',
  on_track: 'On track',
  no_history: 'Not enough history',
};

/**
 * Screen 016b: spending outlook and nudges. The range is a statistical projection, drawn and named
 * as such and never mixed with actual or committed; the model only writes the driver sentences from
 * those same numbers. A nudge suggests a step the owner takes themselves — plan an event, release to
 * the parent, request an increase — and nothing is reduced or released here.
 */
@Component({
  selector: 'bf-outlook-page',
  imports: [
    AI_OUTPUT_IMPORTS,
    LoadState,
    MatButtonModule,
    MatIconModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatInteractiveTag,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <div class="bf-title-row">
          <h1 class="bf-page__title">Spending outlook</h1>
          <bf-ai-label text="AI outlook" />
        </div>
        <p class="bf-page__subtitle">
          Where budgets are heading by year end, from run rate, open commitments and the request
          pipeline. The outlook never changes a budget and never replaces an owner's forecast.
        </p>
      </div>
      <div class="bf-page__actions">
        @if (canRun()) {
          <button
            mat-stroked-button
            type="button"
            [disabled]="running()"
            (click)="run()"
            data-testid="run-outlook"
          >
            <mat-icon svgIcon="refresh" />Recompute outlook
          </button>
        }
      </div>
    </header>

    @if (disabled(); as detail) {
      <bf-ai-disabled
        feature="Spending outlook and nudges"
        [detail]="detail"
        stillWorks="Forecast and variance screens are unaffected."
      />
    } @else {
      <bf-load-state
        [loading]="outlook.isLoading() && !outlook.hasValue()"
        [error]="loadError()"
        what="the spending outlook"
        (retry)="outlook.reload()"
      />
      @if (outlook.hasValue()) {
        @if (summary(); as s) {
          <div class="bf-kpis">
            <div class="bf-kpi" data-testid="kpi-overspend">
              <p class="bf-kpi__label">Likely overspend</p>
              <p class="bf-kpi__value">{{ s.likelyOverspend }}</p>
              <p class="bf-kpi__delta">
                <bf-money
                  [amountMinor]="s.overspendTotal.amountMinor"
                  [currency]="s.overspendTotal.currency"
                />
                over authorized in total
              </p>
            </div>
            <div class="bf-kpi" data-testid="kpi-unused">
              <p class="bf-kpi__label">Likely unused</p>
              <p class="bf-kpi__value">{{ s.likelyUnused }}</p>
              <p class="bf-kpi__delta">
                <bf-money
                  [amountMinor]="s.unusedTotal.amountMinor"
                  [currency]="s.unusedTotal.currency"
                />
                may go unused
              </p>
            </div>
            <div class="bf-kpi" data-testid="kpi-on-track">
              <p class="bf-kpi__label">On track</p>
              <p class="bf-kpi__value">{{ s.onTrack }}</p>
            </div>
            <div class="bf-kpi" data-testid="kpi-no-history">
              <p class="bf-kpi__label">Not enough history</p>
              <p class="bf-kpi__value">{{ s.noHistory }}</p>
              <p class="bf-kpi__delta">An outlook needs at least 3 months of spending</p>
            </div>
          </div>
        }

        <section class="bf-card" aria-labelledby="outlook-title">
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title" id="outlook-title">
                Budgets, as of {{ valueOf(outlook)?.asOfDate }}
              </h2>
              <p class="bf-card__hint">
                Authorized, actual and committed are BudgetFlow figures. The year-end outlook and
                its range are a projection under an AI label, never money that has been spent.
              </p>
            </div>
          </div>
          <div class="bf-filters">
            @for (c of categories; track c.value) {
              <sat-status-tag
                satInteractiveTag
                [status]="category() === c.value ? 'info' : 'neutral-quiet'"
                [hideIcon]="true"
                role="button"
                tabindex="0"
                (click)="category.set(c.value)"
                (keydown.enter)="category.set(c.value)"
                [attr.data-testid]="'filter-' + (c.value || 'all')"
                >{{ c.label }}</sat-status-tag
              >
            }
            <sat-status-tag
              satInteractiveTag
              [status]="ownedOnly() ? 'info' : 'neutral-quiet'"
              [hideIcon]="true"
              role="button"
              tabindex="0"
              (click)="ownedOnly.set(!ownedOnly())"
              (keydown.enter)="ownedOnly.set(!ownedOnly())"
              data-testid="filter-owned"
              >Only budgets I own</sat-status-tag
            >
          </div>

          @if (rows().length === 0) {
            <sat-empty-state data-testid="outlook-empty">
              <h2 satEmptyStateHeadline>No outlook for these filters</h2>
              <p satEmptyStateDescription>
                Recompute the outlook, or clear the filters to see every budget you can read.
              </p>
            </sat-empty-state>
          } @else {
            <div class="bf-table-scroll">
              <table class="bf-split-table" aria-label="Spending outlook by budget">
                <thead>
                  <tr>
                    <th>Budget</th>
                    <th>Owner</th>
                    <th class="bf-num">Authorized</th>
                    <th class="bf-num">Actual and committed to date</th>
                    <th class="bf-num">Year-end outlook (AI)</th>
                    <th class="bf-num">Gap to authorized</th>
                    <th>Outlook</th>
                    <th>Nudge</th>
                  </tr>
                </thead>
                <tbody>
                  @for (o of rows(); track o.id) {
                    <tr [attr.data-testid]="'outlook-row-' + o.budgetId">
                      <td>
                        <button
                          mat-button
                          type="button"
                          (click)="select(o)"
                          [attr.data-testid]="'open-outlook-' + o.budgetId"
                        >
                          {{ o.budgetName }}
                        </button>
                      </td>
                      <td>{{ o.ownerName ?? 'Unassigned' }}</td>
                      <td class="bf-num">
                        <bf-money
                          [amountMinor]="o.authorized.amountMinor"
                          [currency]="o.authorized.currency"
                        />
                      </td>
                      <td class="bf-num">
                        <bf-money
                          [amountMinor]="o.toDate.amountMinor"
                          [currency]="o.toDate.currency"
                        />
                      </td>
                      <td class="bf-num bf-outlook__projection">
                        @if (o.likely) {
                          <bf-money
                            [amountMinor]="o.likely.amountMinor"
                            [currency]="o.likely.currency"
                          />
                          @if (o.low && o.high) {
                            <span
                              class="bf-cell__secondary"
                              [attr.data-testid]="'range-' + o.budgetId"
                            >
                              between
                              <bf-money
                                [amountMinor]="o.low.amountMinor"
                                [currency]="o.low.currency"
                              />
                              and
                              <bf-money
                                [amountMinor]="o.high.amountMinor"
                                [currency]="o.high.currency"
                              />
                            </span>
                          }
                        } @else {
                          <span class="bf-cell__secondary">Not enough history</span>
                        }
                      </td>
                      <td class="bf-num">
                        @if (o.gap) {
                          <bf-money [amountMinor]="o.gap.amountMinor" [currency]="o.gap.currency" />
                        } @else {
                          <span class="bf-cell__secondary">—</span>
                        }
                      </td>
                      <td>
                        <sat-status-tag [status]="categoryTone(o.category)">
                          {{ categoryLabel(o.category) }}
                        </sat-status-tag>
                        @if (o.confidence) {
                          <span class="bf-cell__secondary">{{ o.confidence }} confidence</span>
                        }
                      </td>
                      <td>
                        @if (o.nudge) {
                          @if (o.nudge.snoozedUntil) {
                            <sat-status-tag status="neutral"
                              >Snoozed until {{ o.nudge.snoozedUntil }}</sat-status-tag
                            >
                          } @else {
                            <sat-status-tag status="warning">Nudge raised</sat-status-tag>
                          }
                        } @else {
                          <span class="bf-cell__secondary">None</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        @if (selected(); as o) {
          <section class="bf-card" aria-labelledby="detail-title" data-testid="outlook-detail">
            <div class="bf-card__header">
              <div class="bf-title-row">
                <h2 class="bf-card__title" id="detail-title">{{ o.budgetName }}</h2>
                <bf-ai-label text="AI outlook" />
              </div>
              <button mat-button type="button" (click)="selected.set(null)">Close</button>
            </div>
            <div class="bf-card__body bf-outlook__detail">
              @if (o.category === 'no_history') {
                <sat-banner variant="info" data-testid="no-history">
                  <sat-banner-message>
                    An outlook needs at least 3 months of spending. No figures are projected for
                    this budget yet.
                  </sat-banner-message>
                </sat-banner>
              }
              <bf-ai-figures
                [figures]="ledgerFigures(o)"
                label="BudgetFlow figures for this budget"
              />
              @if (o.likely && o.low && o.high) {
                <div class="bf-outlook__range" data-testid="detail-range">
                  <h3 class="bf-section__title">Year-end projection (AI, not spent money)</h3>
                  <p class="bf-outlook__range-text">
                    Most likely
                    <bf-money
                      [amountMinor]="o.likely.amountMinor"
                      [currency]="o.likely.currency"
                    />, between
                    <bf-money [amountMinor]="o.low.amountMinor" [currency]="o.low.currency" /> and
                    <bf-money [amountMinor]="o.high.amountMinor" [currency]="o.high.currency" />.
                  </p>
                </div>
              }
              @if (o.drivers.length) {
                <div>
                  <h3 class="bf-section__title">Drivers</h3>
                  <dl class="bf-facts">
                    @for (d of o.drivers; track d.label) {
                      <div>
                        <dt>{{ d.label }}</dt>
                        <dd>{{ d.detail }}</dd>
                      </div>
                    }
                  </dl>
                </div>
              }
              <bf-ai-sources [sources]="o.sources" />
              @if (o.nudge; as nudge) {
                <div class="bf-outlook__nudge" [attr.data-testid]="'nudge-' + o.budgetId">
                  <div class="bf-title-row">
                    <h3 class="bf-section__title">Suggested next step</h3>
                    <bf-ai-label text="AI suggestion" />
                  </div>
                  <bf-ai-prose [text]="nudge.message" />
                  <p class="bf-cell__secondary">
                    Each action opens the normal form with its own checks, reason code and approval
                    route. Nothing is released or reduced from here.
                  </p>
                  <div class="bf-outlook__actions">
                    @for (action of nudge.actions; track action.label) {
                      <a
                        mat-stroked-button
                        [routerLink]="
                          actionLink(action.resourceType, action.resourceId, o.budgetId)
                        "
                        [attr.data-testid]="'nudge-action'"
                        >{{ action.label }}</a
                      >
                    }
                    <button
                      mat-button
                      type="button"
                      (click)="dismissNudge(nudge.suggestionId, o.budgetId)"
                      data-testid="nudge-not-useful"
                    >
                      Not useful
                    </button>
                  </div>
                </div>
              }
              <p class="bf-cell__secondary" data-testid="detail-model">
                Model {{ o.modelId }} {{ o.modelVersion }}, as of {{ o.asOfDate }}.
              </p>
            </div>
          </section>
        }
      }
    }
  `,
  styles: `
    .bf-outlook__projection {
      background: var(--sat-sys-info-container);
    }
    .bf-outlook__detail {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .bf-outlook__range {
      padding: 12px 14px;
      border: 1px dashed var(--sat-sys-info);
      border-radius: var(--mat-sys-corner-medium);
    }
    .bf-outlook__range-text {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      margin: 0;
      font: var(--mat-sys-body-medium);
    }
    .bf-outlook__nudge {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px;
      border: 1px solid var(--sat-sys-warning);
      border-radius: var(--mat-sys-corner-large);
      background: var(--sat-sys-warning-container);
      color: var(--sat-sys-on-warning-container);
    }
    .bf-outlook__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutlookPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly valueOf = valueOf;
  protected readonly categories = CATEGORIES;

  protected readonly category = signal<'' | OutlookCategory>('');
  protected readonly ownedOnly = signal(false);
  protected readonly running = signal(false);
  protected readonly selected = signal<BudgetOutlook | null>(null);
  protected readonly canRun = signal(true);

  protected readonly outlook = resource({
    params: () => {
      const category = this.category();
      return {
        ...(category ? { category } : {}),
        ...(this.ownedOnly() ? { ownedOnly: true } : {}),
      };
    },
    loader: ({ params }) => data(this.api.listAiOutlook({ query: params })),
  });

  protected readonly rows = computed(() => valueOf(this.outlook)?.items ?? []);
  protected readonly summary = computed(() => valueOf(this.outlook)?.summary ?? null);
  protected readonly disabled = computed(() =>
    isFeatureDisabled(this.outlook.error()) ? errorMessage(this.outlook.error()) : null,
  );
  protected readonly loadError = computed(() =>
    isFeatureDisabled(this.outlook.error()) ? undefined : this.outlook.error(),
  );

  protected categoryLabel(category: OutlookCategory): string {
    return CATEGORY_LABELS[category];
  }

  protected categoryTone(
    category: OutlookCategory,
  ): 'success' | 'info' | 'warning' | 'important' | 'neutral' {
    switch (category) {
      case 'likely_overspend':
        return 'warning';
      case 'likely_unused':
        return 'info';
      case 'on_track':
        return 'success';
      default:
        return 'neutral';
    }
  }

  /** Authorized and to-date are ledger figures, so they render through the shared figures table. */
  protected ledgerFigures(o: BudgetOutlook) {
    const source = { type: 'budget' as const, id: o.budgetId, label: o.budgetName };
    return [
      { key: 'authorized', label: 'Authorized', amount: o.authorized, source },
      {
        key: 'to_date',
        label: 'Actual and committed to date',
        amount: o.toDate,
        source,
      },
    ];
  }

  protected actionLink(
    resourceType: string | null,
    resourceId: string | null,
    budgetId: string,
  ): string {
    const paths: Record<string, string> = {
      budget: '/budgets',
      event: '/events',
      request: '/requests',
    };
    const base = paths[resourceType ?? ''] ?? '/budgets';
    return `${base}/${resourceId ?? budgetId}`;
  }

  protected select(outlook: BudgetOutlook): void {
    this.selected.set(outlook);
  }

  protected async run(): Promise<void> {
    this.running.set(true);
    try {
      await data(this.api.runAiOutlook({ body: {} }));
      this.outlook.reload();
      this.snack.open('Outlook recomputed from the ledger.', 'Dismiss', { duration: 4000 });
    } catch (error) {
      this.snack.open(errorMessage(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.running.set(false);
    }
  }

  /** "Not useful" dismisses the nudge. It never changes the budget; only the suggestion closes. */
  protected async dismissNudge(suggestionId: string, budgetId: string): Promise<void> {
    try {
      await data(
        this.api.decideAiSuggestion({
          params: { suggestionId },
          body: { decision: 'dismissed', reasonCode: 'NOT_USEFUL' },
        }),
      );
      this.selected.set(null);
      this.outlook.reload();
      this.snack.open(`Nudge dismissed for ${budgetId.slice(0, 8)}.`, 'Dismiss', {
        duration: 4000,
      });
    } catch (error) {
      this.snack.open(errorMessage(error), 'Dismiss', { duration: 6000 });
    }
  }
}
