import { ChangeDetectionStrategy, Component, computed, input, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatGhost } from '@hylandsoftware/satori-ui/ghost';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { Money } from '@bf/web/ui';
import { data, errorMessage, errorStatus, injectApi, valueOf } from '../api';

/**
 * The widget as a host page shows it (102d): one card, no shell, no navigation, readable from
 * 280 px wide.
 *
 * The viewer is whoever is signed in to BudgetFlow in this browser. The widget id in the URL picks
 * the card and nothing else: it names no person, no team and no budget, and the host page cannot
 * influence what is read. A frame on a site that is not on the widget's list is refused, and this
 * page says which site was refused rather than rendering an empty box.
 */
@Component({
  selector: 'bf-widget-embed-page',
  imports: [MatButtonModule, Money, SAT_BANNER_IMPORTS, SAT_TAG_IMPORTS, SatGhost],
  template: `
    <main class="bf-embed">
      @if (content.isLoading() && !valueOf(content)) {
        <div aria-busy="true" aria-label="Loading your widget" data-testid="embed-loading">
          <sat-ghost variant="box" [height]="20" fitContainer />
          <sat-ghost variant="box" [height]="20" fitContainer />
        </div>
      } @else if (status() === 403) {
        <sat-banner variant="important" data-testid="embed-not-allowed">
          <sat-banner-message>
            <strong>This site is not allowed to show the widget.</strong>
            An administrator adds the exact address of this page to the widget's allowed sites
            before it will render here. Until then nothing is shown, and no data has been read.
          </sat-banner-message>
        </sat-banner>
      } @else if (status() === 409) {
        <sat-banner variant="warning" data-testid="embed-paused">
          <sat-banner-message>
            <strong>This widget is paused.</strong>
            It shows nothing anywhere until an administrator resumes it.
          </sat-banner-message>
        </sat-banner>
      } @else if (status() === 404) {
        <sat-banner variant="warning" data-testid="embed-missing">
          <sat-banner-message>
            <strong>This widget no longer exists.</strong>
            Whoever looks after this page can take the snippet out.
          </sat-banner-message>
        </sat-banner>
      } @else if (content.error()) {
        <sat-banner variant="important" data-testid="embed-error">
          <sat-banner-message>BudgetFlow is unavailable. {{ message() }}</sat-banner-message>
        </sat-banner>
        <div class="bf-embed__actions">
          <button mat-stroked-button type="button" (click)="content.reload()">Try again</button>
        </div>
      } @else if (valueOf(content); as c) {
        <p class="bf-embed__viewer" data-testid="embed-viewer">
          BudgetFlow, for {{ c.viewerName ?? 'you' }}
        </p>

        @if (c.teamBudget; as b) {
          <h1 class="bf-embed__headline" data-testid="embed-headline">{{ b.headline }}</h1>
          @if (b.available) {
            <p class="bf-embed__amount" data-testid="embed-amount">
              <bf-money [amountMinor]="b.available.amountMinor" [currency]="b.available.currency" />
              available under this budget's rules
            </p>
          }
          @if (b.utilizationBps !== null) {
            <div
              class="bf-bar"
              role="img"
              [attr.aria-label]="'Used ' + (b.utilizationBps / 100).toFixed(0) + ' percent'"
            >
              <div class="bf-bar__fill" [style.width.%]="barWidth(b.utilizationBps)"></div>
            </div>
          }
          <div class="bf-tile__tags">
            <sat-status-tag [status]="budgetTone(b.status)">{{ b.status }}</sat-status-tag>
          </div>
          <div class="bf-embed__actions">
            @if (b.canRequest) {
              <a mat-flat-button [href]="c.openInAppUrl" target="_blank" rel="noopener"
                >Request funds</a
              >
            }
            <a mat-stroked-button [href]="c.openInAppUrl" target="_blank" rel="noopener"
              >Open BudgetFlow</a
            >
          </div>
        } @else if (c.events.length) {
          <h1 class="bf-embed__headline">Coming up</h1>
          <ul class="bf-embed__events" data-testid="embed-events">
            @for (e of c.events; track e.eventId) {
              <li class="bf-embed__event">
                <strong>{{ e.name }}</strong>
                <span class="bf-embed__viewer">
                  {{ e.startDate ?? 'Date to be confirmed' }}
                  @if (e.city) {
                    · {{ e.city }}
                  }
                  @if (e.rsvpStatus) {
                    · You said {{ e.rsvpStatus }}
                  }
                </span>
              </li>
            }
          </ul>
          <div class="bf-embed__actions">
            <a mat-stroked-button [href]="c.openInAppUrl" target="_blank" rel="noopener"
              >See all events</a
            >
          </div>
        } @else {
          <p class="bf-embed__headline" data-testid="embed-empty">
            {{ c.emptyMessage ?? 'Nothing to show right now.' }}
          </p>
          <div class="bf-embed__actions">
            <a mat-stroked-button [href]="c.openInAppUrl" target="_blank" rel="noopener"
              >Open BudgetFlow</a
            >
          </div>
        }
      }
    </main>
  `,
  styleUrls: ['./ecosystem.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WidgetEmbedPage {
  /** Bound from the route parameter by `withComponentInputBinding`. */
  readonly widgetId = input.required<string>();

  private readonly api = injectApi();
  protected readonly valueOf = valueOf;

  protected readonly content = resource({
    params: () => ({ widgetId: this.widgetId() }),
    loader: ({ params }) => data(this.api.getWidgetContent({ params })),
  });

  protected readonly status = computed(() => errorStatus(this.content.error()));
  protected readonly message = computed(() => errorMessage(this.content.error()));

  protected barWidth(bps: number): number {
    return Math.min(100, Math.max(0, bps / 100));
  }

  /** A frozen or exhausted budget must not be shown in a tone that reads as healthy. */
  protected budgetTone(status: string): 'success' | 'warning' | 'important' | 'neutral' {
    if (status === 'frozen' || status === 'set_to_zero') return 'important';
    if (status === 'exhausted' || status === 'expired' || status === 'closed') return 'warning';
    return status === 'active' ? 'success' : 'neutral';
  }
}
