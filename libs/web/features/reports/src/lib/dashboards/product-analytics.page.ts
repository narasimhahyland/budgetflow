import { DatePipe, formatNumber } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router } from '@angular/router';
import type { ProductAnalytics } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from '../api';

type Kpi = ProductAnalytics['kpis'][number];

const LABELS: Record<string, string> = {
  web: 'Web',
  email: 'Email',
  slack: 'Slack',
  teams: 'Teams',
  mobile: 'Mobile',
  push: 'Push',
  file: 'File upload',
  card: 'Card feed',
  expense: 'Expense feed',
  erp: 'ERP feed',
  travel: 'Travel feed',
  ap: 'Accounts payable',
  manual: 'Manual',
};

const STATUS_TEXT: Record<Kpi['status'], string> = {
  on_target: 'On target',
  below_target: 'Below target',
  no_target: 'No target',
  insufficient: 'Not enough data yet',
};

/**
 * Screen 018b: whether BudgetFlow works as a product, against the agreed targets. Built from the
 * analytics events (counts and flags only) and the ledger's unused share; nothing drills down to a
 * person.
 */
@Component({
  selector: 'bf-product-analytics-page',
  imports: [
    DatePipe,
    DateTimePipe,
    FormsModule,
    LoadState,
    MatFormFieldModule,
    MatSelectModule,
    SAT_BANNER_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Product analytics</h1>
        <p class="bf-page__subtitle">
          Activation, activity, time to approve and auto-matching against the agreed targets.
          @if (view(); as v) {
            {{ v.from | date: 'd MMM y' : 'UTC' }} to {{ v.to | date: 'd MMM y' : 'UTC' }}, as of
            <span data-testid="relative-time">{{
              v.generatedAt | bfDateTime: session.timezone()
            }}</span>
          }
        </p>
      </div>
    </header>

    <section class="bf-card" aria-labelledby="pa-filters-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="pa-filters-title">Period</h2>
      </div>
      <div class="bf-filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Period</mat-label>
          <mat-select [ngModel]="period()" (ngModelChange)="setPeriod($event)">
            <mat-option value="30">Last 30 days</mat-option>
            <mat-option value="90">Last 90 days</mat-option>
            <mat-option value="fy">Fiscal year</mat-option>
          </mat-select>
        </mat-form-field>
      </div>
    </section>

    <bf-load-state
      [loading]="analytics.isLoading() && !analytics.hasValue()"
      [error]="analytics.error()"
      what="product analytics"
      shape="cards"
      [lines]="6"
      (retry)="analytics.reload()"
    />

    @if (view(); as v) {
      @if (v.insufficient) {
        <sat-banner variant="info" data-testid="insufficient">
          <sat-banner-message
            >Not enough data yet: {{ v.owners }} budget owners (targets are judged from 20 owners
            and 14 days of data).</sat-banner-message
          >
        </sat-banner>
      }
      <div class="bf-pa-grid" data-testid="product-kpis">
        @for (k of v.kpis; track k.key) {
          <section
            class="bf-pa-card"
            [class.bf-pa-card--missed]="k.status === 'below_target'"
            [attr.data-testid]="'kpi-' + k.key"
            [attr.aria-label]="k.label"
          >
            <p class="bf-pa-card__label">{{ k.label }}</p>
            <p class="bf-pa-card__value">{{ value(k) }}</p>
            <p class="bf-pa-card__detail">{{ k.detail }}</p>
            <p class="bf-pa-card__target">
              <sat-status-tag [status]="tone(k)">{{ statusText(k) }}</sat-status-tag>
              @if (k.target) {
                <span>{{ k.target.text }}</span>
              }
            </p>
          </section>
        }
      </div>

      <div class="bf-dash-grid">
        <section class="bf-card" aria-labelledby="funnel-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="funnel-title">
              Activation funnel (owners invited this year)
            </h2>
          </div>
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Activation funnel">
              <thead>
                <tr>
                  <th>Step</th>
                  <th class="bf-num">Owners</th>
                </tr>
              </thead>
              <tbody>
                @for (f of v.funnel; track f.step) {
                  <tr>
                    <td>{{ f.step }}</td>
                    <td class="bf-num">{{ f.count }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <section class="bf-card" aria-labelledby="active-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="active-title">Weekly active owners and employees</h2>
          </div>
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Weekly active people">
              <thead>
                <tr>
                  <th>Week of</th>
                  <th class="bf-num">Owners</th>
                  <th class="bf-num">Employees</th>
                </tr>
              </thead>
              <tbody>
                @for (w of v.weeklyActive; track w.weekStart) {
                  <tr>
                    <td>{{ w.weekStart | date: 'd MMM' : 'UTC' }}</td>
                    <td class="bf-num">{{ w.owners }}</td>
                    <td class="bf-num">{{ w.employees }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <section class="bf-card" aria-labelledby="channels-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="channels-title">Decisions by channel</h2>
          </div>
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Decisions by channel">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th class="bf-num">Decisions</th>
                </tr>
              </thead>
              <tbody>
                @for (c of v.decisionsByChannel; track c.channel) {
                  <tr>
                    <td>{{ c.channel }}</td>
                    <td class="bf-num">{{ c.decisions }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="2" class="bf-empty">No decisions in this period.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
        <section class="bf-card" aria-labelledby="match-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="match-title">Auto-match by source</h2>
          </div>
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Auto-match rate by source">
              <thead>
                <tr>
                  <th>Source</th>
                  <th class="bf-num">Matched</th>
                  <th class="bf-num">Automatically</th>
                </tr>
              </thead>
              <tbody>
                @for (m of v.autoMatchBySource; track m.source) {
                  <tr>
                    <td>{{ label(m.source) }}</td>
                    <td class="bf-num">{{ m.matched }}</td>
                    <td class="bf-num">{{ m.automatic }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="3" class="bf-empty">No actuals matched in this period.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section class="bf-card" aria-labelledby="def-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="def-title">Definitions</h2>
        </div>
        <dl class="bf-card__body bf-defs">
          @for (k of v.kpis; track k.key) {
            <dt>{{ k.label }}</dt>
            <dd>
              {{ k.definition }}
              @if (k.events.length) {
                Events: {{ k.events.join(', ') }}.
              }
              @if (k.target) {
                {{ k.target.text }} (plan default).
              }
            </dd>
          }
        </dl>
      </section>
    }
  `,
  styles: `
    .bf-pa-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 16px;
    }
    .bf-pa-card {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 16px 20px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
      background: var(--mat-sys-surface-container-lowest);
    }
    .bf-pa-card--missed {
      border-color: var(--sat-sys-warning-icon);
      background: var(--sat-sys-warning-container);
    }
    .bf-pa-card p {
      margin: 0;
    }
    .bf-pa-card__label {
      font: var(--mat-sys-label-large);
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-pa-card__value {
      font: var(--mat-sys-headline-small);
      font-variant-numeric: tabular-nums;
    }
    .bf-pa-card__detail {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-pa-card__target {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      font: var(--mat-sys-body-small);
    }
    .bf-dash-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
    }
    .bf-defs {
      margin: 0;
      font: var(--mat-sys-body-medium);
    }
    .bf-defs dt {
      font: var(--mat-sys-title-small);
      margin-top: 8px;
    }
    .bf-defs dd {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductAnalyticsPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly period = computed(() => {
    const p = this.query().get('period');
    return p === '90' || p === 'fy' ? p : '30';
  });
  protected readonly analytics = resource({
    params: () => ({ period: this.period() }),
    loader: ({ params }) =>
      data(
        this.api.getProductAnalytics({ query: { period: params.period as '30' | '90' | 'fy' } }),
      ),
  });
  protected readonly view = computed(() => valueOf(this.analytics));

  protected value(k: Kpi): string {
    if (k.value === null) return '—';
    const v = formatNumber(k.value, 'en', '1.0-1');
    return k.unit === 'percent' ? `${v}%` : `${v} ${k.unit}`;
  }

  protected statusText(k: Kpi): string {
    if (k.status === 'below_target' && k.target)
      return `Below target (${k.target.text.replace('Target ', '')})`;
    return STATUS_TEXT[k.status];
  }

  protected tone(k: Kpi): 'success' | 'warning' | 'info' | 'neutral' {
    return k.status === 'on_target'
      ? 'success'
      : k.status === 'below_target'
        ? 'warning'
        : k.status === 'insufficient'
          ? 'info'
          : 'neutral';
  }

  protected label(code: string): string {
    return LABELS[code] ?? code;
  }

  protected setPeriod(value: string): void {
    void this.router.navigate([], {
      queryParams: { period: value === '30' ? null : value },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
