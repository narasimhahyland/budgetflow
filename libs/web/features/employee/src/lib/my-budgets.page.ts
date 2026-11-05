import { ChangeDetectionStrategy, Component, computed, resource, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { Money } from '@bf/web/ui';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

type Filter = 'all' | 'open' | 'paused';

/** Screen 116: every budget I may request from, what I asked for this year, and which budgets are paused. */
@Component({
  selector: 'bf-my-budgets-page',
  imports: [
    LoadState,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    Money,
    RouterLink,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">My budgets</h1>
        <p class="bf-page__subtitle">What you can request this year</p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/requests"><mat-icon svgIcon="upload" />Upload receipt</a>
        <a mat-flat-button routerLink="/requests/new" [queryParams]="{ kind: 'spending' }"
          ><mat-icon svgIcon="circle_add" />Request funds</a
        >
      </div>
    </header>

    <bf-load-state
      [loading]="budgets.isLoading() && !budgets.hasValue()"
      [error]="budgets.error()"
      what="your budgets"
      (retry)="budgets.reload()"
    />
    @if (budgets.hasValue()) {
      @if (items().length === 0) {
        <sat-empty-state>
          <h2 satEmptyStateHeadline>You have no budgets to request from yet</h2>
          <p satEmptyStateDescription>Ask your manager which budget your location or team uses.</p>
        </sat-empty-state>
      } @else {
        <mat-button-toggle-group
          class="bf-my-budgets__filters"
          [value]="filter()"
          (change)="filter.set($event.value)"
          aria-label="Show budgets"
          hideSingleSelectionIndicator
        >
          <mat-button-toggle value="all">All ({{ items().length }})</mat-button-toggle>
          <mat-button-toggle value="open">Can request ({{ open().length }})</mat-button-toggle>
          <mat-button-toggle value="paused"
            >Paused ({{ items().length - open().length }})</mat-button-toggle
          >
        </mat-button-toggle-group>
        <div class="bf-my-budgets__cards">
          @for (b of shown(); track b.budgetId) {
            <article class="bf-card bf-my-budgets__card" [attr.aria-label]="b.name">
              <div class="bf-list__row">
                <h2 class="bf-card__title">{{ b.name }}</h2>
                @if (b.blockedCode === 'BUDGET_FROZEN') {
                  <sat-status-tag status="info">Paused</sat-status-tag>
                } @else if (b.blockedCode === 'BUDGET_SET_TO_ZERO') {
                  <sat-status-tag status="important">Closed</sat-status-tag>
                } @else if (b.pendingCount) {
                  <sat-status-tag status="warning">{{ b.pendingCount }} pending</sat-status-tag>
                }
              </div>
              @if (b.code) {
                <span class="bf-cell__secondary">{{ b.code }}</span>
              }
              @if (b.available) {
                <p class="bf-my-budgets__amount">
                  <bf-money
                    [amountMinor]="b.available.amountMinor"
                    [currency]="b.available.currency"
                  />
                  available
                </p>
              }
              <p>
                You requested
                <bf-money
                  [amountMinor]="b.requestedThisYear.amountMinor"
                  [currency]="b.requestedThisYear.currency"
                />
                this year
              </p>
              @if (b.approverHint) {
                <p class="bf-cell__secondary">{{ b.approverHint }}</p>
              }
              @if (b.pendingCount) {
                <a mat-button routerLink="/requests">{{
                  b.pendingCount === 1 ? '1 request pending' : b.pendingCount + ' requests pending'
                }}</a>
              }
              @if (b.blockedCode === 'BUDGET_FROZEN') {
                <p class="bf-my-budgets__reason">
                  <mat-icon svgIcon="lock" />Requests paused: the budget is frozen. Existing
                  approved requests still complete.
                </p>
              } @else if (b.blockedCode === 'BUDGET_SET_TO_ZERO') {
                <p class="bf-my-budgets__reason">Requests closed: budget set to zero.</p>
              }
              @if (b.blockedReason) {
                <button mat-flat-button type="button" disabled>Request</button>
              } @else {
                <a
                  mat-flat-button
                  [routerLink]="['/requests/new']"
                  [queryParams]="{ kind: 'spending', budgetId: b.budgetId }"
                  >Request</a
                >
              }
            </article>
          }
        </div>
      }
    }
    <p class="bf-cell__secondary">
      Your limits come from company policy. Ask your manager if a limit looks wrong.
    </p>
  `,
  styles: `
    .bf-my-budgets__filters {
      width: fit-content;
      margin-bottom: 12px;
    }
    .bf-my-budgets__cards {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }
    .bf-my-budgets__card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      align-items: flex-start;
      padding: 16px;
    }
    .bf-my-budgets__card p {
      margin: 0;
    }
    .bf-my-budgets__amount {
      font: var(--mat-sys-title-medium);
    }
    .bf-my-budgets__reason {
      display: flex;
      gap: 4px;
      align-items: center;
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-my-budgets__card > :last-child {
      margin-top: auto;
    }
    @media (max-width: 1100px) {
      .bf-my-budgets__cards {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 600px) {
      .bf-my-budgets__cards {
        grid-template-columns: 1fr;
      }
      .bf-my-budgets__card > :last-child {
        align-self: stretch;
      }
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyBudgetsPage {
  private readonly api = injectApi();
  protected readonly filter = signal<Filter>('all');
  protected readonly budgets = resource({ loader: () => data(this.api.requestableBudgets({})) });
  protected readonly items = computed(() => valueOf(this.budgets)?.items ?? []);
  protected readonly open = computed(() => this.items().filter((b) => !b.blockedReason));
  protected readonly shown = computed(() => {
    const f = this.filter();
    if (f === 'open') return this.open();
    if (f === 'paused') return this.items().filter((b) => !!b.blockedReason);
    return this.items();
  });
}
