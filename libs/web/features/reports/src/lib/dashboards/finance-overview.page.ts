import { DatePipe, DecimalPipe } from '@angular/common';
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
import { RouterLink } from '@angular/router';
import type { CloseCheck, FinanceOverview } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from '../api';

/** The close-status columns of 012, in the spec's order; each is one check of the period close. */
const CLOSE_COLUMNS: { code: string; label: string }[] = [
  { code: 'actuals_imported', label: 'Actuals imported' },
  { code: 'unmatched_actuals_cleared', label: 'Unmatched cleared' },
  { code: 'gl_tieout_signed_off', label: 'GL tie-out signed' },
  { code: 'accruals_reviewed', label: 'Accruals reviewed' },
];

const PERIOD_STATUS: Record<string, string> = {
  open: 'Open',
  soft_closed: 'Soft-closed',
  closed: 'Closed',
  locked: 'Locked',
};

/**
 * Screen 012: the finance controller's home. Whether the numbers can be trusted and whether the
 * month can close: close status per legal entity, the queues that block the close, the nightly
 * ledger check, feed freshness and the FX effect. Every figure is the API's.
 */
@Component({
  selector: 'bf-finance-overview-page',
  imports: [
    DatePipe,
    DateTimePipe,
    DecimalPipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Finance overview</h1>
        <p class="bf-page__subtitle">
          Whether the numbers can be trusted and whether the month can close.
          @if (overview(); as o) {
            In {{ o.currency }} as of
            <span data-testid="relative-time">{{
              o.generatedAt | bfDateTime: session.timezone()
            }}</span>
          }
        </p>
      </div>
      @if (overview()) {
        <div class="bf-page__actions">
          <a mat-stroked-button routerLink="/dashboards/exceptions">
            <mat-icon svgIcon="report_problem" />Exceptions
          </a>
          <a mat-flat-button routerLink="/finance/close">
            <mat-icon svgIcon="calendar" />Open period close
          </a>
        </div>
      }
    </header>

    <bf-load-state
      [loading]="finance.isLoading() && !finance.hasValue()"
      [error]="finance.error()"
      what="the finance overview"
      shape="cards"
      [lines]="3"
      (retry)="finance.reload()"
    />

    @if (overview(); as o) {
      @if (driftFlags(o) > 0) {
        <sat-banner variant="important" data-testid="drift-banner">
          <sat-banner-message
            >Ledger check found {{ driftFlags(o) }} open integrity
            {{ driftFlags(o) === 1 ? 'flag' : 'flags' }}: a cached balance differs from the rebuild
            or a journal does not balance.</sat-banner-message
          >
          <a
            satBannerAction
            mat-button
            routerLink="/dashboards/exceptions"
            [queryParams]="{ type: 'ledger_integrity' }"
            >See the integrity flags</a
          >
        </sat-banner>
      } @else if (o.allClear) {
        <sat-banner variant="success" data-testid="all-clear-banner">
          <sat-banner-message>Every entity is ready to close.</sat-banner-message>
          <a satBannerAction mat-button routerLink="/finance/close">Open period close</a>
        </sat-banner>
      }
      @for (feed of lateFeeds(o); track feed.source) {
        <sat-banner variant="warning">
          <sat-banner-message
            >{{ feed.label }} is {{ feed.lateByHours }} hours late.</sat-banner-message
          >
        </sat-banner>
      }

      <section class="bf-card" aria-labelledby="close-title" data-testid="close-status">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="close-title">Close status</h2>
            <p class="bf-card__hint">
              The period each entity is closing, with the checks the close runs.
            </p>
          </div>
        </div>
        <div class="bf-table-scroll">
          <table class="bf-split-table" aria-label="Close status by legal entity">
            <thead>
              <tr>
                <th>Entity</th>
                @for (c of columns; track c.code) {
                  <th>{{ c.label }}</th>
                }
                <th>Recharges</th>
                <th>Period</th>
              </tr>
            </thead>
            <tbody>
              @for (row of closeRows(o); track row.entity.legalEntityId) {
                <tr [attr.data-testid]="'close-row-' + row.entity.legalEntityCode">
                  <td>
                    <span class="bf-cell__primary">{{ row.entity.legalEntityCode }}</span>
                    <span class="bf-cell__secondary">{{ row.entity.legalEntityName }}</span>
                  </td>
                  @for (c of columns; track c.code) {
                    @let check = checkOf(row.entity.checks, c.code);
                    <td>
                      @if (check) {
                        <a
                          class="bf-check"
                          [class]="'bf-check bf-check--' + check.status"
                          [routerLink]="['/finance/close', row.period.id]"
                          [title]="check.detail"
                        >
                          <mat-icon [svgIcon]="checkIcon(check.status)" aria-hidden="true" />
                          <span>{{ checkWord(check.status) }}</span>
                        </a>
                        <span class="bf-cell__secondary">{{ check.detail }}</span>
                      } @else {
                        <span class="bf-cell__secondary">Not checked</span>
                      }
                    </td>
                  }
                  <td>
                    @let r = rechargeOf(o, row.entity.legalEntityId);
                    @if (!r) {
                      <span class="bf-cell__secondary">None needed</span>
                    } @else if (r.pendingTaxApproval) {
                      <a class="bf-check bf-check--warn" routerLink="/finance/recharges">
                        <mat-icon svgIcon="clock" aria-hidden="true" />
                        <span>{{ r.pendingTaxApproval }} awaiting tax approval</span>
                      </a>
                    } @else if (r.awaitingPosting) {
                      <a class="bf-check bf-check--warn" routerLink="/finance/recharges">
                        <mat-icon svgIcon="clock" aria-hidden="true" />
                        <span>{{ r.awaitingPosting }} to post</span>
                      </a>
                    } @else {
                      <span class="bf-check bf-check--pass">
                        <mat-icon svgIcon="circle_check" aria-hidden="true" /><span>Done</span>
                      </span>
                    }
                  </td>
                  <td>
                    <a [routerLink]="['/finance/close', row.period.id]" class="bf-cell__primary">{{
                      row.period.label
                    }}</a>
                    <sat-status-tag
                      class="bf-nowrap"
                      [status]="row.period.status === 'open' ? 'info' : 'neutral'"
                      >{{ periodStatus(row.period.status) }}</sat-status-tag
                    >
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="columns.length + 3" class="bf-empty">
                    No legal entity has a fiscal calendar yet.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="queues-title">
        <h2 class="bf-section__title" id="queues-title">Queues that block the close</h2>
        <div class="bf-tiles" data-testid="queue-tiles">
          @for (t of o.tiles; track t.key) {
            <a
              class="bf-tile"
              [class.bf-tile--busy]="t.count > 0"
              [routerLink]="t.link"
              [attr.aria-label]="t.label + ': ' + t.count"
              [attr.data-testid]="'tile-' + t.key"
            >
              <span class="bf-tile__label">{{ t.label }}</span>
              <span class="bf-tile__count">{{ t.count | number }}</span>
              @if (t.amount) {
                <span class="bf-tile__amount"
                  ><bf-money [amountMinor]="t.amount.amountMinor" [currency]="t.amount.currency"
                /></span>
              }
              <span class="bf-tile__detail">{{ t.detail }}</span>
            </a>
          }
        </div>
      </section>

      <div class="bf-dash-grid">
        <section class="bf-card" aria-labelledby="integrity-title" data-testid="integrity-card">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="integrity-title">Ledger integrity</h2>
          </div>
          <div class="bf-card__body">
            @if (o.integrity; as i) {
              @if (i.lastRun; as run) {
                <p class="bf-line">
                  <sat-status-tag
                    [status]="
                      run.status === 'clean'
                        ? 'success'
                        : run.status === 'drift_detected' || run.status === 'failed'
                          ? 'important'
                          : 'info'
                    "
                    >{{ runWord(run.status) }}</sat-status-tag
                  >
                  Ledger check
                  {{ run.finishedAt ?? run.requestedAt | bfDateTime: session.timezone() }}.
                  @if (run.budgetsChecked !== null && run.status === 'clean') {
                    Cached balances equal the rebuild for {{ run.budgetsChecked | number }} budgets.
                  }
                </p>
              } @else {
                <p class="bf-line">No ledger check has run yet.</p>
              }
              @if (i.auditChain; as chain) {
                <p class="bf-line">
                  @if (chain.valid) {
                    Audit chain verified to entry {{ chain.checked | number }}.
                  } @else {
                    <strong class="bf-error-text"
                      >Audit chain verification failed at entry
                      {{ chain.brokenAt | number }}.</strong
                    >
                  }
                </p>
              }
              <p class="bf-line">Open ledger integrity flags: {{ i.openLedgerFlags | number }}</p>
              @if (session.can('integrity.run')) {
                <div class="bf-form__actions">
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="running()"
                    (click)="runCheck()"
                  >
                    <mat-icon svgIcon="refresh" />Run check now
                  </button>
                </div>
              }
              @if (runMessage(); as m) {
                <p class="bf-line" role="status">{{ m }}</p>
              }
            } @else {
              <p class="bf-line">The ledger check result is shown to roles that read integrity.</p>
            }
          </div>
        </section>

        <section class="bf-card" aria-labelledby="feeds-title" data-testid="feeds-card">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="feeds-title">Feeds</h2>
          </div>
          <div class="bf-card__body">
            <ul class="bf-plain">
              @for (f of o.feeds; track f.source) {
                <li>
                  <strong>{{ f.label }}</strong>
                  @if (f.lastImportAt) {
                    last import {{ f.lastImportAt | bfDateTime: session.timezone() }}
                  } @else {
                    no import yet
                  }
                  @if (f.lateByHours !== null) {
                    <sat-status-tag status="warning">{{ f.lateByHours }} hours late</sat-status-tag>
                  } @else {
                    <sat-status-tag status="success">On time</sat-status-tag>
                  }
                </li>
              } @empty {
                <li>No actuals have been imported yet.</li>
              }
            </ul>
          </div>
        </section>

        <section class="bf-card" aria-labelledby="fx-title" data-testid="fx-card">
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title" id="fx-title">FX effect</h2>
              <p class="bf-card__hint">
                {{ o.fx.fiscalYearLabel ?? 'This year' }} to date. Not part of spend or available.
              </p>
            </div>
          </div>
          <div class="bf-card__body">
            <p class="bf-fx-total">
              <bf-money [amountMinor]="o.fx.total.amountMinor" [currency]="o.fx.total.currency" />
              <span class="bf-cell__secondary">{{ fxWord(o.fx.total.amountMinor) }}</span>
            </p>
            <ul class="bf-plain">
              @for (c of o.fx.byCurrency; track c.currency) {
                <li>
                  {{ c.currency }}:
                  <bf-money [amountMinor]="c.effect.amountMinor" [currency]="c.effect.currency" />
                </li>
              }
            </ul>
          </div>
        </section>
      </div>
    }
  `,
  styles: `
    .bf-check {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font: var(--mat-sys-label-large);
      text-decoration: none;
      white-space: nowrap;
    }
    .bf-check mat-icon {
      width: 18px;
      height: 18px;
    }
    .bf-check--pass {
      color: var(--sat-sys-on-success-container);
    }
    .bf-check--warn {
      color: var(--sat-sys-on-warning-container);
    }
    .bf-check--fail {
      color: var(--mat-sys-error);
    }
    .bf-tiles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 16px;
    }
    .bf-tile {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface);
      text-decoration: none;
    }
    .bf-tile--busy {
      border-color: var(--sat-sys-warning-icon);
    }
    .bf-tile__label {
      font: var(--mat-sys-label-large);
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-tile__count {
      font: var(--mat-sys-headline-small);
      font-variant-numeric: tabular-nums;
    }
    .bf-tile__amount {
      font: var(--mat-sys-title-small);
    }
    .bf-tile__detail {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-dash-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .bf-line {
      margin: 0 0 8px;
      font: var(--mat-sys-body-medium);
    }
    .bf-error-text {
      color: var(--mat-sys-error);
    }
    .bf-plain {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font: var(--mat-sys-body-medium);
    }
    .bf-nowrap {
      white-space: nowrap;
    }
    .bf-fx-total {
      margin: 0 0 8px;
      font: var(--mat-sys-title-large);
      display: flex;
      gap: 8px;
      align-items: baseline;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinanceOverviewPage {
  private readonly api = injectApi();
  protected readonly session = inject(SessionStore);
  protected readonly columns = CLOSE_COLUMNS;
  protected readonly running = signal(false);
  protected readonly runMessage = signal<string | null>(null);

  protected readonly finance = resource({
    loader: () => data(this.api.getFinanceOverview({})),
  });
  protected readonly overview = computed(() => valueOf(this.finance));

  protected closeRows(o: FinanceOverview) {
    return o.close.flatMap((c) => c.entities.map((entity) => ({ period: c.period, entity })));
  }

  protected checkOf(checks: readonly CloseCheck[], code: string): CloseCheck | undefined {
    return checks.find((c) => c.code === code);
  }

  protected rechargeOf(o: FinanceOverview, legalEntityId: string) {
    const r = o.recharges.find((x) => x.legalEntityId === legalEntityId);
    return r && r.pendingTaxApproval + r.awaitingPosting + r.posted > 0 ? r : null;
  }

  protected driftFlags(o: FinanceOverview): number {
    return o.integrity?.openLedgerFlags ?? 0;
  }

  protected lateFeeds(o: FinanceOverview) {
    return o.feeds.filter((f) => f.lateByHours !== null);
  }

  protected checkIcon(status: CloseCheck['status']): string {
    return status === 'pass' ? 'circle_check' : status === 'warn' ? 'report_problem' : 'circle_x';
  }

  protected checkWord(status: CloseCheck['status']): string {
    return status === 'pass' ? 'Done' : status === 'warn' ? 'Warning' : 'Blocking';
  }

  protected periodStatus(s: string): string {
    return PERIOD_STATUS[s] ?? s;
  }

  protected runWord(s: string): string {
    return s === 'clean'
      ? 'Clean'
      : s === 'drift_detected'
        ? 'Drift detected'
        : s === 'failed'
          ? 'Failed'
          : s === 'running'
            ? 'Running'
            : 'Queued';
  }

  protected fxWord(minor: number): string {
    return minor < 0 ? 'Favourable' : minor > 0 ? 'Unfavourable' : 'No effect';
  }

  protected async runCheck(): Promise<void> {
    this.running.set(true);
    this.runMessage.set(null);
    try {
      await data(this.api.requestLedgerCheck({}));
      this.runMessage.set('Ledger check queued. The result appears here when it finishes.');
      this.finance.reload();
    } catch (e) {
      this.runMessage.set(errorMessage(e));
    } finally {
      this.running.set(false);
    }
  }
}
