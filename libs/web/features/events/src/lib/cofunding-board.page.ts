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
import { DateOnlyPipe, DateTimePipe, formatMoney, Money, SpendStatus } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

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
    SpendStatus,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <div class="bf-title-row">
          <h1 class="bf-page__title">Co-funding board</h1>
          <span class="bf-chip" [class.bf-chip--stale]="stale()"
            >{{ stale() ? 'Live updates paused' : 'Live' }} · updated
            <span data-testid="relative-time">{{
              updatedAt() | bfDateTime: session.timezone() : 'HH:mm:ss'
            }}</span></span
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
          <a mat-stroked-button routerLink="/events">Go to events</a>
        </sat-empty-state>
      } @else {
        <div class="bf-split">
          <section aria-label="Shared events" class="bf-board__events">
            @for (ev of events(); track ev.id) {
              <button
                type="button"
                class="bf-option"
                [class.bf-option--selected]="selected()?.id === ev.id"
                (click)="select(ev.id)"
              >
                <span class="bf-list__row"
                  ><span class="bf-option__title">{{ ev.name }}</span>
                  @if (ev.fullyFunded) {
                    <bf-spend-status kind="event" status="funded" />
                  } @else if (pendingCount(ev)) {
                    <span class="bf-chip">{{ pendingCount(ev) }} pending</span>
                  }
                </span>
                <span class="bf-cell__secondary"
                  >{{ ev.eventCode }} · {{ ev.startsAt | bfDate: session.timezone() }}</span
                >
                <span class="bf-list__row"
                  ><span>Estimate</span
                  ><bf-money
                    [amountMinor]="ev.estimate.amountMinor"
                    [currency]="ev.estimate.currency"
                /></span>
                <span class="bf-progress">
                  <span
                    class="bf-progress__fill bf-progress__fill--approved"
                    [style.width.%]="
                      pct(
                        ev.ownFunds.amountMinor + ev.approved.amountMinor,
                        ev.estimate.amountMinor
                      )
                    "
                  ></span>
                  <span
                    class="bf-progress__fill bf-progress__fill--pending"
                    [style.width.%]="pct(ev.pending.amountMinor, ev.estimate.amountMinor)"
                  ></span>
                </span>
                <span class="bf-cell__secondary"
                  >{{
                    pct(ev.ownFunds.amountMinor + ev.approved.amountMinor, ev.estimate.amountMinor)
                  }}% funded · gap {{ money(ev.gap) }}</span
                >
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
              <div class="bf-kpis bf-section">
                <div class="bf-kpi">
                  <p class="bf-kpi__label">Estimate</p>
                  <p class="bf-kpi__value">
                    <bf-money
                      [amountMinor]="ev.estimate.amountMinor"
                      [currency]="ev.estimate.currency"
                    />
                  </p>
                </div>
                <div class="bf-kpi">
                  <p class="bf-kpi__label">Approved</p>
                  <p class="bf-kpi__value bf-amount--approved">
                    <bf-money
                      [amountMinor]="ev.ownFunds.amountMinor + ev.approved.amountMinor"
                      [currency]="ev.cap.currency"
                    />
                  </p>
                </div>
                <div class="bf-kpi">
                  <p class="bf-kpi__label">Pending</p>
                  <p class="bf-kpi__value bf-amount--pending">
                    <bf-money [amountMinor]="ev.pending.amountMinor" [currency]="ev.cap.currency" />
                  </p>
                </div>
                <div class="bf-kpi">
                  <p class="bf-kpi__label">Funding gap</p>
                  <p class="bf-kpi__value">
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
                <p class="bf-cell__secondary">
                  Own funds {{ money(ev.ownFunds) }} · approved contributions
                  {{ money(ev.approved) }} · pending {{ money(ev.pending) }}
                </p>
              </div>
              <div class="bf-table-scroll">
                <table class="bf-split-table" aria-label="Contributions ledger">
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
                    @for (c of ev.contributions; track c.id) {
                      <tr>
                        <td>
                          <a [routerLink]="['/contributions', c.id]">{{ c.giverBudgetName }}</a
                          ><span class="bf-cell__secondary">{{ c.ref }}</span>
                        </td>
                        <td>{{ c.giverOwnerName ?? '—' }}</td>
                        <td>
                          <span class="bf-chip">{{
                            c.mode === 'earmark' ? 'Earmark' : 'Transfer'
                          }}</span>
                        </td>
                        <td class="bf-num">
                          <bf-money
                            [amountMinor]="c.requested.amountMinor"
                            [currency]="c.requested.currency"
                          />
                        </td>
                        <td class="bf-num">
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
                        <td><bf-spend-status kind="contribution" [status]="c.status" /></td>
                      </tr>
                    }
                  </tbody>
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
                    <li class="bf-cell__secondary">No decisions yet.</li>
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
    .bf-board__stack {
      height: 16px;
    }
    .bf-chip--stale {
      background: var(--sat-sys-info-container);
      color: var(--sat-sys-on-info-container);
    }
  `,
  styleUrl: './page.scss',
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
    () => this.events().find((e) => e.id === this.picked()) ?? this.events()[0] ?? null,
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
          String(c.requested.amountMinor / 100),
          c.approved ? String(c.approved.amountMinor / 100) : '',
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
