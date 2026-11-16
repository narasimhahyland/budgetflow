import { DatePipe, DecimalPipe, formatNumber } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { data, injectApi, valueOf } from '../api';

const CHANNELS: Record<string, string> = {
  web: 'Web',
  email: 'Email',
  slack: 'Slack',
  teams: 'Teams',
  mobile: 'Mobile',
  push: 'Push',
};

/**
 * Screen 018a: how fast approvals happen and where they get stuck. Finance and the CEO see named
 * approvers (at least ten decisions), analysts aggregates only, an approver their own figures
 * against the company median. Suggestions are written hints; nothing changes from here.
 */
@Component({
  selector: 'bf-approval-performance-page',
  imports: [
    DatePipe,
    DateTimePipe,
    DecimalPipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Approval performance</h1>
        <p class="bf-page__subtitle">
          Cycle time, SLA compliance and where approvals get stuck.
          @if (perf(); as p) {
            Last {{ p.periodDays }} days, as of
            <span data-testid="relative-time">{{
              p.generatedAt | bfDateTime: session.timezone()
            }}</span>
          }
        </p>
      </div>
      @if (perf()) {
        <div class="bf-page__actions">
          <a mat-stroked-button routerLink="/dashboards/pending-approvals"
            ><mat-icon svgIcon="inbox" />Pending approvals</a
          >
        </div>
      }
    </header>

    <section class="bf-card" aria-labelledby="perf-filters-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="perf-filters-title">Period</h2>
      </div>
      <div class="bf-filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Period</mat-label>
          <mat-select [ngModel]="days()" (ngModelChange)="setDays($event)">
            <mat-option value="30">Last 30 days</mat-option>
            <mat-option value="90">Last 90 days</mat-option>
            <mat-option value="365">Last 12 months</mat-option>
          </mat-select>
        </mat-form-field>
      </div>
    </section>

    <bf-load-state
      [loading]="performance.isLoading() && !performance.hasValue()"
      [error]="performance.error()"
      what="approval performance"
      shape="cards"
      [lines]="4"
      (retry)="performance.reload()"
    />

    @if (perf(); as p) {
      @if (p.smallSample) {
        <sat-banner variant="info" data-testid="small-sample">
          <sat-banner-message
            >Fewer than 30 decisions in this period ({{ p.kpis.decisions }}); medians may move a
            lot.</sat-banner-message
          >
        </sat-banner>
      }
      @if (p.view === 'own' && p.own; as own) {
        <section class="bf-card" data-testid="own-view">
          <div class="bf-card__header"><h2 class="bf-card__title">Your approvals</h2></div>
          <p class="bf-card__body">
            Your median {{ hours(own.medianHours) }}, company
            {{ hours(own.companyMedianHours) }} ({{ own.decisions }}
            {{ own.decisions === 1 ? 'decision' : 'decisions' }}).
          </p>
        </section>
      }
      <div class="bf-kpis" data-testid="perf-kpis">
        <div class="bf-kpi">
          <div class="bf-kpi__head"><p class="bf-kpi__label">Median time to approve</p></div>
          <p class="bf-kpi__value" data-testid="kpi-median">{{ hours(p.kpis.medianHours) }}</p>
          <p class="bf-kpi__delta">Target under {{ p.kpis.targetHours }} hours</p>
        </div>
        <div class="bf-kpi">
          <div class="bf-kpi__head"><p class="bf-kpi__label">90th percentile</p></div>
          <p class="bf-kpi__value">{{ hours(p.kpis.p90Hours) }}</p>
        </div>
        <div class="bf-kpi">
          <div class="bf-kpi__head"><p class="bf-kpi__label">SLA compliance</p></div>
          <p class="bf-kpi__value">{{ percent(p.kpis.slaCompliancePct) }}</p>
        </div>
        <div class="bf-kpi">
          <div class="bf-kpi__head"><p class="bf-kpi__label">Changes requested</p></div>
          <p class="bf-kpi__value">{{ percent(p.kpis.changesRequestedPct) }}</p>
        </div>
        <div class="bf-kpi">
          <div class="bf-kpi__head"><p class="bf-kpi__label">Decided outside the web app</p></div>
          <p class="bf-kpi__value">{{ percent(p.kpis.outsideWebPct) }}</p>
        </div>
      </div>

      @if (p.kpis.decisions === 0) {
        <sat-empty-state>
          <h3 satEmptyStateHeadline>No decisions in this period</h3>
          <p satEmptyStateDescription>Choose a longer period to see cycle times.</p>
        </sat-empty-state>
      }

      @if (p.view !== 'own' && p.kpis.decisions > 0) {
        <div class="bf-dash-grid">
          <section class="bf-card" aria-labelledby="step-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="step-title">Cycle time by step</h2>
            </div>
            <div class="bf-table-scroll">
              <table class="bf-split-table" aria-label="Cycle time by step">
                <thead>
                  <tr>
                    <th>Step</th>
                    <th class="bf-num">Decisions</th>
                    <th class="bf-num">Median</th>
                    <th class="bf-num">90th percentile</th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of p.byStep; track s.step) {
                    <tr>
                      <td>{{ s.step }}</td>
                      <td class="bf-num">{{ s.decisions }}</td>
                      <td class="bf-num">{{ hours(s.medianHours) }}</td>
                      <td class="bf-num">{{ hours(s.p90Hours) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
          <section class="bf-card" aria-labelledby="channel-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="channel-title">Channel mix</h2>
            </div>
            <div class="bf-table-scroll">
              <table class="bf-split-table" aria-label="Decisions by channel">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th class="bf-num">Share</th>
                    <th class="bf-num">Median time</th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of p.byChannel; track c.channel) {
                    <tr>
                      <td>{{ channel(c.channel) }}</td>
                      <td class="bf-num">
                        {{ c.sharePct | number: '1.0-1' }}% ({{ c.decisions }})
                      </td>
                      <td class="bf-num">{{ hours(c.medianHours) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
          <section class="bf-card" aria-labelledby="weekly-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="weekly-title">Weekly trend</h2>
            </div>
            <div class="bf-table-scroll">
              <table
                class="bf-split-table"
                aria-label="Weekly median cycle time and SLA compliance"
              >
                <thead>
                  <tr>
                    <th>Week of</th>
                    <th class="bf-num">Decisions</th>
                    <th class="bf-num">Median</th>
                    <th class="bf-num">SLA compliance</th>
                  </tr>
                </thead>
                <tbody>
                  @for (w of p.weekly; track w.weekStart) {
                    <tr>
                      <td>{{ w.weekStart | date: 'd MMM' : 'UTC' }}</td>
                      <td class="bf-num">{{ w.decisions }}</td>
                      <td class="bf-num">{{ hours(w.medianHours) }}</td>
                      <td class="bf-num">{{ percent(w.slaCompliancePct) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        </div>
      }

      @if (p.view === 'named') {
        <section class="bf-card" aria-labelledby="bottleneck-title" data-testid="bottlenecks">
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title" id="bottleneck-title">Bottleneck approvers</h2>
              <p class="bf-card__hint">
                Approvers with at least 10 decisions; everyone else is grouped.
              </p>
            </div>
          </div>
          <div class="bf-table-scroll">
            <table class="bf-split-table" aria-label="Bottleneck approvers">
              <thead>
                <tr>
                  <th>Approver</th>
                  <th>Step</th>
                  <th class="bf-num">Decisions</th>
                  <th class="bf-num">Median wait</th>
                  <th class="bf-num">90th percentile</th>
                  <th class="bf-num">Past SLA</th>
                  <th class="bf-num">Delegations used</th>
                </tr>
              </thead>
              <tbody>
                @for (a of p.approvers; track a.approverName) {
                  <tr>
                    <td>{{ a.approverName }}</td>
                    <td>{{ a.step }}</td>
                    <td class="bf-num">{{ a.decisions }}</td>
                    <td class="bf-num">{{ hours(a.medianHours) }}</td>
                    <td class="bf-num">{{ hours(a.p90Hours) }}</td>
                    <td class="bf-num">{{ a.pastSla }}</td>
                    <td class="bf-num">{{ a.delegationsUsed }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="bf-empty">No decisions in this period.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      @if (p.suggestions.length) {
        <section class="bf-card" aria-labelledby="suggest-title">
          <div class="bf-card__header">
            <div>
              <h2 class="bf-card__title" id="suggest-title">Suggestions</h2>
              <p class="bf-card__hint">Rules-based hints. Nothing changes automatically.</p>
            </div>
          </div>
          <ul class="bf-card__body bf-plain">
            @for (s of p.suggestions; track s.text) {
              <li>{{ s.text }} <a [routerLink]="s.link">Open</a></li>
            }
          </ul>
        </section>
      }
    }
  `,
  styles: `
    .bf-dash-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
    }
    .bf-plain {
      margin: 0;
      list-style: none;
      font: var(--mat-sys-body-medium);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovalPerformancePage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);

  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  protected readonly days = computed(() => {
    const d = this.query().get('days');
    return d === '30' || d === '365' ? d : '90';
  });
  protected readonly performance = resource({
    params: () => ({ days: this.days() }),
    loader: ({ params }) =>
      data(
        this.api.getApprovalPerformance({ query: { days: params.days as '30' | '90' | '365' } }),
      ),
  });
  protected readonly perf = computed(() => valueOf(this.performance));

  protected hours(h: number | null): string {
    return h === null ? '—' : `${formatNumber(h, 'en', '1.1-1')} hours`;
  }

  protected percent(p: number | null): string {
    return p === null ? '—' : `${formatNumber(p, 'en', '1.0-1')}%`;
  }

  protected channel(c: string): string {
    return CHANNELS[c] ?? c;
  }

  protected setDays(value: string): void {
    void this.router.navigate([], {
      queryParams: { days: value === '90' ? null : value },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
