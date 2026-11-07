import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { LeadershipSummary, SummaryStatus } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

export const SUMMARY_STATUS_LABEL: Record<SummaryStatus, string> = {
  ai_draft: 'AI draft: not reviewed',
  edited: 'Edited draft',
  approved: 'Approved',
};

export const SUMMARY_STATUS_TONE: Record<SummaryStatus, 'warning' | 'info' | 'success'> = {
  ai_draft: 'warning',
  edited: 'info',
  approved: 'success',
};

/** Screen 011b: leadership summaries by period, with their review state in words. */
@Component({
  selector: 'bf-summary-list-page',
  imports: [
    DateTimePipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Leadership summaries</h1>
        <p class="bf-page__subtitle">Drafted from BudgetFlow's own figures; approved by a person</p>
      </div>
      <div class="bf-page__actions">
        @if (draftablePeriod(); as period) {
          <button
            mat-flat-button
            type="button"
            [disabled]="drafting()"
            (click)="draft(period.id)"
            data-testid="draft-summary"
          >
            <mat-icon svgIcon="ai" />Draft {{ period.label }} summary
          </button>
        }
      </div>
    </header>

    <sat-banner variant="info" data-testid="summaries-note">
      <sat-banner-message>
        A drafted summary is a draft. The model writes the sentences; every figure in them is read
        from the ledger by BudgetFlow. Nothing is exported or attached to a board pack until someone
        has read every section and approved it.
      </sat-banner-message>
    </sat-banner>

    @if (failure(); as message) {
      <sat-banner variant="important" data-testid="summary-error">
        <sat-banner-message>{{ message }}</sat-banner-message>
      </sat-banner>
    }

    <bf-load-state
      [loading]="summaries.isLoading() && !summaries.hasValue()"
      [error]="summaries.error()"
      what="leadership summaries"
      (retry)="summaries.reload()"
    />

    @if (summaries.hasValue()) {
      @if (items().length === 0) {
        <sat-empty-state data-testid="summaries-empty">
          <h2 satEmptyStateHeadline>No leadership summaries yet</h2>
          <p satEmptyStateDescription>
            A summary is drafted from a closed period's snapshot, so its figures match the board
            pack.
          </p>
        </sat-empty-state>
      } @else {
        <ul class="bf-summaries">
          @for (s of items(); track s.id) {
            <li class="bf-card bf-summaries__item" [attr.data-testid]="'summary-' + s.id">
              <div class="bf-list__row">
                <a class="bf-summaries__period" [routerLink]="['/insights/summaries', s.id]">{{
                  s.periodLabel
                }}</a>
                <sat-status-tag [status]="tone(s)">{{ label(s) }}</sat-status-tag>
              </div>
              @if (s.periodState === 'open') {
                <p class="bf-summaries__open">
                  <mat-icon svgIcon="info" class="bf-summaries__icon" />
                  Draft of an open period: its figures can still move, so it can never be approved.
                </p>
              }
              <dl class="bf-summaries__facts">
                <div>
                  <dt>Author</dt>
                  <dd>{{ s.authorName ?? 'Unknown' }}</dd>
                </div>
                <div>
                  <dt>Sections read</dt>
                  <dd>{{ reviewed(s) }} of {{ s.sections.length }}</dd>
                </div>
                <div>
                  <dt>Approved by</dt>
                  <dd>{{ s.approvedByName ?? 'Not approved yet' }}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>
                    <span data-testid="relative-time">{{
                      s.updatedAt | bfDateTime: session.timezone()
                    }}</span>
                  </dd>
                </div>
              </dl>
            </li>
          }
        </ul>
      }
    }
  `,
  styles: `
    .bf-summaries {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 12px 0 0;
      padding: 0;
      list-style: none;
    }
    .bf-summaries__item {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px;
    }
    .bf-summaries__period {
      font: var(--mat-sys-title-medium);
    }
    .bf-summaries__open {
      display: flex;
      align-items: center;
      gap: 4px;
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-summaries__icon {
      width: 16px;
      height: 16px;
    }
    .bf-summaries__facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 8px;
      margin: 0;
    }
    .bf-summaries__facts dt {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    .bf-summaries__facts dd {
      margin: 2px 0 0;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SummaryListPage {
  private readonly api = injectApi();
  private readonly snackBar = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);

  protected readonly failure = signal<string | null>(null);
  protected readonly drafting = signal(false);
  protected readonly summaries = resource({
    loader: () => data(this.api.listLeadershipSummaries({})),
  });
  protected readonly items = computed(() => valueOf(this.summaries)?.items ?? []);

  /**
   * Periods are only offered for drafting when they are closed, because a closed period has the
   * snapshot the summary quotes.
   */
  private readonly periods = resource({
    loader: async () => {
      try {
        return await data(this.api.listClosePeriods({}));
      } catch {
        return { items: [] };
      }
    },
  });
  /**
   * Drafting is `audit.read`, the same action the API checks: leadership and finance draft the
   * company summary, an analyst reads the approved one. Reading the close calendar is not enough
   * to stand in for it — an analyst can read it — so without this the button is offered to someone
   * the API will refuse the moment they press it.
   */
  protected readonly draftablePeriod = computed(() => {
    if (!this.session.can('audit.read')) return undefined;
    const summarised = new Set(this.items().map((s) => s.periodId));
    const closed = (valueOf(this.periods)?.items ?? []).filter(
      (p) => (p.status === 'closed' || p.status === 'locked') && !summarised.has(p.id),
    );
    return closed.at(-1);
  });

  protected label = (s: LeadershipSummary) => SUMMARY_STATUS_LABEL[s.status];
  protected tone = (s: LeadershipSummary) => SUMMARY_STATUS_TONE[s.status];
  protected reviewed = (s: LeadershipSummary) => s.sections.filter((x) => x.reviewed).length;

  protected async draft(periodId: string): Promise<void> {
    this.drafting.set(true);
    this.failure.set(null);
    try {
      await data(this.api.draftLeadershipSummary({ body: { periodId } }));
      this.summaries.reload();
      this.snackBar.open('Drafted. Read every section before approving it.', 'Dismiss', {
        duration: 6000,
      });
    } catch (error) {
      this.failure.set(errorMessage(error));
    } finally {
      this.drafting.set(false);
    }
  }
}
