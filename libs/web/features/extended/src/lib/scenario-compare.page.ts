import { ChangeDetectionStrategy, Component, computed, resource, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { data, injectApi, valueOf } from './api';

/** The comparison takes today plus at most three scenarios (031a). */
const MAX_SCENARIOS = 3;

/**
 * Screen 031a, compare: today beside up to three scenarios.
 *
 * Every column after the first is a projection. "Today" is what the ledger actually says, and the
 * page keeps that distinction in the column headings rather than letting four similar-looking
 * columns imply that any of the scenarios has happened.
 */
@Component({
  selector: 'bf-scenario-compare-page',
  imports: [
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Compare scenarios</h1>
        <p class="bf-page__subtitle">
          Today beside up to {{ max }} projections.
          <a routerLink="/budgets/scenarios">All scenarios</a>
        </p>
      </div>
    </header>

    <sat-banner variant="info" data-testid="compare-note">
      <sat-banner-message>
        Only the "Today" column is real. The others show what the ledger would say if that scenario
        were promoted; none of them has changed a budget.
      </sat-banner-message>
    </sat-banner>

    <bf-load-state
      [loading]="scenarios.isLoading() && !scenarios.hasValue()"
      [error]="scenarios.error()"
      what="your scenarios"
      (retry)="scenarios.reload()"
    />

    @if (scenarios.hasValue()) {
      @if (available().length === 0) {
        <sat-empty-state data-testid="compare-empty">
          <h2 satEmptyStateHeadline>No scenarios to compare</h2>
          <p satEmptyStateDescription>Create a scenario first, then compare it with today.</p>
          <a mat-stroked-button satEmptyStateAction routerLink="/budgets/scenarios"
            >Go to scenarios</a
          >
        </sat-empty-state>
      } @else {
        <section class="bf-card bf-section">
          <h2 class="bf-section__title">Scenarios to compare</h2>
          <p class="bf-cell__secondary">Pick up to {{ max }}.</p>
          <div class="bf-compare__picker">
            @for (s of available(); track s.id) {
              <mat-checkbox
                [checked]="selected().includes(s.id)"
                [disabled]="!selected().includes(s.id) && selected().length >= max"
                (change)="toggle(s.id)"
                [attr.data-testid]="'compare-pick-' + s.id"
                >{{ s.name }}</mat-checkbox
              >
            }
          </div>
        </section>

        @if (selected().length === 0) {
          <sat-empty-state data-testid="compare-none-selected">
            <h2 satEmptyStateHeadline>Pick a scenario to compare</h2>
            <p satEmptyStateDescription>
              Choose one to three scenarios above to see them beside today's figures.
            </p>
          </sat-empty-state>
        } @else {
          <bf-load-state
            [loading]="comparison.isLoading() && !comparison.hasValue()"
            [error]="comparison.error()"
            what="the comparison"
            [lines]="4"
            (retry)="comparison.reload()"
          />
          @if (table(); as c) {
            <section class="bf-card bf-section" data-testid="compare-table">
              <table class="bf-split-table" aria-label="Budgets today and under each scenario">
                <thead>
                  <tr>
                    <th>Budget</th>
                    <th>Figure</th>
                    @for (col of c.columns; track $index) {
                      <th class="bf-num">
                        {{ col.label }}
                        @if (col.scenarioId) {
                          <span class="bf-cell__secondary">Projection</span>
                        } @else {
                          <span class="bf-cell__secondary">On the ledger</span>
                        }
                      </th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of c.rows; track row.budgetId) {
                    <tr>
                      <th scope="rowgroup" rowspan="4" class="bf-compare__budget">
                        {{ row.budgetName }}
                      </th>
                      <td>Authorized</td>
                      @for (cell of row.authorized; track $index) {
                        <td class="bf-num">
                          <bf-money [amountMinor]="cell.amountMinor" [currency]="cell.currency" />
                        </td>
                      }
                    </tr>
                    <tr>
                      <td>Available</td>
                      @for (cell of row.available; track $index) {
                        <td class="bf-num">
                          <bf-money [amountMinor]="cell.amountMinor" [currency]="cell.currency" />
                        </td>
                      }
                    </tr>
                    <tr>
                      <td>Committed and at risk</td>
                      @for (cell of row.atRiskCommitted; track $index) {
                        <td class="bf-num">
                          <bf-money [amountMinor]="cell.amountMinor" [currency]="cell.currency" />
                        </td>
                      }
                    </tr>
                    <tr>
                      <td>Per eligible head</td>
                      @for (cell of row.perHead; track $index) {
                        <td class="bf-num">
                          @if (cell) {
                            <bf-money [amountMinor]="cell.amountMinor" [currency]="cell.currency" />
                          } @else {
                            <span class="bf-cell__secondary">Not available</span>
                          }
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </section>
          }
        }
      }
    }
  `,
  styles: `
    .bf-section {
      padding: 16px;
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bf-section__title {
      margin: 0;
      font: var(--mat-sys-title-small);
    }
    .bf-compare__picker {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 20px;
    }
    .bf-compare__budget {
      text-align: start;
      vertical-align: top;
      font: var(--mat-sys-title-small);
    }
    @media (max-width: 834px) {
      .bf-split-table {
        display: block;
        overflow-x: auto;
      }
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenarioComparePage {
  private readonly api = injectApi();
  protected readonly max = MAX_SCENARIOS;
  protected readonly selected = signal<readonly string[]>([]);

  protected readonly scenarios = resource({ loader: () => data(this.api.listScenarios({})) });
  /** Promoted scenarios are history, so only drafts are worth placing beside today. */
  protected readonly available = computed(() =>
    (valueOf(this.scenarios)?.items ?? []).filter((s) => s.status !== 'archived'),
  );

  protected readonly comparison = resource({
    params: () => ({ ids: this.selected().join(',') }),
    loader: ({ params }) =>
      params.ids
        ? data(this.api.compareScenarios({ query: { ids: params.ids } }))
        : Promise.resolve(undefined),
  });
  protected readonly table = computed(() => valueOf(this.comparison));

  protected toggle(id: string): void {
    const current = this.selected();
    this.selected.set(
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length >= MAX_SCENARIOS
          ? current
          : [...current, id],
    );
  }
}
