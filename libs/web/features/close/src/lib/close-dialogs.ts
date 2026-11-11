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
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import type {
  CloseCheck,
  CloseEntityChecklist,
  ClosePeriodDetail,
  ReopenRequest,
} from '@bf/contracts';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { data, errorMessage, injectApi, valueOf } from './api';

/** The reason codes finance picks when accepting a soft check or asking for a break-glass reopen. */
function reasonCodes() {
  const api = injectApi();
  return resource({
    loader: async () =>
      (await data(api.listReasonCodes({ query: { category: 'period_close' } }))).items,
  });
}

/** Screen 80e: accept a soft check with a reason. Hard checks never reach this dialog. */
@Component({
  selector: 'bf-acknowledge-check-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    SAT_BANNER_IMPORTS,
  ],
  styleUrl: './dialogs.scss',
  template: `
    <h2 mat-dialog-title>Accept “{{ d.check.title }}”</h2>
    <mat-dialog-content>
      <p class="bf-dialog__subtitle">
        {{ d.entity.legalEntityCode }} — {{ d.entity.legalEntityName }}. {{ d.check.detail }}
      </p>
      <p class="bf-note">
        Accepting records who accepted it and why. It does not change the numbers: anything still
        outstanding posts to the next open period with a late flag.
      </p>
      <mat-form-field class="bf-field">
        <mat-label>Reason code</mat-label>
        <mat-select
          [ngModel]="reasonCode()"
          (ngModelChange)="reasonCode.set($event)"
          data-testid="ack-reason-code"
        >
          @for (r of codes(); track r.id) {
            <mat-option [value]="r.code">{{ r.code }} — {{ r.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field class="bf-field">
        <mat-label>Reason</mat-label>
        <textarea
          matInput
          rows="3"
          [ngModel]="reason()"
          (ngModelChange)="reason.set($event)"
          data-testid="ack-reason"
        ></textarea>
        <mat-hint>Say what is outstanding and what happens to it.</mat-hint>
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
        [disabled]="busy() || !ready()"
        (click)="submit()"
        data-testid="confirm-acknowledge"
      >
        Accept with this reason
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcknowledgeCheckDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<AcknowledgeCheckDialog, ClosePeriodDetail>);
  protected readonly d = inject<{
    periodId: string;
    entity: CloseEntityChecklist;
    check: CloseCheck;
  }>(MAT_DIALOG_DATA);
  private readonly codesRes = reasonCodes();
  protected readonly codes = computed(() => valueOf(this.codesRes) ?? []);
  protected readonly reasonCode = signal('');
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly ready = computed(
    () => this.reasonCode().length > 0 && this.reason().trim().length >= 10,
  );

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.ref.close(
        await data(
          this.api.acknowledgeCloseCheck({
            params: { periodId: this.d.periodId },
            body: {
              legalEntityId: this.d.entity.legalEntityId,
              code: this.d.check.code,
              reasonCode: this.reasonCode(),
              reason: this.reason().trim(),
            },
          }),
        ),
      );
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Screen 80e: close the period. The phrase must match exactly and the server re-checks every rule. */
@Component({
  selector: 'bf-close-period-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  styleUrl: './dialogs.scss',
  template: `
    <h2 mat-dialog-title>Close {{ d.detail.period.label }}</h2>
    <mat-dialog-content>
      <p class="bf-dialog__subtitle">
        Postings dated in {{ d.detail.period.label }} are refused from now on. Anything that arrives
        later posts to the next open period with a late flag.
      </p>
      <div class="bf-panel">
        <dl class="bf-rows">
          <div>
            <dt>Legal entities</dt>
            <dd>{{ d.detail.entities.length }}</dd>
          </div>
          <div>
            <dt>Checks passed</dt>
            <dd>{{ passed() }} of {{ total() }}</dd>
          </div>
          <div>
            <dt>Accepted with a reason</dt>
            <dd>{{ acknowledged() }}</dd>
          </div>
          <div class="bf-rows__total">
            <dt>As-of snapshots taken</dt>
            <dd>{{ d.detail.entities.length }}, one per entity</dd>
          </div>
        </dl>
      </div>
      <p class="bf-note">A snapshot is append-only: a correction after the close is a reversal.</p>
      <mat-form-field class="bf-field">
        <mat-label>Type {{ d.detail.closeConfirmation }} to confirm</mat-label>
        <input
          matInput
          [ngModel]="confirmation()"
          (ngModelChange)="confirmation.set($event)"
          data-testid="close-confirmation"
        />
        <mat-hint>The phrase must match exactly.</mat-hint>
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
        satImportantButton
        type="button"
        [disabled]="busy() || !ready()"
        (click)="submit()"
        data-testid="confirm-close"
      >
        Close period
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClosePeriodDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<ClosePeriodDialog, ClosePeriodDetail>);
  protected readonly d = inject<{ detail: ClosePeriodDetail }>(MAT_DIALOG_DATA);
  private readonly checks = this.d.detail.entities.flatMap((e) => e.checks);
  protected readonly total = signal(this.checks.length);
  protected readonly passed = signal(this.checks.filter((c) => c.status === 'pass').length);
  protected readonly acknowledged = signal(this.checks.filter((c) => c.acknowledgement).length);
  protected readonly confirmation = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly ready = computed(
    () => this.confirmation() === this.d.detail.closeConfirmation,
  );

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.ref.close(
        await data(
          this.api.closePeriod({
            params: { periodId: this.d.detail.period.id },
            body: { confirmation: this.confirmation() },
          }),
        ),
      );
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Screen 80e: soft close (finance adjustments only) and lock (after reporting). */
@Component({
  selector: 'bf-period-status-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    SAT_BANNER_IMPORTS,
  ],
  styleUrl: './dialogs.scss',
  template: `
    <h2 mat-dialog-title>
      {{ d.action === 'soft_close' ? 'Soft close' : 'Lock' }} {{ d.periodLabel }}
    </h2>
    <mat-dialog-content>
      <p class="bf-dialog__subtitle">
        @if (d.action === 'soft_close') {
          Only finance adjustments (accruals, reclassifications) post to {{ d.periodLabel }} after a
          soft close. Everyday spending is refused.
        } @else {
          Lock once reporting is done. A locked period only reopens through a break-glass request
          that a second person approves.
        }
      </p>
      <mat-form-field class="bf-field">
        <mat-label>Reason (optional)</mat-label>
        <input
          matInput
          [ngModel]="reason()"
          (ngModelChange)="reason.set($event)"
          data-testid="status-reason"
        />
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
        [disabled]="busy()"
        (click)="submit()"
        data-testid="confirm-status"
      >
        {{ d.action === 'soft_close' ? 'Soft close' : 'Lock period' }}
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeriodStatusDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<PeriodStatusDialog, ClosePeriodDetail>);
  protected readonly d = inject<{
    periodId: string;
    periodLabel: string;
    action: 'soft_close' | 'lock';
  }>(MAT_DIALOG_DATA);
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    const body = this.reason().trim() ? { reason: this.reason().trim() } : {};
    try {
      const params = { periodId: this.d.periodId };
      this.ref.close(
        await data(
          this.d.action === 'soft_close'
            ? this.api.softClosePeriod({ params, body })
            : this.api.lockPeriod({ params, body }),
        ),
      );
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * Screen 80e, break-glass: asking to reopen a closed period or unlock a locked one. Deliberately
 * not an ordinary action — the dialog states that it is audited and that a second person decides.
 */
@Component({
  selector: 'bf-break-glass-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  styleUrl: './dialogs.scss',
  template: `
    <div mat-dialog-title class="bf-dialog__head">
      <span class="bf-dialog__icon bf-dialog__icon--danger" aria-hidden="true">
        <mat-icon svgIcon="unlocked" />
      </span>
      <span>
        <span class="bf-dialog__title"
          >{{ d.action === 'reopen' ? 'Reopen' : 'Unlock' }} {{ d.periodLabel }}</span
        >
        <span class="bf-dialog__subtitle">Break-glass request</span>
      </span>
    </div>
    <mat-dialog-content>
      <sat-banner variant="important">
        <sat-banner-message>
          Reopening a closed period is exceptional. Reports and board packs already use the as-of
          snapshot of this period. Prefer a reversal in the next open period where you can.
        </sat-banner-message>
      </sat-banner>
      <p class="bf-note">
        This request is written to the audit log with your name and reason, and it does nothing on
        its own: a different person has to approve it before the period moves.
      </p>
      <mat-form-field class="bf-field">
        <mat-label>Reason code</mat-label>
        <mat-select
          [ngModel]="reasonCode()"
          (ngModelChange)="reasonCode.set($event)"
          data-testid="break-glass-reason-code"
        >
          @for (r of codes(); track r.id) {
            <mat-option [value]="r.code">{{ r.code }} — {{ r.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field class="bf-field">
        <mat-label>Why this cannot wait for the next open period</mat-label>
        <textarea
          matInput
          rows="3"
          [ngModel]="reason()"
          (ngModelChange)="reason.set($event)"
          data-testid="break-glass-reason"
        ></textarea>
        <mat-hint>At least 20 characters. The approver reads this.</mat-hint>
      </mat-form-field>
      <mat-form-field class="bf-field">
        <mat-label>Type {{ d.periodLabel }} to confirm</mat-label>
        <input
          matInput
          [ngModel]="confirmation()"
          (ngModelChange)="confirmation.set($event)"
          data-testid="break-glass-confirmation"
        />
        <mat-hint>The period name must match exactly.</mat-hint>
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
        satImportantButton
        type="button"
        [disabled]="busy() || !ready()"
        (click)="submit()"
        data-testid="confirm-break-glass"
      >
        Ask a second person to {{ d.action === 'reopen' ? 'reopen' : 'unlock' }}
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BreakGlassDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<BreakGlassDialog, ReopenRequest>);
  protected readonly d = inject<{
    periodId: string;
    periodLabel: string;
    action: 'reopen' | 'unlock';
  }>(MAT_DIALOG_DATA);
  private readonly codesRes = reasonCodes();
  protected readonly codes = computed(() => valueOf(this.codesRes) ?? []);
  protected readonly reasonCode = signal('');
  protected readonly reason = signal('');
  protected readonly confirmation = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly ready = computed(
    () =>
      this.reasonCode().length > 0 &&
      this.reason().trim().length >= 20 &&
      this.confirmation().trim() === this.d.periodLabel,
  );

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.ref.close(
        await data(
          this.api.requestPeriodReopen({
            params: { periodId: this.d.periodId },
            body: {
              action: this.d.action,
              reasonCode: this.reasonCode(),
              reason: this.reason().trim(),
            },
          }),
        ),
      );
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Screen 80e, break-glass: the second person decides. The requester's own approval is refused. */
@Component({
  selector: 'bf-reopen-decision-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    SAT_BANNER_IMPORTS,
  ],
  styleUrl: './dialogs.scss',
  template: `
    <h2 mat-dialog-title>Decide the break-glass request</h2>
    <mat-dialog-content>
      <div class="bf-panel">
        <dl class="bf-rows">
          <div>
            <dt>Asked for</dt>
            <dd>{{ d.request.action === 'reopen' ? 'Reopen' : 'Unlock' }}</dd>
          </div>
          <div>
            <dt>Period</dt>
            <dd>{{ d.request.periodLabel }}</dd>
          </div>
          <div>
            <dt>Requested by</dt>
            <dd>{{ d.request.requestedByName ?? 'Unknown' }}</dd>
          </div>
          <div>
            <dt>Reason code</dt>
            <dd>{{ d.request.reasonCode }}</dd>
          </div>
        </dl>
        <p class="bf-note">“{{ d.request.reason }}”</p>
      </div>
      <mat-radio-group
        class="bf-radios"
        [ngModel]="decision()"
        (ngModelChange)="decision.set($event)"
        aria-label="Decision"
      >
        <mat-radio-button value="approve" data-testid="decision-approve"
          >Approve: the period moves and a re-close takes a new snapshot version</mat-radio-button
        >
        <mat-radio-button value="decline" data-testid="decision-decline"
          >Decline: the period stays as it is</mat-radio-button
        >
      </mat-radio-group>
      <mat-form-field class="bf-field">
        <mat-label>Reason for your decision</mat-label>
        <textarea
          matInput
          rows="2"
          [ngModel]="reason()"
          (ngModelChange)="reason.set($event)"
          data-testid="decision-reason"
        ></textarea>
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
        [disabled]="busy() || !ready()"
        (click)="submit()"
        data-testid="confirm-decision"
      >
        Record the decision
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReopenDecisionDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<ReopenDecisionDialog, ReopenRequest>);
  protected readonly d = inject<{ request: ReopenRequest }>(MAT_DIALOG_DATA);
  protected readonly decision = signal<'approve' | 'decline'>('approve');
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly ready = computed(() => this.reason().trim().length >= 5);

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.ref.close(
        await data(
          this.api.decidePeriodReopen({
            params: { requestId: this.d.request.id },
            body: { decision: this.decision(), reason: this.reason().trim() },
          }),
        ),
      );
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
