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
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import type { BudgetDetail } from '@bf/contracts';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import {
  balancesOf,
  data,
  errorMessage,
  flagMatcher,
  injectApi,
  sameTree,
  toMinor,
  valueOf,
} from './api';

const COMMON = [
  FormsModule,
  MatButtonModule,
  MatButtonToggleModule,
  MatDialogModule,
  MatFormFieldModule,
  MatIconModule,
  MatInputModule,
  MatRadioModule,
  MatSelectModule,
  Money,
  SAT_BANNER_IMPORTS,
];

export interface AllocateDialogData {
  parent: BudgetDetail;
  childId?: string;
}

/** Screen 24: allocate to a child unit, checked live against the parent's available. */
@Component({
  selector: 'bf-allocate-dialog',
  imports: [...COMMON, SatImportantButton],
  styleUrl: './dialogs.scss',
  template: `
    <div mat-dialog-title class="bf-dialog__head">
      <span class="bf-dialog__icon"><mat-icon svgIcon="graph_org" aria-hidden="true" /></span>
      <div>
        <h2 class="bf-dialog__title">Allocate budget to child unit</h2>
        <p class="bf-dialog__subtitle">
          {{ p.name }} · {{ p.display.fiscalYearLabel }} · {{ p.currency }}
        </p>
      </div>
      <button
        mat-icon-button
        type="button"
        class="bf-dialog__close"
        mat-dialog-close
        aria-label="Close"
      >
        <mat-icon svgIcon="x_small" aria-hidden="true" />
      </button>
    </div>
    <mat-dialog-content>
      <div class="bf-dialog__grid">
        <div>
          <div class="bf-panel">
            <p class="bf-dialog__section-title">From (parent unit)</p>
            <p style="margin: 0; font: var(--mat-sys-title-small)">{{ p.name }}</p>
            <p class="bf-note">{{ p.display.ownerName ?? 'No owner' }}</p>
            <dl class="bf-rows" style="margin-top: 8px">
              <div>
                <dt>Available to allocate</dt>
                <dd data-testid="parent-available">
                  <bf-money [amountMinor]="available" [currency]="p.currency" />
                </dd>
              </div>
            </dl>
          </div>
          <mat-form-field class="bf-field" style="margin-top: 12px">
            <mat-label>To child unit</mat-label>
            <mat-select
              [ngModel]="childId()"
              (ngModelChange)="childId.set($event)"
              required
              data-testid="child-select"
            >
              @for (c of children(); track c.id) {
                <mat-option [value]="c.id"
                  >{{ c.name }} — {{ c.display.ownerName ?? 'no owner' }}</mat-option
                >
              }
            </mat-select>
            @if (child(); as c) {
              <mat-hint
                >Current authorized
                <bf-money
                  [amountMinor]="c.balances.budgetCurrency.authorized.amountMinor"
                  [currency]="c.currency"
              /></mat-hint>
            }
          </mat-form-field>
          <mat-button-toggle-group
            [value]="method()"
            (change)="method.set($event.value)"
            aria-label="Allocation method"
            style="margin: 8px 0 16px"
          >
            <mat-button-toggle value="fixed">Fixed amount</mat-button-toggle>
            <mat-button-toggle value="per_head">Per-head driver</mat-button-toggle>
          </mat-button-toggle-group>
          @if (method() === 'fixed') {
            <mat-form-field class="bf-field">
              <mat-label>Amount</mat-label>
              <span matTextPrefix>{{ p.currency }}&nbsp;</span>
              <input
                matInput
                inputmode="decimal"
                [ngModel]="amount()"
                (ngModelChange)="amount.set($event)"
                [errorStateMatcher]="amountError"
                data-testid="allocate-amount"
              />
              <mat-hint
                >Up to <bf-money [amountMinor]="available" [currency]="p.currency"
              /></mat-hint>
              <mat-error
                ><mat-icon svgIcon="error" aria-hidden="true" />Up to
                <bf-money [amountMinor]="available" [currency]="p.currency" /> is
                available</mat-error
              >
            </mat-form-field>
            <mat-form-field class="bf-field">
              <mat-label>Note to owner</mat-label>
              <textarea matInput rows="2" [(ngModel)]="memo"></textarea>
            </mat-form-field>
          } @else {
            <p class="bf-note">
              The per-head driver allocates the rate times the eligible headcount from the HR import
              and keeps the amount current with true-ups.
            </p>
          }
        </div>
        <div class="bf-panel">
          <p class="bf-dialog__section-title">Impact preview</p>
          <div class="bf-delta">
            <span>{{ p.name }} available</span>
            <span class="bf-delta__after" [class.bf-bad]="over()">
              <bf-money [amountMinor]="available - (amountMinor() ?? 0)" [currency]="p.currency" />
            </span>
          </div>
          @if (child(); as c) {
            <div class="bf-delta">
              <span>{{ c.name }} authorized</span>
              <span class="bf-delta__after bf-ok">
                <bf-money
                  [amountMinor]="
                    c.balances.budgetCurrency.authorized.amountMinor + (amountMinor() ?? 0)
                  "
                  [currency]="c.currency"
                />
              </span>
            </div>
          }
          <p class="bf-note">
            <mat-icon svgIcon="info" aria-hidden="true" />Posts an allocation journal to the ledger
            and one audit entry; the owner is notified.
          </p>
        </div>
      </div>
    </mat-dialog-content>
    <div class="bf-dialog__status" aria-live="polite">
      @if (over()) {
        <sat-banner variant="important" [border]="true" data-testid="over-allocation"
          ><sat-banner-message
            ><strong>Blocked:</strong> only
            <bf-money [amountMinor]="available" [currency]="p.currency" /> is available. Lower the
            amount or ask for an increase.</sat-banner-message
          ></sat-banner
        >
      }
      @if (failure()) {
        <sat-banner variant="important" [border]="true"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    </div>
    <mat-dialog-actions align="end" class="bf-dialog__actions">
      @if (method() === 'fixed' && !valid()) {
        <span class="bf-dialog__why">{{ why() }}</span>
      }
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      @if (method() === 'fixed') {
        <button
          mat-flat-button
          satImportantButton
          type="button"
          [disabled]="busy() || !valid()"
          (click)="submit()"
          data-testid="confirm-allocate"
        >
          <mat-icon svgIcon="check" aria-hidden="true" />Allocate
          <bf-money [amountMinor]="amountMinor() ?? 0" [currency]="p.currency" />
        </button>
      } @else {
        <button mat-flat-button type="button" [disabled]="!childId()" (click)="perHead()">
          Set up per-head allocation
        </button>
      }
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AllocateDialog {
  private readonly api = injectApi();
  private readonly router = inject(Router);
  private readonly ref = inject(MatDialogRef<AllocateDialog, boolean>);
  private readonly input = inject<AllocateDialogData>(MAT_DIALOG_DATA);
  protected readonly p = this.input.parent;
  protected readonly available = this.p.balances.allocationAvailable.amountMinor;
  protected readonly childId = signal<string | null>(this.input.childId ?? null);
  protected readonly method = signal<'fixed' | 'per_head'>('fixed');
  protected readonly amount = signal('');
  protected memo = '';
  protected readonly amountMinor = computed(() => toMinor(this.amount()));
  protected readonly over = computed(() => (this.amountMinor() ?? 0) > this.available);
  protected readonly amountError = flagMatcher(() => this.over());
  private readonly childrenRes = resource({
    loader: async () =>
      (await data(this.api.listBudgets({ query: { parentId: this.p.id, limit: 500 } }))).items,
  });
  protected readonly children = computed(() => valueOf(this.childrenRes) ?? []);
  protected readonly child = computed(() => this.children().find((c) => c.id === this.childId()));
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected valid(): boolean {
    const a = this.amountMinor();
    return !!this.childId() && !!a && a > 0 && !this.over();
  }

  protected why(): string {
    if (this.over()) return 'Lower the amount to continue.';
    if (!this.childId()) return 'Choose the child unit.';
    return 'Enter an amount to allocate.';
  }

  protected perHead(): void {
    this.ref.close(false);
    void this.router.navigate(['/budgets', this.childId(), 'per-head']);
  }

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await data(
        this.api.allocate({
          params: { budgetId: this.p.id },
          body: {
            childBudgetId: this.childId()!,
            amount: { amountMinor: this.amountMinor()!, currency: this.p.currency },
            ...(this.memo.trim() ? { memo: this.memo.trim() } : {}),
          },
        }),
      );
      this.ref.close(true);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

export interface MoneyDialogData {
  budget: BudgetDetail;
}

/** Screen 25: transfer to another budget of the same tree with a live before/after preview. */
@Component({
  selector: 'bf-transfer-dialog',
  imports: [...COMMON, SatImportantButton],
  styleUrl: './dialogs.scss',
  template: `
    <div mat-dialog-title class="bf-dialog__head">
      <span class="bf-dialog__icon"><mat-icon svgIcon="import_export" aria-hidden="true" /></span>
      <div>
        <h2 class="bf-dialog__title">Transfer budget</h2>
        <p class="bf-dialog__subtitle">
          Move authorized budget between two budgets. Both are held in {{ b.currency }}.
        </p>
      </div>
      <button
        mat-icon-button
        type="button"
        class="bf-dialog__close"
        mat-dialog-close
        aria-label="Close"
      >
        <mat-icon svgIcon="x_small" aria-hidden="true" />
      </button>
    </div>
    <mat-dialog-content>
      <div class="bf-dialog__grid">
        <div>
          <div class="bf-panel">
            <p class="bf-dialog__section-title">From (source budget)</p>
            <p style="margin: 0; font: var(--mat-sys-title-small)">{{ b.name }}</p>
            <p class="bf-note">
              Can transfer up to <bf-money [amountMinor]="sourceMax" [currency]="b.currency" />
              (pending requests stay covered)
            </p>
          </div>
          <mat-form-field class="bf-field" style="margin-top: 12px">
            <mat-label>To destination budget</mat-label>
            <mat-select
              [ngModel]="toId()"
              (ngModelChange)="toId.set($event)"
              required
              data-testid="transfer-target"
            >
              @for (t of targets(); track t.id) {
                <mat-option [value]="t.id"
                  >{{ t.name }} — available
                  <bf-money
                    [amountMinor]="t.balances.available.amountMinor"
                    [currency]="t.currency"
                /></mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field class="bf-field">
            <mat-label>Transfer amount</mat-label>
            <span matTextPrefix>{{ b.currency }}&nbsp;</span>
            <input
              matInput
              inputmode="decimal"
              [ngModel]="amount()"
              (ngModelChange)="amount.set($event)"
              [errorStateMatcher]="amountError"
              data-testid="transfer-amount"
            />
            <mat-hint
              >Up to <bf-money [amountMinor]="sourceMax" [currency]="b.currency"
            /></mat-hint>
            <mat-error
              ><mat-icon svgIcon="error" aria-hidden="true" />Up to
              <bf-money [amountMinor]="sourceMax" [currency]="b.currency" /> can move</mat-error
            >
          </mat-form-field>
          <mat-form-field class="bf-field">
            <mat-label>Reason code</mat-label>
            <mat-select [(ngModel)]="reasonCode" required>
              @for (r of codes(); track r.id) {
                <mat-option [value]="r.code">{{ r.code }} · {{ r.label }}</mat-option>
              }
            </mat-select>
            <mat-error
              ><mat-icon svgIcon="error" aria-hidden="true" />Choose a reason code</mat-error
            >
          </mat-form-field>
          <mat-form-field class="bf-field">
            <mat-label>Reason and business justification</mat-label>
            <textarea matInput rows="2" [(ngModel)]="reason" required></textarea>
            <mat-error><mat-icon svgIcon="error" aria-hidden="true" />Enter a reason</mat-error>
          </mat-form-field>
        </div>
        <div class="bf-panel">
          <p class="bf-dialog__section-title">Impact preview</p>
          <div class="bf-delta">
            <span>{{ b.name }}</span>
            <span class="bf-delta__after" [class.bf-bad]="over()"
              ><bf-money
                [amountMinor]="b.balances.available.amountMinor - (amountMinor() ?? 0)"
                [currency]="b.currency"
            /></span>
          </div>
          @if (target(); as t) {
            <div class="bf-delta">
              <span>{{ t.name }}</span>
              <span class="bf-delta__after bf-ok"
                ><bf-money
                  [amountMinor]="t.balances.available.amountMinor + (amountMinor() ?? 0)"
                  [currency]="t.currency"
              /></span>
            </div>
          }
          <p class="bf-note">
            <mat-icon svgIcon="info" aria-hidden="true" />Posts one balanced transfer journal
            through the common parent and one audit entry. The owner of both budgets (their common
            parent) or finance can transfer.
          </p>
        </div>
      </div>
    </mat-dialog-content>
    <div class="bf-dialog__status" aria-live="polite">
      @if (over()) {
        <sat-banner variant="important" [border]="true" data-testid="transfer-blocked"
          ><sat-banner-message
            ><strong>Blocked:</strong> only
            <bf-money [amountMinor]="sourceMax" [currency]="b.currency" /> can move out of
            {{ b.name }}.</sat-banner-message
          ></sat-banner
        >
      }
      @if (failure()) {
        <sat-banner variant="important" [border]="true"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    </div>
    <mat-dialog-actions align="end" class="bf-dialog__actions">
      @if (!valid()) {
        <span class="bf-dialog__why">{{ why() }}</span>
      }
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        satImportantButton
        type="button"
        [disabled]="busy() || !valid()"
        (click)="submit()"
        data-testid="confirm-transfer"
      >
        Transfer <bf-money [amountMinor]="amountMinor() ?? 0" [currency]="b.currency" />
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransferDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<TransferDialog, boolean>);
  protected readonly b = inject<MoneyDialogData>(MAT_DIALOG_DATA).budget;
  private readonly bal = balancesOf(this.b);
  protected readonly sourceMax = Math.max(
    this.bal.authorized -
      this.bal.allocatedOut -
      this.bal.held -
      this.bal.preEncumbered -
      this.bal.encumbered -
      this.bal.actual,
    0,
  );
  protected readonly toId = signal<string | null>(null);
  protected readonly amount = signal('');
  protected reasonCode = 'TRF-REBALANCE';
  protected reason = '';
  protected readonly amountMinor = computed(() => toMinor(this.amount()));
  protected readonly over = computed(() => (this.amountMinor() ?? 0) > this.sourceMax);
  protected readonly amountError = flagMatcher(() => this.over());
  private readonly treeRes = resource({ loader: () => sameTree(this.api, this.b) });
  protected readonly targets = computed(() =>
    (valueOf(this.treeRes) ?? []).filter(
      (t) => t.id !== this.b.id && ['active', 'reduced'].includes(t.status) && t.parentId,
    ),
  );
  protected readonly target = computed(() => this.targets().find((t) => t.id === this.toId()));
  private readonly codesRes = resource({
    loader: async () =>
      (await data(this.api.listReasonCodes({ query: { category: 'transfer' } }))).items,
  });
  protected readonly codes = computed(() => valueOf(this.codesRes) ?? []);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected valid(): boolean {
    const a = this.amountMinor();
    return (
      !!this.toId() &&
      !!a &&
      a > 0 &&
      !this.over() &&
      !!this.reasonCode &&
      this.reason.trim().length >= 3
    );
  }

  protected why(): string {
    const a = this.amountMinor();
    if (this.over()) return 'Lower the amount to continue.';
    if (!this.toId()) return 'Choose the destination budget.';
    if (!a || a <= 0) return 'Enter the amount to transfer.';
    if (!this.reasonCode) return 'Choose a reason code.';
    return 'Enter a reason (3 characters or more).';
  }

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await data(
        this.api.transferBudget({
          params: { budgetId: this.b.id },
          body: {
            toBudgetId: this.toId()!,
            amountMinor: this.amountMinor()!,
            reasonCode: this.reasonCode,
            reason: this.reason,
          },
        }),
      );
      this.ref.close(true);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Screen 29 (increase request): ask the parent for more; nothing posts until approved. */
@Component({
  selector: 'bf-increase-dialog',
  imports: COMMON,
  styleUrl: './dialogs.scss',
  template: `
    <div mat-dialog-title class="bf-dialog__head">
      <span class="bf-dialog__icon"><mat-icon svgIcon="trending_up" aria-hidden="true" /></span>
      <div>
        <h2 class="bf-dialog__title">Request budget increase</h2>
        <p class="bf-dialog__subtitle">{{ b.name }} · version {{ b.version }} · {{ b.currency }}</p>
      </div>
      <button
        mat-icon-button
        type="button"
        class="bf-dialog__close"
        mat-dialog-close
        aria-label="Close"
      >
        <mat-icon svgIcon="x_small" aria-hidden="true" />
      </button>
    </div>
    <mat-dialog-content>
      <div class="bf-dialog__grid">
        <div>
          <div class="bf-panel">
            <p class="bf-dialog__section-title">Current authorized</p>
            <p style="margin: 0; font: var(--mat-sys-title-large)">
              <bf-money [amountMinor]="bal.authorized" [currency]="b.currency" />
            </p>
          </div>
          <mat-form-field class="bf-field" style="margin-top: 12px">
            <mat-label>New authorized</mat-label>
            <span matTextPrefix>{{ b.currency }}&nbsp;</span>
            <input
              matInput
              inputmode="decimal"
              [ngModel]="target()"
              (ngModelChange)="target.set($event)"
              data-testid="increase-target"
            />
            @if (increase() > 0) {
              <mat-hint class="bf-ok"
                ><mat-icon svgIcon="trending_up" aria-hidden="true" /> Increase of
                <bf-money [amountMinor]="increase()" [currency]="b.currency"
              /></mat-hint>
            }
          </mat-form-field>
          <p class="bf-dialog__section-title">Funded from</p>
          <mat-radio-group class="bf-destinations" aria-label="Funded from" value="parent">
            <mat-radio-button value="parent" class="bf-destination bf-destination--selected"
              >Parent: {{ b.display.parentName
              }}<small>Standard route; the parent owner decides</small></mat-radio-button
            >
            <mat-radio-button value="new" class="bf-destination" [disabled]="true"
              >New money<small>Needs a plan revision by finance</small></mat-radio-button
            >
          </mat-radio-group>
          <mat-form-field class="bf-field">
            <mat-label>Reason and business justification</mat-label>
            <textarea matInput rows="3" [(ngModel)]="reason" required></textarea>
            <mat-error><mat-icon svgIcon="error" aria-hidden="true" />Enter a reason</mat-error>
          </mat-form-field>
          @if (b.thresholdsReachedPct.length) {
            <sat-banner variant="warning"
              ><sat-banner-message
                >{{ b.name }} is at {{ b.thresholdsReachedPct.at(-1) }}% of its
                budget.</sat-banner-message
              ></sat-banner
            >
          }
        </div>
        <div class="bf-panel">
          <p class="bf-dialog__section-title">Approval route</p>
          <div class="bf-delta">
            <span>Step 1 · owner of {{ b.display.parentName }}</span>
            <span class="bf-note">Allocates from the parent</span>
          </div>
          <p class="bf-note">
            <mat-icon svgIcon="info" aria-hidden="true" />When approved, the parent allocates the
            approved amount (fully or partly) and this budget gets a new version. Until then the
            increase cannot be spent.
          </p>
        </div>
      </div>
    </mat-dialog-content>
    <div class="bf-dialog__status" aria-live="polite">
      @if (failure()) {
        <sat-banner variant="important" [border]="true"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    </div>
    <mat-dialog-actions align="end" class="bf-dialog__actions">
      @if (increase() <= 0 || reason.trim().length < 3) {
        <span class="bf-dialog__why">{{
          increase() <= 0
            ? 'Enter a new authorized amount above the current one.'
            : 'Enter a reason (3 characters or more).'
        }}</span>
      }
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="busy() || increase() <= 0 || reason.trim().length < 3"
        (click)="submit()"
        data-testid="confirm-increase"
      >
        Submit increase request
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IncreaseDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<IncreaseDialog, boolean>);
  protected readonly b = inject<MoneyDialogData>(MAT_DIALOG_DATA).budget;
  protected readonly bal = balancesOf(this.b);
  protected readonly target = signal('');
  protected readonly increase = computed(() => (toMinor(this.target()) ?? 0) - this.bal.authorized);
  protected reason = '';
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await data(
        this.api.requestIncrease({
          params: { budgetId: this.b.id },
          body: { amountMinor: this.increase(), reason: this.reason.trim() },
        }),
      );
      this.ref.close(true);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Screen 29a (request): ask to release contingency reserve to a budget of the same tree. */
@Component({
  selector: 'bf-release-dialog',
  imports: COMMON,
  styleUrl: './dialogs.scss',
  template: `
    <div mat-dialog-title class="bf-dialog__head">
      <span class="bf-dialog__icon"><mat-icon svgIcon="shield_lock" aria-hidden="true" /></span>
      <div>
        <h2 class="bf-dialog__title">Request reserve release</h2>
        <p class="bf-dialog__subtitle">{{ b.name }} · {{ b.currency }}</p>
      </div>
      <button
        mat-icon-button
        type="button"
        class="bf-dialog__close"
        mat-dialog-close
        aria-label="Close"
      >
        <mat-icon svgIcon="x_small" aria-hidden="true" />
      </button>
    </div>
    <mat-dialog-content>
      <p class="bf-note">
        From {{ b.name }} (available
        <bf-money
          [amountMinor]="b.balances.allocationAvailable.amountMinor"
          [currency]="b.currency"
        />). Someone other than you approves the release; nothing moves until then.
      </p>
      <mat-form-field class="bf-field">
        <mat-label>Target budget</mat-label>
        <mat-select
          [ngModel]="toId()"
          (ngModelChange)="toId.set($event)"
          data-testid="release-target"
        >
          @for (t of targets(); track t.id) {
            <mat-option [value]="t.id">{{ t.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field class="bf-field">
        <mat-label>Amount</mat-label>
        <span matTextPrefix>{{ b.currency }}&nbsp;</span>
        <input
          matInput
          inputmode="decimal"
          [ngModel]="amount()"
          (ngModelChange)="amount.set($event)"
        />
      </mat-form-field>
      <mat-form-field class="bf-field">
        <mat-label>Justification</mat-label>
        <textarea matInput rows="3" [(ngModel)]="reason"></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <div class="bf-dialog__status" aria-live="polite">
      @if (failure()) {
        <sat-banner variant="important" [border]="true"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    </div>
    <mat-dialog-actions align="end" class="bf-dialog__actions">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="busy() || !toId() || !(amountMinor() ?? 0) || reason.trim().length < 3"
        (click)="submit()"
      >
        Request release
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReleaseDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<ReleaseDialog, boolean>);
  protected readonly b = inject<MoneyDialogData>(MAT_DIALOG_DATA).budget;
  protected readonly toId = signal<string | null>(null);
  protected readonly amount = signal('');
  protected readonly amountMinor = computed(() => toMinor(this.amount()));
  protected reason = '';
  private readonly treeRes = resource({ loader: () => sameTree(this.api, this.b) });
  protected readonly targets = computed(() =>
    (valueOf(this.treeRes) ?? []).filter(
      (t) => t.id !== this.b.id && t.parentId && ['active', 'reduced'].includes(t.status),
    ),
  );
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await data(
        this.api.requestContingencyRelease({
          params: { budgetId: this.b.id },
          body: {
            toBudgetId: this.toId()!,
            amountMinor: this.amountMinor()!,
            reason: this.reason.trim(),
          },
        }),
      );
      this.ref.close(true);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
