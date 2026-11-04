import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import type { BudgetDetail, ControlImpact } from '@bf/contracts';
import { Money } from '@bf/web/ui';
import { BudgetStatus } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { balancesOf, data, errorMessage, injectApi, toMinor, valueOf } from './api';

export interface BudgetDialogData {
  budget: BudgetDetail;
}

type Destination = 'parent' | 'savings' | 'reallocation';

const COMMON = [
  FormsModule,
  MatButtonModule,
  MatDialogModule,
  MatFormFieldModule,
  MatIconModule,
  MatInputModule,
  MatSelectModule,
  MatSlideToggleModule,
  Money,
  SAT_BANNER_IMPORTS,
];

/** Reason codes of the given categories, for the reason-code selects. */
function reasonCodes(categories: string[]) {
  const api = injectApi();
  return resource({
    loader: async () => {
      const lists = await Promise.all(
        categories.map((category) => data(api.listReasonCodes({ query: { category } }))),
      );
      return lists.flatMap((l) => l.items);
    },
  });
}

/** Other budgets of the same tree that can receive reallocated or transferred money. */
function treeBudgets(budget: () => BudgetDetail) {
  const api = injectApi();
  return resource({
    params: () => ({ rootId: budget().path.split('/').filter(Boolean)[0], self: budget().id }),
    loader: async ({ params }) =>
      (await data(api.listBudgets({ query: { rootId: params.rootId, limit: 500 } }))).items,
  });
}

/** Screen 27: freeze (and unfreeze) with cascade, reason code and the pending requests put on hold. */
@Component({
  selector: 'bf-freeze-dialog',
  imports: COMMON,
  styleUrl: './dialogs.scss',
  template: `
    <div mat-dialog-title class="bf-dialog__head">
      <span class="bf-dialog__icon"><mat-icon svgIcon="lock" aria-hidden="true" /></span>
      <div>
        <h2 class="bf-dialog__title">{{ unfreeze ? 'Unfreeze' : 'Freeze' }} {{ b.name }}</h2>
        <p class="bf-dialog__subtitle">
          Owner {{ b.display.ownerName ?? '—' }} · Budget currency {{ b.currency }}
        </p>
      </div>
    </div>
    <mat-dialog-content>
      @if (unfreeze) {
        <sat-banner variant="info"
          ><sat-banner-message
            >New requests and allocations are accepted again. Pending requests on hold are released
            for approval.</sat-banner-message
          ></sat-banner
        >
      } @else {
        <sat-banner variant="info"
          ><sat-banner-message
            >New requests and allocations will be blocked. Existing commitments (<bf-money
              [amountMinor]="bal.encumbered + bal.held"
              [currency]="b.currency"
            />) can still be paid.</sat-banner-message
          ></sat-banner
        >
      }
      <div class="bf-dialog__grid">
        <div>
          @if (!unfreeze) {
            <p class="bf-dialog__section-title">Freeze duration</p>
            <p class="bf-note">Until someone unfreezes it.</p>
          }
          <div class="bf-panel" style="margin: 12px 0">
            <mat-slide-toggle [(ngModel)]="cascade" [disabled]="b.childCount === 0"
              >Apply to child budgets</mat-slide-toggle
            >
            <p class="bf-note">
              {{
                b.childCount === 0
                  ? 'No child budgets under this one.'
                  : b.childCount + ' child budget(s) and everything below them.'
              }}
            </p>
          </div>
          @if (!unfreeze) {
            <mat-form-field class="bf-field">
              <mat-label>Reason code</mat-label>
              <mat-select [(ngModel)]="reasonCode" required>
                @for (r of codes() ?? []; track r.id) {
                  <mat-option [value]="r.code">{{ r.code }} · {{ r.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }
          <mat-form-field class="bf-field">
            <mat-label>Reason and internal note</mat-label>
            <textarea matInput rows="3" [(ngModel)]="reason" required></textarea>
          </mat-form-field>
        </div>
        <div>
          <div class="bf-panel">
            <p class="bf-dialog__section-title">Impact summary</p>
            <dl class="bf-rows">
              <div>
                <dt>Pending requests {{ unfreeze ? 'released' : 'put on hold' }}</dt>
                <dd><bf-money [amountMinor]="bal.preEncumbered" [currency]="b.currency" /></dd>
              </div>
              <div>
                <dt>Approved commitments that continue</dt>
                <dd><bf-money [amountMinor]="bal.encumbered" [currency]="b.currency" /></dd>
              </div>
            </dl>
          </div>
          <p class="bf-note">
            <mat-icon svgIcon="shield" aria-hidden="true" />Recorded in the tamper-evident audit
            trail; the owner and requesters are notified.
          </p>
        </div>
      </div>
      @if (failure()) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="bf-dialog__actions">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="busy() || !valid()"
        (click)="submit()"
        data-testid="confirm-freeze"
      >
        <mat-icon [svgIcon]="unfreeze ? 'unlocked' : 'lock'" aria-hidden="true" />
        {{ unfreeze ? 'Unfreeze budget' : 'Freeze budget' }}
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FreezeDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<FreezeDialog, boolean>);
  protected readonly b = inject<BudgetDialogData>(MAT_DIALOG_DATA).budget;
  protected readonly bal = balancesOf(this.b);
  protected readonly unfreeze = this.b.status === 'frozen';
  protected cascade = false;
  protected reasonCode = '';
  protected reason = '';
  private readonly codesRes = reasonCodes(['freeze']);
  protected readonly codes = computed(() => valueOf(this.codesRes));
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected valid(): boolean {
    return this.reason.trim().length >= 3 && (this.unfreeze || !!this.reasonCode);
  }

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      if (this.unfreeze)
        await data(
          this.api.unfreezeBudget({
            params: { budgetId: this.b.id },
            body: { reason: this.reason, cascade: this.cascade },
          }),
        );
      else
        await data(
          this.api.freezeBudget({
            params: { budgetId: this.b.id },
            body: { reasonCode: this.reasonCode, reason: this.reason, cascade: this.cascade },
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

/** Shared state for reduce and set to zero: destination, reason, live impact preview. */
abstract class ReductionDialogBase {
  protected readonly api = injectApi();
  protected readonly b = inject<BudgetDialogData>(MAT_DIALOG_DATA).budget;
  protected readonly bal = balancesOf(this.b);
  protected readonly destination = signal<Destination>(this.b.parentId ? 'parent' : 'savings');
  protected readonly destinationBudgetId = signal<string | null>(null);
  protected readonly cascade = signal(false);
  protected reasonCode = '';
  protected reason = '';
  private readonly codesRes = reasonCodes(['reduction']);
  protected readonly codes = computed(() => valueOf(this.codesRes));
  protected readonly treeRes = treeBudgets(() => this.b);
  protected readonly targets = computed(() =>
    (valueOf(this.treeRes) ?? []).filter(
      (t) =>
        !t.path.startsWith(this.b.path) &&
        !['frozen', 'set_to_zero', 'closed', 'cancelled', 'draft'].includes(t.status),
    ),
  );
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly impact = signal<ControlImpact | null>(null);

  protected abstract previewBody(): Record<string, unknown> | null;

  constructor() {
    effect((onCleanup) => {
      const body = this.previewBody();
      if (!body) return;
      const timer = setTimeout(async () => {
        try {
          this.impact.set(
            await data(
              this.api.previewControl({
                params: { budgetId: this.b.id },
                body: body as never,
              }),
            ),
          );
        } catch (e) {
          this.failure.set(errorMessage(e));
        }
      }, 250);
      onCleanup(() => clearTimeout(timer));
    });
  }

  protected destinationFields() {
    return {
      destination: this.destination(),
      ...(this.destination() === 'reallocation' && this.destinationBudgetId()
        ? { destinationBudgetId: this.destinationBudgetId()! }
        : {}),
    };
  }

  protected readonly destinationReady = computed(
    () => this.destination() !== 'reallocation' || !!this.destinationBudgetId(),
  );
}

/** Screen 26: reduce with floor, destination, reason code and the live impact preview. */
@Component({
  selector: 'bf-reduce-dialog',
  imports: COMMON,
  styleUrl: './dialogs.scss',
  template: `
    <div mat-dialog-title class="bf-dialog__head">
      <span class="bf-dialog__icon bf-dialog__icon--danger"
        ><mat-icon svgIcon="trending_down" aria-hidden="true"
      /></span>
      <div>
        <h2 class="bf-dialog__title">Reduce budget</h2>
        <p class="bf-dialog__subtitle">
          {{ b.name }} · owner {{ b.display.ownerName ?? '—' }} · {{ b.display.fiscalYearLabel }} ·
          {{ b.currency }}
        </p>
      </div>
    </div>
    <mat-dialog-content>
      <div class="bf-dialog__grid">
        <div>
          <div class="bf-panel">
            <p class="bf-dialog__section-title">Current position</p>
            <dl class="bf-rows">
              <div>
                <dt>Authorized</dt>
                <dd><bf-money [amountMinor]="bal.authorized" [currency]="b.currency" /></dd>
              </div>
              <div>
                <dt>Pending requests (pre-encumbered)</dt>
                <dd><bf-money [amountMinor]="bal.preEncumbered" [currency]="b.currency" /></dd>
              </div>
              <div>
                <dt>Approved commitments (encumbered)</dt>
                <dd><bf-money [amountMinor]="bal.encumbered" [currency]="b.currency" /></dd>
              </div>
              <div>
                <dt>Held</dt>
                <dd><bf-money [amountMinor]="bal.held" [currency]="b.currency" /></dd>
              </div>
              <div>
                <dt>Actual</dt>
                <dd><bf-money [amountMinor]="bal.actual" [currency]="b.currency" /></dd>
              </div>
              <div>
                <dt>Allocated to child budgets</dt>
                <dd><bf-money [amountMinor]="bal.allocatedOut" [currency]="b.currency" /></dd>
              </div>
            </dl>
            <div class="bf-floor" data-testid="floor">
              <dl class="bf-rows">
                <div>
                  <dt>Floor (children + held + encumbered + actual)</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="impact()?.floorMinor ?? floor"
                      [currency]="b.currency"
                    />
                  </dd>
                </div>
              </dl>
              <p class="bf-note">Pending requests are not part of the floor.</p>
            </div>
          </div>
        </div>
        <div>
          <mat-form-field class="bf-field">
            <mat-label>Reduce by ({{ b.currency }})</mat-label>
            <input
              matInput
              inputmode="decimal"
              [ngModel]="amount()"
              (ngModelChange)="amount.set($event)"
              required
              data-testid="reduce-amount"
            />
            <mat-hint
              >Maximum reducible: <bf-money [amountMinor]="max" [currency]="b.currency"
            /></mat-hint>
          </mat-form-field>
          <div class="bf-delta">
            <span>New authorized</span>
            <span class="bf-delta__after"
              ><bf-money
                [amountMinor]="bal.authorized - (amountMinor() ?? 0)"
                [currency]="b.currency"
            /></span>
          </div>
          <p class="bf-dialog__section-title" style="margin-top: 16px">
            Where does the cut money go?
          </p>
          <div class="bf-destinations" role="radiogroup" aria-label="Destination">
            @if (b.parentId) {
              <button
                type="button"
                role="radio"
                class="bf-destination"
                [class.bf-destination--selected]="destination() === 'parent'"
                [attr.aria-checked]="destination() === 'parent'"
                (click)="destination.set('parent')"
              >
                Return to parent<small
                  >{{ b.display.parentName }}: increases its unallocated pool</small
                >
              </button>
            }
            <button
              type="button"
              role="radio"
              class="bf-destination"
              [class.bf-destination--selected]="destination() === 'savings'"
              [attr.aria-checked]="destination() === 'savings'"
              (click)="destination.set('savings')"
            >
              Company savings<small>Leaves the program; the plan ties out with savings</small>
            </button>
            <button
              type="button"
              role="radio"
              class="bf-destination"
              [class.bf-destination--selected]="destination() === 'reallocation'"
              [attr.aria-checked]="destination() === 'reallocation'"
              (click)="destination.set('reallocation')"
            >
              Reallocate<small>Move it to another budget of this tree</small>
            </button>
          </div>
          @if (destination() === 'reallocation') {
            <mat-form-field class="bf-field">
              <mat-label>Receiving budget</mat-label>
              <mat-select
                [ngModel]="destinationBudgetId()"
                (ngModelChange)="destinationBudgetId.set($event)"
              >
                @for (t of targets(); track t.id) {
                  <mat-option [value]="t.id">{{ t.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }
          <mat-form-field class="bf-field">
            <mat-label>Reason code</mat-label>
            <mat-select [(ngModel)]="reasonCode" required data-testid="reason-code">
              @for (r of codes() ?? []; track r.id) {
                <mat-option [value]="r.code">{{ r.code }} · {{ r.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field class="bf-field">
            <mat-label>Reason</mat-label>
            <textarea matInput rows="2" [(ngModel)]="reason" required></textarea>
          </mat-form-field>
        </div>
      </div>
      @if (impact()?.problem; as p) {
        <sat-banner variant="important" data-testid="reduce-problem"
          ><sat-banner-message>{{ p.message }}</sat-banner-message></sat-banner
        >
      } @else if (impact() && impact()!.pendingMinor > 0) {
        <sat-banner variant="warning"
          ><sat-banner-message
            >Pending requests (<bf-money
              [amountMinor]="impact()!.pendingMinor"
              [currency]="b.currency"
            />) are not floored; they stay pending and are checked again when
            approved.</sat-banner-message
          ></sat-banner
        >
      }
      @if (failure()) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
      <p class="bf-note">
        <mat-icon svgIcon="shield" aria-hidden="true" />Existing commitments are not affected. One
        audit entry and a reduction journal are recorded.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="bf-dialog__actions">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="busy() || !canSubmit()"
        (click)="submit()"
        data-testid="confirm-reduce"
      >
        <mat-icon svgIcon="trending_down" aria-hidden="true" />
        Reduce by <bf-money [amountMinor]="amountMinor() ?? 0" [currency]="b.currency" />
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReduceDialog extends ReductionDialogBase {
  private readonly ref = inject(MatDialogRef<ReduceDialog, boolean>);
  protected readonly amount = signal('');
  protected readonly amountMinor = computed(() => toMinor(this.amount()));
  protected readonly floor =
    this.bal.allocatedOut + this.bal.held + this.bal.encumbered + this.bal.actual;
  protected readonly max = Math.max(this.bal.authorized - this.floor, 0);

  protected previewBody() {
    const amountMinor = this.amountMinor();
    if (!amountMinor || amountMinor <= 0 || !this.destinationReady()) return null;
    return { action: 'reduce', amountMinor, ...this.destinationFields() };
  }

  protected canSubmit(): boolean {
    const i = this.impact();
    return (
      !!i &&
      !i.problem &&
      i.reductionMinor === this.amountMinor() &&
      !!this.reasonCode &&
      this.reason.trim().length >= 3
    );
  }

  protected async submit(): Promise<void> {
    const i = this.impact();
    if (!i) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      await data(
        this.api.reduceBudget({
          params: { budgetId: this.b.id },
          body: {
            amountMinor: this.amountMinor()!,
            reasonCode: this.reasonCode,
            reason: this.reason,
            confirmedFloorMinor: i.floorMinor,
            ...this.destinationFields(),
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

/** Screen 28: set to zero with impact, floor, cascade, destination, reason code, typed confirmation. */
@Component({
  selector: 'bf-zero-dialog',
  imports: [...COMMON, BudgetStatus],
  styleUrl: './dialogs.scss',
  template: `
    <div mat-dialog-title class="bf-dialog__head">
      <span class="bf-dialog__icon bf-dialog__icon--danger"
        ><mat-icon svgIcon="block" aria-hidden="true"
      /></span>
      <div>
        <h2 class="bf-dialog__title">Set budget to zero</h2>
        <p class="bf-dialog__subtitle">
          {{ b.name }} · owner {{ b.display.ownerName ?? '—' }} · {{ b.display.fiscalYearLabel }} ·
          {{ b.currency }}
        </p>
      </div>
    </div>
    <mat-dialog-content>
      <sat-banner variant="important"
        ><sat-banner-message
          ><strong>This stops all new spending.</strong> New requests and allocations are blocked.
          Approved commitments can still be paid.</sat-banner-message
        ></sat-banner
      >
      <div class="bf-dialog__grid">
        <div>
          <p class="bf-dialog__section-title">Impact</p>
          <div class="bf-panel">
            <dl class="bf-rows">
              <div>
                <dt>Authorized</dt>
                <dd><bf-money [amountMinor]="bal.authorized" [currency]="b.currency" /></dd>
              </div>
              <div>
                <dt>Actual spend</dt>
                <dd><bf-money [amountMinor]="bal.actual" [currency]="b.currency" /></dd>
              </div>
              <div>
                <dt>Approved commitments and holds</dt>
                <dd>
                  <bf-money [amountMinor]="bal.encumbered + bal.held" [currency]="b.currency" />
                </dd>
              </div>
              <div>
                <dt>Kept by child budgets</dt>
                <dd>
                  <bf-money
                    [amountMinor]="impact()?.childrenAllocatedMinor ?? bal.allocatedOut"
                    [currency]="b.currency"
                  />
                </dd>
              </div>
              <div class="bf-rows__total">
                <dt>Floor (committed + actual + children)</dt>
                <dd data-testid="zero-floor">
                  <bf-money [amountMinor]="impact()?.floorMinor ?? 0" [currency]="b.currency" />
                </dd>
              </div>
            </dl>
          </div>
          <div class="bf-cut">
            <span>Money cut</span>
            <bf-money
              [amountMinor]="impact()?.reductionMinor ?? 0"
              [currency]="b.currency"
              data-testid="zero-cut"
            />
          </div>
          @if ((impact()?.pendingMinor ?? 0) > 0) {
            <sat-banner variant="warning" style="margin-top: 12px"
              ><sat-banner-message
                >Pending requests (<bf-money
                  [amountMinor]="impact()!.pendingMinor"
                  [currency]="b.currency"
                />) will be cancelled and returned to the requesters.</sat-banner-message
              ></sat-banner
            >
          }
          @if (b.childCount > 0) {
            <p class="bf-dialog__section-title" style="margin-top: 16px">Child budgets</p>
            <ul class="bf-children">
              @for (a of children(); track a.budgetId) {
                <li>
                  <span>{{ a.name }}</span>
                  <span
                    ><bf-money [amountMinor]="a.authorizedMinor" [currency]="b.currency" />
                    <bf-budget-status [status]="cascade() ? a.newStatus : a.status"
                  /></span>
                </li>
              }
            </ul>
            <mat-slide-toggle
              [ngModel]="cascade()"
              (ngModelChange)="cascade.set($event)"
              data-testid="cascade"
              >Also set child budgets to zero</mat-slide-toggle
            >
          }
        </div>
        <div>
          <p class="bf-dialog__section-title">Decision</p>
          <mat-form-field class="bf-field">
            <mat-label>Destination for cut money</mat-label>
            <mat-select [ngModel]="destination()" (ngModelChange)="destination.set($event)">
              @if (b.parentId) {
                <mat-option value="parent">Return to parent: {{ b.display.parentName }}</mat-option>
              }
              <mat-option value="savings">Company savings</mat-option>
              <mat-option value="reallocation">Reallocate to another budget</mat-option>
            </mat-select>
          </mat-form-field>
          @if (destination() === 'reallocation') {
            <mat-form-field class="bf-field">
              <mat-label>Receiving budget</mat-label>
              <mat-select
                [ngModel]="destinationBudgetId()"
                (ngModelChange)="destinationBudgetId.set($event)"
              >
                @for (t of targets(); track t.id) {
                  <mat-option [value]="t.id">{{ t.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }
          <mat-form-field class="bf-field">
            <mat-label>Reason code</mat-label>
            <mat-select [(ngModel)]="reasonCode" required data-testid="reason-code">
              @for (r of codes() ?? []; track r.id) {
                <mat-option [value]="r.code">{{ r.code }} · {{ r.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field class="bf-field">
            <mat-label>Reason</mat-label>
            <textarea matInput rows="3" [(ngModel)]="reason" required></textarea>
          </mat-form-field>
          <div class="bf-confirm">
            <mat-form-field class="bf-field" subscriptSizing="dynamic">
              <mat-label>Type {{ confirmTarget }} to confirm</mat-label>
              <input
                matInput
                [ngModel]="confirmText()"
                (ngModelChange)="confirmText.set($event)"
                data-testid="confirm-text"
              />
              @if (confirmed()) {
                <mat-icon matSuffix svgIcon="check" class="bf-ok" aria-label="Confirmed" />
              }
            </mat-form-field>
          </div>
          <p class="bf-note">
            <mat-icon svgIcon="shield" aria-hidden="true" />Recorded in the audit log; the owner,
            child owners and requesters are notified.
          </p>
        </div>
      </div>
      @if (impact()?.problem; as p) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ p.message }}</sat-banner-message></sat-banner
        >
      }
      @if (failure()) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="bf-dialog__actions">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        class="bf-danger-button"
        type="button"
        [disabled]="busy() || !canSubmit()"
        (click)="submit()"
        data-testid="confirm-zero"
      >
        <mat-icon svgIcon="block" aria-hidden="true" />Set to zero
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZeroDialog extends ReductionDialogBase {
  private readonly ref = inject(MatDialogRef<ZeroDialog, boolean>);
  protected readonly confirmTarget = this.b.code ?? this.b.name;
  protected readonly confirmText = signal('');
  protected readonly confirmed = computed(
    () => this.confirmText().trim().toLowerCase() === this.confirmTarget.trim().toLowerCase(),
  );
  protected readonly children = computed(() =>
    (valueOf(this.treeRes) ?? [])
      .filter((t) => t.parentId === this.b.id)
      .map((t) => ({
        budgetId: t.id,
        name: t.name,
        status: t.status,
        newStatus: 'set_to_zero',
        authorizedMinor: t.balances.budgetCurrency.authorized.amountMinor,
      })),
  );

  protected previewBody() {
    if (!this.destinationReady()) return null;
    return { action: 'set_to_zero', cascade: this.cascade(), ...this.destinationFields() };
  }

  protected canSubmit(): boolean {
    const i = this.impact();
    return (
      !!i && !i.problem && this.confirmed() && !!this.reasonCode && this.reason.trim().length >= 3
    );
  }

  protected async submit(): Promise<void> {
    const i = this.impact();
    if (!i) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      await data(
        this.api.setBudgetToZero({
          params: { budgetId: this.b.id },
          body: {
            reasonCode: this.reasonCode,
            reason: this.reason,
            cascade: this.cascade(),
            confirmedFloorMinor: i.floorMinor,
            confirmText: this.confirmText(),
            ...this.destinationFields(),
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

export interface ReasonDialogData {
  budget: BudgetDetail;
  mode: 'restore';
}

/** Lifts a set to zero (no money returns; new allocations are accepted again). */
@Component({
  selector: 'bf-restore-dialog',
  imports: COMMON,
  styleUrl: './dialogs.scss',
  template: `
    <h2 mat-dialog-title>Lift set to zero on {{ b.name }}</h2>
    <mat-dialog-content>
      <p>
        The budget accepts allocations and new requests again. Its authorized amount stays
        <bf-money
          [amountMinor]="b.balances.budgetCurrency.authorized.amountMinor"
          [currency]="b.currency"
        />
        until someone allocates more.
      </p>
      <mat-form-field class="bf-field">
        <mat-label>Reason</mat-label>
        <textarea matInput rows="2" [(ngModel)]="reason" required></textarea>
      </mat-form-field>
      @if (failure()) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="bf-dialog__actions">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="busy() || reason.trim().length < 3"
        (click)="submit()"
      >
        Lift set to zero
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RestoreDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<RestoreDialog, boolean>);
  protected readonly b = inject<ReasonDialogData>(MAT_DIALOG_DATA).budget;
  protected reason = '';
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.busy.set(true);
    try {
      await data(
        this.api.restoreBudget({ params: { budgetId: this.b.id }, body: { reason: this.reason } }),
      );
      this.ref.close(true);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
