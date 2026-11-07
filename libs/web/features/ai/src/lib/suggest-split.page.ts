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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSliderModule } from '@angular/material/slider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { AllocationSuggestion, BatchAllocationResult } from '@bf/contracts';
import { formatMoney, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { AI_OUTPUT_IMPORTS, isFeatureDisabled } from './ai-output';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

/**
 * Screen 022d: suggested allocations. The model proposes the weights and writes the reasons; the
 * amounts are computed from those weights and the facts, so the split is reproducible. Nothing is
 * saved from the suggestion: the owner edits the draft and submits it through the normal batch
 * allocation command, which runs the parent-available check under ordered row locks and writes one
 * journal and one audit entry. The acceptance is then recorded against the suggestion.
 */
@Component({
  selector: 'bf-suggest-split-page',
  imports: [
    AI_OUTPUT_IMPORTS,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSliderModule,
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
          <h1 class="bf-page__title">Suggested allocations</h1>
          <bf-ai-label text="AI suggestion" />
        </div>
        <p class="bf-page__subtitle">
          A split over eligible headcount, how much of last year's budget each child used, and the
          people its events reached. You can change every line; nothing is saved until you submit it
          as a normal allocation change.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button [routerLink]="['/budgets', budgetId()]">Budget details</a>
        <a mat-stroked-button routerLink="/budgets/allocate">Allocation workspace</a>
      </div>
    </header>

    @if (disabled(); as detail) {
      <bf-ai-disabled
        feature="Suggested allocations"
        [detail]="detail"
        stillWorks="Manual allocation in the workspace and the grid is unchanged."
      />
    } @else {
      <bf-load-state
        [loading]="suggestion.isLoading() && !suggestion.hasValue()"
        [error]="loadError()"
        what="the suggested split"
        (retry)="suggestion.reload()"
      />
      @if (suggestion.hasValue()) {
        @if (valueOf(suggestion); as s) {
          @if (s.lines.length === 0) {
            <sat-empty-state data-testid="no-data">
              <h2 satEmptyStateHeadline>Not enough data for a suggestion</h2>
              <p satEmptyStateDescription>
                A suggestion needs a headcount snapshot and at least one prior year or three months
                of spending for the children of this budget.
              </p>
              <a mat-stroked-button satEmptyStateAction routerLink="/org/headcount">
                Import headcount
              </a>
            </sat-empty-state>
          } @else {
            <section class="bf-card" aria-labelledby="weights-title">
              <div class="bf-card__header">
                <div>
                  <h2 class="bf-card__title" id="weights-title">How the split is weighted</h2>
                  <p class="bf-card__hint">
                    The model proposed these weights. Change them and the amounts are recomputed
                    from the same facts.
                  </p>
                </div>
                <sat-status-tag [status]="customWeights(s) ? 'warning' : 'info'">
                  {{ customWeights(s) ? 'Custom weights' : 'Suggested weights' }}
                </sat-status-tag>
              </div>
              <div class="bf-card__body">
                @if (s.weightsReason) {
                  <bf-ai-prose [text]="s.weightsReason" />
                }
                <div class="bf-weights">
                  <div class="bf-weights__row">
                    <label for="w-headcount">Eligible headcount</label>
                    <mat-slider min="0" max="100" step="5" discrete>
                      <input
                        matSliderThumb
                        id="w-headcount"
                        [value]="headcountPct()"
                        (valueChange)="headcountPct.set($event)"
                      />
                    </mat-slider>
                    <span class="bf-weights__value" data-testid="weight-headcount"
                      >{{ headcountPct() }}%</span
                    >
                  </div>
                  <div class="bf-weights__row">
                    <label for="w-prior">Last year's use</label>
                    <mat-slider min="0" max="100" step="5" discrete>
                      <input
                        matSliderThumb
                        id="w-prior"
                        [value]="priorUsePct()"
                        (valueChange)="priorUsePct.set($event)"
                      />
                    </mat-slider>
                    <span class="bf-weights__value" data-testid="weight-prior"
                      >{{ priorUsePct() }}%</span
                    >
                  </div>
                  <div class="bf-weights__row">
                    <label for="w-participation">Participation</label>
                    <mat-slider min="0" max="100" step="5" discrete>
                      <input
                        matSliderThumb
                        id="w-participation"
                        [value]="participationPct()"
                        (valueChange)="participationPct.set($event)"
                      />
                    </mat-slider>
                    <span class="bf-weights__value" data-testid="weight-participation"
                      >{{ participationPct() }}%</span
                    >
                  </div>
                </div>
                <p
                  class="bf-weights__total"
                  [class.bf-weights__total--invalid]="weightTotal() !== 100"
                  aria-live="polite"
                  data-testid="weights-total"
                >
                  Weights total {{ weightTotal() }}%.
                  {{ weightTotal() === 100 ? '' : 'They must total 100% before asking again.' }}
                </p>
                <div class="bf-form__actions">
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="weightTotal() !== 100"
                    (click)="applyWeights()"
                    data-testid="recompute-weights"
                  >
                    Recompute with these weights
                  </button>
                  <button
                    mat-button
                    type="button"
                    (click)="resetWeights(s)"
                    data-testid="reset-weights"
                  >
                    Suggested weights
                  </button>
                </div>
              </div>
            </section>

            <section class="bf-card" aria-labelledby="split-title">
              <div class="bf-card__header">
                <div class="bf-title-row">
                  <h2 class="bf-card__title" id="split-title">The suggested split</h2>
                  <bf-ai-label text="AI suggestion" />
                </div>
                <span class="bf-cell__secondary" data-testid="rounding-note">
                  Rounded to {{ rounding(s) }}; the remainder goes to the largest line.
                </span>
              </div>
              <div class="bf-table-scroll">
                <table class="bf-split-table" aria-label="Suggested allocation per child budget">
                  <thead>
                    <tr>
                      <th>Child budget</th>
                      <th class="bf-num">Eligible headcount</th>
                      <th class="bf-num">Last year's use</th>
                      <th class="bf-num">Reach</th>
                      <th class="bf-num">Current allocation</th>
                      <th class="bf-num">Suggested</th>
                      <th class="bf-num">Your amount</th>
                      <th>Why this line</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (line of s.lines; track line.budgetId) {
                      <tr [attr.data-testid]="'split-row-' + line.budgetId">
                        <td>{{ line.budgetName }}</td>
                        <td class="bf-num">{{ line.eligibleHeadcount }}</td>
                        <td class="bf-num">
                          {{ line.priorUseBps === null ? '—' : pct(line.priorUseBps) }}
                        </td>
                        <td class="bf-num">
                          {{ line.participationBps === null ? '—' : pct(line.participationBps) }}
                        </td>
                        <td class="bf-num">
                          <bf-money
                            [amountMinor]="line.currentAllocation.amountMinor"
                            [currency]="line.currentAllocation.currency"
                          />
                        </td>
                        <td class="bf-num bf-split__suggested">
                          <bf-money
                            [amountMinor]="line.suggested.amountMinor"
                            [currency]="line.suggested.currency"
                          />
                          @if (edited(line.budgetId, line.suggested.amountMinor)) {
                            <span class="bf-cell__secondary">Edited by you</span>
                          } @else {
                            <sat-status-tag status="info" [hideIcon]="true"
                              >From suggestion</sat-status-tag
                            >
                          }
                        </td>
                        <td class="bf-num">
                          <mat-form-field appearance="outline" subscriptSizing="dynamic">
                            <mat-label>{{ line.suggested.currency }}</mat-label>
                            <input
                              matInput
                              type="number"
                              min="0"
                              [value]="major(amountFor(line.budgetId, line.suggested.amountMinor))"
                              (input)="setAmount(line.budgetId, $event)"
                              [attr.data-testid]="'amount-' + line.budgetId"
                            />
                          </mat-form-field>
                        </td>
                        <td>{{ line.why }}</td>
                      </tr>
                    }
                    <tr class="bf-total">
                      <td>Total</td>
                      <td colspan="4"></td>
                      <td class="bf-num">
                        <bf-money
                          [amountMinor]="s.total.amountMinor"
                          [currency]="s.total.currency"
                        />
                      </td>
                      <td class="bf-num" data-testid="draft-total">
                        {{ formatted(draftTotal(s), s.amount.currency) }}
                      </td>
                      <td>
                        Never more than the parent's
                        {{ formatted(s.amount.amountMinor, s.amount.currency) }} available under its
                        own rules.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              @if (s.excluded.length) {
                <div class="bf-section">
                  <h3 class="bf-section__title">Children left out</h3>
                  <ul class="bf-list" data-testid="excluded">
                    @for (e of s.excluded; track e.budgetId) {
                      <li class="bf-list__item">{{ e.budgetName }}: {{ e.reason }}</li>
                    }
                  </ul>
                </div>
              }

              @if (s.notes.length) {
                <sat-banner variant="info" data-testid="split-notes">
                  <sat-banner-message>
                    @for (note of s.notes; track note) {
                      {{ note }}
                    }
                  </sat-banner-message>
                </sat-banner>
              }

              <div class="bf-section">
                <bf-ai-why [why]="s.notes" [confidence]="s.confidence" />
                <bf-ai-sources [sources]="s.sources" />
                <bf-ai-provenance [provenance]="s.provenance" />
              </div>

              @if (preview(); as p) {
                <sat-banner [variant]="p.ok ? 'success' : 'important'" data-testid="split-preview">
                  <sat-banner-message>
                    @if (p.ok) {
                      Checked: {{ formatted(p.totalMinor, p.currency) }} would post, leaving
                      {{ formatted(p.availableAfterMinor, p.currency) }} available. Nothing has been
                      posted yet.
                    } @else {
                      The allocation command rejected this draft:
                      {{ firstProblem(p) }}
                    }
                  </sat-banner-message>
                </sat-banner>
              }
              @if (actionError(); as message) {
                <sat-banner variant="important" data-testid="split-error">
                  <sat-banner-message>{{ message }}</sat-banner-message>
                </sat-banner>
              }

              <div class="bf-form__actions">
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="busy()"
                  (click)="check(s)"
                  data-testid="check-split"
                >
                  Check against the parent
                </button>
                <button
                  satImportantButton
                  type="button"
                  [disabled]="busy()"
                  (click)="submit(s)"
                  data-testid="submit-split"
                >
                  Submit as one allocation change
                </button>
                <button
                  mat-button
                  type="button"
                  [disabled]="busy()"
                  (click)="dismiss(s)"
                  data-testid="dismiss-split"
                >
                  Dismiss suggestion
                </button>
                <bf-ai-feedback (rating)="rate(s, $event)" />
              </div>
            </section>
          }
        }
      }
    }
  `,
  styles: `
    .bf-weights {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 12px;
    }
    .bf-weights__row {
      display: grid;
      grid-template-columns: 180px minmax(120px, 1fr) 60px;
      align-items: center;
      gap: 12px;
      font: var(--mat-sys-body-medium);
    }
    .bf-weights__value {
      font-variant-numeric: tabular-nums;
    }
    .bf-weights__total {
      margin: 8px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-weights__total--invalid {
      color: var(--mat-sys-error);
    }
    .bf-split__suggested {
      background: var(--sat-sys-info-container);
    }
    @media (width < 720px) {
      .bf-weights__row {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuggestSplitPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);
  protected readonly valueOf = valueOf;

  protected readonly budgetId = signal(this.route.snapshot.paramMap.get('budgetId') ?? '');
  protected readonly headcountPct = signal(50);
  protected readonly priorUsePct = signal(30);
  protected readonly participationPct = signal(20);
  /** Weights actually sent to the API; the sliders are a draft until "Recompute" is pressed. */
  private readonly askedWeights = signal<{
    headcountPct: number;
    priorUsePct: number;
    participationPct: number;
  } | null>(null);
  private readonly weightsLoaded = signal(false);
  protected readonly amounts = signal<Record<string, number>>({});
  protected readonly preview = signal<BatchAllocationResult | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly suggestion = resource({
    params: () => ({ parentBudgetId: this.budgetId(), weights: this.askedWeights() }),
    loader: async ({ params }) => {
      const result = await data(
        this.api.suggestAllocation({
          body: {
            parentBudgetId: params.parentBudgetId,
            ...(params.weights ? { weights: params.weights } : {}),
          },
        }),
      );
      this.amounts.set(
        Object.fromEntries(result.lines.map((l) => [l.budgetId, l.suggested.amountMinor])),
      );
      this.preview.set(null);
      if (!this.weightsLoaded()) {
        this.headcountPct.set(result.weights.headcountPct);
        this.priorUsePct.set(result.weights.priorUsePct);
        this.participationPct.set(result.weights.participationPct);
        this.weightsLoaded.set(true);
      }
      return result;
    },
  });

  protected readonly disabled = computed(() =>
    isFeatureDisabled(this.suggestion.error()) ? errorMessage(this.suggestion.error()) : null,
  );
  protected readonly loadError = computed(() =>
    isFeatureDisabled(this.suggestion.error()) ? undefined : this.suggestion.error(),
  );
  protected readonly weightTotal = computed(
    () => this.headcountPct() + this.priorUsePct() + this.participationPct(),
  );

  protected customWeights(s: AllocationSuggestion): boolean {
    return (
      this.headcountPct() !== s.weights.headcountPct ||
      this.priorUsePct() !== s.weights.priorUsePct ||
      this.participationPct() !== s.weights.participationPct
    );
  }

  protected pct(bps: number): string {
    return `${(bps / 100).toFixed(1)}%`;
  }

  protected rounding(s: AllocationSuggestion): string {
    return formatMoney(s.roundingMinor, s.amount.currency);
  }

  protected formatted(amountMinor: number, currency: string): string {
    return formatMoney(amountMinor, currency);
  }

  protected major(amountMinor: number): number {
    return amountMinor / 100;
  }

  protected amountFor(budgetId: string, fallback: number): number {
    return this.amounts()[budgetId] ?? fallback;
  }

  protected edited(budgetId: string, suggested: number): boolean {
    return this.amountFor(budgetId, suggested) !== suggested;
  }

  protected draftTotal(s: AllocationSuggestion): number {
    return s.lines.reduce(
      (total, l) => total + this.amountFor(l.budgetId, l.suggested.amountMinor),
      0,
    );
  }

  protected setAmount(budgetId: string, event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    const minor = Number.isFinite(value) ? Math.round(value * 100) : 0;
    this.amounts.update((a) => ({ ...a, [budgetId]: Math.max(0, minor) }));
    this.preview.set(null);
  }

  protected applyWeights(): void {
    this.askedWeights.set({
      headcountPct: this.headcountPct(),
      priorUsePct: this.priorUsePct(),
      participationPct: this.participationPct(),
    });
  }

  protected resetWeights(s: AllocationSuggestion): void {
    this.headcountPct.set(s.weights.headcountPct);
    this.priorUsePct.set(s.weights.priorUsePct);
    this.participationPct.set(s.weights.participationPct);
    this.askedWeights.set(null);
  }

  protected firstProblem(p: BatchAllocationResult): string {
    const failed = p.lines.find((l) => l.outcome === 'error');
    return failed?.message ?? 'One of the lines did not pass its checks.';
  }

  private lines(s: AllocationSuggestion) {
    return s.lines
      .map((l) => ({
        childBudgetId: l.budgetId,
        amountMinor: this.amountFor(l.budgetId, l.suggested.amountMinor),
      }))
      .filter((l) => l.amountMinor > 0);
  }

  /** Dry run of the normal batch allocation command: the same checks, nothing posted. */
  protected async check(s: AllocationSuggestion): Promise<void> {
    this.busy.set(true);
    this.actionError.set(null);
    try {
      this.preview.set(
        await data(
          this.api.allocateBatch({
            params: { budgetId: this.budgetId() },
            body: { dryRun: true, lines: this.lines(s) },
          }),
        ),
      );
    } catch (error) {
      this.actionError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Posts the owner's amounts through the normal allocation command, then records the acceptance.
   * The API verifies the change really happened before it accepts the decision.
   */
  protected async submit(s: AllocationSuggestion): Promise<void> {
    this.busy.set(true);
    this.actionError.set(null);
    try {
      const posted = await data(
        this.api.allocateBatch({
          params: { budgetId: this.budgetId() },
          body: {
            dryRun: false,
            memo: 'Allocation change started from an AI suggestion',
            lines: this.lines(s),
          },
        }),
      );
      if (!posted.ok) {
        this.preview.set(posted);
        return;
      }
      if (s.provenance.suggestionId) {
        await data(
          this.api.decideAiSuggestion({
            params: { suggestionId: s.provenance.suggestionId },
            body: {
              decision: 'accepted',
              appliedResourceType: 'budget',
              appliedResourceId: this.budgetId(),
            },
          }),
        );
      }
      this.preview.set(posted);
      this.snack.open(
        `Allocated ${formatMoney(posted.totalMinor, posted.currency)} as one change, and recorded your acceptance.`,
        'Dismiss',
        { duration: 7000 },
      );
      this.suggestion.reload();
    } catch (error) {
      this.actionError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async dismiss(s: AllocationSuggestion): Promise<void> {
    const suggestionId = s.provenance.suggestionId;
    if (!suggestionId) return;
    this.busy.set(true);
    try {
      await data(
        this.api.decideAiSuggestion({
          params: { suggestionId },
          body: { decision: 'dismissed', reasonCode: 'NOT_USEFUL' },
        }),
      );
      this.snack.open('Suggestion dismissed. Nothing was allocated.', 'Dismiss', {
        duration: 5000,
      });
    } catch (error) {
      this.actionError.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async rate(s: AllocationSuggestion, rating: 'helpful' | 'not_helpful'): Promise<void> {
    const suggestionId = s.provenance.suggestionId;
    if (!suggestionId) return;
    try {
      await data(this.api.rateAiSuggestion({ params: { suggestionId }, body: { rating } }));
    } catch (error) {
      this.snack.open(errorMessage(error), 'Dismiss', { duration: 6000 });
    }
  }
}
