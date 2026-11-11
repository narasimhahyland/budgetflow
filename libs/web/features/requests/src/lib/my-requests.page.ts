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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SessionStore } from '@bf/web/data-access';
import { DateOnlyPipe, DateTimePipe, LoadState, Money, SpendStatus } from '@bf/web/ui';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SAT_TABLE_WITH_ROW_STATES_IMPORTS } from '@hylandsoftware/satori-ui/table-with-row-states';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';

type Tab = 'all' | 'drafts' | 'pending' | 'approved' | 'rejected';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];
const KIND: Record<string, string> = {
  budget: 'Event budget',
  additional_fund: 'Additional funds',
  spending: 'Spending',
  over_budget: 'Over budget',
  exception: 'Exception',
};

/** Screen 55 (with 64 request history and 119 request status): everything I asked for, with status and the next approver. */
@Component({
  selector: 'bf-my-requests-page',
  imports: [
    DateOnlyPipe,
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
    SAT_TABLE_WITH_ROW_STATES_IMPORTS,
    SatStatusTag,
    SpendStatus,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">My requests</h1>
        <p class="bf-page__subtitle">
          Everything you asked for, with its status and who approves next
        </p>
      </div>
      <div class="bf-page__actions">
        <button mat-flat-button type="button" [matMenuTriggerFor]="newMenu">
          <mat-icon svgIcon="circle_add" />New request
        </button>
        <mat-menu #newMenu="matMenu">
          <a mat-menu-item routerLink="/requests/new" [queryParams]="{ kind: 'spending' }"
            >Spending request</a
          >
          <a mat-menu-item routerLink="/requests/new" [queryParams]="{ kind: 'over_budget' }"
            >Over-budget request</a
          >
          @if (session.can('event.manage')) {
            <a mat-menu-item routerLink="/requests/event-funding">Funding for a team event</a>
          }
          <a mat-menu-item routerLink="/events">Additional funds or co-funding for an event</a>
        </mat-menu>
        <a mat-stroked-button routerLink="/requests/approved">Approved for you</a>
        <a mat-stroked-button routerLink="/requests/upload"
          ><mat-icon svgIcon="upload" />Upload receipt</a
        >
      </div>
    </header>
    <sat-navigation-tabs class="bf-tabs" aria-label="Request status">
      @for (t of tabs; track t.id) {
        <a
          satNavigationTab
          [active]="tab() === t.id"
          (click)="setTab(t.id)"
          (keydown.enter)="setTab(t.id)"
          tabindex="0"
          >{{ t.label }} <span class="bf-chip">{{ counts()[t.id] }}</span></a
        >
      }
    </sat-navigation-tabs>
    <section class="bf-card" aria-labelledby="requests-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="requests-title">{{ rows().length }} requests</h2>
      </div>
      <div class="bf-filters">
        <mat-form-field class="bf-search" appearance="outline" subscriptSizing="dynamic">
          <mat-label>Search title or reference</mat-label>
          <mat-icon matPrefix svgIcon="search" aria-hidden="true" />
          <input
            matInput
            placeholder="For example REQ-00007 or team lunch"
            [ngModel]="q()"
            (ngModelChange)="search($event)"
          />
        </mat-form-field>
      </div>
      <bf-load-state
        [loading]="list.isLoading() && !list.hasValue()"
        [error]="list.error()"
        what="your requests"
        (retry)="list.reload()"
      />
      @if (list.hasValue()) {
        @if (rows().length === 0) {
          <sat-empty-state>
            <h2 satEmptyStateHeadline>
              You have no requests {{ tab() === 'all' ? 'yet' : 'here' }}
            </h2>
            <p satEmptyStateDescription>Ask for money from a budget you may request from.</p>
            <a satEmptyStateAction mat-stroked-button routerLink="/requests/new">New request</a>
          </sat-empty-state>
        } @else {
          <div class="bf-table-scroll">
            <table
              mat-table
              satTableWithRowStates
              class="bf-table bf-table--stack"
              [dataSource]="rows()"
              aria-label="My requests"
            >
              <ng-container matColumnDef="title">
                <th mat-header-cell *matHeaderCellDef>Request</th>
                <td mat-cell *matCellDef="let r" data-label="Request">
                  <span class="bf-request">
                    <a
                      satRowPrimaryAction
                      class="bf-cell__primary"
                      [routerLink]="['/requests', r.id]"
                      >{{ r.title }}</a
                    >
                    <span class="bf-cell__secondary"
                      ><span class="bf-cell__code">{{ r.ref }}</span> {{ kind(r.kind)
                      }}{{ r.eventName ? ' · ' + r.eventName : '' }}</span
                    >
                  </span>
                </td>
              </ng-container>
              <ng-container matColumnDef="amount">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Amount</th>
                <td mat-cell *matCellDef="let r" class="bf-num" data-label="Amount">
                  <bf-money [amountMinor]="r.amount.amountMinor" [currency]="r.amount.currency" />
                  @if (r.approvedAmount && r.approvedAmount.amountMinor !== r.amount.amountMinor) {
                    <span class="bf-cell__secondary"
                      >approved
                      <bf-money
                        [amountMinor]="r.approvedAmount.amountMinor"
                        [currency]="r.approvedAmount.currency"
                    /></span>
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="budget">
                <th mat-header-cell *matHeaderCellDef>Budget</th>
                <td mat-cell *matCellDef="let r" class="bf-nowrap" data-label="Budget">
                  {{ r.budgetName }}
                </td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let r" data-label="Status">
                  <span class="bf-stack">
                    <span class="bf-tags">
                      <bf-spend-status kind="request" [status]="r.status" />
                      @if (r.onHold) {
                        <sat-status-tag status="info"
                          ><mat-icon svgIcon="lock" aria-hidden="true" />On hold: budget
                          frozen</sat-status-tag
                        >
                      }
                    </span>
                    @if (r.status === 'rejected' && r.decisionReason) {
                      <span class="bf-cell__secondary">{{ r.decisionReason }}</span>
                    }
                    @if (r.status === 'cancelled' && r.cancelReason) {
                      <span class="bf-cell__secondary">{{ r.cancelReason }}</span>
                    }
                  </span>
                </td>
              </ng-container>
              <ng-container matColumnDef="step">
                <th mat-header-cell *matHeaderCellDef>Current step</th>
                <td mat-cell *matCellDef="let r" data-label="Current step">
                  @if (r.currentStep) {
                    <span class="bf-stack">
                      <span class="bf-cell__primary">{{ r.currentStep.approverName }}</span>
                      <span class="bf-cell__secondary" data-testid="relative-time"
                        >due
                        {{
                          r.currentStep.dueAt | bfDateTime: session.timezone() : 'd MMM, HH:mm'
                        }}</span
                      >
                    </span>
                  } @else {
                    —
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="updated">
                <th mat-header-cell *matHeaderCellDef>Updated</th>
                <td mat-cell *matCellDef="let r" data-label="Updated">
                  <span data-testid="relative-time">{{
                    r.updatedAt | bfDate: session.timezone()
                  }}</span>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr
                mat-row
                satRowState
                *matRowDef="let row; columns: columns"
                [class.bf-row--info]="row.onHold"
              ></tr>
            </table>
          </div>
        }
      }
    </section>
  `,
  styles: `
    .bf-search {
      flex: 1 1 320px;
      max-width: 480px;
    }
    .bf-request {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 200px;
    }
    .bf-nowrap {
      white-space: nowrap;
    }
    .bf-stack {
      display: inline-flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
    }
    @media (width < 600px) {
      .bf-stack {
        align-items: flex-end;
        text-align: end;
      }
    }
    .bf-tags {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      white-space: nowrap;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyRequestsPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);
  protected readonly tabs = TABS;
  protected readonly columns = ['title', 'amount', 'budget', 'status', 'step', 'updated'];
  protected readonly tab = signal<Tab>(
    (this.route.snapshot.queryParamMap.get('tab') as Tab) ?? 'all',
  );
  protected readonly q = signal(this.route.snapshot.queryParamMap.get('q') ?? '');
  private readonly debounced = signal(this.q());
  private readonly budgetId = this.route.snapshot.queryParamMap.get('budget');
  private timer: ReturnType<typeof setTimeout> | undefined;

  protected readonly list = resource({
    params: () => ({
      scope: 'mine' as const,
      tab: this.tab(),
      ...(this.debounced() ? { q: this.debounced() } : {}),
      ...(this.budgetId ? { budgetId: this.budgetId } : {}),
      limit: 100,
    }),
    loader: ({ params }) => data(this.api.listRequests({ query: params })),
  });
  protected readonly rows = computed(() => valueOf(this.list)?.items ?? []);
  protected readonly counts = computed(
    () => valueOf(this.list)?.counts ?? { all: 0, drafts: 0, pending: 0, approved: 0, rejected: 0 },
  );

  protected kind(k: string): string {
    return KIND[k] ?? k;
  }

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    void this.router.navigate([], {
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected search(value: string): void {
    this.q.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.debounced.set(value.trim()), 250);
  }
}
