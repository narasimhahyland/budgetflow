import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  resource,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CofundingBoard } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateOnlyPipe, DateTimePipe, formatMoney, LoadState, Money, SpendStatus } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_INTERACTIVE_CARD_IMPORTS } from '@hylandsoftware/satori-ui/interactive-card';
import { SatCategoryTag, SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { initials, label } from './labels';
import { toMajor } from './money-input';

type BoardEvent = CofundingBoard['events'][number];
const POLL_MS = 15_000;

const csvCell = (v: string) => (/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""');

/** Screen 46a: live co-funding per shared event; contributors see each other's amounts, never balances. */
@Component({
  selector: 'bf-cofunding-board-page',
  imports: [
    DateOnlyPipe,
    DateTimePipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_INTERACTIVE_CARD_IMPORTS,
    SatAvatar,
    SatCategoryTag,
    SatStatusTag,
    SpendStatus,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <div class="bf-title-row">
          <h1 class="bf-page__title">Co-funding board</h1>
          <sat-status-tag [status]="stale() ? 'info' : 'success'"
            ><mat-icon [svgIcon]="stale() ? 'pause' : 'sync'" aria-hidden="true" />{{
              stale() ? 'Live updates paused' : 'Live'
            }}
            · updated
            <span data-testid="relative-time">{{
              updatedAt() | bfDateTime: session.timezone() : 'HH:mm:ss'
            }}</span></sat-status-tag
          >
        </div>
        <p class="bf-page__subtitle">
          Inter-Director Budget Contribution Requests and shared event funding
        </p>
      </div>
      <div class="bf-page__actions">
        <button mat-stroked-button type="button" [matMenuTriggerFor]="exportMenu">
          <mat-icon svgIcon="download" />Export
        </button>
        <mat-menu #exportMenu="matMenu">
          <button mat-menu-item type="button" (click)="exportCsv()">CSV</button>
          <button mat-menu-item type="button" (click)="print()">PDF (print)</button>
        </mat-menu>
        @if (selected()) {
          <a mat-flat-button [routerLink]="['/events', selected()!.id]"
            ><mat-icon svgIcon="send" />Request contribution</a
          >
        }
      </div>
    </header>
    @if (stale()) {
      <sat-banner variant="info"
        ><sat-banner-message
          >Live updates paused.
          <button mat-button type="button" (click)="board.reload()">
            Retry
          </button></sat-banner-message
        ></sat-banner
      >
    }
    <bf-load-state
      [loading]="board.isLoading() && !board.hasValue()"
      [error]="board.hasValue() ? undefined : board.error()"
      what="the co-funding board"
      (retry)="board.reload()"
    />
    @if (board.hasValue()) {
      @if (events().length === 0) {
        <sat-empty-state>
          <h2 satEmptyStateHeadline>No events are being co-funded</h2>
          <p satEmptyStateDescription>
            Events you organize or fund appear here once a contribution is requested.
          </p>
          <a mat-stroked-button satEmptyStateAction routerLink="/events">Go to events</a>
        </sat-empty-state>
      } @else {
        <div class="bf-split">
          <section aria-label="Shared events" class="bf-board__events">
            @for (ev of events(); track ev.id) {
              <button
                sat-interactive-card
                type="button"
                surface="container-lowest"
                [active]="selected()?.id === ev.id"
                [attr.aria-pressed]="selected()?.id === ev.id"
                (click)="select(ev.id)"
              >
                <span satInteractiveCardTitle>{{ ev.name }}</span>
                <span satInteractiveCardSubtitle
                  >{{ ev.eventCode }} · {{ ev.startsAt | bfDate: session.timezone() }}</span
                >
                <sat-interactive-card-content>
                  <span class="bf-board__card">
                    <span class="bf-list__row">
                      @if (ev.fullyFunded) {
                        <bf-spend-status kind="event" status="funded" />
                      } @else if (pendingCount(ev)) {
                        <sat-status-tag status="warning"
                          ><mat-icon svgIcon="clock" aria-hidden="true" />{{
                            pendingCount(ev)
                          }}
                          pending</sat-status-tag
                        >
                      } @else {
                        <span></span>
                      }
                      <span
                        ><span class="bf-cell__secondary">Estimate</span>
                        <bf-money
                          [amountMinor]="ev.estimate.amountMinor"
                          [currency]="ev.estimate.currency"
                      /></span>
                    </span>
                    <span class="bf-progress" aria-hidden="true">
                      <span
                        class="bf-progress__fill"
                        [style.width.%]="pct(ev.ownFunds.amountMinor, ev.estimate.amountMinor)"
                      ></span>
                      <span
                        class="bf-progress__fill bf-progress__fill--approved"
                        [style.width.%]="pct(ev.approved.amountMinor, ev.estimate.amountMinor)"
                      ></span>
                      <span
                        class="bf-progress__fill bf-progress__fill--pending"
                        [style.width.%]="pct(ev.pending.amountMinor, ev.estimate.amountMinor)"
                      ></span>
                    </span>
                    <span class="bf-cell__secondary"
                      >{{ fundedPct(ev) }}% funded
                      @if (ev.gap.amountMinor > 0) {
                        · gap
                        <bf-money [amountMinor]="ev.gap.amountMinor" [currency]="ev.gap.currency" />
                      }
                    </span>
                  </span>
                </sat-interactive-card-content>
              </button>
            }
          </section>
          @if (selected(); as ev) {
            <section class="bf-card" aria-labelledby="board-title">
              <div class="bf-card__header">
                <h2 class="bf-card__title" id="board-title">{{ ev.name }}: funding breakdown</h2>
                <a mat-button [routerLink]="['/events', ev.id]"
                  >Open event<mat-icon svgIcon="arrow_right" iconPositionEnd
                /></a>
              </div>
              <div class="bf-kpis bf-board__kpis bf-section">
                <div class="bf-kpi">
                  <div class="bf-kpi__head">
                    <p class="bf-kpi__label">Estimate</p>
                    <mat-icon class="bf-kpi__icon" svgIcon="currency_dollar" aria-hidden="true" />
                  </div>
                  <p class="bf-kpi__value">
                    <bf-money
                      [amountMinor]="ev.estimate.amountMinor"
                      [currency]="ev.estimate.currency"
                    />
                  </p>
                </div>
                <div class="bf-kpi bf-kpi--success">
                  <div class="bf-kpi__head">
                    <p class="bf-kpi__label">Approved</p>
                    <mat-icon class="bf-kpi__icon" svgIcon="circle_check" aria-hidden="true" />
                  </div>
                  <p class="bf-kpi__value bf-kpi__value--success">
                    <bf-money
                      [amountMinor]="ev.ownFunds.amountMinor + ev.approved.amountMinor"
                      [currency]="ev.cap.currency"
                    />
                  </p>
                  <div class="bf-kpi__foot">
                    <span>Of the estimate</span>
                    <span class="bf-kpi__pct">{{ fundedPct(ev) }}%</span>
                    <span class="bf-kpi__track"
                      ><span class="bf-kpi__fill" [style.width.%]="fundedPct(ev)"></span
                    ></span>
                  </div>
                </div>
                <div class="bf-kpi bf-kpi--warning">
                  <div class="bf-kpi__head">
                    <p class="bf-kpi__label">Pending</p>
                    <mat-icon class="bf-kpi__icon" svgIcon="clock" aria-hidden="true" />
                  </div>
                  <p class="bf-kpi__value bf-kpi__value--warning">
                    <bf-money [amountMinor]="ev.pending.amountMinor" [currency]="ev.cap.currency" />
                  </p>
                  <p class="bf-kpi__delta">
                    {{ pendingCount(ev) }} request{{ pendingCount(ev) === 1 ? '' : 's' }} waiting
                    for a decision
                  </p>
                </div>
                <div
                  class="bf-kpi"
                  [class.bf-kpi--warning]="ev.gap.amountMinor > 0"
                  [class.bf-kpi--success]="ev.gap.amountMinor <= 0"
                >
                  <div class="bf-kpi__head">
                    <p class="bf-kpi__label">Funding gap</p>
                    <mat-icon
                      class="bf-kpi__icon"
                      [svgIcon]="ev.gap.amountMinor > 0 ? 'critical' : 'circle_check'"
                      aria-hidden="true"
                    />
                  </div>
                  <p class="bf-kpi__value" [class.bf-kpi__value--warning]="ev.gap.amountMinor > 0">
                    <bf-money [amountMinor]="ev.gap.amountMinor" [currency]="ev.gap.currency" />
                  </p>
                </div>
              </div>
              <div class="bf-section">
                <h3 class="bf-section__title">Stacked funding towards the estimate</h3>
                <div
                  class="bf-progress bf-board__stack"
                  role="img"
                  [attr.aria-label]="stackLabel(ev)"
                >
                  <span
                    class="bf-progress__fill"
                    [style.width.%]="pct(ev.ownFunds.amountMinor, ev.estimate.amountMinor)"
                  ></span>
                  <span
                    class="bf-progress__fill bf-progress__fill--approved"
                    [style.width.%]="pct(ev.approved.amountMinor, ev.estimate.amountMinor)"
                  ></span>
                  <span
                    class="bf-progress__fill bf-progress__fill--pending"
                    [style.width.%]="pct(ev.pending.amountMinor, ev.estimate.amountMinor)"
                  ></span>
                </div>
                <ul class="bf-board__legend">
                  <li>
                    <span class="bf-board__swatch bf-progress__fill" aria-hidden="true"></span>Own
                    funds
                    <bf-money
                      [amountMinor]="ev.ownFunds.amountMinor"
                      [currency]="ev.ownFunds.currency"
                    />
                  </li>
                  <li>
                    <span
                      class="bf-board__swatch bf-progress__fill bf-progress__fill--approved"
                      aria-hidden="true"
                    ></span
                    >Approved contributions
                    <bf-money
                      [amountMinor]="ev.approved.amountMinor"
                      [currency]="ev.approved.currency"
                    />
                  </li>
                  <li>
                    <span
                      class="bf-board__swatch bf-progress__fill bf-progress__fill--pending"
                      aria-hidden="true"
                    ></span
                    >Pending
                    <bf-money
                      [amountMinor]="ev.pending.amountMinor"
                      [currency]="ev.pending.currency"
                    />
                  </li>
                </ul>
              </div>
              <div class="bf-table-scroll">
                <table class="bf-split-table bf-table--stack" aria-label="Contributions ledger">
                  <thead>
                    <tr>
                      <th>Source budget</th>
                      <th>Owner</th>
                      <th>Mode</th>
                      <th class="bf-num">Requested</th>
                      <th class="bf-num">Approved</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <span class="bf-cell__primary">Own funds</span
                        ><span class="bf-cell__secondary">Home budget</span>
                      </td>
                      <td data-label="Owner">—</td>
                      <td data-label="Mode">—</td>
                      <td class="bf-num" data-label="Requested">—</td>
                      <td class="bf-num" data-label="Approved">
                        <bf-money
                          class="bf-amount--approved"
                          [amountMinor]="ev.ownFunds.amountMinor"
                          [currency]="ev.ownFunds.currency"
                        />
                      </td>
                      <td data-label="Status">
                        <sat-category-tag category="purple">Home budget</sat-category-tag>
                      </td>
                    </tr>
                    @for (c of ev.contributions; track c.id) {
                      <tr>
                        <td>
                          <a class="bf-cell__primary" [routerLink]="['/contributions', c.id]">{{
                            c.giverBudgetName
                          }}</a
                          ><span class="bf-cell__secondary">{{ c.ref }}</span>
                        </td>
                        <td data-label="Owner">
                          @if (c.giverOwnerName) {
                            <span class="bf-cell__owner"
                              ><sat-avatar size="28" [initials]="initials(c.giverOwnerName)" />{{
                                c.giverOwnerName
                              }}</span
                            >
                          } @else {
                            —
                          }
                        </td>
                        <td data-label="Mode">{{ label(c.mode) }}</td>
                        <td class="bf-num" data-label="Requested">
                          <bf-money
                            [class.bf-amount--struck]="isPartial(c)"
                            [amountMinor]="c.requested.amountMinor"
                            [currency]="c.requested.currency"
                          />
                        </td>
                        <td class="bf-num" data-label="Approved">
                          @if (c.approved) {
                            <bf-money
                              class="bf-amount--approved"
                              [amountMinor]="c.approved.amountMinor"
                              [currency]="c.approved.currency"
                            />
                          } @else {
                            —
                          }
                        </td>
                        <td data-label="Status">
                          <bf-spend-status kind="contribution" [status]="c.status" />
                          @if (isPartial(c)) {
                            <span class="bf-cell__secondary">Approved in part</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">Total</th>
                      <td></td>
                      <td></td>
                      <td class="bf-num" data-label="Pending">
                        <bf-money
                          class="bf-amount--pending"
                          [amountMinor]="ev.pending.amountMinor"
                          [currency]="ev.pending.currency"
                        />
                        <span class="bf-cell__secondary">pending</span>
                      </td>
                      <td class="bf-num" data-label="Approved">
                        <bf-money
                          class="bf-amount--approved"
                          [amountMinor]="ev.ownFunds.amountMinor + ev.approved.amountMinor"
                          [currency]="ev.cap.currency"
                        />
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div class="bf-section">
                <h3 class="bf-section__title">Live activity</h3>
                <ol class="bf-timeline">
                  @for (a of ev.activity; track $index) {
                    <li>
                      <span class="bf-cell__primary">{{ a.text }}</span
                      ><span class="bf-cell__secondary" data-testid="relative-time">{{
                        a.at | bfDateTime: session.timezone()
                      }}</span>
                    </li>
                  } @empty {
                    <li class="bf-board__none">No decisions yet.</li>
                  }
                </ol>
              </div>
            </section>
          }
        </div>
      }
    }
  `,
  styles: `
    .bf-board__events {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bf-board__card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
    }
    .bf-board__kpis {
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    }
    .bf-board__stack {
      height: 16px;
    }
    /* Pending money is hatched warning so it never reads as approved (docs/ux/screens/043). */
    .bf-progress__fill--pending {
      background: repeating-linear-gradient(
        135deg,
        var(--sat-sys-warning-icon) 0 4px,
        var(--sat-sys-warning-container) 4px 7px
      );
    }
    .bf-board__legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      margin: 8px 0 0;
      padding: 0;
      list-style: none;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-board__legend li {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .bf-board__swatch {
      width: 10px;
      height: 10px;
      border-radius: var(--mat-sys-corner-extra-small);
    }
    .bf-amount--struck {
      color: var(--mat-sys-on-surface-variant);
      text-decoration: line-through;
    }
    .bf-board__none {
      border-inline-start: 0;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CofundingBoardPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);
  private readonly picked = signal<string | null>(this.route.snapshot.queryParamMap.get('event'));

  protected readonly board = resource({ loader: () => data(this.api.getCofundingBoard({})) });
  protected readonly events = computed(() => valueOf(this.board)?.events ?? []);
  protected readonly selected = computed(
    () => this.events().find((e) => e.id === this.picked()) ?? this.events().at(0) ?? null,
  );
  protected readonly updatedAt = computed(() => valueOf(this.board)?.generatedAt ?? null);
  protected readonly stale = computed(() => Boolean(this.board.error()) && this.board.hasValue());

  constructor() {
    const timer = setInterval(() => this.board.reload(), POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected select(id: string): void {
    this.picked.set(id);
    void this.router.navigate([], { queryParams: { event: id }, replaceUrl: true });
  }

  protected pct(part: number, whole: number): number {
    return whole <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((part * 100) / whole)));
  }

  protected readonly label = label;
  protected readonly initials = initials;

  protected fundedPct(ev: BoardEvent): number {
    return this.pct(ev.ownFunds.amountMinor + ev.approved.amountMinor, ev.estimate.amountMinor);
  }

  /** An approved amount below what was asked: the giving director approved part of it. */
  protected isPartial(c: BoardEvent['contributions'][number]): boolean {
    return !!c.approved && c.approved.amountMinor < c.requested.amountMinor;
  }

  protected pendingCount(ev: BoardEvent): number {
    return ev.contributions.filter(
      (c) => c.status === 'pending_approval' || c.status === 'submitted',
    ).length;
  }

  protected money(m: { amountMinor: number; currency: string }): string {
    return formatMoney(m.amountMinor, m.currency);
  }

  protected stackLabel(ev: BoardEvent): string {
    return `Own funds ${this.money(ev.ownFunds)}, approved ${this.money(ev.approved)}, pending ${this.money(ev.pending)} of ${this.money(ev.estimate)}`;
  }

  protected exportCsv(): void {
    const rows = [
      [
        'Event',
        'Request',
        'Source budget',
        'Owner',
        'Mode',
        'Requested',
        'Approved',
        'Currency',
        'Status',
      ],
    ];
    for (const ev of this.events())
      for (const c of ev.contributions)
        rows.push([
          ev.name,
          c.ref,
          c.giverBudgetName,
          c.giverOwnerName ?? '',
          c.mode,
          toMajor(c.requested.amountMinor, c.requested.currency),
          c.approved ? toMajor(c.approved.amountMinor, c.approved.currency) : '',
          c.requested.currency,
          c.status,
        ]);
    const csv = rows.map((r) => r.map((v) => `"${csvCell(v)}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'co-funding-board.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  protected print(): void {
    window.print();
  }
}
