import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { DiscussionItemType, FollowedItemView } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { BudgetStatus, DateTimePipe, LoadState, SpendStatus } from '@bf/web/ui';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatCategoryTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';

/**
 * Screen 060a: Following page (`/me/following`).
 * Table of followed items (type, name, status tag, last activity with time, notification level, Unfollow),
 * filters by type (Budgets, Events, Requests) and search.
 */
@Component({
  selector: 'bf-following-page',
  imports: [
    BudgetStatus,
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTableModule,
    RouterLink,
    SAT_EMPTY_STATE_IMPORTS,
    SatCategoryTag,
    SpendStatus,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Following</h1>
        <p class="bf-page__subtitle">
          Budgets, events and requests you follow for discussion and activity alerts
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/notifications">Back to notifications</a>
      </div>
    </header>

    <div class="bf-following__toolbar">
      <mat-button-toggle-group
        [value]="typeFilter() ?? 'all'"
        (change)="setTypeFilter($event.value)"
        aria-label="Filter by item type"
        hideSingleSelectionIndicator
      >
        <mat-button-toggle value="all">All</mat-button-toggle>
        <mat-button-toggle value="budget">Budgets</mat-button-toggle>
        <mat-button-toggle value="event">Events</mat-button-toggle>
        <mat-button-toggle value="request">Requests</mat-button-toggle>
      </mat-button-toggle-group>

      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>Search followed items</mat-label>
        <input
          matInput
          [ngModel]="search()"
          (ngModelChange)="search.set($event)"
          name="search"
          data-testid="following-search"
        />
      </mat-form-field>
    </div>

    <bf-load-state
      [loading]="list.isLoading() && !list.hasValue()"
      [error]="list.error()"
      what="your followed items"
      (retry)="list.reload()"
    />

    @if (list.hasValue()) {
      @if (items().length === 0) {
        <sat-empty-state>
          <h2 satEmptyStateHeadline>You are not following anything yet</h2>
          <p satEmptyStateDescription>
            Use the Follow button on any budget, event or request to watch its activity.
          </p>
          <a satEmptyStateAction mat-stroked-button routerLink="/budgets">Browse budgets</a>
        </sat-empty-state>
      } @else {
        <section class="bf-card" aria-label="Followed items">
          <div class="bf-table-scroll">
            <table
              mat-table
              class="bf-table bf-table--stack"
              [dataSource]="items()"
              aria-label="Followed items"
              data-testid="following-table"
            >
              <ng-container matColumnDef="type">
                <th mat-header-cell *matHeaderCellDef>Type</th>
                <td mat-cell *matCellDef="let i" data-label="Type">
                  <sat-category-tag category="gray">{{ typeOf(i) }}</sat-category-tag>
                </td>
              </ng-container>
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Item</th>
                <td mat-cell *matCellDef="let i" data-label="Item">
                  <a [routerLink]="i.link" class="bf-cell__primary">{{ i.name }}</a>
                  @if (i.source === 'owner') {
                    <span class="bf-cell__secondary">Following (owner)</span>
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let i" data-label="Status">
                  @if (i.itemType === 'budget') {
                    <bf-budget-status [status]="i.status" />
                  } @else {
                    <bf-spend-status [kind]="i.itemType" [status]="i.status" />
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="activity">
                <th mat-header-cell *matHeaderCellDef>Last activity</th>
                <td mat-cell *matCellDef="let i" data-label="Last activity">
                  <span class="bf-cell__primary">{{ i.lastActivitySummary }}</span>
                  <span class="bf-cell__secondary" data-testid="relative-time">{{
                    i.lastActivityAt | bfDateTime: session.timezone()
                  }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="level">
                <th mat-header-cell *matHeaderCellDef>Notification level</th>
                <td mat-cell *matCellDef="let i" data-label="Notification level">
                  {{ i.level === 'money_decisions' ? 'Money and decisions only' : 'All activity' }}
                </td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef>Action</th>
                <td mat-cell *matCellDef="let i" data-label="Action">
                  <button
                    mat-button
                    type="button"
                    [disabled]="busy()"
                    (click)="unfollow(i)"
                    [attr.data-testid]="'unfollow-' + i.itemId"
                  >
                    Unfollow
                  </button>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr mat-row *matRowDef="let row; columns: columns"></tr>
            </table>
          </div>
        </section>
      }
    }
  `,
  styles: `
    .bf-following__toolbar {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FollowingPage {
  private readonly typeLabel: Record<DiscussionItemType, string> = {
    budget: 'Budget',
    event: 'Event',
    request: 'Request',
  };

  protected typeOf(i: FollowedItemView): string {
    return this.typeLabel[i.itemType];
  }
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);

  protected readonly columns = ['type', 'name', 'status', 'activity', 'level', 'actions'];
  protected readonly typeFilter = signal<DiscussionItemType | undefined>(undefined);
  protected readonly search = signal('');
  protected readonly busy = signal(false);

  protected readonly list = resource({
    params: () => ({
      itemType: this.typeFilter(),
      q: this.search().trim() ? this.search().trim() : undefined,
    }),
    loader: ({ params }) => data(this.api.listFollowedItems({ query: params })),
  });

  protected readonly items = computed<FollowedItemView[]>(() => valueOf(this.list)?.items ?? []);

  protected setTypeFilter(val: string): void {
    this.typeFilter.set(val === 'all' ? undefined : (val as DiscussionItemType));
  }

  protected async unfollow(item: FollowedItemView): Promise<void> {
    this.busy.set(true);
    try {
      await data(
        this.api.updateFollow({
          params: { itemType: item.itemType, itemId: item.itemId },
          body: { following: false },
        }),
      );
      this.snack.open(`Unfollowed ${item.name}`, undefined, { duration: 3000 });
      this.list.reload();
    } catch (e) {
      this.snack.open(errorMessage(e), undefined, { duration: 4000 });
    } finally {
      this.busy.set(false);
    }
  }
}
