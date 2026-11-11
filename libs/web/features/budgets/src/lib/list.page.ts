import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { map } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { BudgetDetail } from '@bf/contracts';
import { BudgetStatus, LoadState, Money } from '@bf/web/ui';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import {
  balancesOf,
  BUDGET_TYPE_LABEL,
  data,
  downloadCsv,
  exportAmount,
  initials,
  injectApi,
  valueOf,
} from './api';
import { UsageBar } from './widgets';

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'frozen', label: 'Frozen' },
  { key: 'set_to_zero', label: 'Set to zero' },
  { key: 'draft', label: 'Draft' },
] as const;

/** Screen 19: every budget the user can see, filterable, with Available per the company definition note. */
@Component({
  selector: 'bf-budget-list-page',
  imports: [
    BudgetStatus,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
    SAT_TAG_IMPORTS,
    SatAvatar,
    UsageBar,
  ],
  styleUrl: './page.scss',
  styles: `
    .bf-tabs {
      padding: 0 12px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .bf-tab__count {
      padding: 0 6px;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container-high);
      font: var(--mat-sys-label-small);
    }
    .bf-banner {
      margin: 12px 16px 0;
    }
    .bf-nowrap {
      white-space: nowrap;
    }
    .bf-available {
      color: var(--sat-sys-on-success-container);
      font-weight: 600;
    }
    .bf-available--info {
      color: var(--sat-sys-on-info-container);
    }
    .bf-available--important {
      color: var(--sat-sys-on-important-container);
    }
    a.bf-cell__primary {
      color: var(--mat-sys-on-surface);
      text-decoration: none;
    }
    a.bf-cell__primary:hover {
      color: var(--mat-sys-primary);
      text-decoration: underline;
    }
    .bf-more {
      padding: 12px 16px;
    }
  `,
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Budgets</h1>
        <p class="bf-page__subtitle">Hyland · {{ fyLabel() }} · all amounts in USD</p>
      </div>
      <div class="bf-page__actions">
        <button mat-stroked-button type="button" (click)="export()" [disabled]="!items().length">
          <mat-icon svgIcon="download" aria-hidden="true" />Export
        </button>
        <a mat-stroked-button routerLink="/budgets/plans"
          ><mat-icon svgIcon="upload" aria-hidden="true" />Import plan</a
        >
        <a mat-flat-button routerLink="/budgets/new"
          ><mat-icon svgIcon="plus_small" aria-hidden="true" />Create budget</a
        >
      </div>
    </header>
    <section class="bf-card">
      <div class="bf-filters">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Search budgets</mat-label>
          <input matInput [ngModel]="q()" (ngModelChange)="q.set($event)" data-testid="search" />
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Fiscal year</mat-label>
          <mat-select [ngModel]="fy()" (ngModelChange)="fy.set($event)">
            @for (y of years(); track y.id) {
              <mat-option [value]="y.id">{{ y.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Type</mat-label>
          <mat-select [ngModel]="type()" (ngModelChange)="type.set($event)">
            <mat-option value="">Any</mat-option>
            @for (t of types; track t[0]) {
              <mat-option [value]="t[0]">{{ t[1] }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        @if (q() || type()) {
          <button mat-button type="button" (click)="q.set(''); type.set('')">Clear</button>
        }
      </div>
      <sat-navigation-tabs class="bf-tabs" aria-label="Status">
        @for (t of tabs; track t.key) {
          <a
            satNavigationTab
            [active]="tab() === t.key"
            [routerLink]="[]"
            [queryParams]="{ status: t.key === 'all' ? null : t.key }"
            queryParamsHandling="merge"
            replaceUrl
            >{{ t.label }} <span class="bf-tab__count">{{ counts()[t.key] ?? 0 }}</span></a
          >
        }
      </sat-navigation-tabs>
      <sat-banner variant="info" class="bf-banner"
        ><sat-banner-message
          >Available = budget − pending requests − committed − actual. Each budget’s own control
          rules apply on its details page.</sat-banner-message
        ></sat-banner
      >
      <bf-load-state
        shape="table"
        [loading]="list.isLoading()"
        [error]="list.error()"
        what="budgets"
        (retry)="list.reload()"
      />
      @if (!list.isLoading() && list.hasValue() && rows().length === 0) {
        <sat-empty-state>
          <h2 satEmptyStateHeadline>No budgets match</h2>
          <p satEmptyStateDescription>Change the filters, or create a budget.</p>
          @if (q() || type() || tab() !== 'all') {
            <a
              mat-stroked-button
              satEmptyStateAction
              [routerLink]="[]"
              [queryParams]="{ status: null }"
              (click)="q.set(''); type.set('')"
              ><mat-icon svgIcon="clear_filter" aria-hidden="true" />Clear filters</a
            >
          } @else {
            <a mat-flat-button satEmptyStateAction routerLink="/budgets/new"
              ><mat-icon svgIcon="plus_small" aria-hidden="true" />Create budget</a
            >
          }
        </sat-empty-state>
      }
      @if (rows().length) {
        <div class="bf-table-scroll">
          <table mat-table class="bf-table" [dataSource]="rows()" aria-label="Budgets">
            <ng-container matColumnDef="budget">
              <th mat-header-cell *matHeaderCellDef>Budget</th>
              <td mat-cell *matCellDef="let b">
                <span class="bf-cell__name">
                  <a class="bf-cell__primary" [routerLink]="['/budgets', b.id]">{{ b.name }}</a>
                  @if (b.code) {
                    <span class="bf-cell__code">{{ b.code }}</span>
                  }
                </span>
                <span class="bf-cell__secondary">{{ b.display.parentName ?? 'Hyland' }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="owner">
              <th mat-header-cell *matHeaderCellDef>Owner</th>
              <td mat-cell *matCellDef="let b">
                @if (b.display.ownerName; as owner) {
                  <span class="bf-cell__owner"
                    ><sat-avatar size="28" [initials]="initials(owner)" aria-hidden="true" />{{
                      owner
                    }}</span
                  >
                } @else {
                  —
                }
              </td>
            </ng-container>
            <ng-container matColumnDef="type">
              <th mat-header-cell *matHeaderCellDef>Type</th>
              <td mat-cell *matCellDef="let b">
                <sat-category-tag category="gray">{{
                  b.allocationDriver === 'per_head' ? 'Per-head' : typeLabel(b.budgetType)
                }}</sat-category-tag>
              </td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let b" class="bf-nowrap">
                <bf-budget-status [status]="b.status" />
              </td>
            </ng-container>
            <ng-container matColumnDef="budgetAmount">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Budget (USD)</th>
              <td mat-cell *matCellDef="let b" class="bf-num">
                <bf-money [amountMinor]="bal(b).authorized" [currency]="b.currency" />
              </td>
            </ng-container>
            <ng-container matColumnDef="committed">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Committed (USD)</th>
              <td mat-cell *matCellDef="let b" class="bf-num">
                <bf-money [amountMinor]="bal(b).committed" [currency]="b.currency" />
              </td>
            </ng-container>
            <ng-container matColumnDef="actual">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Actual (USD)</th>
              <td mat-cell *matCellDef="let b" class="bf-num">
                <bf-money [amountMinor]="bal(b).actual" [currency]="b.currency" />
              </td>
            </ng-container>
            <ng-container matColumnDef="available">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Available (USD)</th>
              <td
                mat-cell
                *matCellDef="let b"
                class="bf-num bf-available"
                [class.bf-available--info]="b.status === 'frozen'"
                [class.bf-available--important]="b.status === 'set_to_zero'"
              >
                <bf-money
                  [amountMinor]="b.balances.available.amountMinor"
                  [currency]="b.currency"
                />
              </td>
            </ng-container>
            <ng-container matColumnDef="used">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Used</th>
              <td mat-cell *matCellDef="let b" class="bf-num">
                <bf-usage-bar [bps]="b.utilizationBps" [thresholds]="b.alertThresholdsPct" />
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns()"></tr>
            <tr
              mat-row
              *matRowDef="let row; columns: columns()"
              [class.bf-row--info]="row.status === 'frozen'"
              [class.bf-row--important]="row.status === 'set_to_zero'"
              [attr.data-testid]="'row-' + (row.code ?? row.id)"
            ></tr>
          </table>
        </div>
        @if (valueOf(list)?.nextCursor) {
          <div class="bf-more">
            <button mat-stroked-button type="button" (click)="more()">Load more</button>
          </div>
        }
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetListPage {
  private readonly api = injectApi();
  protected readonly valueOf = valueOf;
  protected readonly tabs = TABS;
  protected readonly types = Object.entries(BUDGET_TYPE_LABEL);
  private readonly size = toSignal(
    inject(BreakpointObserver)
      .observe(['(width < 600px)', '(width < 1024px)'])
      .pipe(
        map((s) =>
          s.breakpoints['(width < 600px)'] ? 'sm' : s.breakpoints['(width < 1024px)'] ? 'md' : 'lg',
        ),
      ),
    { initialValue: 'lg' },
  );
  /** Fewer columns on smaller screens, so Available and status stay in view without scrolling. */
  protected readonly columns = computed(() =>
    this.size() === 'sm'
      ? ['budget', 'status', 'available']
      : this.size() === 'md'
        ? ['budget', 'owner', 'status', 'budgetAmount', 'available', 'used']
        : [
            'budget',
            'owner',
            'type',
            'status',
            'budgetAmount',
            'committed',
            'actual',
            'available',
            'used',
          ],
  );
  protected readonly q = signal('');
  protected readonly type = signal('');
  private readonly route = inject(ActivatedRoute);
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly tab = computed(() => this.query().get('status') ?? 'all');
  protected readonly initials = initials;
  protected readonly fy = signal<string | null>(null);
  protected readonly limit = signal(200);
  private readonly calendars = resource({
    loader: async () => (await data(this.api.listFiscalCalendars({}))).items,
  });
  protected readonly years = computed(
    () => (valueOf(this.calendars) ?? []).find((c) => !c.groupCalendarId)?.years ?? [],
  );
  protected readonly fyLabel = computed(
    () => this.years().find((y) => y.id === this.fy())?.label ?? '',
  );

  constructor() {
    effect(() => {
      const ys = this.years();
      if (this.fy() || !ys.length) return;
      const today = new Date().toISOString().slice(0, 10);
      this.fy.set((ys.find((y) => y.startDate <= today && y.endDate >= today) ?? ys[0]).id);
    });
  }

  protected readonly list = resource({
    params: () =>
      this.fy()
        ? {
            fiscalYearId: this.fy()!,
            limit: this.limit(),
            ...(this.q().trim() ? { q: this.q().trim() } : {}),
            ...(this.type() ? { budgetType: this.type() as BudgetDetail['budgetType'] } : {}),
          }
        : undefined,
    loader: ({ params }) => data(this.api.listBudgets({ query: params })),
  });
  protected readonly items = computed(() => valueOf(this.list)?.items ?? []);
  protected readonly counts = computed(() => {
    const c: Record<string, number> = { all: this.items().length };
    for (const b of this.items()) {
      const key = ['reduced', 'partially_allocated', 'fully_allocated'].includes(b.status)
        ? 'active'
        : b.status;
      c[key] = (c[key] ?? 0) + 1;
    }
    return c;
  });
  protected readonly rows = computed(() =>
    this.items().filter((b) => {
      if (this.tab() === 'all') return true;
      if (this.tab() === 'active')
        return ['active', 'reduced', 'partially_allocated', 'fully_allocated'].includes(b.status);
      return b.status === this.tab();
    }),
  );

  protected bal(b: BudgetDetail) {
    return balancesOf(b);
  }

  protected typeLabel(t: string): string {
    return BUDGET_TYPE_LABEL[t] ?? t;
  }

  protected more(): void {
    this.limit.update((l) => Math.min(l + 200, 500));
  }

  protected export(): void {
    downloadCsv('budgets.csv', [
      [
        'Code',
        'Budget',
        'Parent',
        'Owner',
        'Type',
        'Status',
        'Budget (USD)',
        'Committed (USD)',
        'Actual (USD)',
        'Available (USD)',
      ],
      ...this.rows().map((b) => {
        const x = balancesOf(b);
        return [
          b.code ?? '',
          b.name,
          b.display.parentName ?? '',
          b.display.ownerName ?? '',
          b.budgetType,
          b.status,
          exportAmount(x.authorized, b.currency),
          exportAmount(x.committed, b.currency),
          exportAmount(x.actual, b.currency),
          exportAmount(x.available, b.currency),
        ];
      }),
    ]);
  }
}
