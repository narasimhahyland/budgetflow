import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ErrorStateMatcher } from '@angular/material/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { BudgetDetail, BudgetLimit, BudgetVersion } from '@bf/contracts';
import { BudgetStatus, Money, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { can, data, errorMessage, flagMatcher, injectApi, toMajor, toMinor, valueOf } from './api';
import { BudgetActions } from './budget-actions';
import { UsageBar } from './widgets';

const TAB_STYLES = `
  .bf-tab-body { padding: 8px 20px 20px; }
  .bf-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 20px; }
  .bf-grow { flex: 1; }
  .bf-num-input { width: 110px; }
  .bf-num-input input { text-align: end; font-variant-numeric: tabular-nums; }
  .bf-total { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 20px; border-top: 1px solid var(--mat-sys-outline-variant); font: var(--mat-sys-title-small); }
  .bf-bad { color: var(--mat-sys-error); }
  .bf-ok { color: var(--sat-sys-on-success-container); }
  .bf-warn { color: var(--sat-sys-on-warning-container); }
  .bf-move { display: inline-flex; align-items: center; gap: 2px; }
  .bf-move mat-icon { width: 16px; height: 16px; }
`;

/** Children of a budget with allocate actions. */
@Component({
  selector: 'bf-children-tab',
  imports: [
    BudgetStatus,
    LoadState,
    MatButtonModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_EMPTY_STATE_IMPORTS,
    UsageBar,
  ],
  styleUrl: './page.scss',
  styles: TAB_STYLES,
  template: `
    <div class="bf-toolbar">
      <span class="bf-grow bf-card__hint">
        Allocated out
        <bf-money
          [amountMinor]="budget().balances.budgetCurrency.allocatedOut.amountMinor"
          [currency]="budget().currency"
        />
        · available to allocate
        <bf-money
          [amountMinor]="budget().balances.allocationAvailable.amountMinor"
          [currency]="budget().currency"
        />
      </span>
      @if (can(budget(), 'budget.create_child')) {
        <a mat-stroked-button routerLink="/budgets/new" [queryParams]="{ parent: budget().id }"
          >Create child budget</a
        >
      }
      @if (can(budget(), 'budget.allocate')) {
        <a mat-flat-button routerLink="/budgets/allocate" [queryParams]="{ parent: budget().id }"
          >Open allocation grid</a
        >
      }
    </div>
    <bf-load-state
      shape="table"
      [loading]="list.isLoading()"
      [error]="list.error()"
      what="child budgets"
      (retry)="list.reload()"
    />
    @if (list.hasValue() && rows().length === 0) {
      <sat-empty-state>
        <h2 satEmptyStateHeadline>No child budgets</h2>
        <p satEmptyStateDescription>Create a child budget to delegate part of this budget.</p>
      </sat-empty-state>
    }
    @if (rows().length) {
      <div class="bf-table-scroll">
        <table mat-table class="bf-table" [dataSource]="rows()" aria-label="Child budgets">
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Budget</th>
            <td mat-cell *matCellDef="let c">
              <a class="bf-cell__primary" [routerLink]="['/budgets', c.id]">{{ c.name }}</a>
              <span class="bf-cell__secondary">{{ c.display.ownerName ?? 'No owner' }}</span>
            </td>
          </ng-container>
          <ng-container matColumnDef="authorized">
            <th mat-header-cell *matHeaderCellDef class="bf-num">Authorized</th>
            <td mat-cell *matCellDef="let c" class="bf-num">
              <bf-money
                [amountMinor]="c.balances.budgetCurrency.authorized.amountMinor"
                [currency]="c.currency"
              />
            </td>
          </ng-container>
          <ng-container matColumnDef="available">
            <th mat-header-cell *matHeaderCellDef class="bf-num">Available</th>
            <td mat-cell *matCellDef="let c" class="bf-num">
              <bf-money [amountMinor]="c.balances.available.amountMinor" [currency]="c.currency" />
            </td>
          </ng-container>
          <ng-container matColumnDef="used">
            <th mat-header-cell *matHeaderCellDef class="bf-num">Used</th>
            <td mat-cell *matCellDef="let c" class="bf-num">
              <bf-usage-bar [bps]="c.utilizationBps" [thresholds]="c.alertThresholdsPct" />
            </td>
          </ng-container>
          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let c"><bf-budget-status [status]="c.status" /></td>
          </ng-container>
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef>
              <span class="bf-visually-hidden">Actions</span>
            </th>
            <td mat-cell *matCellDef="let c">
              @if (can(budget(), 'budget.allocate')) {
                <button mat-button type="button" (click)="allocate(c.id)">Allocate</button>
              }
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns"></tr>
        </table>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChildrenTab {
  private readonly api = injectApi();
  private readonly actions = inject(BudgetActions);
  readonly budget = input.required<BudgetDetail>();
  readonly changed = output<void>();
  protected readonly can = can;
  protected readonly columns = ['name', 'authorized', 'available', 'used', 'status', 'actions'];
  protected readonly list = resource({
    params: () => ({ parentId: this.budget().id, v: this.budget().version }),
    loader: async ({ params }) =>
      (await data(this.api.listBudgets({ query: { parentId: params.parentId, limit: 500 } })))
        .items,
  });
  protected readonly rows = computed(() => valueOf(this.list) ?? []);

  protected async allocate(childId: string): Promise<void> {
    if (await this.actions.allocate(this.budget(), childId)) {
      this.list.reload();
      this.changed.emit();
    }
  }
}

/** Screen 32a: period phasing (even, seasonal, manual) with committed and actual per period. */
@Component({
  selector: 'bf-phasing-tab',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  styleUrl: './page.scss',
  styles:
    TAB_STYLES +
    `
    .bf-periods td { vertical-align: middle; }
    .bf-closed td { color: var(--mat-sys-on-surface-variant); }
    .bf-period { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  `,
  template: `
    <bf-load-state
      shape="table"
      [loading]="res.isLoading()"
      [error]="res.error()"
      what="phasing"
      (retry)="res.reload()"
    />
    @if (valueOf(res); as p) {
      @if (mismatch(); as diff) {
        <sat-banner variant="important" data-testid="phasing-error"
          ><sat-banner-message
            >Phasing is
            <bf-money [amountMinor]="diff > 0 ? diff : -diff" [currency]="p.currency" />
            {{ diff > 0 ? 'over' : 'under' }} the authorized amount. Change a period so the total
            equals
            <bf-money
              [amountMinor]="p.authorizedMinor"
              [currency]="p.currency"
            />.</sat-banner-message
          ></sat-banner
        >
      } @else if (problem(); as msg) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ msg }}</sat-banner-message></sat-banner
        >
      } @else if (p.outOfDate) {
        <sat-banner variant="warning"
          ><sat-banner-message
            >The phasing no longer adds up to the authorized amount; save it again to
            rebalance.</sat-banner-message
          ></sat-banner
        >
      }
      <div class="bf-toolbar">
        <mat-button-toggle-group
          [value]="method()"
          (change)="method.set($event.value)"
          aria-label="Phasing method"
          [disabled]="!editable()"
        >
          <mat-button-toggle value="even">Even</mat-button-toggle>
          <mat-button-toggle value="seasonal">Seasonal</mat-button-toggle>
          <mat-button-toggle value="manual">Manual</mat-button-toggle>
        </mat-button-toggle-group>
        <span class="bf-grow bf-card__hint"
          >Phasing controls when budget becomes available; it never changes the authorized
          amount.</span
        >
      </div>
      <div class="bf-table-scroll">
        <table class="bf-periods bf-split-table" aria-label="Periods">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col" class="bf-num">
                {{
                  method() === 'seasonal'
                    ? 'Weight'
                    : method() === 'manual'
                      ? 'Allotment (USD)'
                      : 'Allotment'
                }}
              </th>
              <th scope="col" class="bf-num">Phased now</th>
              <th scope="col" class="bf-num bf-hide-sm">Committed</th>
              <th scope="col" class="bf-num bf-hide-sm">Actual</th>
            </tr>
          </thead>
          <tbody>
            @for (row of p.periods; track row.periodId; let i = $index) {
              <tr [class.bf-closed]="row.status !== 'open'">
                <td>
                  <span class="bf-period"
                    >{{ row.label }}
                    @if (row.status !== 'open') {
                      <sat-status-tag status="neutral"
                        ><mat-icon svgIcon="lock" aria-hidden="true" />{{
                          periodLabel(row.status)
                        }}</sat-status-tag
                      >
                    }
                  </span>
                </td>
                <td class="bf-num">
                  @if (method() === 'seasonal') {
                    <mat-form-field class="bf-num-input" subscriptSizing="dynamic"
                      ><input
                        matInput
                        type="number"
                        min="0"
                        [ngModel]="weights()[i]"
                        (ngModelChange)="setWeight(i, $event)"
                        [disabled]="!editable() || row.status !== 'open'"
                        [attr.aria-label]="'Weight for ' + row.label"
                    /></mat-form-field>
                  } @else if (method() === 'manual') {
                    <mat-form-field class="bf-num-input" subscriptSizing="dynamic"
                      ><input
                        matInput
                        inputmode="decimal"
                        [ngModel]="amounts()[i]"
                        (ngModelChange)="setAmount(i, $event)"
                        [disabled]="!editable() || row.status !== 'open'"
                        [errorStateMatcher]="amountError(i)"
                        [attr.aria-label]="'Amount for ' + row.label"
                      />
                      <mat-error><mat-icon svgIcon="error" aria-hidden="true" />Too high</mat-error>
                    </mat-form-field>
                  } @else {
                    —
                  }
                </td>
                <td class="bf-num">
                  <bf-money [amountMinor]="row.allotmentMinor" [currency]="p.currency" />
                </td>
                <td class="bf-num bf-hide-sm">
                  <bf-money [amountMinor]="row.committedMinor" [currency]="p.currency" />
                </td>
                <td class="bf-num bf-hide-sm">
                  <bf-money [amountMinor]="row.actualMinor" [currency]="p.currency" />
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="bf-total">
        <span>Total phased</span>
        <span [class.bf-bad]="manualTotal() !== null && manualTotal() !== p.authorizedMinor">
          <bf-money [amountMinor]="manualTotal() ?? p.phasedMinor" [currency]="p.currency" />
        </span>
        <span class="bf-card__hint"
          >of
          <bf-money [amountMinor]="p.authorizedMinor" [currency]="p.currency" /> authorized</span
        >
        <span class="bf-grow"></span>
        @if (editable()) {
          <button
            mat-flat-button
            type="button"
            [disabled]="busy() || mismatch() !== 0"
            (click)="save()"
            data-testid="save-phasing"
          >
            Save phasing
          </button>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhasingTab {
  private readonly api = injectApi();
  readonly budget = input.required<BudgetDetail>();
  readonly changed = output<void>();
  protected readonly valueOf = valueOf;
  protected readonly res = resource({
    params: () => ({ id: this.budget().id, v: this.budget().version }),
    loader: ({ params }) => data(this.api.getPhasing({ params: { budgetId: params.id } })),
  });
  protected readonly method = signal<'even' | 'seasonal' | 'manual'>('even');
  protected readonly weights = signal<number[]>([]);
  protected readonly amounts = signal<string[]>([]);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly editable = computed(() => can(this.budget(), 'budget.settings'));

  constructor() {
    effect(() => {
      const p = valueOf(this.res);
      if (!p) return;
      this.method.set(p.method ?? 'even');
      this.weights.set(p.periods.map(() => 1));
      this.amounts.set(p.periods.map((r) => toMajor(r.allotmentMinor)));
    });
  }

  protected readonly manualTotal = computed(() => {
    if (this.method() !== 'manual') return null;
    return this.amounts().reduce((s, a) => s + (toMinor(a) ?? 0), 0);
  });
  /** Manual amounts minus authorized (0 when they add up or the method is not manual). */
  protected readonly mismatch = computed(() => {
    const total = this.manualTotal();
    const p = valueOf(this.res);
    return total === null || !p ? 0 : total - p.authorizedMinor;
  });

  protected setWeight(i: number, v: number): void {
    this.weights.update((w) => w.map((x, j) => (j === i ? Number(v) || 0 : x)));
  }
  protected setAmount(i: number, v: string): void {
    this.amounts.update((w) => w.map((x, j) => (j === i ? v : x)));
    this.lastEdited.set(i);
  }

  /** The period last typed into is the one that broke the total: it shows the field error. */
  private readonly lastEdited = signal<number | null>(null);
  private readonly matchers = new Map<number, ErrorStateMatcher>();
  protected amountError(i: number): ErrorStateMatcher {
    let m = this.matchers.get(i);
    if (!m) {
      m = flagMatcher(() => this.mismatch() > 0 && this.lastEdited() === i);
      this.matchers.set(i, m);
    }
    return m;
  }

  protected periodLabel(status: string): string {
    return PERIOD_LABEL[status] ?? status.replace(/_/g, ' ');
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    this.problem.set(null);
    try {
      await data(
        this.api.setPhasing({
          params: { budgetId: this.budget().id },
          body: {
            method: this.method(),
            ...(this.method() === 'seasonal' ? { weights: this.weights() } : {}),
            ...(this.method() === 'manual'
              ? { amountsMinor: this.amounts().map((a) => toMinor(a) ?? 0) }
              : {}),
          },
        }),
      );
      this.res.reload();
      this.changed.emit();
    } catch (e) {
      this.problem.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

const PERIOD_LABEL: Record<string, string> = {
  soft_closed: 'Soft-closed',
  closed: 'Closed',
  locked: 'Locked',
};

/** Category, per-event and per-person limits by location. */
@Component({
  selector: 'bf-limits-tab',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
  ],
  styleUrl: './page.scss',
  styles:
    TAB_STYLES +
    `
    .bf-limit { display: grid; grid-template-columns: 160px 180px 180px 140px 120px 40px; gap: 8px; align-items: center; padding: 4px 20px; }
    @media (max-width: 900px) { .bf-limit { grid-template-columns: 1fr 1fr; } }
  `,
  template: `
    <bf-load-state
      shape="table"
      [loading]="res.isLoading()"
      [error]="res.error()"
      what="limits"
      (retry)="res.reload()"
    />
    @if (res.hasValue()) {
      <div class="bf-toolbar">
        <span class="bf-grow bf-card__hint"
          >Requests on this budget are checked against these limits (planned attendance for
          per-person limits).</span
        >
        @if (editable()) {
          <button mat-stroked-button type="button" (click)="add()">
            <mat-icon svgIcon="plus_small" aria-hidden="true" />Add limit
          </button>
        }
      </div>
      @if (items().length === 0) {
        <sat-empty-state>
          <h2 satEmptyStateHeadline>No limits</h2>
          <p satEmptyStateDescription>Only the budget’s available amount and control mode apply.</p>
        </sat-empty-state>
      }
      @for (l of items(); track $index; let i = $index) {
        <div class="bf-limit" [attr.data-testid]="'limit-' + i">
          <mat-form-field subscriptSizing="dynamic"
            ><mat-label>Kind</mat-label>
            <mat-select
              [ngModel]="l.kind"
              (ngModelChange)="patch(i, { kind: $event })"
              [disabled]="!editable()"
            >
              <mat-option value="category">Category</mat-option>
              <mat-option value="per_event">Per event</mat-option>
              <mat-option value="per_person">Per person</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic"
            ><mat-label>Category</mat-label>
            <mat-select
              [ngModel]="l.categoryCode"
              (ngModelChange)="patch(i, { categoryCode: $event })"
              [disabled]="!editable()"
            >
              <mat-option [value]="null">Any</mat-option>
              @for (c of categories(); track c.code) {
                <mat-option [value]="c.code">{{ c.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic"
            ><mat-label>Location</mat-label>
            <mat-select
              [ngModel]="l.orgUnitId"
              (ngModelChange)="patch(i, { orgUnitId: $event })"
              [disabled]="!editable()"
            >
              <mat-option [value]="null">Every location</mat-option>
              @for (u of locations(); track u.id) {
                <mat-option [value]="u.id">{{ u.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic"
            ><mat-label>Limit</mat-label>
            <span matTextPrefix>{{ budget().currency }}&nbsp;</span>
            <input
              matInput
              inputmode="decimal"
              [ngModel]="amountText(l)"
              (ngModelChange)="patch(i, { amountMinor: toMinor($event) ?? 0 })"
              [disabled]="!editable()"
            />
          </mat-form-field>
          <mat-form-field subscriptSizing="dynamic"
            ><mat-label>Mode</mat-label>
            <mat-select
              [ngModel]="l.mode"
              (ngModelChange)="patch(i, { mode: $event })"
              [disabled]="!editable()"
            >
              <mat-option value="hard">Hard</mat-option>
              <mat-option value="soft">Soft</mat-option>
            </mat-select>
          </mat-form-field>
          @if (editable()) {
            <button mat-icon-button type="button" (click)="remove(i)" aria-label="Remove limit">
              <mat-icon svgIcon="minus_small" aria-hidden="true" />
            </button>
          }
        </div>
      }
      @if (failure()) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
      @if (editable()) {
        <div class="bf-total">
          <span class="bf-grow"></span
          ><button
            mat-flat-button
            type="button"
            [disabled]="busy()"
            (click)="save()"
            data-testid="save-limits"
          >
            Save limits
          </button>
        </div>
      } @else {
        <p class="bf-card__hint bf-tab-body">
          The owner of the parent budget or finance sets the limits.
        </p>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LimitsTab {
  private readonly api = injectApi();
  readonly budget = input.required<BudgetDetail>();
  protected readonly toMinor = toMinor;
  protected readonly res = resource({
    params: () => ({ id: this.budget().id }),
    loader: ({ params }) => data(this.api.getBudgetLimits({ params: { budgetId: params.id } })),
  });
  private readonly cats = resource({
    loader: async () => (await data(this.api.listCategories({}))).items,
  });
  protected readonly categories = computed(() => valueOf(this.cats) ?? []);
  private readonly units = resource({
    loader: async () => (await data(this.api.listOrgUnits({}))).items,
  });
  protected readonly locations = computed(() =>
    (valueOf(this.units) ?? []).filter((u) => u.kind === 'location'),
  );
  protected readonly items = signal<BudgetLimit[]>([]);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly editable = computed(() => can(this.budget(), 'budget.control'));

  constructor() {
    effect(() => {
      const l = valueOf(this.res);
      if (l) this.items.set(l.items.map((x) => ({ ...x })));
    });
  }

  protected amountText(l: BudgetLimit): string {
    return toMajor(l.amountMinor);
  }
  protected patch(i: number, p: Partial<BudgetLimit>): void {
    this.items.update((list) => list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  }
  protected add(): void {
    this.items.update((l) => [
      ...l,
      { kind: 'per_person', categoryCode: null, orgUnitId: null, amountMinor: 2_500, mode: 'hard' },
    ]);
  }
  protected remove(i: number): void {
    this.items.update((l) => l.filter((_, j) => j !== i));
  }
  protected async save(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await data(
        this.api.setBudgetLimits({
          params: { budgetId: this.budget().id },
          body: {
            items: this.items().map(({ kind, categoryCode, orgUnitId, amountMinor, mode }) => ({
              kind,
              categoryCode,
              orgUnitId,
              amountMinor,
              mode,
            })),
          },
        }),
      );
      this.res.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

const FIELDS: { key: string; label: string; money?: boolean }[] = [
  { key: 'authorizedMinor', label: 'Authorized', money: true },
  { key: 'allocatedOutMinor', label: 'Allocated out', money: true },
  { key: 'encumberedMinor', label: 'Encumbered', money: true },
  { key: 'actualMinor', label: 'Actual', money: true },
  { key: 'status', label: 'Status' },
  { key: 'control', label: 'Control' },
  { key: 'alertThresholdsPct', label: 'Alert thresholds' },
  { key: 'allocationDriver', label: 'Driver' },
  { key: 'phasingMethod', label: 'Phasing' },
  { key: 'name', label: 'Name' },
];

const CONTROL_LABEL: Record<string, string> = {
  hard: 'Hard control',
  soft: 'Soft control',
  track: 'Track only',
};

/** Plain-English names for the enum values a version snapshot stores. */
const VALUE_LABEL: Record<string, string> = {
  fixed: 'Fixed amount',
  per_head: 'Per head',
  even: 'Even',
  seasonal: 'Seasonal',
  manual: 'Manual',
};

/** Screens 30 and 31: immutable version history with the delta between two versions. */
@Component({
  selector: 'bf-versions-tab',
  imports: [
    BudgetStatus,
    DatePipe,
    LoadState,
    MatButtonModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  styleUrl: './page.scss',
  styles:
    TAB_STYLES +
    `
    .bf-versions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(360px, 520px); gap: 16px; padding: 12px 20px 20px; align-items: start; }
    .bf-delta-val { text-align: end; font-variant-numeric: tabular-nums; }
    @media (max-width: 1000px) { .bf-versions { grid-template-columns: minmax(0, 1fr); } }
    .bf-timeline { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
    .bf-version { width: 100%; padding: 12px 14px; border: 1px solid var(--mat-sys-outline-variant); border-radius: var(--mat-sys-corner-medium); background: var(--mat-sys-surface-container-lowest); color: var(--mat-sys-on-surface); text-align: start; cursor: pointer; font: var(--mat-sys-body-medium); }
    .bf-version--selected { border: 2px solid var(--mat-sys-primary); }
    .bf-version__head { display: flex; justify-content: space-between; gap: 8px; font: var(--mat-sys-title-small); }
    .bf-changed { background: var(--mat-sys-primary-container); }
  `,
  template: `
    <sat-banner variant="info" style="margin: 12px 20px 0; display: block"
      ><sat-banner-message
        >Versions are immutable. Every change creates a new version with its reason; nothing is
        edited in place.</sat-banner-message
      ></sat-banner
    >
    <bf-load-state
      shape="table"
      [loading]="res.isLoading()"
      [error]="res.error()"
      what="versions"
      (retry)="res.reload()"
    />
    @if (items().length) {
      <div class="bf-versions">
        <ol class="bf-timeline" aria-label="Version history">
          @for (v of items(); track v.version; let first = $first) {
            <li>
              <button
                type="button"
                class="bf-version"
                [class.bf-version--selected]="v.version === to()?.version"
                (click)="pick(v)"
                [attr.data-testid]="'version-' + v.version"
              >
                <span class="bf-version__head">
                  <span
                    ><sat-category-tag [category]="first ? 'purple' : 'gray'"
                      >v{{ v.version }}{{ first ? ' current' : '' }}</sat-category-tag
                    >
                    {{ v.reason }}</span
                  >
                  <span class="bf-card__hint" data-testid="relative-time">{{
                    v.createdAt | date: 'd MMM y, HH:mm'
                  }}</span>
                </span>
                <span class="bf-card__hint"
                  >Authorized
                  <bf-money
                    [amountMinor]="num(v, 'authorizedMinor')"
                    [currency]="budget().currency"
                  />
                  · by {{ v.actorName ?? 'system' }}</span
                >
              </button>
            </li>
          }
        </ol>
        @if (to(); as t) {
          <section class="bf-card" aria-label="Version delta">
            <div class="bf-card__header">
              <h3 class="bf-card__title">v{{ t.version }} details and delta</h3>
            </div>
            <div class="bf-card__body">
              @if (from(); as f) {
                <p class="bf-card__hint">Comparing v{{ f.version }} → v{{ t.version }}</p>
                <div class="bf-table-scroll">
                  <table class="bf-delta-table bf-split-table" data-testid="version-compare">
                    <thead>
                      <tr>
                        <th scope="col">Field</th>
                        <th scope="col" class="bf-delta-val">v{{ f.version }}</th>
                        <th scope="col" class="bf-delta-val">v{{ t.version }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (field of fields; track field.key) {
                        <tr [class.bf-changed]="show(f, field.key) !== show(t, field.key)">
                          <td>{{ field.label }}</td>
                          @for (v of [f, t]; track v.version) {
                            <td class="bf-delta-val" [class.bf-num]="field.money">
                              @if (field.money) {
                                <bf-money
                                  [amountMinor]="num(v, field.key)"
                                  [currency]="budget().currency"
                                />
                              } @else if (field.key === 'status' && statusOf(v)) {
                                <bf-budget-status [status]="statusOf(v)" />
                              } @else {
                                {{ show(v, field.key) }}
                              }
                            </td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else {
                <p class="bf-card__hint">The first version; nothing to compare with.</p>
              }
            </div>
          </section>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VersionsTab {
  private readonly api = injectApi();
  readonly budget = input.required<BudgetDetail>();
  protected readonly fields = FIELDS;
  protected readonly res = resource({
    params: () => ({ id: this.budget().id, v: this.budget().version }),
    loader: async ({ params }) =>
      (await data(this.api.budgetVersions({ params: { budgetId: params.id } }))).items,
  });
  protected readonly items = computed(() => valueOf(this.res) ?? []);
  private readonly picked = signal<number | null>(null);
  protected readonly to = computed(
    () => this.items().find((v) => v.version === this.picked()) ?? this.items()[0],
  );
  protected readonly from = computed(() => {
    const t = this.to();
    return t ? this.items().find((v) => v.version < t.version) : undefined;
  });
  protected pick(v: BudgetVersion): void {
    this.picked.set(v.version);
  }
  protected statusOf(v: BudgetVersion): string {
    const s = v.snapshot['status'];
    return typeof s === 'string' ? s : '';
  }
  protected num(v: BudgetVersion, key: string): number {
    return Number(v.snapshot[key] ?? 0);
  }
  protected show(v: BudgetVersion, key: string): string {
    const x = v.snapshot[key];
    if (x === null || x === undefined) return '—';
    if (key === 'control') {
      const c = x as { mode: string; toleranceBps: number };
      return `${CONTROL_LABEL[c.mode] ?? c.mode}, ${c.toleranceBps / 100}% tolerance`;
    }
    if (Array.isArray(x)) return x.map((n) => `${n}%`).join(' / ');
    return VALUE_LABEL[String(x)] ?? String(x).replace(/_/g, ' ');
  }
}

interface Movement {
  label: string;
  icon: string;
  category: 'gray' | 'blue' | 'orange' | 'green' | 'purple';
}

/** Screen 89: allocations, increases, reductions and transfers in and out of the budget. */
@Component({
  selector: 'bf-history-tab',
  imports: [
    DatePipe,
    LoadState,
    MatIconModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  styleUrl: './page.scss',
  styles: TAB_STYLES,
  template: `
    <bf-load-state
      shape="table"
      [loading]="res.isLoading()"
      [error]="res.error()"
      what="allocation history"
      (retry)="res.reload()"
    />
    @if (res.hasValue() && rows().length === 0) {
      <sat-empty-state
        ><h2 satEmptyStateHeadline>No allocations yet</h2>
        <p satEmptyStateDescription>
          Money moving in or out of this budget appears here.
        </p></sat-empty-state
      >
    }
    @if (rows().length) {
      <div class="bf-table-scroll">
        <table mat-table class="bf-table" [dataSource]="rows()" aria-label="Allocation history">
          <ng-container matColumnDef="date"
            ><th mat-header-cell *matHeaderCellDef>Date</th>
            <td mat-cell *matCellDef="let r" data-testid="relative-time">
              {{ r.createdAt | date: 'd MMM y, HH:mm' }}
            </td></ng-container
          >
          <ng-container matColumnDef="type"
            ><th mat-header-cell *matHeaderCellDef>Movement</th>
            <td mat-cell *matCellDef="let r">
              @let m = movement(r.journalType, r.bucket, r.direction);
              <sat-category-tag [category]="m.category"
                ><mat-icon [svgIcon]="m.icon" aria-hidden="true" />{{ m.label }}</sat-category-tag
              >
              @if (r.reversed) {
                <span class="bf-card__hint"> reversed</span>
              }
            </td></ng-container
          >
          <ng-container matColumnDef="counterparty"
            ><th mat-header-cell *matHeaderCellDef class="bf-hide-sm">With</th>
            <td mat-cell *matCellDef="let r" class="bf-hide-sm">
              @for (c of r.counterparties; track c.name; let last = $last) {
                @if (c.budgetId) {
                  <a [routerLink]="['/budgets', c.budgetId]">{{ c.name }}</a>
                } @else {
                  {{ c.name }}
                }
                {{ last ? '' : ', ' }}
              }
            </td></ng-container
          >
          <ng-container matColumnDef="amount"
            ><th mat-header-cell *matHeaderCellDef class="bf-num">Amount</th>
            <td
              mat-cell
              *matCellDef="let r"
              class="bf-num"
              [class.bf-ok]="r.direction === 'in'"
              [class.bf-warn]="r.direction === 'out' && r.journalType === 'reduction'"
            >
              <span class="bf-move"
                ><mat-icon
                  [svgIcon]="r.direction === 'in' ? 'arrow_down' : 'arrow_up'"
                  aria-hidden="true" />{{ r.direction === 'in' ? '+' : '−'
                }}<bf-money [amountMinor]="r.amount.amountMinor" [currency]="r.amount.currency"
              /></span></td
          ></ng-container>
          <ng-container matColumnDef="reason"
            ><th mat-header-cell *matHeaderCellDef class="bf-hide-sm">Reason</th>
            <td mat-cell *matCellDef="let r" class="bf-hide-sm">
              <span class="bf-cell__primary">{{ r.reason ?? 'No reason recorded' }}</span
              ><span class="bf-cell__secondary"
                >{{ r.reasonCode ? r.reasonCode + ' · ' : '' }}{{ r.actorName ?? 'system' }}</span
              >
            </td></ng-container
          >
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns"></tr>
        </table>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryTab {
  private readonly api = injectApi();
  readonly budget = input.required<BudgetDetail>();
  protected readonly columns = ['date', 'type', 'counterparty', 'amount', 'reason'];
  protected readonly res = resource({
    params: () => ({ id: this.budget().id, v: this.budget().version }),
    loader: async ({ params }) =>
      (await data(this.api.allocationHistory({ params: { budgetId: params.id } }))).items,
  });
  protected readonly rows = computed(() => valueOf(this.res) ?? []);
  /** Movement type as a tag with its own icon and colour, so the kinds never look alike. */
  protected movement(type: string, bucket: string, direction: string): Movement {
    if (type === 'original_budget')
      return { label: 'Original budget', icon: 'currency_dollar', category: 'gray' };
    if (type === 'transfer')
      return {
        label: direction === 'in' ? 'Transfer in' : 'Transfer out',
        icon: 'import_export',
        category: 'blue',
      };
    if (type === 'reduction')
      return {
        label: bucket === 'allocated_out' ? 'Returned by child' : 'Reduction',
        icon: 'trending_down',
        category: 'orange',
      };
    if (type === 'increase')
      return { label: 'Plan increase', icon: 'trending_up', category: 'green' };
    if (type === 'reversal') return { label: 'Reversal', icon: 'restore', category: 'gray' };
    return {
      label: bucket === 'allocated_out' ? 'Allocated to child' : 'Allocation received',
      icon: 'graph_org',
      category: 'purple',
    };
  }
}

const BUCKET_LABEL: Record<string, string> = {
  authorized: 'Authorized',
  allocated_out: 'Allocated out',
  held: 'Held',
  pre_encumbered: 'Pending (pre-encumbered)',
  encumbered: 'Committed (encumbered)',
  actual: 'Actual',
  accrued: 'Accrued',
};

/** Ledger lines posted to the budget (append-only; corrections are reversals). */
@Component({
  selector: 'bf-ledger-tab',
  imports: [LoadState, MatTableModule, Money, SAT_TAG_IMPORTS],
  styleUrl: './page.scss',
  styles: TAB_STYLES,
  template: `
    <bf-load-state
      shape="table"
      [loading]="res.isLoading()"
      [error]="res.error()"
      what="ledger lines"
      (retry)="res.reload()"
    />
    @if (rows().length) {
      <div class="bf-table-scroll">
        <table mat-table class="bf-table" [dataSource]="rows()" aria-label="Ledger lines">
          <ng-container matColumnDef="date"
            ><th mat-header-cell *matHeaderCellDef>Accounting date</th>
            <td mat-cell *matCellDef="let l">{{ l.accountingDate }}</td></ng-container
          >
          <ng-container matColumnDef="account"
            ><th mat-header-cell *matHeaderCellDef>Bucket</th>
            <td mat-cell *matCellDef="let l">
              <sat-category-tag category="gray">{{ bucketLabel(l.account) }}</sat-category-tag>
            </td></ng-container
          >
          <ng-container matColumnDef="budget"
            ><th mat-header-cell *matHeaderCellDef class="bf-num">Budget amount</th>
            <td mat-cell *matCellDef="let l" class="bf-num">
              @if (l.budget) {
                <bf-money [amountMinor]="l.budget.amountMinor" [currency]="l.budget.currency" />
              }</td
          ></ng-container>
          <ng-container matColumnDef="reporting"
            ><th mat-header-cell *matHeaderCellDef class="bf-num">Reporting (USD)</th>
            <td mat-cell *matCellDef="let l" class="bf-num">
              <bf-money
                [amountMinor]="l.reporting.amountMinor"
                [currency]="l.reporting.currency"
              /></td
          ></ng-container>
          <ng-container matColumnDef="journal"
            ><th mat-header-cell *matHeaderCellDef>Journal</th>
            <td mat-cell *matCellDef="let l">
              <span class="bf-cell__code">{{ l.journalId.slice(0, 8) }}</span> line {{ l.lineNo }}
              @if (l.reversalOfLineId) {
                · reversal
              }
            </td></ng-container
          >
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns"></tr>
        </table>
      </div>
      <p class="bf-card__hint bf-tab-body">
        Debits are positive and credits negative. Lines are never edited; corrections are reversals.
      </p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LedgerTab {
  private readonly api = injectApi();
  readonly budget = input.required<BudgetDetail>();
  protected readonly columns = ['date', 'account', 'budget', 'reporting', 'journal'];
  protected bucketLabel(account: string): string {
    return BUCKET_LABEL[account] ?? account.replace(/_/g, ' ');
  }
  protected readonly res = resource({
    params: () => ({ id: this.budget().id, v: this.budget().version }),
    loader: async ({ params }) =>
      (await data(this.api.budgetLedger({ params: { budgetId: params.id } }))).items,
  });
  protected readonly rows = computed(() => [...(valueOf(this.res) ?? [])].reverse());
}
