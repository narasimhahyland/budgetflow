import { DatePipe } from '@angular/common';
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
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { AiConfidence, AiMatchSuggestion, AiMatchSuggestionTarget } from '@bf/contracts';
import { LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { AI_OUTPUT_IMPORTS, isFeatureDisabled } from './ai-output';
import { data, errorMessage, injectApi, valueOf } from './api';

const REJECT_REASONS = [
  { code: 'WRONG_EVENT', label: 'Wrong event' },
  { code: 'WRONG_BUDGET', label: 'Wrong budget' },
  { code: 'NOT_BUDGET_RELEVANT', label: 'Not budget-relevant' },
  { code: 'PERSONAL_EXPENSE', label: 'Personal expense' },
  { code: 'OTHER', label: 'Other' },
];

const STATUSES = ['open', 'accepted', 'rejected', 'dismissed', 'stale'] as const;

/**
 * Screen 080f: AI matching suggestions for spend lines the deterministic steps could not place.
 *
 * Accepting is two separate calls on purpose, and there is deliberately no "AI apply" endpoint: the
 * person's own `actuals.manage` permission posts `applyWith` to the normal match command
 * (`POST /api/actuals/{actualId}/matches`), and only once that command has really run is the human
 * decision recorded against the suggestion. The API refuses an acceptance for a line that is still
 * unmatched, so the order here is not a convention — it is enforced.
 */
@Component({
  selector: 'bf-matching-page',
  imports: [
    DatePipe,
    AI_OUTPUT_IMPORTS,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatImportantButton,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <div class="bf-title-row">
          <h1 class="bf-page__title">Matching suggestions</h1>
          <bf-ai-label text="AI suggestions" />
        </div>
        <p class="bf-page__subtitle">
          Ranked targets for spend lines that reference, event-code and mapping-rule matching could
          not place. Nothing is matched until you accept it; accepting runs the normal match command
          under your own permission.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/finance/actuals/queue">Unmatched queue</a>
        <button
          mat-stroked-button
          type="button"
          [disabled]="running()"
          (click)="run()"
          data-testid="run-matching"
        >
          <mat-icon svgIcon="refresh" />Rank unmatched lines
        </button>
      </div>
    </header>

    @if (disabled(); as detail) {
      <bf-ai-disabled
        feature="Transaction matching suggestions"
        [detail]="detail"
        stillWorks="The unmatched queue and mapping rules work exactly as before."
      />
    } @else {
      <bf-load-state
        [loading]="suggestions.isLoading() && !suggestions.hasValue()"
        [error]="loadError()"
        what="the matching suggestions"
        shape="table"
        (retry)="suggestions.reload()"
      />
      @if (suggestions.hasValue()) {
        <div class="bf-kpis">
          <div class="bf-kpi" data-testid="kpi-shown">
            <p class="bf-kpi__label">Suggestions shown, last 30 days</p>
            <p class="bf-kpi__value" data-testid="ai-live-count">
              {{ valueOf(suggestions)?.shownLast30Days }}
            </p>
          </div>
          <div class="bf-kpi" data-testid="kpi-accepted">
            <p class="bf-kpi__label">Accepted by a person, last 30 days</p>
            <p class="bf-kpi__value" data-testid="ai-live-count">
              {{ valueOf(suggestions)?.acceptedLast30Days }}
            </p>
            <p class="bf-kpi__delta">Every one of them through the normal match command</p>
          </div>
        </div>

        <section class="bf-card" aria-labelledby="suggestions-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="suggestions-title">Spend lines waiting for a person</h2>
          </div>
          <div class="bf-filters">
            <mat-chip-listbox aria-label="Suggestion status">
              @for (s of statuses; track s) {
                <mat-chip-option
                  [selected]="status() === s"
                  [selectable]="status() !== s"
                  (selectionChange)="$event.selected && status.set(s)"
                  [attr.data-testid]="'status-' + s"
                  >{{ statusLabel(s) }}</mat-chip-option
                >
              }
            </mat-chip-listbox>
          </div>

          @if (rows().length === 0) {
            <div class="bf-card__body">
              <sat-empty-state data-testid="matching-empty">
                <h2 satEmptyStateHeadline>No suggestions waiting</h2>
                <p satEmptyStateDescription>
                  Unmatched lines without a suggestion are in the unmatched queue.
                </p>
                <a mat-stroked-button satEmptyStateAction routerLink="/finance/actuals/queue">
                  Open the unmatched queue
                </a>
              </sat-empty-state>
            </div>
          } @else {
            <div class="bf-table-scroll">
              <table class="bf-split-table bf-table--stack" aria-label="AI matching suggestions">
                <thead>
                  <tr>
                    <th>Posted</th>
                    <th>Source</th>
                    <th>Merchant and memo</th>
                    <th class="bf-num">Transaction amount</th>
                    <th class="bf-num">Budget amount (plan rate)</th>
                    <th>Suggested target (AI)</th>
                    <th>Confidence</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of rows(); track s.id) {
                    <tr [attr.data-testid]="'suggestion-row-' + s.actualId">
                      <td class="bf-nowrap">{{ s.postedDate | date: 'd MMM y' }}</td>
                      <td class="bf-nowrap" data-label="Source">{{ sourceLabel(s.source) }}</td>
                      <td data-label="Merchant and memo">
                        <button
                          mat-button
                          type="button"
                          (click)="selected.set(s)"
                          [attr.data-testid]="'open-suggestion-' + s.actualId"
                        >
                          {{ lineLabel(s) }}
                        </button>
                        @if (s.merchant && s.memo) {
                          <span class="bf-cell__secondary">{{ s.memo }}</span>
                        }
                      </td>
                      <td class="bf-num" data-label="Transaction amount">
                        <bf-money
                          [amountMinor]="s.transactionAmount.amountMinor"
                          [currency]="s.transactionAmount.currency"
                        />
                      </td>
                      <td class="bf-num" data-label="Budget amount (plan rate)">
                        <bf-money
                          [amountMinor]="s.budgetAmount.amountMinor"
                          [currency]="s.budgetAmount.currency"
                        />
                      </td>
                      <td data-label="Suggested target (AI)">
                        <span class="bf-cell__primary">{{ s.suggested.targetLabel }}</span>
                        <span class="bf-cell__secondary">{{ s.suggested.budgetName }}</span>
                      </td>
                      <td data-label="Confidence">
                        <sat-status-tag [status]="confidenceTone(s.suggested.confidence)">
                          {{ confidenceWord(s.suggested.confidence) }}
                        </sat-status-tag>
                      </td>
                      <td data-label="Status">
                        <sat-status-tag [status]="statusTone(s.status)">{{
                          statusLabel(s.status)
                        }}</sat-status-tag>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        @if (selected(); as s) {
          <section class="bf-card" aria-labelledby="match-detail-title" data-testid="match-detail">
            <div class="bf-card__header">
              <div class="bf-title-row">
                <h2 class="bf-card__title" id="match-detail-title">
                  {{ lineLabel(s) }} on {{ s.postedDate | date: 'd MMM y' }}
                </h2>
                <bf-ai-label text="AI suggestion" />
              </div>
              <button mat-button type="button" (click)="selected.set(null)">Close</button>
            </div>
            <div class="bf-card__body bf-match">
              <sat-banner variant="info" data-testid="match-apply-note">
                <sat-banner-message>
                  Accepting posts the match through the normal actuals match command under your own
                  permission, then records your decision against this suggestion. The suggestion
                  itself never moves money.
                </sat-banner-message>
              </sat-banner>

              <bf-ai-figures [figures]="lineFigures(s)" label="Amounts on this spend line" />
              <p class="bf-cell__secondary" data-testid="fx-note">
                The budget amount uses the locked plan rate. FX never consumes budget.
              </p>

              <div>
                <h3 class="bf-section__title">Suggested target and the alternatives</h3>
                <div class="bf-table-scroll">
                  <table
                    class="bf-split-table bf-table--stack"
                    aria-label="Candidate targets, best first"
                  >
                    <thead>
                      <tr>
                        <th>Target</th>
                        <th>Budget</th>
                        <th>Confidence</th>
                        <th>Why this target</th>
                        <th>Choose</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (c of candidates(s); track c.targetId) {
                        <tr [attr.data-testid]="'candidate-' + c.targetId">
                          <td>{{ c.targetLabel }}</td>
                          <td data-label="Budget">{{ c.budgetName }}</td>
                          <td data-label="Confidence">
                            <sat-status-tag [status]="confidenceTone(c.confidence)">
                              {{ confidenceWord(c.confidence) }}
                            </sat-status-tag>
                          </td>
                          <td data-label="Why this target">
                            <ul class="bf-match__reasons">
                              @for (r of c.reasons; track r) {
                                <li>{{ r }}</li>
                              }
                            </ul>
                          </td>
                          <td data-label="Choose">
                            <button
                              mat-button
                              type="button"
                              (click)="chosen.set(c.targetId)"
                              [attr.data-testid]="'choose-' + c.targetId"
                            >
                              {{ chosen() === c.targetId ? 'Chosen' : 'Choose' }}
                            </button>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>

              <bf-ai-sources [sources]="s.sources" />
              <bf-ai-provenance [provenance]="s.provenance" />

              @if (actionError(); as message) {
                <sat-banner variant="important" data-testid="match-error">
                  <sat-banner-message>{{ message }}</sat-banner-message>
                </sat-banner>
              }

              @if (s.status === 'open') {
                <div class="bf-match__actions">
                  <button
                    mat-flat-button
                    satImportantButton
                    type="button"
                    [disabled]="applying()"
                    (click)="accept(s)"
                    data-testid="accept-suggestion"
                  >
                    Match this line and record my decision
                  </button>
                  <button
                    mat-stroked-button
                    type="button"
                    (click)="rejecting.set(!rejecting())"
                    data-testid="reject-suggestion"
                  >
                    Reject suggestion
                  </button>
                  <bf-ai-feedback (rating)="rate(s, $event)" />
                </div>
                @if (rejecting()) {
                  <div class="bf-form" data-testid="reject-form">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <mat-label>Reason</mat-label>
                      <mat-select [(ngModel)]="rejectReason">
                        @for (r of rejectReasons; track r.code) {
                          <mat-option [value]="r.code">{{ r.label }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                    <mat-form-field
                      appearance="outline"
                      class="bf-form__wide"
                      subscriptSizing="dynamic"
                    >
                      <mat-label>Note (feeds the evaluation set)</mat-label>
                      <input matInput [(ngModel)]="rejectNote" data-testid="reject-note" />
                    </mat-form-field>
                  </div>
                  <div class="bf-form__actions">
                    <button
                      mat-flat-button
                      type="button"
                      [disabled]="applying() || !rejectNote().trim()"
                      (click)="reject(s)"
                      data-testid="confirm-reject"
                    >
                      Record rejection
                    </button>
                  </div>
                }
              } @else {
                <sat-banner variant="info" data-testid="already-decided">
                  <sat-banner-message>
                    This suggestion is {{ statusLabel(s.status).toLowerCase()
                    }}{{ s.decisionReason ? ': ' + s.decisionReason : '' }}.
                    @if (s.status === 'stale') {
                      The target changed since the suggestion was made, so it cannot be accepted.
                    }
                  </sat-banner-message>
                </sat-banner>
              }
            </div>
          </section>
        }
      }
    }
  `,
  styles: `
    .bf-nowrap {
      white-space: nowrap;
    }
    .bf-match {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .bf-match__reasons {
      margin: 0;
      padding-inline-start: 18px;
      font: var(--mat-sys-body-small);
    }
    .bf-match__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatchingPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly valueOf = valueOf;
  protected readonly statuses = STATUSES;
  protected readonly rejectReasons = REJECT_REASONS;

  protected readonly status = signal<(typeof STATUSES)[number]>('open');
  protected readonly selected = signal<AiMatchSuggestion | null>(null);
  protected readonly chosen = signal<string | null>(null);
  protected readonly running = signal(false);
  protected readonly applying = signal(false);
  protected readonly rejecting = signal(false);
  protected readonly rejectReason = signal('WRONG_BUDGET');
  protected readonly rejectNote = signal('');
  protected readonly actionError = signal<string | null>(null);

  protected readonly suggestions = resource({
    params: () => ({ status: this.status() }),
    loader: ({ params }) => data(this.api.listMatchSuggestions({ query: params })),
  });
  protected readonly rows = computed(() => valueOf(this.suggestions)?.items ?? []);
  protected readonly disabled = computed(() =>
    isFeatureDisabled(this.suggestions.error()) ? errorMessage(this.suggestions.error()) : null,
  );
  protected readonly loadError = computed(() =>
    isFeatureDisabled(this.suggestions.error()) ? undefined : this.suggestions.error(),
  );

  /** What a person recognises the line by: the merchant, or the memo when a source sends none. */
  protected lineLabel(s: AiMatchSuggestion): string {
    return s.merchant ?? s.memo ?? `${this.sourceLabel(s.source)} line`;
  }

  protected candidates(s: AiMatchSuggestion): AiMatchSuggestionTarget[] {
    const seen = new Set<string>();
    return [s.suggested, ...s.candidates].filter((c) => {
      if (seen.has(c.targetId)) return false;
      seen.add(c.targetId);
      return true;
    });
  }

  protected lineFigures(s: AiMatchSuggestion) {
    const source = { type: 'actual' as const, id: s.actualId, label: s.merchant ?? s.source };
    return [
      { key: 'transaction', label: 'Transaction amount', amount: s.transactionAmount, source },
      {
        key: 'budget',
        label: 'Budget amount at the locked plan rate',
        amount: s.budgetAmount,
        source,
      },
    ];
  }

  protected confidenceWord(c: AiConfidence): string {
    return c.charAt(0).toUpperCase() + c.slice(1);
  }

  protected confidenceTone(c: AiConfidence): 'success' | 'info' | 'warning' {
    return c === 'high' ? 'success' : c === 'medium' ? 'info' : 'warning';
  }

  protected statusLabel(status: AiMatchSuggestion['status']): string {
    return status === 'stale'
      ? 'No longer valid'
      : status.charAt(0).toUpperCase() + status.slice(1);
  }

  /** Plain names for where a spend line came from, instead of the stored source key. */
  protected sourceLabel(source: string): string {
    return (
      (
        {
          file: 'File import',
          card: 'Card feed',
          expense: 'Expense tool',
          travel: 'Travel tool',
          erp: 'ERP import',
          ap: 'Accounts payable',
          manual: 'Entered by hand',
        } as Record<string, string>
      )[source] ?? source
    );
  }

  protected statusTone(
    status: AiMatchSuggestion['status'],
  ): 'success' | 'info' | 'warning' | 'neutral' {
    switch (status) {
      case 'accepted':
        return 'success';
      case 'open':
        // Waiting for a person, as Pending is everywhere else.
        return 'warning';
      case 'stale':
        return 'warning';
      default:
        return 'neutral';
    }
  }

  protected async run(): Promise<void> {
    this.running.set(true);
    try {
      await data(this.api.runMatchSuggestions({ body: {} }));
      this.suggestions.reload();
      this.snack.open('Unmatched lines ranked. Nothing has been matched.', 'Dismiss', {
        duration: 5000,
      });
    } catch (error) {
      this.snack.open(errorMessage(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.running.set(false);
    }
  }

  /**
   * `applyWith` is the body of the normal match endpoint. The chosen candidate replaces the target
   * in those parts when the reviewer picked a different one, so the command the person runs is
   * always the one they can see on screen.
   */
  protected async accept(s: AiMatchSuggestion): Promise<void> {
    this.applying.set(true);
    this.actionError.set(null);
    try {
      const chosen = this.chosen();
      const target = this.candidates(s).find((c) => c.targetId === chosen) ?? s.suggested;
      // Same shape as `applyWith`: the target only, so the match command computes the amount and
      // runs its own tolerance and period checks exactly as it would without a suggestion.
      const parts =
        chosen && chosen !== s.suggested.targetId
          ? [
              target.targetType === 'commitment'
                ? { commitmentId: target.targetId }
                : { budgetId: target.targetId },
            ]
          : s.applyWith.parts;

      await data(
        this.api.matchActual({ params: { actualId: s.applyWith.actualId }, body: { parts } }),
      );
      const decision = await data(
        this.api.decideAiSuggestion({
          params: { suggestionId: s.id },
          body: {
            decision: 'accepted',
            appliedResourceType: 'actual',
            appliedResourceId: s.actualId,
          },
        }),
      );
      this.selected.set(null);
      this.chosen.set(null);
      this.suggestions.reload();
      this.snack.open(
        `Matched to ${target.targetLabel} and recorded as accepted by ${decision.decidedByName ?? 'you'}.`,
        'Dismiss',
        { duration: 6000 },
      );
    } catch (error) {
      this.actionError.set(errorMessage(error));
    } finally {
      this.applying.set(false);
    }
  }

  protected async reject(s: AiMatchSuggestion): Promise<void> {
    this.applying.set(true);
    this.actionError.set(null);
    try {
      await data(
        this.api.decideAiSuggestion({
          params: { suggestionId: s.id },
          body: {
            decision: 'rejected',
            reasonCode: this.rejectReason(),
            reason: this.rejectNote().trim(),
          },
        }),
      );
      this.selected.set(null);
      this.rejecting.set(false);
      this.rejectNote.set('');
      this.suggestions.reload();
      this.snack.open('Suggestion rejected. The line stays in the unmatched queue.', 'Dismiss', {
        duration: 5000,
      });
    } catch (error) {
      this.actionError.set(errorMessage(error));
    } finally {
      this.applying.set(false);
    }
  }

  protected async rate(s: AiMatchSuggestion, rating: 'helpful' | 'not_helpful'): Promise<void> {
    try {
      await data(this.api.rateAiSuggestion({ params: { suggestionId: s.id }, body: { rating } }));
    } catch (error) {
      this.snack.open(errorMessage(error), 'Dismiss', { duration: 6000 });
    }
  }
}
