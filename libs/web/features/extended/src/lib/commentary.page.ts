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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { VarianceCommentary } from '@bf/contracts';
import { LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { AiDraftNote, Sources } from './figures';

/** The marker the draft leaves where no real driver explains part of the variance (011b). */
const PLACEHOLDER = '[Explain';

/**
 * Screen 011b, variance commentary: the owner's explanation of why their budget is off plan.
 *
 * The draft is built from real drivers — the commitments, events and requests behind the variance.
 * Where no driver explains part of it, the draft leaves an `[Explain: …]` note rather than
 * inventing a reason, and this page refuses to submit while that note is still in the text. The
 * owner also has to state that the words are theirs, because once submitted they are.
 */
@Component({
  selector: 'bf-commentary-page',
  imports: [
    AiDraftNote,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatImportantButton,
    SatStatusTag,
    Sources,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Variance commentary</h1>
        <p class="bf-page__subtitle">Explain why your budget is off plan, in your own words</p>
      </div>
    </header>

    <bf-load-state
      [loading]="budgets.isLoading() && !budgets.hasValue()"
      [error]="budgets.error()"
      what="your budgets"
      (retry)="budgets.reload()"
    />

    @if (budgets.hasValue()) {
      @if (options().length === 0) {
        <sat-empty-state data-testid="commentary-no-budgets">
          <h2 satEmptyStateHeadline>You do not own a budget to comment on</h2>
          <p satEmptyStateDescription>
            Variance commentary is written by the owner of the budget it explains.
          </p>
        </sat-empty-state>
      } @else {
        <section class="bf-card bf-section">
          <h2 class="bf-section__title">Pick the budget</h2>
          <div class="bf-commentary__pick">
            <mat-form-field appearance="outline" class="bf-field">
              <mat-label>Budget</mat-label>
              <mat-select [(ngModel)]="budgetId" data-testid="commentary-budget">
                @for (b of options(); track b.id) {
                  <mat-option [value]="b.id">{{ b.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <button
              mat-flat-button
              type="button"
              [disabled]="!budgetId() || drafting()"
              (click)="draft()"
              data-testid="draft-commentary"
            >
              <mat-icon svgIcon="ai" />Draft commentary
            </button>
          </div>
          <p class="bf-cell__secondary">
            The draft is assembled from the real commitments, events and requests behind the
            variance. It never invents a reason.
          </p>
        </section>
      }
    }

    @if (failure(); as message) {
      <sat-banner variant="important" data-testid="commentary-error">
        <sat-banner-message>{{ message }}</sat-banner-message>
      </sat-banner>
    }

    @if (commentary(); as c) {
      <section class="bf-card bf-section" data-testid="commentary-draft">
        <div class="bf-list__row">
          <h2 class="bf-section__title">{{ c.budgetName }}</h2>
          <sat-status-tag [status]="c.status === 'submitted' ? 'success' : 'info'">
            {{ c.status === 'submitted' ? 'Submitted' : 'Draft' }}
          </sat-status-tag>
        </div>

        @if (c.draftedWithAi) {
          <bf-ai-draft-note label="AI draft" [provenance]="c.provenance" />
        }

        @if (c.status === 'submitted') {
          <sat-banner variant="success" data-testid="commentary-submitted">
            <sat-banner-message>
              Submitted by {{ c.authorName ?? 'the owner' }} as their own explanation.
            </sat-banner-message>
          </sat-banner>
          <p class="bf-commentary__final">{{ c.text }}</p>
        } @else {
          @if (hasPlaceholder()) {
            <sat-banner variant="important" data-testid="commentary-placeholder">
              <sat-banner-message>
                Replace the [Explain] note with your explanation.
                @if (c.unexplained) {
                  <span>
                    BudgetFlow found no driver for
                    <bf-money
                      [amountMinor]="c.unexplained.amountMinor"
                      [currency]="c.unexplained.currency"
                    />
                    of this variance, so it left the gap for you rather than guessing at a reason.
                  </span>
                }
              </sat-banner-message>
            </sat-banner>
          }

          <mat-form-field appearance="outline" class="bf-field">
            <mat-label>Your commentary</mat-label>
            <textarea
              matInput
              rows="8"
              [(ngModel)]="text"
              maxlength="4000"
              data-testid="commentary-text"
            ></textarea>
          </mat-form-field>

          <mat-checkbox [(ngModel)]="attested" data-testid="commentary-attest">
            This is my explanation.
          </mat-checkbox>

          <div class="bf-commentary__actions">
            <button
              mat-flat-button
              satImportantButton
              type="button"
              [disabled]="!canSubmit()"
              (click)="submit(c)"
              data-testid="submit-commentary"
            >
              Submit commentary
            </button>
            @if (!canSubmit()) {
              <span class="bf-cell__secondary" data-testid="submit-blocked-reason">{{
                blockedReason()
              }}</span>
            }
          </div>
        }

        @if (c.drivers.length) {
          <h3 class="bf-section__title">What BudgetFlow found behind the variance</h3>
          <table class="bf-split-table" aria-label="Drivers behind the variance">
            <thead>
              <tr>
                <th>Driver</th>
                <th class="bf-num">Amount</th>
                <th>Record</th>
              </tr>
            </thead>
            <tbody>
              @for (d of c.drivers; track d.source.id) {
                <tr>
                  <td>{{ d.label }}</td>
                  <td class="bf-num">
                    <bf-money [amountMinor]="d.amount.amountMinor" [currency]="d.amount.currency" />
                  </td>
                  <td>{{ d.source.label }}</td>
                </tr>
              }
            </tbody>
          </table>
          <bf-sources [sources]="sourcesOf(c)" testId="commentary-sources" />
        }
      </section>
    }
  `,
  styles: `
    .bf-section {
      padding: 16px;
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: flex-start;
    }
    .bf-section__title {
      margin: 0;
      font: var(--mat-sys-title-small);
    }
    .bf-field {
      width: 100%;
      max-width: 640px;
    }
    .bf-commentary__pick {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }
    .bf-commentary__pick .bf-field {
      max-width: 360px;
    }
    .bf-commentary__actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
    }
    .bf-commentary__final {
      margin: 0;
      white-space: pre-wrap;
    }
    .bf-list__row {
      width: 100%;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommentaryPage {
  private readonly api = injectApi();
  private readonly snackBar = inject(MatSnackBar);

  protected readonly budgetId = signal('');
  protected readonly text = signal('');
  protected readonly attested = signal(false);
  protected readonly drafting = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly commentary = signal<VarianceCommentary | null>(null);

  protected readonly budgets = resource({
    loader: () => data(this.api.listBudgets({ query: { limit: 200 } })),
  });
  protected readonly options = computed(() => valueOf(this.budgets)?.items ?? []);

  /**
   * The placeholder check runs on what is in the box now, not on the flag the API returned when the
   * draft was made. The owner is editing the text, so the question "is the gap still unexplained?"
   * can only be answered by the current text.
   */
  protected readonly hasPlaceholder = computed(() => this.text().includes(PLACEHOLDER));
  protected readonly canSubmit = computed(
    () => this.attested() && !this.hasPlaceholder() && this.text().trim().length > 0,
  );
  protected readonly blockedReason = computed(() => {
    if (this.hasPlaceholder()) return 'Replace the [Explain] note before submitting.';
    if (!this.text().trim()) return 'Write your explanation first.';
    return 'Tick "This is my explanation" to submit.';
  });

  protected sourcesOf = (c: VarianceCommentary) => c.drivers.map((d) => d.source);

  protected async draft(): Promise<void> {
    this.drafting.set(true);
    this.failure.set(null);
    try {
      const drafted = await data(
        this.api.draftVarianceCommentary({ body: { budgetId: this.budgetId() } }),
      );
      this.commentary.set(drafted);
      this.text.set(drafted.text);
      this.attested.set(false);
    } catch (error) {
      this.commentary.set(null);
      this.failure.set(errorMessage(error));
    } finally {
      this.drafting.set(false);
    }
  }

  protected async submit(current: VarianceCommentary): Promise<void> {
    this.failure.set(null);
    try {
      const submitted = await data(
        this.api.submitVarianceCommentary({
          params: { commentaryId: current.id },
          body: { text: this.text().trim(), attested: true },
        }),
      );
      this.commentary.set(submitted);
      this.snackBar.open('Commentary submitted as your explanation.', 'Dismiss', {
        duration: 5000,
      });
    } catch (error) {
      this.failure.set(errorMessage(error));
    }
  }
}
