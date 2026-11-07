import { ChangeDetectionStrategy, Component, computed, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import type { ApprovalHistoryItem } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { inject } from '@angular/core';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const DECISIONS: { value: string; label: string }[] = [
  { value: '', label: 'Every decision' },
  { value: 'approve', label: 'Approved' },
  { value: 'approve_partial', label: 'Partly approved' },
  { value: 'reject', label: 'Rejected' },
  { value: 'request_changes', label: 'Changes requested' },
];

const DECISION_LABELS: Record<string, string> = {
  approve: 'Approved',
  approve_partial: 'Partly approved',
  reject: 'Rejected',
  request_changes: 'Changes requested',
  escalate: 'Escalated',
};

/** Screen 90: every approval decision with the approver, their authority, channel and timing. */
@Component({
  selector: 'bf-approval-history-page',
  imports: [
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Approval history</h1>
        <p class="bf-page__subtitle">
          Who decided, on which channel, how long it took, and the delegation-of-authority limit
          they held at the time.
        </p>
      </div>
    </header>
    <bf-load-state
      [loading]="history.isLoading() && !history.hasValue()"
      [error]="history.error()"
      what="the approval history"
      (retry)="history.reload()"
    />
    @if (valueOf(history); as h) {
      @if (!canReadAll()) {
        <sat-banner variant="info"
          ><sat-banner-message
            >These are the decisions you made. Finance and audit see every
            decision.</sat-banner-message
          ></sat-banner
        >
      }
      <section class="bf-card" aria-labelledby="summary-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="summary-title">Every decision on record</h2>
        </div>
        <dl class="bf-facts" data-testid="history-summary">
          <div class="bf-facts__item">
            <dt>Decisions</dt>
            <dd>{{ h.summary.totalDecisions }}</dd>
          </div>
          <div class="bf-facts__item">
            <dt>Typical time to decide</dt>
            <dd>{{ h.summary.medianLabel }}</dd>
          </div>
          <div class="bf-facts__item">
            <dt>Escalated</dt>
            <dd>{{ h.summary.escalationPct }}%</dd>
          </div>
          <div class="bf-facts__item">
            <dt>Decided by email</dt>
            <dd>{{ h.summary.emailPct }}%</dd>
          </div>
        </dl>
      </section>
      <section class="bf-card" aria-labelledby="filters-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="filters-title">Narrow the list</h2>
        </div>
        <div class="bf-form">
          <mat-form-field appearance="outline">
            <mat-label>Decision</mat-label>
            <mat-select
              [ngModel]="decision()"
              (ngModelChange)="decision.set($event)"
              name="decision"
              data-testid="filter-decision"
            >
              @for (d of decisions; track d.value) {
                <mat-option [value]="d.value">{{ d.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Special cases</mat-label>
            <mat-select
              [ngModel]="only()"
              (ngModelChange)="only.set($event)"
              name="only"
              data-testid="filter-only"
            >
              <mat-option value="">No special case</mat-option>
              <mat-option value="delegated">Decided by a delegate</mat-option>
              <mat-option value="escalated">Escalated first</mat-option>
              <mat-option value="breached">Decided late</mat-option>
            </mat-select>
          </mat-form-field>
        </div>
      </section>
      <section class="bf-card" aria-labelledby="list-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="list-title">Decisions</h2>
        </div>
        <div class="bf-table-scroll">
          <table class="bf-split-table" aria-label="Approval decisions">
            <thead>
              <tr>
                <th>Decided</th>
                <th>Request</th>
                <th class="bf-num">Amount</th>
                <th>Decision</th>
                <th>Approver</th>
                <th class="bf-num">Limit at decision</th>
                <th>Channel</th>
                <th>Took</th>
              </tr>
            </thead>
            <tbody>
              @for (i of rows(); track i.actionId) {
                <tr [attr.data-testid]="'decision-' + i.ref">
                  <td>
                    <span data-testid="relative-time">{{
                      i.decidedAt | bfDateTime: session.timezone()
                    }}</span>
                  </td>
                  <td>
                    <a [routerLink]="['/requests', i.subjectId]">{{ i.ref }}</a>
                    <span class="bf-cell__secondary">{{ i.title }}</span>
                  </td>
                  <td class="bf-num">
                    <bf-money
                      [amountMinor]="i.reportingAmount.amountMinor"
                      [currency]="i.reportingAmount.currency"
                    />
                  </td>
                  <td>{{ decisionLabel(i) }}</td>
                  <td>
                    {{ i.approverName }}
                    @if (i.onBehalfOfName) {
                      <span class="bf-cell__secondary">for {{ i.onBehalfOfName }}</span>
                    }
                  </td>
                  <td class="bf-num">
                    @if (i.doaLimit) {
                      <bf-money
                        [amountMinor]="i.doaLimit.amountMinor"
                        [currency]="i.doaLimit.currency"
                      />
                    } @else {
                      No limit applied
                    }
                  </td>
                  <td>{{ i.channel === 'email' ? 'Email' : 'In BudgetFlow' }}</td>
                  <td>
                    {{ i.timeToDecideLabel }}
                    @if (i.slaStatus === 'breached') {
                      <span class="bf-cell__secondary">Later than agreed</span>
                    }
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="8" data-testid="history-empty">
                    No decisions match. Set both lists back to their first option to see everything
                    again.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovalHistoryPage {
  private readonly api = injectApi();
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly decisions = DECISIONS;
  protected readonly decision = signal('');
  protected readonly only = signal('');
  protected readonly canReadAll = computed(() => this.session.can('audit.read'));

  protected readonly history = resource({
    params: () => ({ decision: this.decision(), only: this.only() }),
    loader: ({ params }) =>
      data(
        this.api.listApprovalHistory({
          query: {
            ...(params.decision ? { decision: params.decision } : {}),
            ...(params.only === 'delegated' ? { delegatedOnly: 'true' as const } : {}),
            ...(params.only === 'escalated' ? { escalatedOnly: 'true' as const } : {}),
            ...(params.only === 'breached' ? { aboveSlaOnly: 'true' as const } : {}),
          },
        }),
      ),
  });

  protected readonly rows = computed(() => valueOf(this.history)?.items ?? []);

  protected decisionLabel(i: ApprovalHistoryItem): string {
    return DECISION_LABELS[i.decision] ?? i.decision;
  }
}
