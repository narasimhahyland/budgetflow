import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { PendingApprovalItem, PendingKind, SlaState } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState, Money } from '@bf/web/ui';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from '../api';

const KIND_LABELS: Record<PendingKind, string> = {
  spending: 'Spending',
  additional_fund: 'Additional funds',
  over_budget: 'Over budget',
  budget: 'Event budget',
  exception: 'Exception',
  co_funding: 'Co-funding',
};
const BAND_LABELS = ['0–1 day', '1–2 days', '2–5 days', 'Over 5 days'];

/**
 * Screen 018: what is waiting for approval across the organization (or the viewer's budgets). The
 * page can remind an approver, at most once per item every four hours; nobody approves from here.
 */
@Component({
  selector: 'bf-pending-approvals-page',
  imports: [
    DateTimePipe,
    DecimalPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Pending approvals</h1>
        <p class="bf-page__subtitle">
          What is waiting, at which step, with whom and for how long. Nobody approves from this
          page.
          @if (overview(); as o) {
            As of
            <span data-testid="relative-time">{{
              o.generatedAt | bfDateTime: session.timezone()
            }}</span>
          }
        </p>
      </div>
      @if (overview()) {
        <div class="bf-page__actions">
          <a mat-stroked-button routerLink="/dashboards/approval-performance"
            ><mat-icon svgIcon="timer" />Performance</a
          >
        </div>
      }
    </header>

    <section class="bf-card" aria-labelledby="pending-filters-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="pending-filters-title">Filters</h2>
      </div>
      <div class="bf-filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Request kind</mat-label>
          <mat-select [ngModel]="kind()" (ngModelChange)="setFilter('kind', $event)">
            <mat-option [value]="''">Any kind</mat-option>
            @for (k of kinds; track k) {
              <mat-option [value]="k">{{ kindLabel(k) }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>SLA</mat-label>
          <mat-select [ngModel]="sla()" (ngModelChange)="setFilter('sla', $event)">
            <mat-option [value]="''">Any</mat-option>
            <mat-option value="within">Within SLA</mat-option>
            <mat-option value="due_today">Due today</mat-option>
            <mat-option value="breached">Past SLA</mat-option>
          </mat-select>
        </mat-form-field>
      </div>
      @if (overview()?.scope?.note; as note) {
        <p class="bf-card__body bf-cell__secondary" data-testid="scope-note">{{ note }}</p>
      }
    </section>

    <bf-load-state
      [loading]="pending.isLoading() && !pending.hasValue()"
      [error]="pending.error()"
      what="pending approvals"
      shape="table"
      (retry)="pending.reload()"
    />

    @if (overview(); as o) {
      <div class="bf-kpis" data-testid="pending-kpis">
        <div class="bf-kpi">
          <div class="bf-kpi__head"><p class="bf-kpi__label">Pending items</p></div>
          <p class="bf-kpi__value" data-testid="kpi-pending">{{ o.kpis.pending | number }}</p>
        </div>
        <div class="bf-kpi bf-kpi--warning bf-kpi--pending">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Pending amount (pre-encumbered)</p>
          </div>
          <p class="bf-kpi__value">
            <bf-money
              [amountMinor]="o.kpis.preEncumbered.amountMinor"
              [currency]="o.kpis.preEncumbered.currency"
            />
          </p>
          <p class="bf-kpi__delta">
            Plus
            <bf-money
              [amountMinor]="o.kpis.coFundingRequested.amountMinor"
              [currency]="o.kpis.coFundingRequested.currency"
            />
            in co-funding requests, not yet held
          </p>
        </div>
        <div class="bf-kpi bf-kpi--important">
          <div class="bf-kpi__head"><p class="bf-kpi__label">Past SLA</p></div>
          <p class="bf-kpi__value" data-testid="kpi-past-sla">{{ o.kpis.pastSla | number }}</p>
        </div>
        <div class="bf-kpi">
          <div class="bf-kpi__head"><p class="bf-kpi__label">Median wait so far</p></div>
          <p class="bf-kpi__value">
            {{
              o.kpis.medianWaitHours === null
                ? '—'
                : (o.kpis.medianWaitHours | number: '1.1-1') + ' hours'
            }}
          </p>
        </div>
      </div>

      @if (o.items.length === 0) {
        <sat-empty-state>
          <h3 satEmptyStateHeadline>Nothing is waiting for approval</h3>
          <p satEmptyStateDescription>Every request on the budgets you can see has been decided.</p>
        </sat-empty-state>
      } @else {
        <div class="bf-dash-grid">
          <section class="bf-card" aria-labelledby="by-step-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="by-step-title">By step</h2>
            </div>
            <div class="bf-table-scroll">
              <table class="bf-split-table" aria-label="Pending by step and SLA">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th class="bf-num">Within SLA</th>
                    <th class="bf-num">Due today</th>
                    <th class="bf-num">Past SLA</th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of o.bySteps; track s.step) {
                    <tr>
                      <td>{{ s.step }}</td>
                      <td class="bf-num">{{ s.within }}</td>
                      <td class="bf-num">{{ s.dueToday }}</td>
                      <td class="bf-num">{{ s.breached }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
          <section class="bf-card" aria-labelledby="aging-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="aging-title">Aging by approver</h2>
            </div>
            <div class="bf-table-scroll">
              <table class="bf-split-table" aria-label="Pending by approver and age">
                <thead>
                  <tr>
                    <th>Approver</th>
                    @for (b of bands; track b) {
                      <th class="bf-num">{{ b }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (a of o.aging; track a.approverPersonId) {
                    <tr>
                      <td>
                        <a
                          routerLink="."
                          [queryParams]="{ approver: a.approverPersonId }"
                          queryParamsHandling="merge"
                          >{{ a.approverName }}</a
                        >
                        @if (a.pastSla) {
                          <sat-status-tag status="important"
                            >{{ a.pastSla }} past SLA</sat-status-tag
                          >
                        }
                      </td>
                      @for (cell of a.bands; track $index) {
                        <td class="bf-num">
                          @if (cell.count) {
                            {{ cell.count }} ·
                            <bf-money
                              [amountMinor]="cell.amount.amountMinor"
                              [currency]="cell.amount.currency"
                            />
                          } @else {
                            —
                          }
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>

        @if (problem(); as p) {
          <p class="bf-error-text" role="alert">{{ p }}</p>
        }
        <section class="bf-card" aria-labelledby="items-title">
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title" id="items-title">Waiting items</h2>
              @if (approver()) {
                <p class="bf-card__hint">
                  One approver's queue.
                  <a routerLink="." [queryParams]="{ approver: null }" queryParamsHandling="merge"
                    >Show everyone</a
                  >
                </p>
              }
            </div>
          </div>
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Waiting items">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Budget</th>
                  <th class="bf-num">Amount</th>
                  <th>Step and approver</th>
                  <th>Waiting</th>
                  <th>Last notified</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (i of o.items; track i.taskId) {
                  <tr [attr.data-testid]="'pending-' + i.reference">
                    <td>
                      <a class="bf-cell__primary" [routerLink]="link(i)">{{ i.reference }}</a>
                      <span class="bf-cell__secondary"
                        >{{ kindLabel(i.kind) }} ·
                        {{ i.requesterName ?? 'Unknown requester' }}</span
                      >
                    </td>
                    <td>{{ i.budgetName ?? '—' }}</td>
                    <td class="bf-num">
                      @if (i.amount) {
                        <span [class.bf-amount--pending]="i.held">
                          <bf-money
                            [amountMinor]="i.amount.amountMinor"
                            [currency]="i.amount.currency"
                          />
                        </span>
                      } @else if (i.transactionAmount) {
                        <bf-money
                          [amountMinor]="i.transactionAmount.amountMinor"
                          [currency]="i.transactionAmount.currency"
                        />
                      }
                      <span class="bf-cell__secondary">{{
                        i.held ? 'Pre-encumbered' : 'Not yet held'
                      }}</span>
                    </td>
                    <td>
                      {{ i.step }}
                      <span class="bf-cell__secondary"
                        >{{ i.approverName
                        }}{{ i.delegateName ? ' · delegated to ' + i.delegateName : '' }}</span
                      >
                    </td>
                    <td>
                      <sat-status-tag [status]="slaTone(i.sla)">{{ i.slaText }}</sat-status-tag>
                      <span class="bf-cell__secondary"
                        >{{ i.waitingHours | number: '1.1-1' }} hours</span
                      >
                    </td>
                    <td>{{ channelLabel(i.lastNotifiedChannel) }}</td>
                    <td>
                      <button
                        mat-stroked-button
                        type="button"
                        [disabled]="!i.canNudge || busy() === i.taskId"
                        [attr.aria-label]="'Remind ' + i.approverName + ' about ' + i.reference"
                        (click)="nudge(i)"
                      >
                        Nudge approver
                      </button>
                      @if (i.lastNudgedAt) {
                        <span class="bf-cell__secondary"
                          >Reminded {{ i.lastNudgedAt | bfDateTime: session.timezone() }}</span
                        >
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    }
  `,
  styles: `
    .bf-dash-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }
    .bf-error-text {
      color: var(--mat-sys-error);
    }
    .bf-kpi--pending {
      border-style: dashed;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendingApprovalsPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  protected readonly kinds = Object.keys(KIND_LABELS) as PendingKind[];
  protected readonly bands = BAND_LABELS;
  protected readonly busy = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly kind = computed(() => this.query().get('kind') ?? '');
  protected readonly sla = computed(() => this.query().get('sla') ?? '');
  protected readonly approver = computed(() => this.query().get('approver') ?? '');

  protected readonly pending = resource({
    params: () => ({ kind: this.kind(), sla: this.sla(), approver: this.approver() }),
    loader: ({ params }) =>
      data(
        this.api.getPendingApprovals({
          query: {
            ...(params.kind ? { kind: params.kind as PendingKind } : {}),
            ...(params.sla ? { sla: params.sla as SlaState } : {}),
            ...(params.approver ? { approverPersonId: params.approver } : {}),
          },
        }),
      ),
  });
  protected readonly overview = computed(() => valueOf(this.pending));

  protected kindLabel(k: string): string {
    return KIND_LABELS[k as PendingKind] ?? k;
  }

  protected channelLabel(c: string | null): string {
    if (!c) return '—';
    return (
      (
        {
          email: 'Email',
          slack: 'Slack',
          teams: 'Teams',
          push: 'Push',
          in_app: 'In-app',
        } as Record<string, string>
      )[c] ?? c
    );
  }

  protected slaTone(s: SlaState): 'success' | 'warning' | 'important' {
    return s === 'breached' ? 'important' : s === 'due_today' ? 'warning' : 'success';
  }

  protected link(i: PendingApprovalItem): string[] {
    return i.subjectType === 'request'
      ? ['/requests', i.subjectId]
      : ['/contributions', i.subjectId];
  }

  protected setFilter(key: string, value: string): void {
    void this.router.navigate([], {
      queryParams: { [key]: value || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected async nudge(i: PendingApprovalItem): Promise<void> {
    this.busy.set(i.taskId);
    this.problem.set(null);
    try {
      const r = await data(this.api.nudgeApprover({ params: { taskId: i.taskId } }));
      const by = r.channels.map((c) => (c === 'in_app' ? 'in-app' : c)).join(' and ');
      this.snack.open(`Reminder sent to ${r.approverName} by ${by}.`, undefined, {
        duration: 5000,
      });
      this.pending.reload();
    } catch (e) {
      this.problem.set(errorMessage(e));
    } finally {
      this.busy.set(null);
    }
  }
}
