import { DecimalPipe } from '@angular/common';
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
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { BOARD_PACK_PAGES, type BoardPackGeneration, type BoardPackPageId } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import type { SatTagStatus } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';
import { Reconciliation, ReportNotes, ReportTable, ScopeNote } from './report-frame';

const PAGE_TITLES: Record<BoardPackPageId, string> = {
  summary: 'Summary',
  legal_entity: 'By legal entity',
  region: 'By region',
  function: 'By function',
  category: 'By category',
  period: 'By period',
  variance_fx: 'Variance and FX bridge',
  top_commitments: 'Top commitments',
  controls_applied: 'Controls applied',
  exceptions: 'Exceptions',
  cofunding: 'Co-funding and recharges',
};

const GENERATION_STATUS: Record<
  BoardPackGeneration['status'],
  { tone: SatTagStatus; text: string }
> = {
  queued: { tone: 'neutral', text: 'Queued' },
  running: { tone: 'warning', text: 'Rendering' },
  ready: { tone: 'success', text: 'Ready' },
  failed: { tone: 'important', text: 'Failed' },
  expired: { tone: 'neutral-quiet', text: 'Expired' },
};

/** Columns of the pack that hold a projection rather than money the ledger moved. */
const FORECAST_COLUMNS = ['forecast', 'forecastYearEnd', 'previousForecast'];

const POLL_MS = 1_500;
const POLL_LIMIT = 40;

/**
 * Screen 16a: the board and FP&A pack. Pages arrive as report columns and rows, so the shared report
 * table renders them unchanged — no figure on this screen is worked out in the browser. The FX bridge
 * is a field of its own, never a page column, because an FX effect is not spend and never moves
 * budget. Owner-scoped roles are refused the pack by the API and land on the forbidden state.
 */
@Component({
  selector: 'bf-board-pack-page',
  imports: [
    DateTimePipe,
    DecimalPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    Money,
    Reconciliation,
    ReportNotes,
    ReportTable,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
    ScopeNote,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">{{ pack()?.title ?? 'Board and FP&A pack' }}</h1>
        <p class="bf-page__subtitle">
          @if (pack(); as p) {
            {{ p.source.statement }} In {{ p.currency }}.
          } @else {
            Roll-ups for the board from a closed-period snapshot, so the numbers do not move after
            the pack is sent.
          }
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/reports">
          <mat-icon svgIcon="arrow_left" />All reports
        </a>
        <button
          mat-flat-button
          type="button"
          [disabled]="busy() || !pack()"
          (click)="generate()"
          data-testid="generate-pack"
        >
          <mat-icon svgIcon="download" />Generate PDF and XLSX
        </button>
      </div>
    </header>

    @if (failure(); as text) {
      <sat-banner variant="important" data-testid="pack-failure">
        <sat-banner-message>{{ text }}</sat-banner-message>
      </sat-banner>
    }

    <bf-load-state
      [loading]="packRes.isLoading() && !packRes.hasValue()"
      [error]="packRes.error()"
      what="the board and FP&A pack"
      (retry)="packRes.reload()"
    />

    @if (pack(); as p) {
      @if (p.source.draft) {
        <sat-banner variant="warning" data-testid="pack-draft">
          <sat-banner-message>
            <strong>Draft.</strong> {{ p.source.periodLabel }} is still open, so every figure can
            still change. Send the board a pack built from a closed period.
          </sat-banner-message>
        </sat-banner>
      }
      <bf-report-notes [notes]="p.notes" />

      <div class="bf-split">
        <section class="bf-card" aria-labelledby="settings-title">
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title" id="settings-title">Pack settings</h2>
              <p class="bf-card__hint">The preview rebuilds as you change these.</p>
            </div>
          </div>
          <div class="bf-form">
            <mat-form-field appearance="outline" class="bf-form__wide">
              <mat-label>As of</mat-label>
              <mat-select
                [ngModel]="periodId()"
                (ngModelChange)="periodId.set($event)"
                [disabled]="draft()"
                data-testid="pack-period"
              >
                <mat-option [value]="''">Latest closed period</mat-option>
                @for (period of closedPeriods(); track period.id) {
                  <mat-option [value]="period.id">{{ period.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>
          <div class="bf-form__actions bf-settings__toggles">
            <mat-checkbox [ngModel]="draft()" (ngModelChange)="draft.set($event)"
              >Current open period (draft)</mat-checkbox
            >
            <mat-checkbox
              [ngModel]="constantCurrency()"
              (ngModelChange)="constantCurrency.set($event)"
              >Constant currency</mat-checkbox
            >
          </div>
          <div class="bf-card__header">
            <div>
              <h3 class="bf-card__title">Pages</h3>
              <p class="bf-card__hint">
                Fixed building blocks: toggle them, and a page with no data keeps its place with a
                statement saying so.
              </p>
            </div>
          </div>
          <ul class="bf-list bf-pages">
            @for (page of allPages; track page) {
              <li>
                <mat-checkbox
                  [checked]="isOn(page)"
                  (change)="togglePage(page, $event.checked)"
                  [attr.data-testid]="'page-toggle-' + page"
                  >{{ title(page) }}</mat-checkbox
                >
              </li>
            }
          </ul>
        </section>

        <div class="bf-layout__main">
          <bf-scope-note
            [note]="p.scope.note"
            [label]="p.scope.label"
            [budgetIds]="p.scope.budgetIds"
          />
          <section class="bf-card" aria-labelledby="source-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="source-title">Where these figures come from</h2>
            </div>
            <dl class="bf-facts">
              <div>
                <dt>Source</dt>
                <dd data-testid="pack-source">
                  {{
                    p.source.kind === 'close_snapshot' ? 'Close snapshot' : 'Open period (draft)'
                  }}
                </dd>
              </div>
              <div>
                <dt>Period</dt>
                <dd>{{ p.source.periodLabel }}</dd>
              </div>
              <div>
                <dt>Snapshot version</dt>
                <dd>{{ p.source.snapshotVersion ?? 'No snapshot' }}</dd>
              </div>
              <div>
                <dt>Constant currency</dt>
                <dd>{{ p.constantCurrency ? 'On' : 'Off' }}</dd>
              </div>
            </dl>
            <bf-reconciliation [reconciliation]="p.reconciliation" />
          </section>

          @for (page of p.pages; track page.page) {
            <section
              class="bf-card"
              [class.bf-draft]="p.source.draft"
              [attr.aria-labelledby]="'page-' + page.page"
              [attr.data-testid]="'pack-page-' + page.page"
            >
              <div class="bf-card__header">
                <h2 class="bf-card__title" [id]="'page-' + page.page">{{ page.title }}</h2>
                @if (p.source.draft) {
                  <span class="bf-watermark" aria-hidden="true">Draft</span>
                }
              </div>
              @if (page.rows.length) {
                <bf-report-table
                  [columns]="page.columns"
                  [rows]="page.rows"
                  [totals]="page.totals"
                  [caption]="page.title"
                  [timezone]="session.timezone()"
                  [forecastColumns]="forecastColumns"
                />
              } @else {
                <p class="bf-empty" [attr.data-testid]="'pack-statement-' + page.page">
                  {{ page.statement ?? 'Nothing to report on this page.' }}
                </p>
              }
            </section>
          }

          <section class="bf-card" aria-labelledby="fx-title" data-testid="pack-fx-bridge">
            <div class="bf-card__header">
              <div>
                <h2 class="bf-card__title" id="fx-title">FX bridge</h2>
                <p class="bf-card__hint">{{ p.fxBridge.note }}</p>
              </div>
            </div>
            @if (p.fxBridge.rows.length) {
              <div class="bf-table-scroll">
                <table class="bf-split-table" aria-label="FX bridge by transaction currency">
                  <thead>
                    <tr>
                      <th>Transaction currency</th>
                      <th class="bf-num">As posted</th>
                      <th class="bf-num">At the plan rate</th>
                      <th class="bf-num">At the reporting rate</th>
                      <th class="bf-num">FX effect</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of p.fxBridge.rows; track row.transactionCurrency) {
                      <tr>
                        <td>
                          {{ row.transactionCurrency }}
                          @if (row.planRate) {
                            <span class="bf-cell__secondary">Plan rate {{ row.planRate }}</span>
                          }
                        </td>
                        <td class="bf-num">
                          <bf-money
                            [amountMinor]="row.transaction.amountMinor"
                            [currency]="row.transaction.currency"
                          />
                        </td>
                        <td class="bf-num">
                          <bf-money
                            [amountMinor]="row.atPlanRate.amountMinor"
                            [currency]="row.atPlanRate.currency"
                          />
                        </td>
                        <td class="bf-num">
                          <bf-money
                            [amountMinor]="row.atReportingRate.amountMinor"
                            [currency]="row.atReportingRate.currency"
                          />
                        </td>
                        <td class="bf-num">
                          <bf-money
                            [amountMinor]="row.fxEffect.amountMinor"
                            [currency]="row.fxEffect.currency"
                          />
                        </td>
                      </tr>
                    }
                    <tr class="bf-total">
                      <td>Total FX effect ({{ p.fxBridge.reportingRateType }})</td>
                      <td class="bf-num"></td>
                      <td class="bf-num"></td>
                      <td class="bf-num"></td>
                      <td class="bf-num" data-testid="fx-total">
                        <bf-money
                          [amountMinor]="p.fxBridge.totalEffect.amountMinor"
                          [currency]="p.fxBridge.totalEffect.currency"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="bf-empty" data-testid="fx-empty">
                No spend in another currency in {{ p.source.periodLabel }}, so there is nothing to
                bridge.
              </p>
            }
          </section>
        </div>
      </div>

      <section class="bf-card" aria-labelledby="generations-title">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="generations-title">Generated packs</h2>
            <p class="bf-card__hint">
              Rendering runs in the background. Download links are signed and last five minutes, so
              each one is fetched the moment you ask for it.
            </p>
          </div>
        </div>
        @if (generations().length) {
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Generated packs">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th class="bf-num">Pages</th>
                  <th class="bf-num">Rows</th>
                  <th>Files</th>
                </tr>
              </thead>
              <tbody>
                @for (g of generations(); track g.id) {
                  <tr [attr.data-testid]="'generation-' + g.id">
                    <td>
                      <span data-testid="relative-time">{{
                        g.requestedAt | bfDateTime: session.timezone()
                      }}</span>
                      <span class="bf-cell__secondary">{{ g.requestedByName ?? 'Unknown' }}</span>
                    </td>
                    <td>
                      <sat-status-tag [status]="statusOf(g).tone">{{
                        statusOf(g).text
                      }}</sat-status-tag>
                      @if (g.error) {
                        <span class="bf-cell__secondary">{{ g.error }}</span>
                      }
                    </td>
                    <td>{{ g.source.periodLabel }}</td>
                    <td class="bf-num">{{ g.pageCount | number }}</td>
                    <td class="bf-num">{{ g.rowCount | number }}</td>
                    <td>
                      @switch (g.status) {
                        @case ('ready') {
                          <span class="bf-row-actions">
                            @for (f of g.files; track f.format) {
                              <button
                                mat-stroked-button
                                type="button"
                                [disabled]="busy()"
                                (click)="download(g, f.format)"
                                [attr.data-testid]="'download-' + f.format"
                              >
                                {{ f.format.toUpperCase() }}
                              </button>
                            }
                          </span>
                        }
                        @case ('expired') {
                          <span class="bf-cell__secondary" data-testid="generation-expired">
                            The files for this pack have expired. Generate it again to get new
                            links.
                          </span>
                        }
                        @case ('failed') {
                          <span class="bf-cell__secondary">
                            Rendering stopped at
                            {{ g.failedPage ? title(g.failedPage) : 'an unknown page' }}.
                          </span>
                        }
                        @default {
                          <span class="bf-cell__secondary">Nothing to download yet.</span>
                        }
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>No packs generated yet</h3>
            <p satEmptyStateDescription>
              Generate one to get a PDF and an XLSX of exactly what the preview shows.
            </p>
          </sat-empty-state>
        }
      </section>
    }
  `,
  styles: `
    .bf-settings__toggles {
      flex-direction: column;
      align-items: flex-start;
      padding-bottom: 8px;
    }
    .bf-pages {
      padding: 0 20px 20px;
    }
    .bf-pages li {
      padding: 2px 0;
    }
    /* An open-period pack is a draft on every page, the way the rendered PDF marks it. */
    .bf-draft {
      background: repeating-linear-gradient(
        135deg,
        var(--mat-sys-surface-container-lowest) 0 14px,
        var(--mat-sys-surface-container-low) 14px 16px
      );
    }
    .bf-watermark {
      padding: 2px 10px;
      border: 1px solid var(--sat-sys-warning-icon);
      border-radius: var(--mat-sys-corner-full);
      color: var(--sat-sys-on-warning-container);
      background: var(--sat-sys-warning-container);
      font: var(--mat-sys-label-large);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BoardPackPage {
  private readonly api = injectApi();
  protected readonly session = inject(SessionStore);
  protected readonly allPages = BOARD_PACK_PAGES;
  protected readonly forecastColumns = FORECAST_COLUMNS;

  protected readonly periodId = signal('');
  protected readonly draft = signal(false);
  protected readonly constantCurrency = signal(true);
  protected readonly pages = signal<readonly BoardPackPageId[]>(BOARD_PACK_PAGES);
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  /** The pack reads a closed period's snapshot; the picker only offers periods that have one. */
  private readonly periodList = resource({
    params: () => ({ fiscalYearId: this.currentFiscalYearId() }),
    loader: ({ params }) =>
      params.fiscalYearId
        ? data(this.api.listClosePeriods({ query: { fiscalYearId: params.fiscalYearId } }))
        : Promise.resolve({ items: [] }),
  });
  protected readonly closedPeriods = computed(() =>
    (valueOf(this.periodList)?.items ?? []).filter(
      (p) => p.status === 'closed' || p.status === 'locked',
    ),
  );

  protected readonly packRes = resource({
    params: () => ({
      fiscalPeriodId: this.draft() ? undefined : this.periodId() || undefined,
      draft: this.draft() ? ('true' as const) : undefined,
      constantCurrency: this.constantCurrency() ? ('true' as const) : ('false' as const),
      pages: this.pages().length === BOARD_PACK_PAGES.length ? undefined : this.pages().join(','),
    }),
    loader: ({ params }) => data(this.api.getBoardPack({ query: params })),
  });
  protected readonly pack = computed(() => valueOf(this.packRes));

  private readonly generationList = resource({
    loader: () => data(this.api.listBoardPackGenerations({})),
  });
  protected readonly generations = computed(() => valueOf(this.generationList)?.items ?? []);

  private currentFiscalYearId(): string | null {
    const years = this.session.me()?.fiscalYears ?? [];
    const today = new Date().toISOString().slice(0, 10);
    return (
      years.find((y) => y.startDate <= today && today <= y.endDate)?.id ??
      years[years.length - 1]?.id ??
      null
    );
  }

  protected title(page: BoardPackPageId): string {
    return PAGE_TITLES[page];
  }

  protected statusOf(g: BoardPackGeneration) {
    return GENERATION_STATUS[g.status];
  }

  protected isOn(page: BoardPackPageId): boolean {
    return this.pages().includes(page);
  }

  /** Keeps the pack's own page order, so toggling one page never reshuffles the rest. */
  protected togglePage(page: BoardPackPageId, on: boolean): void {
    const next = BOARD_PACK_PAGES.filter((p) => (p === page ? on : this.pages().includes(p)));
    if (next.length) this.pages.set(next);
  }

  /** Queueing answers 202; the worker renders, so the screen polls until the pack settles. */
  protected async generate(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      const queued = await data(
        this.api.createBoardPackGeneration({
          body: {
            fiscalPeriodId: this.draft() ? undefined : this.periodId() || undefined,
            draft: this.draft(),
            constantCurrency: this.constantCurrency(),
            pages: [...this.pages()],
            formats: ['pdf', 'xlsx'],
          },
        }),
      );
      this.generationList.reload();
      await this.poll(queued.id);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  private async poll(generationId: string): Promise<void> {
    for (let i = 0; i < POLL_LIMIT; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const g = await data(this.api.getBoardPackGeneration({ params: { generationId } }));
      if (g.status !== 'queued' && g.status !== 'running') {
        this.generationList.reload();
        if (g.status === 'failed')
          this.failure.set(g.error ?? 'The pack could not be rendered. Try generating it again.');
        return;
      }
    }
    this.generationList.reload();
    this.failure.set(
      'The pack is still rendering. It will appear in the list below when the worker finishes.',
    );
  }

  /**
   * The signed URL lasts five minutes, so it is fetched when the reader asks rather than held on a
   * button that would quietly stop working. An expired pack answers 409 and says to generate again.
   */
  protected async download(g: BoardPackGeneration, format: 'pdf' | 'xlsx'): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      const link = await data(
        this.api.downloadBoardPack({ params: { generationId: g.id }, query: { format } }),
      );
      window.open(link.url, '_blank', 'noopener');
    } catch (e) {
      this.failure.set(errorMessage(e));
      this.generationList.reload();
    } finally {
      this.busy.set(false);
    }
  }
}
