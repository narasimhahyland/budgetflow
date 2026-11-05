import {
  ChangeDetectionStrategy,
  Component,
  inject,
  resource,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { ChatAccountLinkView, ChatLinkPreview } from '@bf/contracts';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

/**
 * Screen 061e: Account-link page (`/link/chat`, outside the app shell, requires sign-in).
 * Binds the signed-in person's BudgetFlow identity to their Slack or Microsoft Teams account,
 * enforcing an exact email match.
 */
@Component({
  selector: 'bf-chat-link-page',
  imports: [
    LoadState,
    MatButtonModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  template: `
    <main class="bf-landing">
      <section class="bf-card bf-landing__card" aria-labelledby="link-title" data-testid="chat-link-card">
        <div class="bf-card__header">
          <h1 class="bf-page__title" id="link-title">BudgetFlow · Hyland</h1>
        </div>

        <bf-load-state
          [loading]="preview.isLoading() && !preview.hasValue()"
          [error]="preview.error()"
          what="the account-linking request"
          (retry)="preview.reload()"
        />

        @if (valueOf(preview); as p) {
          <div class="bf-section">
            <h2 class="bf-card__title">Connect {{ p.providerLabel }} to BudgetFlow</h2>
            <dl class="bf-facts">
              <div>
                <dt>{{ p.providerLabel }} account</dt>
                <dd>{{ p.handle }} ({{ p.chatEmail }})</dd>
              </div>
              <div>
                <dt>BudgetFlow</dt>
                <dd>
                  {{ p.personName }}, {{ p.personRole
                  }}{{ p.personLocation ? ', ' + p.personLocation : '' }} ({{ p.personEmail }})
                </dd>
              </div>
            </dl>
            <p class="bf-cell__secondary">
              Approvals you make in {{ p.providerLabel }} will be recorded as yours.
            </p>
          </div>

          @if (linked(); as done) {
            <sat-banner variant="success" class="bf-banner" data-testid="chat-link-success">
              <sat-banner-message>
                Connected {{ done.handle }}. You can close this tab and return to
                {{ p.providerLabel }}.
              </sat-banner-message>
            </sat-banner>
            <div class="bf-form__actions">
              <a mat-stroked-button routerLink="/me/notifications">Open notification settings</a>
            </div>
          } @else if (!p.emailMatches) {
            <sat-banner variant="important" class="bf-banner" data-testid="chat-link-mismatch">
              <sat-banner-message>
                Your {{ p.providerLabel }} email ({{ p.chatEmail }}) doesn't match your BudgetFlow
                email ({{ p.personEmail }}). Ask your administrator to fix one of them.
              </sat-banner-message>
            </sat-banner>
            <div class="bf-form__actions">
              <a mat-stroked-button routerLink="/me/notifications">Back to BudgetFlow</a>
            </div>
          } @else {
            @if (failure()) {
              <sat-banner variant="important" class="bf-banner">
                <sat-banner-message>{{ failure() }}</sat-banner-message>
              </sat-banner>
            }
            <div class="bf-form__actions">
              <a mat-button routerLink="/me/notifications">Cancel</a>
              <button
                mat-flat-button
                satImportantButton
                type="button"
                [disabled]="busy()"
                (click)="connect(p)"
                data-testid="confirm-chat-link"
              >
                Connect
              </button>
            </div>
          }
        }
      </section>
    </main>
  `,
  styles: `
    .bf-landing {
      display: flex;
      justify-content: center;
      min-height: 100vh;
      padding: 48px 16px;
      background: var(--mat-sys-surface-container-low);
      box-sizing: border-box;
    }
    .bf-landing__card {
      width: min(520px, 100%);
      align-self: flex-start;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatLinkPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  protected readonly valueOf = valueOf;

  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly linked = signal<ChatAccountLinkView | null>(null);

  protected readonly preview = resource({
    loader: async (): Promise<ChatLinkPreview> => {
      const q = this.route.snapshot.queryParamMap;
      const token = q.get('token');
      if (token) {
        return data(this.api.previewChatLink({ query: { token } }));
      }
      const provider = (q.get('provider') === 'teams' ? 'teams' : 'slack') as 'slack' | 'teams';
      const email = q.get('email') ?? undefined;
      const handle = q.get('handle') ?? undefined;
      return data(
        this.api.createChatLinkIntent({
          body: {
            provider,
            ...(email ? { verifiedEmail: email } : {}),
            ...(handle ? { handle } : {}),
          },
        }),
      );
    },
  });

  protected async connect(p: ChatLinkPreview): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      const res = await data(
        this.api.completeChatLink({ body: { token: p.token } }),
      );
      this.linked.set(res);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
