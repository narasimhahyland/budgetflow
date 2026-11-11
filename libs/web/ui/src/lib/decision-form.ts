import { BreakpointObserver } from '@angular/cdk/layout';
import { getNumberOfCurrencyDigits } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
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
let nextId = 0;

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
          [vertical]="narrow()"
          [class.bf-decision__toggles--vertical]="narrow()"
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
            <mat-label>Approved amount</mat-label>
            <span matTextPrefix>{{ t.task.amount.currency }}&nbsp;</span>
            <input
              matInput
              inputmode="decimal"
              required
              [ngModel]="partial()"
              (ngModelChange)="partial.set($event)"
              name="partial"
            />
            <mat-hint
              >Less than {{ money(t.task.amount)
              }}{{ t.doa.limit ? ', within ' + money(t.doa.limit) : '' }}</mat-hint
            >
            <mat-error
              ><mat-icon svgIcon="error" aria-hidden="true" />Enter the amount you
              approve.</mat-error
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
              [required]="decision() === 'approve_partial'"
              name="reasonCode"
            >
              @for (r of reasons; track r.code) {
                <mat-option [value]="r.code">{{ r.code }} · {{ r.label }}</mat-option>
              }
            </mat-select>
            <mat-error
              ><mat-icon svgIcon="error" aria-hidden="true" />Choose a reason code for a partial
              approval.</mat-error
            >
          </mat-form-field>
        }
        <mat-form-field appearance="outline">
          <mat-label>Comment to the requester{{ needsComment() ? '' : ' (optional)' }}</mat-label>
          <textarea
            matInput
            rows="3"
            [required]="decision() === 'request_changes'"
            [ngModel]="comment()"
            (ngModelChange)="comment.set($event)"
            name="comment"
          ></textarea>
          <mat-error
            ><mat-icon svgIcon="error" aria-hidden="true" />Tell the requester what to
            change.</mat-error
          >
        </mat-form-field>
        @if (decision() === 'approve' || decision() === 'approve_partial') {
          <mat-checkbox
            [ngModel]="attested()"
            (ngModelChange)="attested.set($event)"
            name="attested"
            >I have no conflict of interest</mat-checkbox
          >
        }
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
      <div class="bf-decision__actions">
        @let why = blockedReason();
        @if (why) {
          <p class="bf-decision__why" [id]="whyId">{{ why }}</p>
        }
        <ng-content />
        @if (
          decision() === 'approve' || decision() === 'approve_partial' || decision() === 'reject'
        ) {
          <button
            mat-flat-button
            satImportantButton
            type="button"
            [disabled]="!valid() || busy()"
            [attr.aria-describedby]="why ? whyId : null"
            (click)="submit()"
          >
            {{ primaryLabel() }}
          </button>
        } @else {
          <button
            mat-flat-button
            type="button"
            [disabled]="!valid() || busy()"
            [attr.aria-describedby]="why ? whyId : null"
            (click)="submit()"
          >
            {{ primaryLabel() }}
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      container-type: inline-size;
    }
    .bf-decision {
      display: grid;
      grid-template-columns: minmax(0, 3fr) minmax(220px, 2fr);
      grid-template-areas:
        'form checks'
        'actions actions';
      gap: 16px;
    }
    @container (width < 760px) {
      .bf-decision {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas:
          'form'
          'checks'
          'actions';
      }
    }
    .bf-decision__form {
      display: flex;
      flex-direction: column;
      gap: 12px;
      grid-area: form;
      min-width: 0;
    }
    .bf-decision__form mat-button-toggle-group {
      align-self: flex-start;
      max-width: 100%;
    }
    .bf-decision__form .bf-decision__toggles--vertical {
      align-self: stretch;
    }
    .bf-decision__form mat-error mat-icon {
      width: 16px;
      height: 16px;
      margin-inline-end: 4px;
      vertical-align: -3px;
    }
    .bf-decision__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      grid-area: actions;
    }
    .bf-decision__why {
      flex: 1 1 240px;
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      text-align: end;
    }
    .bf-decision__checks {
      grid-area: checks;
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
      color: var(--sat-sys-success-icon);
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
  protected readonly whyId = `bf-decision-why-${nextId++}`;
  /** Below 600px the decisions stack: a wrapped toggle row reads as one broken pill. */
  protected readonly narrow = toSignal(
    inject(BreakpointObserver)
      .observe('(width < 600px)')
      .pipe(map((s) => s.matches)),
    { initialValue: false },
  );

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
    if (this.decision() === 'approve_partial') {
      const minor = this.partialMinor();
      return minor === null
        ? LABEL.approve_partial
        : `Approve ${this.money({ amountMinor: minor, currency: t.amount.currency })}`;
    }
    return LABEL[this.decision()];
  });

  /** Why the confirm button is disabled, in plain English beside it (section 4). */
  protected readonly blockedReason = computed(() => {
    if (this.valid() || this.busy()) return null;
    switch (this.decision()) {
      case 'approve':
        return 'Confirm you have no conflict of interest to approve.';
      case 'approve_partial':
        if ((this.partialMinor() ?? 0) <= 0) return 'Enter the amount you approve.';
        if (!this.reasonCode()) return 'Choose a reason code for a partial approval.';
        return 'Confirm you have no conflict of interest to approve.';
      case 'reject':
        return 'Give a reason code or a comment so the requester knows why.';
      case 'request_changes':
        return 'Tell the requester what to change.';
      default:
        return null;
    }
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
