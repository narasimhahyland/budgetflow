import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { NotificationArea, NotificationItem, TaskItem } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState, MobileTabBar, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SatCategoryTag, SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { channelLabel } from './labels';

type Tab = 'all' | 'tasks' | 'mentions' | 'following';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'mentions', label: 'Mentions' },
  { id: 'following', label: 'Following' },
];
const AREAS: { id: NotificationArea; label: string }[] = [
  { id: 'approvals', label: 'Approvals' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'events', label: 'Events' },
  { id: 'requests', label: 'Requests' },
  { id: 'finance', label: 'Finance' },
  { id: 'discussion', label: 'Discussion' },
];

/**
 * Screen 123: Notifications and tasks (`/notifications` on desktop/tablet, `/m/alerts` on mobile).
 * Tabs: All, Tasks (derived from system state), Mentions, Following.
 */
@Component({
  selector: 'bf-notifications-page',
  imports: [
    DateTimePipe,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatMenuModule,
    MatTableModule,
    MobileTabBar,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
    SatCategoryTag,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Notifications and tasks</h1>
        <p class="bf-page__subtitle">
          Everything BudgetFlow has told you and everything waiting on your action
        </p>
      </div>
      <div class="bf-page__actions">
        <button
          mat-stroked-button
          type="button"
          [disabled]="busy() || counts().unread === 0"
          (click)="markAll(true)"
          data-testid="mark-all-read"
        >
          Mark all as read
        </button>
        <a mat-stroked-button routerLink="/me/notifications" data-testid="open-notif-settings"
          >Notification settings</a
        >
      </div>
    </header>

    <sat-navigation-tabs class="bf-tabs" aria-label="Notification sections">
      @for (t of tabs; track t.id) {
        <a
          satNavigationTab
          [active]="tab() === t.id"
          (click)="setTab(t.id)"
          (keydown.enter)="setTab(t.id)"
          tabindex="0"
          [attr.data-testid]="'tab-' + t.id"
        >
          {{ t.label }}
          @if (t.id === 'all') {
            <span class="bf-chip" data-testid="unread-count">{{ counts().unread }}</span>
          } @else if (t.id === 'tasks') {
            <span class="bf-chip" data-testid="tasks-count">{{ counts().tasks }}</span>
          } @else if (t.id === 'mentions') {
            <span class="bf-chip">{{ counts().mentions }}</span>
          } @else if (t.id === 'following') {
            <span class="bf-chip">{{ counts().following }}</span>
          }
        </a>
      }
    </sat-navigation-tabs>

    @if (tab() !== 'tasks') {
      <div class="bf-notif__filters" role="group" aria-label="Filter notifications">
        @for (a of areas; track a.id) {
          <button
            mat-stroked-button
            type="button"
            [class.bf-notif__chip--active]="areaFilter() === a.id"
            (click)="toggleArea(a.id)"
            [attr.data-testid]="'filter-area-' + a.id"
          >
            {{ a.label }}
          </button>
        }
        <button
          mat-stroked-button
          type="button"
          [class.bf-notif__chip--active]="unreadOnly()"
          (click)="unreadOnly.set(!unreadOnly())"
          data-testid="filter-unread"
        >
          Unread only
        </button>
        <button
          mat-stroked-button
          type="button"
          (click)="cyclePeriod()"
          data-testid="filter-period"
        >
          Last {{ periodDays() }} days
        </button>
        @if (areaFilter() || unreadOnly() || periodDays() !== 90) {
          <button mat-button type="button" (click)="clearFilters()" data-testid="clear-filters">
            Clear filters
          </button>
        }
      </div>
    }

    @if (selectedIds().size > 0 && tab() !== 'tasks') {
      <div
        class="bf-notif__selection"
        role="region"
        aria-label="Bulk actions"
        data-testid="selection-bar"
      >
        <span>{{ selectedIds().size }} selected</span>
        <div class="bf-notif__selection-actions">
          <button
            mat-stroked-button
            type="button"
            (click)="markSelected(true)"
            data-testid="bulk-mark-read"
          >
            Mark as read
          </button>
          <button
            mat-stroked-button
            type="button"
            (click)="markSelected(false)"
            data-testid="bulk-mark-unread"
          >
            Mark as unread
          </button>
          <button mat-button type="button" (click)="clearSelection()">Clear</button>
        </div>
      </div>
    }

    @if (failure()) {
      <sat-banner variant="important">
        <sat-banner-message>{{ failure() }}</sat-banner-message>
      </sat-banner>
    }

    <bf-load-state
      [loading]="feed.isLoading() && !feed.hasValue()"
      [error]="feed.error()"
      what="your notifications"
      (retry)="feed.reload()"
    />

    @if (feed.hasValue()) {
      @if (tab() === 'tasks') {
        @if (tasks().length === 0) {
          <sat-empty-state>
            <h2 satEmptyStateHeadline>You're all caught up</h2>
            <p satEmptyStateDescription>
              Tasks close themselves as soon as you approve, upload a receipt or submit commentary.
            </p>
            <a satEmptyStateAction mat-stroked-button routerLink="/me/notifications">
              Notification settings
            </a>
          </sat-empty-state>
        } @else {
          <section class="bf-card" aria-label="Open tasks">
            <div class="bf-card__header">
              <h2 class="bf-card__title">Actionable tasks ({{ tasks().length }})</h2>
              <span class="bf-card__hint">
                Sorted by due date; tasks close automatically when completed
              </span>
            </div>
            <div class="bf-table-scroll">
              <table
                mat-table
                class="bf-table bf-table--stack"
                [dataSource]="tasks()"
                aria-label="Open tasks"
                data-testid="tasks-table"
              >
                <ng-container matColumnDef="task">
                  <th mat-header-cell *matHeaderCellDef>Task</th>
                  <td mat-cell *matCellDef="let t">
                    <span class="bf-cell__primary">{{ t.title }}</span>
                    <span class="bf-cell__secondary">{{ t.subtitle }}</span>
                  </td>
                </ng-container>
                <ng-container matColumnDef="amount">
                  <th mat-header-cell *matHeaderCellDef class="bf-num">Amount</th>
                  <td mat-cell *matCellDef="let t" class="bf-num" data-label="Amount">
                    @if (t.amount) {
                      <bf-money
                        [amountMinor]="t.amount.amountMinor"
                        [currency]="t.amount.currency"
                      />
                    } @else {
                      —
                    }
                  </td>
                </ng-container>
                <ng-container matColumnDef="due">
                  <th mat-header-cell *matHeaderCellDef>Due</th>
                  <td mat-cell *matCellDef="let t" data-label="Due">
                    @if (t.overdue) {
                      <sat-status-tag status="warning">Overdue</sat-status-tag>
                    } @else if (t.dueToday) {
                      <sat-status-tag status="warning">Due today</sat-status-tag>
                    } @else if (t.dueAt) {
                      <span data-testid="relative-time">{{
                        t.dueAt | bfDateTime: session.timezone() : 'd MMM, HH:mm'
                      }}</span>
                    } @else {
                      —
                    }
                  </td>
                </ng-container>
                <ng-container matColumnDef="action">
                  <th mat-header-cell *matHeaderCellDef>Action</th>
                  <td mat-cell *matCellDef="let t" data-label="Action">
                    <a
                      mat-stroked-button
                      [routerLink]="parsePath(t.actionLink)"
                      [queryParams]="parseQuery(t.actionLink)"
                      [attr.data-testid]="'task-action-' + t.kind"
                    >
                      {{ t.actionLabel }}
                    </a>
                  </td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="taskColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: taskColumns"></tr>
              </table>
            </div>
          </section>
        }
      } @else {
        @if (tab() === 'following') {
          <div class="bf-notif__following-bar">
            <span>Activity on budgets, events and requests you follow.</span>
            <a mat-stroked-button routerLink="/me/following" data-testid="manage-following-link"
              >Manage followed items</a
            >
          </div>
        }
        @if (items().length === 0) {
          @if (areaFilter() || unreadOnly()) {
            <sat-empty-state>
              <h2 satEmptyStateHeadline>Nothing matches these filters</h2>
              <p satEmptyStateDescription>Clear the active filters to see all notifications.</p>
              <button satEmptyStateAction mat-stroked-button type="button" (click)="clearFilters()">
                Clear filters
              </button>
            </sat-empty-state>
          } @else {
            <sat-empty-state>
              <h2 satEmptyStateHeadline>You're all caught up</h2>
              <p satEmptyStateDescription>
                Approvals, budget alerts and discussion mentions will appear here.
              </p>
              <a satEmptyStateAction mat-stroked-button routerLink="/me/notifications">
                Notification settings
              </a>
            </sat-empty-state>
          }
        } @else {
          <section class="bf-card" aria-label="Notifications feed">
            <ul class="bf-notif__list" role="feed" data-testid="notifications-list">
              @for (n of items(); track n.id) {
                <li
                  class="bf-notif__row"
                  [class.bf-notif__row--unread]="!n.readAt"
                  [attr.aria-label]="(n.readAt ? 'Read: ' : 'Unread: ') + n.title"
                  [attr.data-testid]="'notif-' + n.id"
                >
                  <mat-checkbox
                    [checked]="selectedIds().has(n.id)"
                    (change)="toggleSelect(n.id, $event.checked)"
                    [attr.aria-label]="'Select ' + n.title"
                  />
                  <span
                    class="bf-notif__dot"
                    [class.bf-notif__dot--visible]="!n.readAt"
                    aria-hidden="true"
                  ></span>
                  <div class="bf-notif__main">
                    <div class="bf-notif__title-line">
                      <strong>{{ n.title }}</strong>
                      <sat-category-tag category="gray">{{ areaLabel(n.area) }}</sat-category-tag>
                    </div>
                    <p class="bf-notif__detail">{{ n.detail }}</p>
                    <div class="bf-notif__meta">
                      <span data-testid="relative-time">{{
                        n.createdAt | bfDateTime: session.timezone()
                      }}</span>
                      <span>· Delivered via {{ delivered(n) }}</span>
                      @if (!n.available && n.itemType) {
                        <span>· <strong>No longer available</strong></span>
                      }
                    </div>
                  </div>
                  <div class="bf-notif__actions">
                    @if (n.available && n.itemLink) {
                      <a
                        mat-stroked-button
                        [routerLink]="parsePath(n.itemLink)"
                        [queryParams]="parseQuery(n.itemLink)"
                        (click)="onOpenItem(n)"
                      >
                        {{ n.area === 'approvals' ? 'Review' : 'Open' }}
                      </a>
                    }
                    <button
                      mat-button
                      type="button"
                      (click)="markOne(n, !n.readAt)"
                      [attr.data-testid]="'toggle-read-' + n.id"
                    >
                      {{ n.readAt ? 'Mark as unread' : 'Mark as read' }}
                    </button>
                  </div>
                </li>
              }
            </ul>
          </section>
        }
      }
    }

    @if (isMobileRoute()) {
      <bf-mobile-tab-bar [approvalCount]="counts().tasks" [alertCount]="counts().unread" />
    }
  `,
  styles: `
    .bf-notif__filters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
      align-items: center;
    }
    .bf-notif__chip--active {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }
    .bf-notif__selection {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      margin-bottom: 12px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-secondary-container);
    }
    .bf-notif__selection-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .bf-notif__following-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    .bf-notif__list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .bf-notif__row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .bf-notif__row--unread {
      background: var(--mat-sys-surface-container-low);
    }
    .bf-notif__dot {
      width: 8px;
      height: 8px;
      margin-top: 8px;
      border-radius: var(--mat-sys-corner-full);
      background: transparent;
      flex: none;
    }
    .bf-notif__dot--visible {
      background: var(--mat-sys-primary);
    }
    .bf-notif__main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .bf-notif__title-line {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .bf-notif__detail {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
    .bf-notif__meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-notif__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);

  protected readonly tabs = TABS;
  protected readonly areas = AREAS;
  protected readonly taskColumns = ['task', 'amount', 'due', 'action'];
  protected readonly isMobileRoute = computed(() => this.router.url.startsWith('/m/'));

  protected readonly tab = signal<Tab>(
    (this.route.snapshot.queryParamMap.get('tab') as Tab) ?? 'all',
  );
  protected readonly areaFilter = signal<NotificationArea | undefined>(undefined);
  protected readonly unreadOnly = signal(false);
  protected readonly periodDays = signal(90);
  protected readonly selectedIds = signal<Set<string>>(new Set());
  protected readonly busy = signal(false);
  protected readonly failure = signal('');

  protected readonly feed = resource({
    params: () => ({
      tab: this.tab(),
      area: this.areaFilter(),
      unreadOnly: this.unreadOnly() ? true : undefined,
      periodDays: this.periodDays(),
    }),
    loader: ({ params }) => data(this.api.listNotifications({ query: params })),
  });

  protected readonly items = computed<NotificationItem[]>(() => valueOf(this.feed)?.items ?? []);
  protected readonly tasks = computed<TaskItem[]>(() => valueOf(this.feed)?.tasks ?? []);
  protected readonly counts = computed(
    () =>
      valueOf(this.feed)?.counts ?? {
        unread: 0,
        tasks: 0,
        mentions: 0,
        following: 0,
      },
  );

  protected setTab(t: Tab): void {
    this.tab.set(t);
    this.clearSelection();
    void this.router.navigate([], {
      queryParams: { tab: t === 'all' ? null : t },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected toggleArea(area: NotificationArea): void {
    this.areaFilter.set(this.areaFilter() === area ? undefined : area);
  }

  protected cyclePeriod(): void {
    const cur = this.periodDays();
    this.periodDays.set(cur === 90 ? 7 : cur === 7 ? 30 : 90);
  }

  protected clearFilters(): void {
    this.areaFilter.set(undefined);
    this.unreadOnly.set(false);
    this.periodDays.set(90);
  }

  protected toggleSelect(id: string, checked: boolean): void {
    const next = new Set(this.selectedIds());
    if (checked) next.add(id);
    else next.delete(id);
    this.selectedIds.set(next);
  }

  protected clearSelection(): void {
    this.selectedIds.set(new Set());
  }

  /** The area a notification belongs to is a category, not a status. */
  protected areaLabel(area: NotificationArea): string {
    return AREAS.find((a) => a.id === area)?.label ?? area;
  }

  protected delivered(n: NotificationItem): string {
    return n.channelsDelivered.map(channelLabel).join(', ');
  }

  protected parsePath(link: string): string {
    return link.split('?')[0].split('#')[0];
  }

  protected parseQuery(link: string): Record<string, string> {
    const q = link.split('?')[1]?.split('#')[0];
    if (!q) return {};
    return Object.fromEntries(new URLSearchParams(q).entries());
  }

  protected onOpenItem(n: NotificationItem): void {
    if (!n.readAt) {
      void this.markOne(n, true);
    }
  }

  protected async markOne(n: NotificationItem, read: boolean): Promise<void> {
    this.busy.set(true);
    try {
      await data(this.api.markNotifications({ body: { ids: [n.id], read } }));
      this.feed.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async markSelected(read: boolean): Promise<void> {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    this.busy.set(true);
    try {
      await data(this.api.markNotifications({ body: { ids, read } }));
      this.snack.open(read ? 'Marked as read' : 'Marked as unread', undefined, { duration: 3000 });
      this.clearSelection();
      this.feed.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async markAll(read: boolean): Promise<void> {
    this.busy.set(true);
    try {
      await data(this.api.markNotifications({ body: { markAll: true, read } }));
      this.snack.open('All notifications marked as read', undefined, { duration: 3000 });
      this.feed.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
