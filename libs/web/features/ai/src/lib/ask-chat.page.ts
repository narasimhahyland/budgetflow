import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import type { AiChannel, AskAnswer } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { formatMoney } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { AI_OUTPUT_IMPORTS, isFeatureDisabled } from './ai-output';
import { data, errorMessage, errorStatus, injectApi, problemCode } from './api';

/** Chat answers are capped at eight lines, with the rest left in BudgetFlow where it is readable. */
const CHAT_LINE_CAP = 8;

/**
 * Screen 061f: the same questions as 011a, asked from Slack or Microsoft Teams. The chat clients call
 * `POST /api/ai/ask` with `channel: slack | teams`, which is the `ask_chat` feature with its own
 * switch; this screen sends a real request on that channel and renders exactly the private message
 * the person would receive, so the wording and the scope can be checked against the running product.
 *
 * Figures in the message come from `AskAnswer.figures`, never from the model's sentences.
 */
@Component({
  selector: 'bf-ask-chat-page',
  imports: [
    AI_OUTPUT_IMPORTS,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <div class="bf-title-row">
          <h1 class="bf-page__title">Ask BudgetFlow in Slack and Teams</h1>
          <bf-ai-label text="AI answers" />
        </div>
        <p class="bf-page__subtitle">
          The same answers as the assistant, delivered privately in chat. Answers are never posted
          where a channel can see them, and nothing in a chat message can approve or move money.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/ask">Ask in the app</a>
      </div>
    </header>

    <section class="bf-card" aria-labelledby="chat-ask-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="chat-ask-title">Ask as you would in chat</h2>
        <mat-button-toggle-group
          [value]="channel()"
          (change)="channel.set($event.value)"
          aria-label="Chat app"
          hideSingleSelectionIndicator
        >
          <mat-button-toggle value="slack" data-testid="channel-slack">Slack</mat-button-toggle>
          <mat-button-toggle value="teams" data-testid="channel-teams">
            Microsoft Teams
          </mat-button-toggle>
        </mat-button-toggle-group>
      </div>
      <div class="bf-form">
        <mat-form-field appearance="outline" class="bf-form__wide" subscriptSizing="dynamic">
          <mat-label>{{ channel() === 'slack' ? '/budgetflow ask' : 'Message the bot' }}</mat-label>
          <input matInput maxlength="500" [(ngModel)]="question" data-testid="chat-question" />
        </mat-form-field>
      </div>
      <div class="bf-form__actions">
        <button
          mat-flat-button
          type="button"
          [disabled]="asking() || !question().trim()"
          (click)="send()"
          data-testid="chat-send"
        >
          Send
        </button>
        <span class="bf-cell__secondary">
          Private: ephemeral in Slack, personal chat in Microsoft Teams.
        </span>
      </div>
    </section>

    @if (disabled()) {
      <bf-ai-disabled
        feature="Ask in Slack and Teams"
        [detail]="disabledDetail()"
        stillWorks="Questions in the app and /budgetflow balance still work."
      />
    }
    @if (rateLimited(); as message) {
      <sat-banner variant="warning" data-testid="chat-rate-limited">
        <sat-banner-message>{{ message }}</sat-banner-message>
      </sat-banner>
    }
    @if (failure(); as message) {
      <sat-banner variant="important" data-testid="chat-error">
        <sat-banner-message>{{ message }}</sat-banner-message>
      </sat-banner>
    }
    @if (asking()) {
      <section class="bf-card">
        <div class="bf-card__body"><bf-ai-preparing label="Preparing a private reply…" /></div>
      </section>
    }

    @if (answer(); as a) {
      <section class="bf-card" aria-labelledby="chat-reply-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="chat-reply-title">
            {{ channel() === 'slack' ? 'Slack' : 'Microsoft Teams' }} reply, visible only to you
          </h2>
          <sat-status-tag [status]="a.outcome === 'answered' ? 'success' : 'info'">
            {{ a.outcome === 'answered' ? 'Answered' : 'Refused' }}
          </sat-status-tag>
        </div>
        <div class="bf-card__body bf-chat">
          <div class="bf-chat__message" data-testid="chat-message">
            @if (a.outcome === 'answered') {
              <bf-ai-prose [text]="a.answer ?? ''" />
              @if (lines().length) {
                <ul class="bf-chat__lines" data-testid="chat-lines">
                  @for (line of lines(); track line) {
                    <li>{{ line }}</li>
                  }
                </ul>
              }
              @if (truncated()) {
                <p class="bf-chat__more" data-testid="chat-truncated">
                  See the full answer in BudgetFlow.
                </p>
              }
              <p class="bf-chat__context" data-testid="chat-context">
                AI-generated from BudgetFlow figures. Sources:
                {{ sourceNames(a) }}.
              </p>
            } @else if (a.refusal; as refusal) {
              <bf-ai-refusal [refusal]="refusal" [outcome]="a.outcome" />
            }
          </div>
          <div class="bf-chat__buttons">
            <a mat-stroked-button routerLink="/ask" [queryParams]="{ q: asked() }">
              Open in BudgetFlow
            </a>
          </div>
          <bf-ai-provenance [provenance]="a.provenance" />
        </div>
      </section>
      @if (a.outcome === 'answered' && a.figures.length) {
        <section class="bf-card" aria-labelledby="chat-figures-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="chat-figures-title">
              The figures the message was built from
            </h2>
          </div>
          <div class="bf-card__body">
            <bf-ai-figures [figures]="a.figures" label="Figures behind the chat reply" />
          </div>
        </section>
      }
    } @else if (!asking() && !disabled() && !failure()) {
      <sat-empty-state data-testid="chat-empty">
        <h2 satEmptyStateHeadline>No chat question asked yet</h2>
        <p satEmptyStateDescription>
          A mention in a channel never produces an answer the channel can see: the asker gets the
          reply privately instead.
        </p>
      </sat-empty-state>
    }
  `,
  styles: `
    .bf-chat {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bf-chat__message {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-large);
      background: var(--mat-sys-surface-container-low);
    }
    .bf-chat__lines {
      margin: 0;
      padding-inline-start: 20px;
      font: var(--mat-sys-body-medium);
    }
    .bf-chat__lines li + li {
      margin-top: 4px;
    }
    .bf-chat__more,
    .bf-chat__context {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-chat__buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AskChatPage {
  private readonly api = injectApi();
  protected readonly session = inject(SessionStore);

  protected readonly channel = signal<AiChannel>('slack');
  protected readonly question = signal('');
  protected readonly asked = signal('');
  protected readonly asking = signal(false);
  protected readonly answer = signal<AskAnswer | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly rateLimited = signal<string | null>(null);
  protected readonly disabled = signal(false);
  protected readonly disabledDetail = signal('');

  /**
   * The message body lines, built from `figures` rather than from the answer text: one line per
   * budget with its own available and authorized amounts, formatted by BudgetFlow.
   */
  private readonly allLines = computed(() => {
    const a = this.answer();
    if (!a || a.outcome !== 'answered') return [];
    const bySource = new Map<string, { label: string; available?: string; authorized?: string }>();
    for (const f of a.figures) {
      const entry = bySource.get(f.source.id) ?? { label: f.source.label };
      if (f.key === 'available')
        entry.available = formatMoney(f.amount.amountMinor, f.amount.currency);
      if (f.key === 'authorized')
        entry.authorized = formatMoney(f.amount.amountMinor, f.amount.currency);
      bySource.set(f.source.id, entry);
    }
    return [...bySource.values()]
      .filter((e) => e.available && e.authorized)
      .map(
        (e) =>
          `${e.label}: ${e.available} available under its rules, of ${e.authorized} authorized.`,
      );
  });
  protected readonly lines = computed(() => this.allLines().slice(0, CHAT_LINE_CAP));
  protected readonly truncated = computed(() => this.allLines().length > CHAT_LINE_CAP);

  protected sourceNames(answer: AskAnswer): string {
    return answer.sources.length
      ? answer.sources.map((s) => s.label).join(', ')
      : 'none in your scope';
  }

  protected async send(): Promise<void> {
    const question = this.question().trim();
    if (!question || this.asking()) return;
    this.asking.set(true);
    this.failure.set(null);
    this.rateLimited.set(null);
    this.disabled.set(false);
    this.answer.set(null);
    this.asked.set(question);
    try {
      const answer = await data(
        this.api.askBudgetFlow({ body: { question, channel: this.channel() } }),
      );
      this.answer.set(answer);
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
}
