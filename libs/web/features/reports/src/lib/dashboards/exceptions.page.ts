import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CONTROL_EXCEPTION_TYPES, type ControlExceptionType } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from '../api';

/**
 * Screen 017a: every control exception by type and age, with the queue that works it. The
 * dashboard aggregates and links; nothing is resolved here. Ledger integrity flags are pinned at
 * the top in the error tone.
 */
@Component({
  selector: 'bf-exceptions-dashboard-page',
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
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Exceptions</h1>
        <p class="bf-page__subtitle">
          Control exceptions by type and age, each worked in its own queue.
          @if (overview(); as o) {
            {{ o.fiscalYearLabel ?? 'This year' }} to date, as of
            <span data-testid="relative-time">{{
              o.generatedAt | bfDateTime: session.timezone()
            }}</span>
          }
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/dashboards/finance"
          ><mat-icon svgIcon="bar_chart" />Finance overview</a
        >
      </div>
    </header>

    <bf-load-state
      [loading]="exceptions.isLoading() && !exceptions.hasValue()"
      [error]="exceptions.error()"
      what="exceptions"
      shape="table"
      (retry)="exceptions.reload()"
    />

    @if (overview(); as o) {
      @if (o.integrityFlagOpen) {
        <sat-banner variant="important" data-testid="integrity-banner">
          <sat-banner-message>Ledger integrity flag open.</sat-banner-message>
          <a satBannerAction mat-button routerLink="." [queryParams]="{ type: 'ledger_integrity' }"
            >See the flags</a
          >
        </sat-banner>
      }
      @if (o.withheld.length) {
        <sat-banner variant="info">
          <sat-banner-message
            >Exceptions raised as integrity flags (splits, duplicates, thresholds, ledger) are shown
            to roles that read integrity.</sat-banner-message
          >
        </sat-banner>
      }

      <div class="bf-kpis" data-testid="exception-kpis">
        <div class="bf-kpi bf-kpi--warning">
          <div class="bf-kpi__head"><p class="bf-kpi__label">Open exceptions</p></div>
          <p class="bf-kpi__value" data-testid="kpi-open">{{ o.kpis.open | number }}</p>
          <p class="bf-kpi__delta">Plus {{ o.kpis.informational | number }} informational</p>
        </div>
        <div class="bf-kpi bf-kpi--important">
          <div class="bf-kpi__head"><p class="bf-kpi__label">Older than 14 days</p></div>
          <p class="bf-kpi__value" data-testid="kpi-old">{{ o.kpis.olderThan14Days | number }}</p>
        </div>
        <div class="bf-kpi bf-kpi--success">
          <div class="bf-kpi__head"><p class="bf-kpi__label">Resolved this month</p></div>
          <p class="bf-kpi__value">{{ o.kpis.resolvedThisMonth | number }}</p>
        </div>
        <div class="bf-kpi">
          <div class="bf-kpi__head"><p class="bf-kpi__label">At stake in open exceptions</p></div>
          <p class="bf-kpi__value" data-testid="kpi-stake">
            <bf-money
              [amountMinor]="o.kpis.atStake.amountMinor"
              [currency]="o.kpis.atStake.currency"
            />
          </p>
        </div>
      </div>

      <section class="bf-card" aria-labelledby="by-type-title">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="by-type-title">By type</h2>
            <p class="bf-card__hint">
              Select a type to list its items. Informational rows are counts for audit sampling, not
              work items.
            </p>
          </div>
        </div>
        @if (o.kpis.open === 0 && o.kpis.informational === 0) {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>No open exceptions</h3>
            <p satEmptyStateDescription>Every control exception has been worked in its queue.</p>
          </sat-empty-state>
        }
        <div class="bf-table-scroll">
          <table class="bf-split-table" aria-label="Exceptions by type">
            <thead>
              <tr>
                <th>Type</th>
                <th class="bf-hide-narrow">Source</th>
                <th class="bf-num">Open</th>
                <th class="bf-num">Oldest</th>
                <th class="bf-num">At stake</th>
                <th>Queue</th>
              </tr>
            </thead>
            <tbody>
              @for (t of o.types; track t.type) {
                <tr
                  [class.bf-row--selected]="t.type === type()"
                  [class.bf-row--error]="t.type === 'ledger_integrity' && t.open > 0"
                  [attr.data-testid]="'type-' + t.type"
                >
                  <td>
                    @if (t.informational) {
                      <span class="bf-cell__primary">{{ t.label }}</span>
                      <sat-status-tag status="neutral">Informational</sat-status-tag>
                    } @else {
                      <a
                        class="bf-cell__primary"
                        routerLink="."
                        [queryParams]="{ type: t.type === type() ? null : t.type }"
                        >{{ t.label }}</a
                      >
                    }
                  </td>
                  <td class="bf-hide-narrow">
                    <span class="bf-cell__secondary">{{ t.source }}</span>
                  </td>
                  <td class="bf-num">{{ t.open | number }}</td>
                  <td class="bf-num">
                    {{ t.oldestDays === null ? '—' : (t.oldestDays | number) + ' days' }}
                  </td>
                  <td class="bf-num">
                    @if (t.atStake) {
                      <bf-money
                        [amountMinor]="t.atStake.amountMinor"
                        [currency]="t.atStake.currency"
                      />
                    } @else {
                      {{ t.informational ? 'Informational' : '—' }}
                    }
                  </td>
                  <td>
                    <a [routerLink]="t.queue.link">{{ t.queue.label }}</a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      @if (type(); as selected) {
        <section class="bf-card" aria-labelledby="items-title" data-testid="type-items">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="items-title">{{ typeLabel(selected) }}: open items</h2>
          </div>
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Open items of the selected type">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>What</th>
                  <th>Location</th>
                  <th class="bf-num">Age</th>
                  <th class="bf-num">At stake</th>
                </tr>
              </thead>
              <tbody>
                @for (i of o.items; track i.id) {
                  <tr>
                    <td>
                      <a [routerLink]="i.link">{{ i.reference }}</a>
                    </td>
                    <td>{{ i.summary }}</td>
                    <td>{{ i.location ?? '—' }}</td>
                    <td class="bf-num">{{ i.ageDays | number }} days</td>
                    <td class="bf-num">
                      @if (i.atStake) {
                        <bf-money
                          [amountMinor]="i.atStake.amountMinor"
                          [currency]="i.atStake.currency"
                        />
                      } @else {
                        —
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="bf-empty">Nothing open of this type.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      <div class="bf-dash-grid">
        <section class="bf-card" aria-labelledby="aging-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="aging-title">Aging</h2>
          </div>
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Open exceptions by age band">
              <thead>
                <tr>
                  <th>Type</th>
                  <th class="bf-num">0–7 days</th>
                  <th class="bf-num">8–30</th>
                  <th class="bf-num">31–60</th>
                  <th class="bf-num">60+</th>
                </tr>
              </thead>
              <tbody>
                @for (t of workTypes(); track t.type) {
                  <tr>
                    <td>{{ t.label }}</td>
                    <td class="bf-num">{{ t.bands.d0to7 }}</td>
                    <td class="bf-num">{{ t.bands.d8to30 }}</td>
                    <td class="bf-num">{{ t.bands.d31to60 }}</td>
                    <td class="bf-num">{{ t.bands.over60 }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="bf-card" aria-labelledby="trend-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="trend-title">Opened and resolved by week</h2>
          </div>
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Exceptions opened and resolved by week">
              <thead>
                <tr>
                  <th>Week of</th>
                  <th class="bf-num">Opened</th>
                  <th class="bf-num">Resolved</th>
                </tr>
              </thead>
              <tbody>
                @for (w of o.trend; track w.weekStart) {
                  <tr>
                    <td>{{ w.weekStart | date: 'd MMM' }}</td>
                    <td class="bf-num">{{ w.opened }}</td>
                    <td class="bf-num">{{ w.resolved }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <section class="bf-card" aria-labelledby="location-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="location-title">By location</h2>
          </div>
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Open exceptions by location">
              <thead>
                <tr>
                  <th>Location</th>
                  <th class="bf-num">Open</th>
                  <th class="bf-num">At stake</th>
                </tr>
              </thead>
              <tbody>
                @for (l of o.byLocation; track l.location) {
                  <tr>
                    <td>{{ l.location }}</td>
                    <td class="bf-num">{{ l.open }}</td>
                    <td class="bf-num">
                      <bf-money
                        [amountMinor]="l.atStake.amountMinor"
                        [currency]="l.atStake.currency"
                      />
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="3" class="bf-empty">No open exceptions.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      </div>
    }
  `,
  styles: `
    .bf-dash-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
    }
    .bf-row--selected td {
      background: var(--mat-sys-surface-container);
    }
    .bf-row--error td {
      background: var(--mat-sys-error-container);
    }
    @media (max-width: 899px) {
      .bf-hide-narrow {
        display: none;
      }
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExceptionsDashboardPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  protected readonly session = inject(SessionStore);

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly type = computed<ControlExceptionType | null>(() => {
    const t = this.query().get('type');
    return t && (CONTROL_EXCEPTION_TYPES as readonly string[]).includes(t)
      ? (t as ControlExceptionType)
      : null;
  });

  protected readonly exceptions = resource({
    params: () => ({ type: this.type() }),
    loader: ({ params }) =>
      data(this.api.getExceptions({ query: params.type ? { type: params.type } : {} })),
  });
  protected readonly overview = computed(() => valueOf(this.exceptions));
  protected readonly workTypes = computed(
    () => this.overview()?.types.filter((t) => !t.informational) ?? [],
  );

  protected typeLabel(t: ControlExceptionType): string {
    return this.overview()?.types.find((x) => x.type === t)?.label ?? t;
  }
}
