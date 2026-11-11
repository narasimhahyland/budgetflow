import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import type { YearEndLine, YearEndRun } from '@bf/contracts';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { data, errorMessage, injectApi, toMinor } from './api';

/** Screen 87b, step 3: the Finance Controller decides a carry-with-approval line. */
@Component({
  selector: 'bf-carry-decision-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    Money,
    SAT_BANNER_IMPORTS,
  ],
  styleUrl: './dialogs.scss',
  template: `
    <h2 mat-dialog-title>Carry decision: {{ d.line.budgetName }}</h2>
    <mat-dialog-content>
      <div class="bf-panel">
        <dl class="bf-rows">
          <div>
            <dt>Available at the dry run</dt>
            <dd>
              <bf-money [amountMinor]="d.line.availableMinor" [currency]="d.line.currency" />
            </dd>
          </div>
          <div>
            <dt>Requested carry</dt>
            <dd><bf-money [amountMinor]="d.line.carryMinor" [currency]="d.line.currency" /></dd>
          </div>
          <div>
            <dt>Open commitments carried</dt>
            <dd>{{ d.line.openCommitmentCount }}</dd>
          </div>
        </dl>
      </div>
      <mat-radio-group
        class="bf-radios"
        [ngModel]="decision()"
        (ngModelChange)="decision.set($event)"
        aria-label="Decision"
      >
        <mat-radio-button value="approve" data-testid="carry-approve"
          >Approve the full amount</mat-radio-button
        >
        <mat-radio-button value="approve_part" data-testid="carry-approve-part"
          >Approve part of it</mat-radio-button
        >
        <mat-radio-button value="decline" data-testid="carry-decline"
          >Decline: it lapses instead</mat-radio-button
        >
      </mat-radio-group>
      @if (decision() === 'approve_part') {
        <mat-form-field class="bf-field">
          <mat-label>Amount to carry ({{ d.line.currency }})</mat-label>
          <input
            matInput
            [ngModel]="amount()"
            (ngModelChange)="amount.set($event)"
            data-testid="carry-amount"
          />
          <mat-hint>Cannot be more than the requested carry.</mat-hint>
        </mat-form-field>
      }
      <mat-form-field class="bf-field">
        <mat-label>Reason</mat-label>
        <textarea
          matInput
          rows="2"
          [ngModel]="reason()"
          (ngModelChange)="reason.set($event)"
          data-testid="carry-reason"
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
        data-testid="confirm-carry-decision"
      >
        Record the decision
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CarryDecisionDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<CarryDecisionDialog, YearEndRun>);
  protected readonly d = inject<{ runId: string; line: YearEndLine }>(MAT_DIALOG_DATA);
  protected readonly decision = signal<'approve' | 'approve_part' | 'decline'>('approve');
  protected readonly amount = signal('');
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  private readonly partMinor = computed(() =>
    this.amount().trim() ? toMinor(this.amount(), this.d.line.currency) : undefined,
  );
  protected readonly ready = computed(
    () =>
      this.reason().trim().length >= 5 &&
      (this.decision() !== 'approve_part' || this.partMinor() !== undefined),
  );

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    const part = this.partMinor();
    try {
      this.ref.close(
        await data(
          this.api.decideYearEndCarry({
            params: { runId: this.d.runId, lineId: this.d.line.id },
            body: {
              decision: this.decision(),
              ...(this.decision() === 'approve_part' && part !== undefined
                ? { approvedCarryMinor: part }
                : {}),
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

/**
 * Screen 87b, step 4: execute. The dialog sets the expectation before the user commits — the
 * postings are real, there is no undo, and the server refuses a second execution of the same run.
 */
@Component({
  selector: 'bf-execute-year-end-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    Money,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  styleUrl: './dialogs.scss',
  template: `
    <h2 mat-dialog-title>Run year end {{ d.run.fiscalYearLabel }}</h2>
    <mat-dialog-content>
      <sat-banner variant="important">
        <sat-banner-message>
          This posts real journals and cannot be undone. Running it a second time is refused by the
          server, so correcting anything afterwards means a reversal in an open period.
        </sat-banner-message>
      </sat-banner>
      <div class="bf-panel">
        <dl class="bf-rows">
          <div>
            <dt>Budgets in the run</dt>
            <dd>{{ d.run.totals.budgetCount }}</dd>
          </div>
          <div>
            <dt>Carries into {{ d.run.targetFiscalYearLabel }}</dt>
            <dd>
              <bf-money
                [amountMinor]="d.run.totals.carryMinor"
                [currency]="d.run.totals.currency"
              />
            </dd>
          </div>
          <div>
            <dt>Lapses and sweeps</dt>
            <dd>
              <bf-money
                [amountMinor]="d.run.totals.lapseMinor"
                [currency]="d.run.totals.currency"
              />
            </dd>
          </div>
          <div class="bf-rows__total">
            <dt>Open commitments carried</dt>
            <dd>
              {{ d.run.totals.commitmentCount }} ·
              <bf-money
                [amountMinor]="d.run.totals.commitmentCarryMinor"
                [currency]="d.run.totals.currency"
              />
            </dd>
          </div>
        </dl>
      </div>
      <p class="bf-note">
        Lapsed money returns to the sweep targets, carried amounts become
        {{ d.run.targetFiscalYearLabel }} authorized, and open commitments are released in
        {{ d.run.fiscalYearLabel }} and re-posted in {{ d.run.targetFiscalYearLabel }} at their
        original amount.
      </p>
      <mat-form-field class="bf-field">
        <mat-label>Type {{ d.run.executeConfirmation }} to confirm</mat-label>
        <input
          matInput
          [ngModel]="confirmation()"
          (ngModelChange)="confirmation.set($event)"
          data-testid="execute-confirmation"
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
        data-testid="confirm-execute"
      >
        Execute year end
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecuteYearEndDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<ExecuteYearEndDialog, YearEndRun>);
  protected readonly d = inject<{ run: YearEndRun }>(MAT_DIALOG_DATA);
  protected readonly confirmation = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly ready = computed(() => this.confirmation() === this.d.run.executeConfirmation);

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.ref.close(
        await data(
          this.api.executeYearEndRun({
            params: { runId: this.d.run.id },
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
