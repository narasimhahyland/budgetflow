import { getNumberOfCurrencyDigits } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { ApprovalTaskDetail, DecisionRequest } from '@bf/contracts';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { formatMoney } from './money';

const LABEL: Record<DecisionRequest['decision'], string> = {
  approve: 'Approve',
  approve_partial: 'Approve part',
  reject: 'Reject',
  request_changes: 'Request changes',
  escalate: 'Escalate',
};
const REASONS = [
  { code: 'REJ-BUDGET', label: 'Insufficient budget' },
  { code: 'REJ-POLICY', label: 'Outside policy' },
  { code: 'TRF-COFUND', label: 'Co-funding a shared event' },
];

/**
 * Screen 61: record a decision after the checks an approver must see (DoA cover, no conflict of
 * interest, budget before and after, rules). Emits the decision; the page sends it to the API, which
 * re-checks everything under lock.
 */
@Component({
  selector: 'bf-decision-form',
  imports: [
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  template: `
    @let t = task();
    <div class="bf-decision">
      <div class="bf-decision__form">
        <mat-button-toggle-group
          [value]="decision()"
          (change)="decision.set($event.value)"
          aria-label="Decision"
          hideSingleSelectionIndicator
        >
          @for (d of t.allowedDecisions; track d) {
            <mat-button-toggle [value]="d">{{ label(d) }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
        @if (!t.doa.withinLimit && t.allowedDecisions.includes('approve_partial')) {
          <sat-banner variant="important"
            ><sat-banner-message
              >{{ t.doa.message }} Approve part up to the limit, or escalate.</sat-banner-message
            ></sat-banner
          >
        }
        @if (decision() === 'approve_partial') {
          <mat-form-field appearance="outline">
            <mat-label>Approved amount ({{ t.task.amount.currency }})</mat-label>
            <input
              matInput
              inputmode="decimal"
              [ngModel]="partial()"
              (ngModelChange)="partial.set($event)"
              name="partial"
            />
            <mat-hint
              >Less than {{ money(t.task.amount)
              }}{{ t.doa.limit ? ', within ' + money(t.doa.limit) : '' }}</mat-hint
            >
          </mat-form-field>
        }
        @if (decision() !== 'approve' && decision() !== 'escalate') {
          <mat-form-field appearance="outline">
            <mat-label
              >Reason code{{ decision() === 'request_changes' ? ' (optional)' : '' }}</mat-label
            >
            <mat-select
              [ngModel]="reasonCode()"
              (ngModelChange)="reasonCode.set($event)"
              name="reasonCode"
            >
              @for (r of reasons; track r.code) {
                <mat-option [value]="r.code">{{ r.code }} · {{ r.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }
        <mat-form-field appearance="outline">
          <mat-label>Comment to the requester{{ needsComment() ? '' : ' (optional)' }}</mat-label>
          <textarea
            matInput
            rows="3"
            [ngModel]="comment()"
            (ngModelChange)="comment.set($event)"
            name="comment"
          ></textarea>
        </mat-form-field>
        @if (decision() === 'approve' || decision() === 'approve_partial') {
          <mat-checkbox
            [ngModel]="attested()"
            (ngModelChange)="attested.set($event)"
            name="attested"
            >I have no conflict of interest</mat-checkbox
          >
        }
        <div class="bf-decision__actions">
          <ng-content />
          @if (decision() === 'reject') {
            <button
              mat-stroked-button
              satImportantButton
              type="button"
              [disabled]="!valid() || busy()"
              (click)="submit()"
            >
              Reject
            </button>
          } @else {
            <button
              mat-flat-button
              type="button"
              [disabled]="!valid() || busy()"
              (click)="submit()"
            >
              {{ primaryLabel() }}
            </button>
          }
        </div>
      </div>
      <aside class="bf-decision__checks" aria-label="Check before you decide">
        <h4 class="bf-decision__title">Check before you decide</h4>
        <ul>
          @for (c of t.checks; track c.code) {
            <li [class.bf-decision__fail]="!c.passed">
              <mat-icon [svgIcon]="c.passed ? 'circle_check' : 'error'" aria-hidden="true" />
              <span
                ><strong>{{ c.label }}</strong> {{ c.passed ? '' : '— '
                }}<span class="bf-decision__detail">{{ c.detail }}</span></span
              >
            </li>
          }
        </ul>
        @if (t.impact) {
          <p class="bf-decision__detail">
            Available under this budget's rules: {{ money(t.impact.availableBefore) }} →
            {{ money(t.impact.availableAfter) }} after approval.
          </p>
        }
        @if (t.doa.onBehalfOfName) {
          <p class="bf-decision__detail">
            You act as a delegate for {{ t.doa.onBehalfOfName }}; the lower of both limits applies.
          </p>
        }
        <p class="bf-decision__detail">{{ t.ruleReason }}</p>
        <p class="bf-decision__detail">
          Your decision is audited with the limit used and your attestation.
        </p>
      </aside>
    </div>
  `,
  styles: `
    .bf-decision {
      display: grid;
      grid-template-columns: minmax(0, 3fr) minmax(220px, 2fr);
      gap: 16px;
    }
    @media (width < 900px) {
      .bf-decision {
        grid-template-columns: minmax(0, 1fr);
      }
    }
    .bf-decision__form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bf-decision__actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 8px;
    }
    .bf-decision__checks {
      padding: 12px 16px;
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-low);
    }
    .bf-decision__checks ul {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0 0 8px;
      padding: 0;
      list-style: none;
    }
    .bf-decision__checks li {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      font: var(--mat-sys-body-medium);
    }
    .bf-decision__checks mat-icon {
      flex: none;
      width: 18px;
      height: 18px;
      color: var(--sat-sys-success);
    }
    .bf-decision__fail mat-icon {
      color: var(--mat-sys-error);
    }
    .bf-decision__title {
      margin: 0 0 8px;
      font: var(--mat-sys-title-small);
    }
    .bf-decision__detail {
      margin: 0 0 6px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DecisionForm {
  readonly task = input.required<ApprovalTaskDetail>();
  readonly busy = input(false);
  readonly decide = output<DecisionRequest>();
  protected readonly reasons = REASONS;
  protected readonly decision = signal<DecisionRequest['decision']>('approve');
  protected readonly partial = signal('');
  protected readonly reasonCode = signal('');
  protected readonly comment = signal('');
  protected readonly attested = signal(false);

  constructor() {
    queueMicrotask(() => {
      const allowed = this.task().allowedDecisions;
      if (!allowed.includes('approve') && allowed.length) this.decision.set(allowed[0]);
    });
  }

  protected label(d: DecisionRequest['decision']): string {
    return LABEL[d];
  }

  protected money(m: { amountMinor: number; currency: string }): string {
    return formatMoney(m.amountMinor, m.currency);
  }

  private readonly partialMinor = computed(() => {
    const ccy = this.task().task.amount.currency;
    const n = Number(this.partial().replace(/[,\s]/g, ''));
    return Number.isFinite(n) && n > 0
      ? Math.round(n * 10 ** getNumberOfCurrencyDigits(ccy))
      : null;
  });

  protected readonly needsComment = computed(
    () => this.decision() === 'reject' || this.decision() === 'request_changes',
  );

  protected readonly valid = computed(() => {
    switch (this.decision()) {
      case 'approve':
        return this.attested();
      case 'approve_partial':
        return this.attested() && Boolean(this.reasonCode()) && (this.partialMinor() ?? 0) > 0;
      case 'reject':
        return Boolean(this.reasonCode() || this.comment().trim());
      case 'request_changes':
        return Boolean(this.comment().trim());
      default:
        return true;
    }
  });

  protected readonly primaryLabel = computed(() => {
    const t = this.task().task;
    if (this.decision() === 'approve') return `Approve ${this.money(t.amount)}`;
    if (this.decision() === 'approve_partial')
      return `Approve ${this.money({ amountMinor: this.partialMinor() ?? 0, currency: t.amount.currency })}`;
    return LABEL[this.decision()];
  });

  protected submit(): void {
    const d = this.decision();
    const ccy = this.task().task.amount.currency;
    this.decide.emit({
      decision: d,
      noConflictAttested: (d === 'approve' || d === 'approve_partial') && this.attested(),
      ...(d === 'approve_partial'
        ? { approvedAmount: { amountMinor: this.partialMinor() ?? 0, currency: ccy } }
        : {}),
      ...(this.reasonCode() && d !== 'approve' && d !== 'escalate'
        ? { reasonCode: this.reasonCode() }
        : {}),
      ...(this.comment().trim() ? { comment: this.comment().trim() } : {}),
    });
  }
}
