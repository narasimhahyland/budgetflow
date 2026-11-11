import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  MatDialog,
  MatDialogModule,
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { LeadershipSummary, SummarySection, SummarySectionKey } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { AiDraftNote, Sources, SummaryText } from './figures';
import { SUMMARY_STATUS_LABEL, SUMMARY_STATUS_TONE } from './summary-list.page';

/** Rewrite one section in the author's own words (011b). */
@Component({
  selector: 'bf-edit-section-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    SAT_BANNER_IMPORTS,
  ],
  template: `
    <h2 mat-dialog-title>Edit {{ data.title }}</h2>
    <mat-dialog-content>
      <sat-banner variant="info">
        <sat-banner-message>
          Figure placeholders you leave in the text keep their ledger values. A number you type
          yourself is your own words, not a figure BudgetFlow read.
        </sat-banner-message>
      </sat-banner>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Section text</mat-label>
        <textarea
          matInput
          rows="8"
          [(ngModel)]="text"
          maxlength="4000"
          data-testid="section-text"
        ></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close()">Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="!text().trim()"
        (click)="ref.close(text().trim())"
        data-testid="section-save"
      >
        Save section
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .bf-field {
      width: 100%;
      margin-top: 12px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditSectionDialog {
  protected readonly data = inject<{ title: string; text: string }>(MAT_DIALOG_DATA);
  protected readonly text = signal(this.data.text);
  protected readonly ref =
    inject<MatDialogRef<EditSectionDialog, string | undefined>>(MatDialogRef);
}

/** Approve a summary: the approver states that they read it before the text is frozen (011b). */
@Component({
  selector: 'bf-approve-summary-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    SatImportantButton,
  ],
  template: `
    <h2 mat-dialog-title>Approve this summary</h2>
    <mat-dialog-content>
      <p>
        Approving freezes the text and the figures with it. An approved summary cannot be edited; a
        change means a new version.
      </p>
      <mat-checkbox [(ngModel)]="attested" data-testid="approve-attest">
        I have read this summary and I am content to put my name to it.
      </mat-checkbox>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Note (optional)</mat-label>
        <textarea
          matInput
          rows="3"
          [(ngModel)]="note"
          maxlength="2000"
          data-testid="approve-note"
        ></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close()">Cancel</button>
      <button
        mat-flat-button
        satImportantButton
        type="button"
        [disabled]="!attested()"
        (click)="ref.close({ attested: true, note: note().trim() || undefined })"
        data-testid="approve-confirm"
      >
        Approve summary
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .bf-field {
      width: 100%;
      margin-top: 12px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApproveSummaryDialog {
  protected readonly attested = signal(false);
  protected readonly note = signal('');
  protected readonly ref =
    inject<MatDialogRef<ApproveSummaryDialog, { attested: true; note?: string } | undefined>>(
      MatDialogRef,
    );
}

/**
 * Screen 011b: one leadership summary, its sections and the figures they quote.
 *
 * Three honesty rules shape this page. A drafted summary is labelled as a draft until a person
 * approves it, and the approve button states which sections are still unread rather than failing
 * at the server. An open-period draft says plainly that it can never be approved, because its
 * figures can still move. And the number inside every sentence is resolved here from the `figures`
 * array the API attached, never from anything the model typed.
 */
@Component({
  selector: 'bf-summary-detail-page',
  imports: [
    AiDraftNote,
    DateTimePipe,
    LoadState,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
    SatStatusTag,
    Sources,
    SummaryText,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">{{ summary()?.periodLabel ?? 'Leadership summary' }}</h1>
        <p class="bf-page__subtitle">
          <a routerLink="/insights/summaries">All summaries</a>
        </p>
      </div>
      <div class="bf-page__actions">
        @if (summary(); as s) {
          <sat-status-tag [status]="tone()" data-testid="summary-status">{{
            label()
          }}</sat-status-tag>
          @if (s.status !== 'approved') {
            <button
              mat-flat-button
              satImportantButton
              type="button"
              [disabled]="!canApprove()"
              (click)="approve()"
              data-testid="approve-summary"
            >
              Approve
            </button>
          }
        }
      </div>
    </header>

    <bf-load-state
      [loading]="detail.isLoading() && !detail.hasValue()"
      [error]="detail.error()"
      what="this summary"
      (retry)="detail.reload()"
    />

    @if (summary(); as s) {
      @if (failure(); as message) {
        <sat-banner variant="important" data-testid="summary-action-error">
          <sat-banner-message>{{ message }}</sat-banner-message>
        </sat-banner>
      }

      @if (s.status === 'approved') {
        <sat-banner variant="success" data-testid="summary-approved">
          <sat-banner-message>
            Approved by {{ s.approvedByName ?? 'a reviewer' }}
            @if (s.approvedAt) {
              <span> on {{ s.approvedAt | bfDateTime: session.timezone() }}</span>
            }
            . This text is frozen; changing it means a new version.
          </sat-banner-message>
        </sat-banner>
      } @else if (s.periodState === 'open') {
        <sat-banner variant="warning" data-testid="summary-open-period">
          <sat-banner-message>
            Draft of an open period. The figures in it can still move before the period closes, so
            this summary can never be approved. Draft it again once {{ s.periodLabel }} is closed.
          </sat-banner-message>
        </sat-banner>
      } @else if (unreviewed().length) {
        <sat-banner variant="warning" data-testid="summary-unreviewed">
          <sat-banner-message>
            Not reviewed yet. Open and mark each section as read before approving:
            {{ unreviewed().join(', ') }}.
          </sat-banner-message>
        </sat-banner>
      }

      <div class="bf-summary__meta">
        <bf-ai-draft-note
          [label]="s.status === 'approved' ? 'AI-drafted, approved' : 'AI draft'"
          [provenance]="s.provenance"
        />
        @if (s.snapshotTakenAt) {
          <span class="bf-cell__secondary" data-testid="summary-snapshot">
            Closed-period snapshot taken
            <span data-testid="relative-time">{{
              s.snapshotTakenAt | bfDateTime: session.timezone()
            }}</span>
          </span>
        }
        <span class="bf-cell__secondary">Version {{ s.version }}</span>
      </div>

      @for (section of s.sections; track section.key) {
        <section class="bf-card bf-summary__section" [attr.data-testid]="'section-' + section.key">
          <div class="bf-list__row">
            <h2 class="bf-summary__title">{{ section.title }}</h2>
            <div class="bf-summary__tags">
              @if (section.edited) {
                <sat-status-tag status="info" [attr.data-testid]="'section-edited-' + section.key"
                  >Edited by the author</sat-status-tag
                >
              }
              @if (section.reviewed) {
                <sat-status-tag status="success" [attr.data-testid]="'section-read-' + section.key"
                  >Read</sat-status-tag
                >
              } @else {
                <sat-status-tag
                  status="warning"
                  [attr.data-testid]="'section-unread-' + section.key"
                  >Not read yet</sat-status-tag
                >
              }
            </div>
          </div>

          <bf-summary-text
            [text]="section.text"
            [figures]="section.figures"
            [testId]="'section-text-' + section.key"
          />

          @if (section.figures.length) {
            <p class="bf-cell__secondary">
              {{ section.figures.length }}
              {{ section.figures.length === 1 ? 'figure' : 'figures' }} in this section
              {{ section.figures.length === 1 ? 'was' : 'were' }} read from BudgetFlow's own
              records. Hover one to see where it came from.
            </p>
          }

          <bf-sources [sources]="section.sources" [testId]="'section-sources-' + section.key" />

          @if (s.status !== 'approved') {
            <div class="bf-summary__actions">
              @if (!section.reviewed) {
                <button
                  mat-stroked-button
                  type="button"
                  (click)="markRead(section)"
                  [attr.data-testid]="'mark-read-' + section.key"
                >
                  <mat-icon svgIcon="check" />Mark as read
                </button>
              }
              <button
                mat-button
                type="button"
                (click)="edit(section)"
                [attr.data-testid]="'edit-' + section.key"
              >
                <mat-icon svgIcon="pencil" />Edit
              </button>
              <button
                mat-button
                type="button"
                (click)="regenerate(section)"
                [attr.data-testid]="'regenerate-' + section.key"
              >
                <mat-icon svgIcon="refresh" />Redraft
              </button>
              @if (section.edited) {
                <span class="bf-cell__secondary"
                  >Redrafting replaces your edits in this section.</span
                >
              }
            </div>
          }
        </section>
      }
    }
  `,
  styles: `
    .bf-summary__meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 16px;
      margin-top: 12px;
    }
    .bf-summary__section {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
      margin-top: 12px;
    }
    .bf-summary__title {
      margin: 0;
      font: var(--mat-sys-title-small);
    }
    .bf-summary__tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .bf-summary__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SummaryDetailPage {
  readonly summaryId = input.required<string>();

  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);

  protected readonly failure = signal<string | null>(null);
  protected readonly detail = resource({
    params: () => ({ id: this.summaryId() }),
    loader: ({ params }) =>
      data(this.api.getLeadershipSummary({ params: { summaryId: params.id } })),
  });
  protected readonly summary = computed<LeadershipSummary | undefined>(() => valueOf(this.detail));

  protected readonly label = computed(() => {
    const s = this.summary();
    return s ? SUMMARY_STATUS_LABEL[s.status] : '';
  });
  protected readonly tone = computed(() => {
    const s = this.summary();
    return s ? SUMMARY_STATUS_TONE[s.status] : 'info';
  });

  /** The sections whose author has not yet opened them; approval waits for all of them. */
  protected readonly unreviewed = computed(() =>
    (this.summary()?.sections ?? []).filter((x) => !x.reviewed).map((x) => x.title),
  );
  /**
   * Approving is `audit.read`, the action the API checks: leadership and finance approve the
   * company summary, an analyst reads the approved one. Without the permission in here a reader
   * is handed a live Approve button that the API refuses on the press.
   */
  protected readonly canApprove = computed(() => {
    const s = this.summary();
    return Boolean(
      s &&
        this.session.can('audit.read') &&
        s.status !== 'approved' &&
        s.periodState === 'closed' &&
        this.unreviewed().length === 0,
    );
  });

  protected async markRead(section: SummarySection): Promise<void> {
    await this.saveSection(section.key, section.text, true);
  }

  protected edit(section: SummarySection): void {
    this.dialog
      .open(EditSectionDialog, {
        width: '620px',
        data: { title: section.title, text: section.text },
      })
      .afterClosed()
      .subscribe(async (text) => {
        if (text === undefined) return;
        await this.saveSection(section.key, text, true);
      });
  }

  private async saveSection(
    key: SummarySectionKey,
    text: string,
    markReviewed: boolean,
  ): Promise<void> {
    this.failure.set(null);
    try {
      await data(
        this.api.editSummarySection({
          params: { summaryId: this.summaryId(), sectionKey: key },
          body: { text, markReviewed },
        }),
      );
      this.detail.reload();
    } catch (error) {
      this.failure.set(errorMessage(error));
    }
  }

  protected async regenerate(section: SummarySection): Promise<void> {
    this.failure.set(null);
    try {
      await data(
        this.api.regenerateSummarySection({
          params: { summaryId: this.summaryId(), sectionKey: section.key },
          body: {},
        }),
      );
      this.detail.reload();
      this.snackBar.open(`${section.title} redrafted. Read it again before approving.`, 'Dismiss', {
        duration: 6000,
      });
    } catch (error) {
      this.failure.set(errorMessage(error));
    }
  }

  protected approve(): void {
    this.dialog
      .open(ApproveSummaryDialog, { width: '520px' })
      .afterClosed()
      .subscribe(async (body) => {
        if (!body) return;
        this.failure.set(null);
        try {
          await data(
            this.api.approveLeadershipSummary({ params: { summaryId: this.summaryId() }, body }),
          );
          this.detail.reload();
          this.snackBar.open('Approved. The text is now frozen.', 'Dismiss', { duration: 5000 });
        } catch (error) {
          this.failure.set(errorMessage(error));
        }
      });
  }
}
