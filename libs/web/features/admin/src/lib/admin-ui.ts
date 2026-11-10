import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { AdminChangeRequest } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';

/**
 * A change that needs a second person, rendered next to the value that is still in force.
 *
 * The whole point of this component is that a waiting change must never read as though it has
 * happened: the caller passes what is in force today (`inForce`), and this block says, in words,
 * that the request has not taken effect.
 */
@Component({
  selector: 'bf-pending-change',
  imports: [DateTimePipe, MatButtonModule, SAT_TAG_IMPORTS],
  template: `
    <div class="bf-pending" [attr.data-testid]="testId()">
      <sat-status-tag status="warning">Waiting for a second person</sat-status-tag>
      <p class="bf-pending__inforce">
        <strong>{{ inForce() }}</strong> is still in force.
      </p>
      <p class="bf-pending__summary">
        Requested: {{ change().summary }}. This has not taken effect.
      </p>
      <p class="bf-pending__meta">
        Asked for by {{ change().requestedByName ?? 'a person no longer recorded' }} on
        {{ change().requestedAt | bfDateTime: timezone() }} — “{{ change().reason }}”
      </p>
      @if (canConfirm()) {
        <div class="bf-pending__actions">
          <button mat-flat-button type="button" [disabled]="busy()" (click)="confirm.emit()">
            Confirm change
          </button>
          <button mat-stroked-button type="button" [disabled]="busy()" (click)="decline.emit()">
            Decline
          </button>
        </div>
      } @else if (mine()) {
        <div class="bf-pending__actions">
          <p class="bf-pending__meta">
            You asked for this change, so somebody else has to confirm it.
          </p>
          <button mat-stroked-button type="button" [disabled]="busy()" (click)="withdraw.emit()">
            Withdraw request
          </button>
        </div>
      } @else {
        <p class="bf-pending__meta">
          {{ confirmerNote() }}
        </p>
      }
    </div>
  `,
  styles: `
    .bf-pending {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 12px;
      border: 1px solid var(--sat-sys-warning-icon);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--sat-sys-warning-container);
      color: var(--sat-sys-on-warning-container);
    }

    .bf-pending__inforce,
    .bf-pending__summary {
      margin: 0;
      font: var(--mat-sys-body-medium);
    }

    .bf-pending__meta {
      margin: 0;
      font: var(--mat-sys-body-small);
    }

    .bf-pending__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 4px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PendingChange {
  private readonly session = inject(SessionStore);
  readonly change = input.required<AdminChangeRequest>();
  /** What is in force today, in words, for example “Off” or “8 years after the fiscal year closes”. */
  readonly inForce = input.required<string>();
  /** Whether the signed-in person may decide this change (the API checks it again). */
  readonly canDecide = input(false);
  readonly busy = input(false);
  readonly testId = input('pending-change');
  /** Who has to confirm, in words, shown to people who cannot decide it themselves. */
  readonly confirmerNote = input('A Finance Controller has to confirm it before it takes effect.');
  readonly confirm = output<void>();
  readonly decline = output<void>();
  readonly withdraw = output<void>();
  protected readonly timezone = this.session.timezone;
  protected readonly mine = computed(
    () => this.change().requestedByName === this.session.me()?.displayName,
  );
  /** The requester never confirms their own change, whatever the policy says. */
  protected readonly canConfirm = computed(() => this.canDecide() && !this.mine());
}

/** A reason field used by every administration change; the API requires one on each of them. */
@Component({
  selector: 'bf-reason-field',
  imports: [MatFormFieldModule, MatInputModule],
  template: `
    <mat-form-field appearance="outline" class="bf-reason">
      <mat-label>{{ label() }}</mat-label>
      <input
        matInput
        required
        [attr.data-testid]="testId()"
        [value]="value()"
        (input)="valueChange.emit($any($event.target).value)"
      />
      <mat-hint>{{ hint() }}</mat-hint>
    </mat-form-field>
  `,
  styles: `
    .bf-reason {
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReasonField {
  readonly value = input('');
  readonly label = input('Reason');
  readonly hint = input('Recorded in the audit trail with your name.');
  readonly testId = input('reason');
  readonly valueChange = output<string>();
}
