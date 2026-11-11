import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ApprovalRouteView } from '@bf/contracts';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { Money } from './money';
import { SpendStatus } from './spend-status';

const RESOLVER: Record<string, string> = {
  budget_owner: 'Budget owner',
  parent_owner: 'Owner up the hierarchy',
  giving_director: 'Giving director',
  finance_review: 'Finance review',
  executive: 'Executive',
};

const SKIP: Record<string, string> = {
  requester: 'skipped: the requester',
  beneficiary: 'skipped: benefits from the event',
  attendee: 'skipped: attends the event',
  no_authority: 'skipped: no delegation of authority for this spend',
  above_limit: 'skipped: above their delegation-of-authority limit',
};

/** The approval route as an ordered list: each step's approver, why they hold it, their DoA limit and state. */
@Component({
  selector: 'bf-approval-route',
  imports: [Money, SatAvatar, SpendStatus],
  template: `
    @let r = route();
    <ol class="bf-route" aria-label="Approval route">
      @for (s of r.steps; track s.taskId ?? s.stepNo + s.personId) {
        <li
          class="bf-route__step"
          [class.bf-route__step--done]="s.status !== 'pending' && s.status !== 'waiting'"
          [class.bf-route__step--current]="s.status === 'pending'"
        >
          <span class="bf-route__marker" aria-hidden="true">{{ s.stepNo }}</span>
          <div class="bf-route__body">
            <div class="bf-route__line">
              <span class="bf-route__who">
                <sat-avatar size="24" [initials]="initials(s.personName)" aria-hidden="true" />
                <span class="bf-route__name">{{ s.personName }}</span>
              </span>
              <bf-spend-status kind="task" [status]="s.status" />
            </div>
            <span class="bf-route__meta">
              {{ resolver(s.resolver) }} · {{ s.reason }}
              @if (s.limit) {
                · DoA limit
                <bf-money [amountMinor]="s.limit.amountMinor" [currency]="s.limit.currency" />
              }
            </span>
            @if (s.actedByName && s.actedByName !== s.personName) {
              <span class="bf-route__meta"
                >Decided by {{ s.actedByName }} on behalf of
                {{ s.onBehalfOfName ?? s.personName }}</span
              >
            }
            @if (s.channel === 'email') {
              <span class="bf-route__meta">Decided from email</span>
            }
            @if (s.comment) {
              <span class="bf-route__comment">“{{ s.comment }}”</span>
            }
          </div>
        </li>
      }
    </ol>
    @if (r.skipped.length) {
      <ul class="bf-route__skipped" aria-label="Skipped approvers">
        @for (s of r.skipped; track $index) {
          <li>{{ s.personName }} {{ skip(s.reason) }}</li>
        }
      </ul>
    }
  `,
  styles: `
    .bf-route {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .bf-route__step {
      display: grid;
      grid-template-columns: 28px 1fr;
      gap: 10px;
      align-items: start;
    }
    .bf-route__marker {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: var(--mat-sys-corner-full);
      border: 1px solid var(--mat-sys-outline-variant);
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
    }
    .bf-route__step--done .bf-route__marker {
      background: var(--sat-sys-success-container);
      color: var(--sat-sys-on-success-container);
      border-color: transparent;
    }
    .bf-route__step--current .bf-route__marker {
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
      border-color: transparent;
    }
    .bf-route__body {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .bf-route__line {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: space-between;
    }
    .bf-route__who {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .bf-route__name {
      font: var(--mat-sys-title-small);
    }
    .bf-route__meta {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-route__comment {
      font: var(--mat-sys-body-small);
      font-style: italic;
    }
    .bf-route__skipped {
      margin: 8px 0 0;
      padding-left: 38px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovalRoute {
  readonly route = input.required<ApprovalRouteView>();
  /** Initials for the approver's avatar (section 6 people pattern). */
  protected initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
    return (first + last).toUpperCase();
  }

  protected resolver(r: string): string {
    return RESOLVER[r] ?? r;
  }
  protected skip(r: string): string {
    return SKIP[r] ?? 'skipped';
  }
}
