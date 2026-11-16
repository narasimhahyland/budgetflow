import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { AI_REPORT_REASONS, type AiReportedAnswer, type AiReportReason } from '@bf/contracts';
import { data, errorMessage, injectApi } from './api';

export const REPORT_REASON_LABELS: Record<AiReportReason, string> = {
  wrong_figure: 'Wrong figure',
  missing_data: 'Missing data',
  not_my_scope: 'Not my scope',
  other: 'Other',
};

/**
 * 011a "Report a problem": what was wrong, an optional note, and "Include my question and the
 * answer" (on by default). The text is kept only with that switch on, and only for 90 days.
 */
@Component({
  selector: 'bf-report-answer-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    MatSlideToggleModule,
    ReactiveFormsModule,
  ],
  template: `
    <h2 mat-dialog-title>Report a problem with this answer</h2>
    <mat-dialog-content>
      <p class="bf-dialog__question">“{{ turn.question }}”</p>
      <p id="report-reason-label" class="bf-dialog__label">What was wrong?</p>
      <mat-radio-group
        [formControl]="reason"
        aria-labelledby="report-reason-label"
        class="bf-dialog__reasons"
      >
        @for (r of reasons; track r) {
          <mat-radio-button [value]="r">{{ labels[r] }}</mat-radio-button>
        }
      </mat-radio-group>
      @if (reason.invalid && reason.touched) {
        <p class="bf-dialog__error" role="alert">Choose what was wrong.</p>
      }
      <mat-form-field appearance="outline" class="bf-dialog__field">
        <mat-label>Note (optional)</mat-label>
        <textarea matInput rows="3" maxlength="500" [formControl]="note"></textarea>
      </mat-form-field>
      <mat-slide-toggle [formControl]="includeText" data-testid="include-text">
        Include my question and the answer
      </mat-slide-toggle>
      <p class="bf-dialog__hint">
        AI administrators see the text for 90 days. Without it they see only the reason and your
        note.
      </p>
      @if (error(); as e) {
        <p class="bf-dialog__error" role="alert">{{ e }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" (click)="ref.close(null)">Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="saving()"
        (click)="send()"
        data-testid="send-report"
      >
        Send report
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .bf-dialog__question {
      margin: 0 0 12px;
      font: var(--mat-sys-body-large);
    }
    .bf-dialog__label {
      margin: 0 0 4px;
      font: var(--mat-sys-title-small);
    }
    .bf-dialog__reasons {
      display: flex;
      flex-direction: column;
      margin-bottom: 12px;
    }
    .bf-dialog__field {
      width: 100%;
    }
    .bf-dialog__hint {
      margin: 4px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-dialog__error {
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-medium);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportAnswerDialog {
  protected readonly ref =
    inject<MatDialogRef<ReportAnswerDialog, AiReportedAnswer | null>>(MatDialogRef);
  protected readonly turn = inject<{ turnId: string; question: string }>(MAT_DIALOG_DATA);
  private readonly api = injectApi();
  protected readonly reasons = AI_REPORT_REASONS;
  protected readonly labels = REPORT_REASON_LABELS;
  protected readonly reason = new FormControl<AiReportReason | null>(null, Validators.required);
  protected readonly note = new FormControl('', { nonNullable: true });
  protected readonly includeText = new FormControl(true, { nonNullable: true });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async send(): Promise<void> {
    this.reason.markAsTouched();
    if (!this.reason.value) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const note = this.note.value.trim();
      const report = await data(
        this.api.reportAiAnswer({
          body: {
            turnId: this.turn.turnId,
            reason: this.reason.value,
            includeText: this.includeText.value,
            ...(note ? { note } : {}),
          },
        }),
      );
      this.ref.close(report);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
