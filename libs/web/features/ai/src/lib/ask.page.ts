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
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { AskAnswer, AskRequest } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatInlineChip } from '@hylandsoftware/satori-ui/inline-chip';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { AI_OUTPUT_IMPORTS, isFeatureDisabled } from './ai-output';
import { data, errorMessage, errorStatus, injectApi, problemCode, valueOf } from './api';
import { LoadState } from './load-state';

/**
 * Screen 011a: Ask BudgetFlow. Answers come only from records the asker may already read, every
 * figure is rendered by BudgetFlow from its ledger read models, and the assistant never acts: an
 * action request is refused and redirected to the screen where the person does it themselves.
 */
@Component({
  selector: 'bf-ask-page',
  imports: [
    AI_OUTPUT_IMPORTS,
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatInlineChip,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <div class="bf-title-row">
          <h1 class="bf-page__title">Ask BudgetFlow</h1>
          <bf-ai-label text="AI answers" />
        </div>
        <p class="bf-page__subtitle">
          Answers use only the budgets, requests and events you can see. BudgetFlow AI explains and
          suggests; it cannot approve, move money or change settings.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/ask/chat">Questions in Slack and Teams</a>
        <button
          mat-stroked-button
          type="button"
          (click)="newConversation()"
          data-testid="new-conversation"
        >
          <mat-icon svgIcon="circle_add" />New conversation
        </button>
      </div>
    </header>

    @if (disabled()) {
      <bf-ai-disabled
        feature="Ask BudgetFlow"
        [detail]="disabledDetail()"
        stillWorks="Budget, request and report screens are unaffected."
      />
    } @else {
      <div class="bf-layout">
        <div class="bf-layout__main">
          <section class="bf-card" aria-labelledby="ask-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="ask-title">Your question</h2>
              @if (context(); as c) {
                <button
                  satInlineChip
                  type="button"
                  (click)="clearContext()"
                  data-testid="context-chip"
                >
                  About: {{ c.id }}
                  <mat-icon satInlineChipTrailingIcon svgIcon="circle_x" />
                </button>
              }
            </div>
            <div class="bf-form">
              <mat-form-field appearance="outline" class="bf-form__wide" subscriptSizing="dynamic">
                <mat-label>Ask about budgets, requests or events you can see</mat-label>
                <textarea
                  matInput
                  rows="3"
                  maxlength="500"
                  [(ngModel)]="question"
                  (keydown.enter)="onEnter($event)"
                  data-testid="question"
                ></textarea>
                <mat-hint>{{ question().length }} of 500 characters</mat-hint>
              </mat-form-field>
            </div>
            <div class="bf-form__actions">
              <button
                mat-flat-button
                type="button"
                [disabled]="asking() || !question().trim()"
                (click)="send()"
                data-testid="send"
              >
                Send
              </button>
              @if (!turns().length) {
                <span class="bf-cell__secondary">Suggested questions:</span>
                @for (s of suggestions(); track s) {
                  <button
                    satInlineChip
                    type="button"
                    (click)="askSuggested(s)"
                    [attr.data-testid]="'suggested'"
                  >
                    {{ s }}
                  </button>
                }
              }
            </div>
          </section>

          @if (rateLimited(); as message) {
            <sat-banner variant="warning" data-testid="rate-limited">
              <sat-banner-message>{{ message }}</sat-banner-message>
            </sat-banner>
          }
          @if (failure(); as message) {
            <sat-banner variant="important" data-testid="ask-error">
              <sat-banner-message>{{ message }}</sat-banner-message>
            </sat-banner>
          }

          @if (asking()) {
            <section class="bf-card">
              <div class="bf-card__body">
                <bf-ai-preparing label="Looking at the records you can see…" />
              </div>
            </section>
          }

          @for (turn of turns(); track turn.answer.turnId) {
            <section class="bf-card" aria-label="Answer">
              <div class="bf-card__header">
                <h2 class="bf-card__title">{{ turn.question }}</h2>
                <sat-status-tag [status]="turn.answer.outcome === 'answered' ? 'success' : 'info'">
                  {{ outcomeLabel(turn.answer.outcome) }}
                </sat-status-tag>
              </div>
              <div class="bf-card__body bf-answer">
                @switch (turn.answer.outcome) {
                  @case ('answered') {
                    <bf-ai-prose [text]="turn.answer.answer ?? ''" />
                    @if (turn.answer.figures.length) {
                      <bf-ai-figures
                        [figures]="turn.answer.figures"
                        label="Figures behind this answer"
                      />
                      <p class="bf-cell__secondary">
                        Ledger figures as of
                        <span data-testid="relative-time">{{
                          turn.answer.asOf | bfDateTime: session.timezone() : 'HH:mm'
                        }}</span>
                      </p>
                    }
                    <bf-ai-why [why]="turn.answer.why" [confidence]="turn.answer.confidence" />
                    <bf-ai-sources [sources]="turn.answer.sources" />
                    @if (turn.answer.followUps.length) {
                      <div class="bf-answer__followups">
                        @for (f of turn.answer.followUps; track f) {
                          <button satInlineChip type="button" (click)="askSuggested(f)">
                            {{ f }}
                          </button>
                        }
                      </div>
                    }
                  }
                  @default {
                    @if (turn.answer.refusal; as refusal) {
                      <bf-ai-refusal [refusal]="refusal" [outcome]="turn.answer.outcome" />
                    }
                    @if (turn.answer.sources.length) {
                      <bf-ai-sources [sources]="turn.answer.sources" />
                    }
                  }
                }
                <div class="bf-answer__footer">
                  <bf-ai-provenance [provenance]="turn.answer.provenance" />
                  @if (turn.answer.provenance.suggestionId) {
                    <bf-ai-feedback [rated]="turn.rated" (rating)="rate(turn.answer, $event)" />
                  }
                </div>
              </div>
            </section>
          }

          @if (!turns().length && !asking() && !failure()) {
            <sat-empty-state data-testid="ask-empty">
              <h2 satEmptyStateHeadline>No questions yet</h2>
              <p satEmptyStateDescription>
                Ask about a budget, a request or an event. Answers never include records you cannot
                already open yourself.
              </p>
            </sat-empty-state>
          }
        </div>

        <aside class="bf-layout__side">
          <section class="bf-card" aria-labelledby="history-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="history-title">Your conversations</h2>
            </div>
            <bf-load-state
              [loading]="conversations.isLoading() && !conversations.hasValue()"
              [error]="conversations.error()"
              what="your conversations"
              [lines]="3"
              (retry)="conversations.reload()"
            />
            @if (conversations.hasValue()) {
              @if (conversationList().length === 0) {
                <p class="bf-empty" data-testid="history-empty">
                  Conversations you start are private to you and kept
                  {{ historyDays() }} days.
                </p>
              } @else {
                <ul class="bf-list" data-testid="conversation-list">
                  @for (c of conversationList(); track c.id) {
                    <li class="bf-list__item" [attr.data-testid]="'conversation-' + c.id">
                      <div class="bf-list__row bf-history__row">
                        <span class="bf-history__title">{{ c.title }}</span>
                        <button
                          mat-button
                          type="button"
                          class="bf-history__delete"
                          (click)="deleteConversation(c.id)"
                          [attr.aria-label]="'Delete conversation ' + c.title"
                        >
                          Delete
                        </button>
                      </div>
                      <span class="bf-cell__secondary"
                        >{{ c.turnCount }} {{ c.turnCount === 1 ? 'question' : 'questions' }} ·
                        {{ c.channel }}</span
                      >
                    </li>
                  }
                </ul>
              }
            }
          </section>
          <section class="bf-card" aria-labelledby="how-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="how-title">How answers work</h2>
            </div>
            <div class="bf-card__body">
              <ul class="bf-how">
                <li>
                  Figures are read from BudgetFlow's ledger and rendered as data, never written by
                  the model.
                </li>
                <li>
                  An answer is discarded if its text states a figure that is not in those records.
                </li>
                <li>
                  Asking changes nothing. Requests to approve or move money are redirected to the
                  screen that does it.
                </li>
                <li>
                  Every call is recorded in the AI query log without your question or the answer
                  text.
                </li>
              </ul>
            </div>
          </section>
        </aside>
      </div>
    }
  `,
  styles: `
    .bf-answer {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .bf-answer__followups {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .bf-answer__footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    /* The shared .bf-list__item is width:100% in a content-box, so its 20px side padding pushes it
       past the card. Scoped here; the shared rule in libs/web/ui needs the same fix. */
    .bf-list__item {
      box-sizing: border-box;
    }
    .bf-history__row {
      align-items: center;
      gap: 8px;
    }
    .bf-history__title {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .bf-history__delete {
      flex: 0 0 auto;
    }
    .bf-how {
      margin: 0;
      padding-inline-start: 20px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-how li + li {
      margin-top: 6px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AskPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);

  private readonly query = this.route.snapshot.queryParamMap;
  protected readonly question = signal(this.query.get('q') ?? '');
  protected readonly asking = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly rateLimited = signal<string | null>(null);
  protected readonly disabled = signal(false);
  protected readonly disabledDetail = signal('');
  protected readonly conversationId = signal<string | undefined>(undefined);
  protected readonly turns = signal<
    { question: string; answer: AskAnswer; rated: 'helpful' | 'not_helpful' | null }[]
  >([]);

  protected readonly context = signal<AskRequest['context'] | undefined>(contextOf(this.query));

  protected readonly conversations = resource({
    loader: () => data(this.api.listAiConversations({})),
  });
  protected readonly conversationList = computed(() => valueOf(this.conversations)?.items ?? []);
  protected readonly historyDays = signal(30);

  /** Suggested questions by what the API says this person may do, never by role name. */
  protected readonly suggestions = computed(() => {
    const can = (action: string) => this.session.can(action);
    if (can('actuals.manage'))
      return [
        'Which budgets are forecast to overspend this quarter?',
        'How much is committed but not spent yet?',
      ];
    if (can('budget.allocate'))
      return [
        'How much is left in my budgets?',
        'What is committed but not spent yet?',
        'Which of my budgets are above 80%?',
      ];
    return ['How much can I still request?', 'Where is my latest request?'];
  });

  protected outcomeLabel(outcome: AskAnswer['outcome']): string {
    return OUTCOMES[outcome] ?? outcome;
  }

  protected onEnter(event: Event): void {
    const keyboard = event as KeyboardEvent;
    if (keyboard.shiftKey) return;
    event.preventDefault();
    void this.send();
  }

  protected askSuggested(text: string): void {
    this.question.set(text);
    void this.send();
  }

  protected clearContext(): void {
    this.context.set(undefined);
  }

  protected newConversation(): void {
    this.conversationId.set(undefined);
    this.turns.set([]);
    this.failure.set(null);
    this.rateLimited.set(null);
  }

  protected async send(): Promise<void> {
    const question = this.question().trim();
    if (!question || this.asking()) return;
    this.asking.set(true);
    this.failure.set(null);
    this.rateLimited.set(null);
    try {
      const answer = await data(
        this.api.askBudgetFlow({
          body: {
            question,
            channel: 'web',
            ...(this.conversationId() ? { conversationId: this.conversationId() } : {}),
            ...(this.context() ? { context: this.context() } : {}),
          },
        }),
      );
      this.conversationId.set(answer.conversationId);
      this.turns.update((t) => [{ question, answer, rated: null }, ...t]);
      this.question.set('');
      this.conversations.reload();
    } catch (error) {
      if (isFeatureDisabled(error)) {
        this.disabled.set(true);
        this.disabledDetail.set(errorMessage(error));
      } else if (errorStatus(error) === 429 || problemCode(error) === 'RATE_LIMIT_EXCEEDED') {
        this.rateLimited.set(errorMessage(error));
      } else {
        this.failure.set(errorMessage(error));
      }
    } finally {
      this.asking.set(false);
    }
  }

  protected async rate(answer: AskAnswer, rating: 'helpful' | 'not_helpful'): Promise<void> {
    const suggestionId = answer.provenance.suggestionId;
    if (!suggestionId) return;
    try {
      await data(this.api.rateAiSuggestion({ params: { suggestionId }, body: { rating } }));
      this.turns.update((turns) =>
        turns.map((t) => (t.answer.turnId === answer.turnId ? { ...t, rated: rating } : t)),
      );
    } catch (error) {
      this.snack.open(errorMessage(error), 'Dismiss', { duration: 6000 });
    }
  }

  protected async deleteConversation(id: string): Promise<void> {
    try {
      await data(this.api.deleteAiConversation({ params: { conversationId: id } }));
      if (this.conversationId() === id) this.newConversation();
      this.conversations.reload();
      this.snack.open('Conversation deleted.', 'Dismiss', { duration: 4000 });
    } catch (error) {
      this.snack.open(errorMessage(error), 'Dismiss', { duration: 6000 });
    }
  }
}

const OUTCOMES: Partial<Record<AskAnswer['outcome'], string>> = {
  answered: 'Answered',
  refused_out_of_scope: 'Refused \u2013 out of scope',
  refused_action: 'Refused \u2013 action',
  discarded_unreliable: 'Discarded \u2013 unreliable',
  failed: 'Failed',
  rate_limited: 'Rate limited',
};

/** The record the panel was opened from (`?contextType=budget&contextId=...`). */
function contextOf(query: { get(key: string): string | null }): AskRequest['context'] | undefined {
  const type = query.get('contextType');
  const id = query.get('contextId');
  const allowed = ['budget', 'event', 'request', 'report'] as const;
  const kind = allowed.find((a) => a === type);
  return kind && id ? { type: kind, id } : undefined;
}
