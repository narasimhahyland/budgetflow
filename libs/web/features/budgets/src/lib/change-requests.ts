import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import type { BudgetChangeRequest } from '@bf/contracts';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, toMajor, toMinor, valueOf } from './api';
import { LoadState } from './load-state';

const STATUS_TONE = {
  pending: 'warning',
  approved: 'success',
  rejected: 'important',
  cancelled: 'neutral',
} as const;

/**
 * Increase requests and contingency releases with the decision panel (approve fully or partly,
 * reject with a note). Screen 29a for a reserve; the Budget requests page for approvers.
 */
@Component({
  selector: 'bf-change-requests',
  imports: [
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  styleUrl: './page.scss',
  styles: `
    .bf-req {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 1000px) {
      .bf-req {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .bf-req__tabs {
      display: flex;
      gap: 4px;
      padding: 12px 16px 0;
    }
    .bf-req__table {
      width: 100%;
      border-collapse: collapse;
      font: var(--mat-sys-body-medium);
    }
    .bf-req__table th,
    .bf-req__table td {
      padding: 10px 16px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: start;
    }
    .bf-req__table th {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    .bf-req__table tbody tr {
      cursor: pointer;
    }
    .bf-req__table tbody tr:hover {
      background: var(--mat-sys-surface-container-low);
    }
    .bf-req__selected {
      background: var(--mat-sys-primary-container);
      box-shadow: inset 3px 0 0 var(--mat-sys-primary);
    }
    .bf-rows {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0 0 12px;
    }
    .bf-rows div {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    .bf-rows dt {
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-rows dd {
      margin: 0;
    }
    .bf-quote {
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-low);
      font: var(--mat-sys-body-medium);
    }
    .bf-field {
      width: 100%;
    }
    .bf-decide {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
  `,
  template: `
    <div class="bf-req">
      <section class="bf-card" aria-label="Requests">
        <div class="bf-req__tabs" role="tablist">
          @for (s of statuses; track s) {
            <button
              mat-button
              type="button"
              role="tab"
              [attr.aria-selected]="status() === s"
              [class.mat-mdc-unelevated-button]="status() === s"
              (click)="status.set(s)"
            >
              {{ label(s) }} {{ count(s) }}
            </button>
          }
        </div>
        <bf-load-state
          [loading]="list.isLoading()"
          [error]="list.error()"
          what="requests"
          (retry)="list.reload()"
        />
        @if (list.hasValue() && rows().length === 0) {
          <sat-empty-state>
            <h2 satEmptyStateHeadline>
              No {{ status() === 'all' ? '' : label(status()).toLowerCase() }} requests
            </h2>
            <p satEmptyStateDescription>
              Increase requests and reserve releases you can see appear here.
            </p>
          </sat-empty-state>
        }
        @if (rows().length) {
          <div class="bf-table-scroll">
            <table class="bf-req__table">
              <thead>
                <tr>
                  <th scope="col">For budget</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Requested by</th>
                  <th scope="col" class="bf-num">Amount</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                @for (r of rows(); track r.id) {
                  <tr
                    [class.bf-req__selected]="r.id === selected()?.id"
                    (click)="select(r)"
                    tabindex="0"
                    (keydown.enter)="select(r)"
                    [attr.data-testid]="'request-' + r.budgetName"
                  >
                    <td>
                      <span class="bf-cell__primary">{{ r.budgetName }}</span>
                      <span class="bf-cell__secondary">from {{ r.sourceBudgetName }}</span>
                    </td>
                    <td>{{ r.kind === 'increase' ? 'Increase' : 'Reserve release' }}</td>
                    <td>{{ r.requestedByName ?? '—' }}</td>
                    <td class="bf-num">
                      <bf-money
                        [amountMinor]="r.amount.amountMinor"
                        [currency]="r.amount.currency"
                      />
                    </td>
                    <td>
                      <sat-status-tag [status]="tone(r.status)">{{
                        label(r.status)
                      }}</sat-status-tag>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
      @if (selected(); as r) {
        <aside class="bf-card" aria-label="Request details" data-testid="request-panel">
          <div class="bf-card__header">
            <h2 class="bf-card__title">
              {{ r.kind === 'increase' ? 'Increase request' : 'Reserve release' }}
            </h2>
            <sat-status-tag [status]="tone(r.status)">{{ label(r.status) }}</sat-status-tag>
          </div>
          <div class="bf-card__body">
            <dl class="bf-rows">
              <div>
                <dt>Requested amount</dt>
                <dd>
                  <bf-money [amountMinor]="r.amount.amountMinor" [currency]="r.amount.currency" />
                </dd>
              </div>
              <div>
                <dt>Target budget</dt>
                <dd>
                  <a [routerLink]="['/budgets', r.budgetId]">{{ r.budgetName }}</a>
                </dd>
              </div>
              <div>
                <dt>Funded from</dt>
                <dd>
                  <a [routerLink]="['/budgets', r.sourceBudgetId]">{{ r.sourceBudgetName }}</a>
                </dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{{ r.createdAt | date: 'd MMM y' }} by {{ r.requestedByName ?? '—' }}</dd>
              </div>
              @if (r.sourceAvailableMinor !== null && r.status === 'pending') {
                <div>
                  <dt>{{ r.sourceBudgetName }} available</dt>
                  <dd>
                    <bf-money
                      [amountMinor]="r.sourceAvailableMinor"
                      [currency]="r.amount.currency"
                    />
                  </dd>
                </div>
              }
              @if (r.approvedAmount; as a) {
                <div>
                  <dt>Approved</dt>
                  <dd><bf-money [amountMinor]="a.amountMinor" [currency]="a.currency" /></dd>
                </div>
              }
              @if (r.decidedAt) {
                <div>
                  <dt>Decided</dt>
                  <dd>{{ r.decidedAt | date: 'd MMM y' }} by {{ r.decidedByName ?? '—' }}</dd>
                </div>
              }
            </dl>
            <p class="bf-quote">“{{ r.reason }}”</p>
            @if (r.decisionNote) {
              <p class="bf-card__hint">Decision note: {{ r.decisionNote }}</p>
            }
            @if (r.canDecide) {
              @if (
                r.sourceAvailableMinor !== null && (amountMinor() ?? 0) > r.sourceAvailableMinor
              ) {
                <sat-banner variant="important"
                  ><sat-banner-message
                    >{{ r.sourceBudgetName }} does not have enough available for this
                    amount.</sat-banner-message
                  ></sat-banner
                >
              }
              <mat-form-field class="bf-field">
                <mat-label>Amount to approve ({{ r.amount.currency }})</mat-label>
                <input
                  matInput
                  inputmode="decimal"
                  [ngModel]="amount()"
                  (ngModelChange)="amount.set($event)"
                  data-testid="approve-amount"
                />
                <mat-hint>Lower it to approve part of the request.</mat-hint>
              </mat-form-field>
              <mat-form-field class="bf-field">
                <mat-label>Note</mat-label>
                <textarea matInput rows="2" [(ngModel)]="note"></textarea>
              </mat-form-field>
              <div class="bf-decide">
                <button
                  mat-flat-button
                  type="button"
                  [disabled]="busy() || !(amountMinor() ?? 0)"
                  (click)="decide('approve')"
                  data-testid="approve"
                >
                  Approve
                  <bf-money [amountMinor]="amountMinor() ?? 0" [currency]="r.amount.currency" />
                </button>
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="busy()"
                  (click)="decide('reject')"
                  data-testid="reject"
                >
                  Reject
                </button>
              </div>
            } @else if (r.status === 'pending') {
              <p class="bf-card__hint">
                Waiting for the owner of {{ r.sourceBudgetName
                }}{{ r.kind === 'contingency_release' ? ' (or finance)' : '' }} to decide.
              </p>
            }
            @if (failure()) {
              <sat-banner variant="important"
                ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
              >
            }
          </div>
        </aside>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangeRequests {
  private readonly api = injectApi();
  readonly budgetId = input<string | null>(null);
  readonly changed = output<void>();
  protected readonly statuses = ['pending', 'approved', 'rejected', 'all'] as const;
  protected readonly status = signal<string>('pending');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly amount = signal('');
  protected note = '';
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected readonly list = resource({
    params: () => ({ budgetId: this.budgetId() }),
    loader: async ({ params }) =>
      (
        await data(
          this.api.listChangeRequests({
            query: params.budgetId ? { budgetId: params.budgetId } : {},
          }),
        )
      ).items,
  });
  protected readonly all = computed(() => valueOf(this.list) ?? []);
  protected readonly rows = computed(() =>
    this.status() === 'all' ? this.all() : this.all().filter((r) => r.status === this.status()),
  );
  protected readonly selected = computed(
    () => this.rows().find((r) => r.id === this.selectedId()) ?? this.rows()[0],
  );
  protected readonly amountMinor = computed(() => toMinor(this.amount()));

  protected label(s: string): string {
    return s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1);
  }
  protected count(s: string): number {
    return s === 'all' ? this.all().length : this.all().filter((r) => r.status === s).length;
  }
  protected tone(s: string) {
    return STATUS_TONE[s as keyof typeof STATUS_TONE] ?? 'neutral';
  }

  protected select(r: BudgetChangeRequest): void {
    this.selectedId.set(r.id);
    this.failure.set(null);
  }

  private shownId: string | null = null;

  constructor() {
    effect(() => {
      const r = this.selected();
      if (r && r.id !== this.shownId) {
        this.shownId = r.id;
        this.amount.set(toMajor(r.amount.amountMinor));
      }
    });
  }

  protected async decide(decision: 'approve' | 'reject'): Promise<void> {
    const r = this.selected();
    if (!r) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      const amountMinor = this.amountMinor() ?? r.amount.amountMinor;
      await data(
        this.api.decideChangeRequest({
          params: { requestId: r.id },
          body: {
            decision,
            ...(decision === 'approve' ? { approvedAmountMinor: amountMinor } : {}),
            ...(this.note.trim() ? { note: this.note.trim() } : {}),
          },
        }),
      );
      this.note = '';
      this.list.reload();
      this.changed.emit();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
