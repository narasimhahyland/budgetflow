import { ChangeDetectionStrategy, Component, computed, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import type { ApprovalHistoryItem } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState, Money } from '@bf/web/ui';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { inject } from '@angular/core';
import { data, injectApi, valueOf } from './api';

const DECISIONS: { value: string; label: string }[] = [
  { value: '', label: 'Every decision' },
  { value: 'approve', label: 'Approved' },
  { value: 'approve_partial', label: 'Partly approved' },
  { value: 'reject', label: 'Rejected' },
  { value: 'request_changes', label: 'Changes requested' },
];

type Tone = 'success' | 'important' | 'info' | 'neutral';
// Section 5: every decision is a toned tag with its own icon, never plain text.
const DECISION_VIEW: Record<string, { label: string; tone: Tone; icon: string }> = {
  approve: { label: 'Approved', tone: 'success', icon: 'circle_check' },
  approve_partial: { label: 'Partly approved', tone: 'success', icon: 'circle_check' },
  reject: { label: 'Rejected', tone: 'important', icon: 'circle_x' },
  request_changes: { label: 'Changes requested', tone: 'info', icon: 'note_edit' },
  escalate: { label: 'Escalated', tone: 'info', icon: 'arrow_up' },
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
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SatAvatar,
    SatStatusTag,
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
      <section aria-labelledby="summary-title">
        <h2 class="bf-visually-hidden" id="summary-title">Every decision on record</h2>
        <div class="bf-kpis" data-testid="history-summary">
          <div class="bf-kpi">
            <div class="bf-kpi__head">
              <p class="bf-kpi__label">Decisions</p>
              <mat-icon class="bf-kpi__icon" svgIcon="check_double" aria-hidden="true" />
            </div>
            <p class="bf-kpi__value">{{ h.summary.totalDecisions }}</p>
            <p class="bf-kpi__delta">Every decision on record</p>
          </div>
          <div class="bf-kpi">
            <div class="bf-kpi__head">
              <p class="bf-kpi__label">Typical time to decide</p>
              <mat-icon class="bf-kpi__icon" svgIcon="clock" aria-hidden="true" />
            </div>
            <p class="bf-kpi__value">{{ h.summary.medianLabel }}</p>
            <p class="bf-kpi__delta">Median, from assignment to decision</p>
          </div>
          <div class="bf-kpi bf-kpi--warning">
            <div class="bf-kpi__head">
              <p class="bf-kpi__label">Escalated</p>
              <mat-icon class="bf-kpi__icon" svgIcon="arrow_up" aria-hidden="true" />
            </div>
            <p class="bf-kpi__value">{{ h.summary.escalationPct }}%</p>
            <div class="bf-kpi__foot">
              <span>Of all decisions</span
              ><span class="bf-kpi__pct">{{ h.summary.escalationPct }}%</span>
              <span class="bf-kpi__track"
                ><span class="bf-kpi__fill" [style.width.%]="h.summary.escalationPct"></span
              ></span>
            </div>
          </div>
          <div class="bf-kpi bf-kpi--info">
            <div class="bf-kpi__head">
              <p class="bf-kpi__label">Decided by email</p>
              <mat-icon class="bf-kpi__icon" svgIcon="mail" aria-hidden="true" />
            </div>
            <p class="bf-kpi__value">{{ h.summary.emailPct }}%</p>
            <div class="bf-kpi__foot">
              <span>Of all decisions</span
              ><span class="bf-kpi__pct">{{ h.summary.emailPct }}%</span>
              <span class="bf-kpi__track"
                ><span class="bf-kpi__fill" [style.width.%]="h.summary.emailPct"></span
              ></span>
            </div>
          </div>
        </div>
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
          <table class="bf-split-table bf-table--stack" aria-label="Approval decisions">
            <thead>
              <tr>
                <th>Decided</th>
                <th>Request</th>
                <th class="bf-num">Amount</th>
                <th>Decision</th>
                <th>Approver</th>
                <th class="bf-num bf-col--extra">Limit at decision</th>
                <th class="bf-col--extra">Channel</th>
                <th class="bf-col--extra">Took</th>
              </tr>
            </thead>
            <tbody>
              @for (i of rows(); track i.actionId) {
                <tr [attr.data-testid]="'decision-' + i.ref">
                  <td data-label="Decided">
                    <span data-testid="relative-time">{{
                      i.decidedAt | bfDateTime: session.timezone()
                    }}</span>
                    <span class="bf-cell__secondary bf-only-mid"
                      >{{ i.channel === 'email' ? 'Email' : 'In BudgetFlow' }} ·
                      {{ i.timeToDecideLabel }}</span
                    >
                  </td>
                  <td data-label="Request">
                    <span class="bf-request">
                      <a
                        class="bf-cell__code"
                        [routerLink]="[
                          i.subjectType === 'contribution' ? '/contributions' : '/requests',
                          i.subjectId,
                        ]"
                        >{{ i.ref }}</a
                      >
                      <span class="bf-cell__secondary">{{ i.title }}</span>
                    </span>
                  </td>
                  <td class="bf-num" data-label="Amount">
                    <bf-money
                      [amountMinor]="i.reportingAmount.amountMinor"
                      [currency]="i.reportingAmount.currency"
                    />
                  </td>
                  <td class="bf-nowrap" data-label="Decision">
                    @let v = decisionView(i);
                    <sat-status-tag [status]="v.tone"
                      ><mat-icon [svgIcon]="v.icon" aria-hidden="true" />{{
                        v.label
                      }}</sat-status-tag
                    >
                  </td>
                  <td data-label="Approver">
                    <span class="bf-cell__owner"
                      ><sat-avatar
                        size="24"
                        [initials]="initials(i.approverName)"
                        aria-hidden="true"
                      />{{ i.approverName }}</span
                    >
                    <span class="bf-cell__secondary bf-only-mid"
                      >Limit
                      @if (i.doaLimit) {
                        <bf-money
                          [amountMinor]="i.doaLimit.amountMinor"
                          [currency]="i.doaLimit.currency"
                        />
                      } @else {
                        not applied
                      }
                    </span>
                    @if (i.onBehalfOfName) {
                      <span class="bf-cell__secondary">for {{ i.onBehalfOfName }}</span>
                    }
                  </td>
                  <td class="bf-num bf-col--extra" data-label="Limit at decision">
                    @if (i.doaLimit) {
                      <bf-money
                        [amountMinor]="i.doaLimit.amountMinor"
                        [currency]="i.doaLimit.currency"
                      />
                    } @else {
                      No limit applied
                    }
                  </td>
                  <td class="bf-col--extra" data-label="Channel">
                    {{ i.channel === 'email' ? 'Email' : 'In BudgetFlow' }}
                  </td>
                  <td class="bf-col--extra" data-label="Took">
                    {{ i.timeToDecideLabel }}
                    @if (i.slaStatus === 'breached') {
                      <sat-status-tag status="warning"
                        ><mat-icon svgIcon="clock" aria-hidden="true" />Later than
                        agreed</sat-status-tag
                      >
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
  styles: `
    .bf-visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .bf-nowrap {
      white-space: nowrap;
    }
    .bf-only-mid {
      display: none;
    }
    /* Between phone and desktop, channel and timing move under the decision date so the table
       fits the card instead of hiding columns past its edge. */
    @media (600px <= width < 1100px) {
      .bf-col--extra {
        display: none;
      }
      .bf-only-mid {
        display: block;
      }
    }
    .bf-request {
      display: inline-flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
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

  protected decisionView(i: ApprovalHistoryItem): { label: string; tone: Tone; icon: string } {
    return (
      DECISION_VIEW[i.decision] ?? {
        label: i.decision.replace(/_/g, ' '),
        tone: 'neutral',
        icon: 'circle_minus',
      }
    );
  }

  protected initials(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('');
  }
}
