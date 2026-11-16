import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { AiReportedAnswer, AiReportReason } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateOnlyPipe, DateTimePipe, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { AiLabel } from './ai-output';
import { aiChannelLabel, aiFeatureLabel } from './ai-labels';
import { AiTabs } from './ai-tabs';
import { data, errorMessage, injectApi, valueOf } from './api';
import { QueryLogTabs } from './query-log-tabs';
import { REPORT_REASON_LABELS } from './report-answer-dialog';

/** Mark reviewed: the reviewer says what they found or did. */
@Component({
  selector: 'bf-review-report-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
  ],
  template: `
    <h2 mat-dialog-title>Mark the report reviewed</h2>
    <mat-dialog-content>
      <p>
        Reported by {{ report.reporterName ?? 'a former user' }}: {{ reasonLabel(report.reason) }}.
        Reviewing changes nothing the answer said or did.
      </p>
      <mat-form-field appearance="outline" class="bf-dialog__field">
        <mat-label>Review note</mat-label>
        <textarea
          matInput
          rows="3"
          [formControl]="note"
          maxlength="500"
          data-testid="review-note"
        ></textarea>
        @if (note.hasError('required') && note.touched) {
          <mat-error>Add a note saying what you found.</mat-error>
        }
      </mat-form-field>
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
        (click)="save()"
        data-testid="confirm-review"
      >
        Mark reviewed
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .bf-dialog__field {
      width: 100%;
    }
    .bf-dialog__error {
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-medium);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewReportDialog {
  protected readonly ref =
    inject<MatDialogRef<ReviewReportDialog, AiReportedAnswer | null>>(MatDialogRef);
  protected readonly report = inject<AiReportedAnswer>(MAT_DIALOG_DATA);
  private readonly api = injectApi();
  protected readonly note = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(500)],
  });
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly reasonLabel = (r: AiReportReason) => REPORT_REASON_LABELS[r];

  protected async save(): Promise<void> {
    this.note.markAsTouched();
    if (this.note.invalid || !this.note.value.trim()) {
      this.note.setErrors({ required: true });
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const updated = await data(
        this.api.reviewAiReportedAnswer({
          params: { reportId: this.report.id },
          body: { note: this.note.value.trim() },
        }),
      );
      this.ref.close(updated);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}

/**
 * Screen 113a, Query log > Reported answers: answers people reported from Ask BudgetFlow with
 * "Report a problem". Text appears only when the reporter chose to include it, and only for 90
 * days. Who may read and who may mark reviewed both come from the API (`canReview`).
 */
@Component({
  selector: 'bf-reported-answers-page',
  imports: [
    AiLabel,
    AiTabs,
    DateOnlyPipe,
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    QueryLogTabs,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <div class="bf-title-row">
          <h1 class="bf-page__title">AI query log</h1>
          <bf-ai-label text="AI activity" />
        </div>
        <p class="bf-page__subtitle">
          Answers people reported as wrong or unhelpful. Text is here only when the person chose to
          include their question and the answer.
        </p>
      </div>
    </header>

    <bf-ai-tabs class="bf-tabs" />
    <bf-query-log-tabs class="bf-tabs" />

    <section class="bf-card" aria-labelledby="reported-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="reported-title">Reported answers, newest first</h2>
        @if (list(); as l) {
          <p class="bf-card__meta" data-testid="reported-counts">
            {{ l.counts.new }} new · {{ l.counts.reviewed }} reviewed
          </p>
        }
      </div>
      <div class="bf-filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Status</mat-label>
          <mat-select [ngModel]="status()" (ngModelChange)="status.set($event)">
            <mat-option value="">All statuses</mat-option>
            <mat-option value="new">New</mat-option>
            <mat-option value="reviewed">Reviewed</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      <bf-load-state
        [loading]="reports.isLoading() && !reports.hasValue()"
        [error]="reports.error()"
        what="the reported answers"
        shape="table"
        (retry)="reports.reload()"
      />

      @if (list(); as l) {
        @if (l.items.length === 0) {
          <sat-empty-state data-testid="reported-empty">
            <h2 satEmptyStateHeadline>
              {{ status() ? 'No reported answers with this status' : 'No reported answers' }}
            </h2>
            <p satEmptyStateDescription>
              People report an answer from Ask BudgetFlow with "Report a problem". Reports appear
              here for review.
            </p>
            <a mat-stroked-button satEmptyStateActions routerLink="/ask">Open Ask BudgetFlow</a>
          </sat-empty-state>
        } @else {
          <div class="bf-table-scroll">
            <table class="bf-split-table bf-table--stack" aria-label="Reported answers">
              <thead>
                <tr>
                  <th>Reported</th>
                  <th>Person</th>
                  <th>Where</th>
                  <th>What was wrong</th>
                  <th>Question and answer</th>
                  <th class="bf-num">Records</th>
                  <th>Status</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody data-testid="reported-rows">
                @for (r of l.items; track r.id) {
                  <tr [attr.data-testid]="'reported-row-' + r.id">
                    <td class="bf-nowrap" data-label="Reported">
                      {{ r.reportedAt | bfDateTime: session.timezone() : 'd MMM y, HH:mm' }}
                    </td>
                    <td data-label="Person">{{ r.reporterName ?? 'Former user' }}</td>
                    <td data-label="Where">
                      <div class="bf-cell__group">
                        <span class="bf-cell__primary">{{ featureLabel(r.feature) }}</span>
                        <span class="bf-cell__secondary">{{ channelLabel(r.channel) }}</span>
                      </div>
                    </td>
                    <td data-label="What was wrong">
                      <div class="bf-cell__group">
                        <span class="bf-cell__primary">{{ reasonLabel(r.reason) }}</span>
                        @if (r.note) {
                          <span class="bf-cell__secondary">“{{ r.note }}”</span>
                        }
                      </div>
                    </td>
                    <td class="bf-qa" data-label="Question and answer">
                      @if (r.question || r.answer) {
                        <div class="bf-cell__group bf-qa__body">
                          <p class="bf-qa__question">
                            <span class="bf-qa__label">Question</span> {{ r.question }}
                          </p>
                          <div class="bf-qa__answer">
                            <bf-ai-label />
                            <p>{{ r.answer ?? 'No answer was given.' }}</p>
                          </div>
                        </div>
                      } @else if (r.includesText) {
                        <span class="bf-cell__secondary">Text removed after 90 days</span>
                      } @else {
                        <span class="bf-cell__secondary">The person did not include the text</span>
                      }
                    </td>
                    <td class="bf-num" data-label="Records">{{ r.recordsUsed }}</td>
                    <td data-label="Status">
                      <sat-status-tag
                        [status]="r.status === 'new' ? 'warning' : 'success'"
                        [attr.data-testid]="'report-status-' + r.id"
                        >{{ r.status === 'new' ? 'New' : 'Reviewed' }}</sat-status-tag
                      >
                    </td>
                    <td data-label="Review">
                      @if (r.status === 'reviewed') {
                        <div class="bf-cell__group">
                          <span class="bf-cell__primary">{{ r.reviewNote }}</span>
                          <span class="bf-cell__secondary"
                            >{{ r.reviewedByName ?? 'Former user' }} ·
                            {{ r.reviewedAt | bfDate: session.timezone() }}</span
                          >
                        </div>
                      } @else if (l.canReview) {
                        <button
                          mat-stroked-button
                          type="button"
                          (click)="review(r, $event)"
                          [attr.aria-label]="
                            'Mark the report from ' +
                            (r.reporterName ?? 'a former user') +
                            ' reviewed'
                          "
                          [attr.data-testid]="'review-' + r.id"
                        >
                          Mark reviewed
                        </button>
                      } @else {
                        <span class="bf-cell__secondary">Waiting for an AI administrator</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </section>

    <sat-banner variant="info" data-testid="reported-retention">
      <sat-banner-message>
        Question and answer text is kept 90 days, and only when the person chose "Include my
        question and the answer". The report, its reason and the review note stay.
      </sat-banner-message>
    </sat-banner>
  `,
  styles: `
    .bf-nowrap {
      white-space: nowrap;
    }
    .bf-card__meta {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
    .bf-qa {
      min-width: 280px;
      max-width: 460px;
    }
    .bf-cell__group {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    @media (width < 600px) {
      .bf-qa {
        min-width: 0;
        max-width: none;
      }
      .bf-qa__body {
        flex: 1 1 100%;
        text-align: start;
      }
    }
    .bf-qa__question,
    .bf-qa__answer p {
      margin: 0 0 4px;
      font: var(--mat-sys-body-medium);
    }
    .bf-qa__label {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    .bf-qa__answer {
      padding: 8px;
      border-radius: var(--mat-sys-corner-small);
      background: var(--mat-sys-surface-container-low);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportedAnswersPage {
  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  protected readonly featureLabel = aiFeatureLabel;
  protected readonly channelLabel = aiChannelLabel;
  protected readonly reasonLabel = (r: AiReportReason) => REPORT_REASON_LABELS[r];

  protected readonly status = signal<'' | 'new' | 'reviewed'>('');
  protected readonly reports = resource({
    params: () => (this.status() ? { status: this.status() as 'new' | 'reviewed' } : {}),
    loader: ({ params }) => data(this.api.listAiReportedAnswers({ query: params })),
  });
  protected readonly list = computed(() => valueOf(this.reports) ?? null);

  protected review(report: AiReportedAnswer, event: Event): void {
    const trigger = event.currentTarget as HTMLElement | null;
    const ref = this.dialog.open<ReviewReportDialog, AiReportedAnswer, AiReportedAnswer | null>(
      ReviewReportDialog,
      { data: report, width: '520px', restoreFocus: true },
    );
    ref.afterClosed().subscribe((updated) => {
      if (!updated) return;
      this.reports.reload();
      this.snack.open('Report marked reviewed.', 'Dismiss', { duration: 4000 });
      trigger?.focus();
    });
  }
}
