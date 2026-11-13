import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import type { RulesDashboard } from '@bf/contracts';
import { LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { data, injectApi, valueOf } from './api';
import { RuleEffectTag } from './rule-tags';
import { RulesTabs } from './rules-tabs';

/** Screen 066: what the rules are doing right now and what needs a decision. */
@Component({
  selector: 'bf-rules-overview-page',
  imports: [
    DatePipe,
    DecimalPipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
    RouterLink,
    RulesTabs,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    RuleEffectTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Rules and policies</h1>
        <p class="bf-page__subtitle">
          Rules decide what goes through, what needs approval and what is blocked. Changes take
          effect from the date you publish them and never change a decision already made.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/admin/rules/simulate">Test a request</a>
        <a mat-stroked-button routerLink="/admin/rules/list">All rules</a>
      </div>
    </header>
    <bf-rules-tabs current="overview" />
    <bf-load-state
      [loading]="view.isLoading() && !view.hasValue()"
      [error]="view.error()"
      what="rules and policies"
      shape="cards"
      (retry)="view.reload()"
    />
    @if (valueOf(view); as v) {
      <div class="bf-kpis bf-kpis--six">
        @for (k of kpis(v.kpis); track k.label) {
          <div class="bf-kpi" [class]="'bf-kpi--' + (k.alert ?? 'plain')">
            <div class="bf-kpi__head">
              <p class="bf-kpi__label">{{ k.label }}</p>
              <mat-icon class="bf-kpi__icon" [svgIcon]="k.icon" aria-hidden="true" />
            </div>
            <p class="bf-kpi__value" [class]="'bf-kpi__value--' + (k.alert ?? 'plain')">
              {{ k.value | number }}
            </p>
            @if (k.link && k.value > 0) {
              <a class="bf-kpi__delta" [routerLink]="k.link">{{ k.linkText }}</a>
            }
          </div>
        }
      </div>

      <section class="bf-card" aria-labelledby="attention-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="attention-title">Needs attention</h2>
        </div>
        <div class="bf-card__body">
          @for (item of v.needsAttention; track item.id) {
            <sat-banner class="bf-banner" [variant]="item.tone">
              <sat-banner-message>
                <strong>{{ item.title }}</strong> {{ item.detail }}
              </sat-banner-message>
              <a mat-button satBannerAction [routerLink]="item.linkPath">Open</a>
            </sat-banner>
          } @empty {
            <sat-empty-state>
              <h3 satEmptyStateHeadline>Nothing needs a decision</h3>
              <p satEmptyStateDescription>
                No rule conflicts, no open exceptions and every approval is within its agreed time.
              </p>
            </sat-empty-state>
          }
        </div>
      </section>

      <section class="bf-card" aria-labelledby="decisions-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="decisions-title">Decisions over the last four weeks</h2>
          <p class="bf-card__hint">How the rules decided requests, week by week.</p>
        </div>
        @if (v.weeklyDecisions.length) {
          <div class="bf-card__body">
            <ul class="bf-week-legend" aria-hidden="true">
              <li><span class="bf-week-swatch bf-week-swatch--through"></span>Went through</li>
              <li><span class="bf-week-swatch bf-week-swatch--approval"></span>Needed approval</li>
              <li><span class="bf-week-swatch bf-week-swatch--warned"></span>Warned</li>
              <li><span class="bf-week-swatch bf-week-swatch--blocked"></span>Blocked or held</li>
            </ul>
            <div class="bf-week-chart">
              @for (w of v.weeklyDecisions; track w.weekLabel) {
                @let total = w.autoApproved + w.approvalRequired + w.warned + w.blocked;
                <span class="bf-week-chart__label">{{ w.weekLabel }}</span>
                <span
                  class="bf-week-chart__bar"
                  role="img"
                  [attr.aria-label]="
                    'Week of ' +
                    w.weekLabel +
                    ': ' +
                    w.autoApproved +
                    ' went through, ' +
                    w.approvalRequired +
                    ' needed approval, ' +
                    w.warned +
                    ' warned, ' +
                    w.blocked +
                    ' blocked or held'
                  "
                >
                  @if (total > 0) {
                    <span
                      class="bf-week-swatch--through"
                      [style.width.%]="(w.autoApproved * 100) / total"
                    ></span>
                    <span
                      class="bf-week-swatch--approval"
                      [style.width.%]="(w.approvalRequired * 100) / total"
                    ></span>
                    <span
                      class="bf-week-swatch--warned"
                      [style.width.%]="(w.warned * 100) / total"
                    ></span>
                    <span
                      class="bf-week-swatch--blocked"
                      [style.width.%]="(w.blocked * 100) / total"
                    ></span>
                  }
                </span>
              }
            </div>
            <p class="bf-card__hint">The table below lists the same figures.</p>
          </div>
        }
        <div class="bf-table-scroll">
          <table class="bf-split-table bf-table--stack" aria-label="Decisions by week">
            <thead>
              <tr>
                <th scope="col">Week of</th>
                <th scope="col" class="bf-num">Went through</th>
                <th scope="col" class="bf-num">Needed approval</th>
                <th scope="col" class="bf-num">Warned</th>
                <th scope="col" class="bf-num">Blocked or held</th>
              </tr>
            </thead>
            <tbody>
              @for (w of v.weeklyDecisions; track w.weekLabel) {
                <tr>
                  <td class="bf-nowrap">{{ w.weekLabel }}</td>
                  <td class="bf-num" data-label="Went through">{{ w.autoApproved | number }}</td>
                  <td class="bf-num" data-label="Needed approval">
                    {{ w.approvalRequired | number }}
                  </td>
                  <td class="bf-num" data-label="Warned">{{ w.warned | number }}</td>
                  <td class="bf-num" data-label="Blocked or held">{{ w.blocked | number }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5">No decisions yet.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="bf-card" aria-labelledby="matched-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="matched-title">Rules that matched most often</h2>
        </div>
        <div class="bf-table-scroll">
          <table class="bf-split-table bf-table--stack" aria-label="Most matched rules">
            <thead>
              <tr>
                <th scope="col">Rule</th>
                <th scope="col">Outcome</th>
                <th scope="col" class="bf-num">Matches</th>
                <th scope="col" class="bf-num">Share</th>
                <th scope="col">Last change</th>
              </tr>
            </thead>
            <tbody>
              @for (r of v.mostMatchedRules; track r.ruleId) {
                <tr>
                  <td>
                    <a [routerLink]="['/admin/rules', r.ruleId]" class="bf-cell__primary">{{
                      r.code
                    }}</a>
                    <span class="bf-cell__secondary">{{ r.name }}</span>
                  </td>
                  <td data-label="Outcome"><bf-rule-effect [effect]="r.effect" /></td>
                  <td class="bf-num" data-label="Matches">{{ r.matches | number }}</td>
                  <td class="bf-num" data-label="Share">{{ r.sharePct }}%</td>
                  <td class="bf-nowrap" data-label="Last change">
                    {{ r.lastChange | date: 'd MMM y' }}
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5">No rule has matched a request in the last 30 days.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }
  `,
  styles: `
    .bf-kpis--six {
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    }
    .bf-nowrap {
      white-space: nowrap;
    }
    .bf-week-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-week-legend li {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .bf-week-legend .bf-week-swatch {
      width: 10px;
      height: 10px;
      border-radius: var(--mat-sys-corner-extra-small);
    }
    .bf-week-chart {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      gap: 8px 12px;
      align-items: center;
      font: var(--mat-sys-body-small);
    }
    .bf-week-chart__label {
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
    .bf-week-chart__bar {
      display: flex;
      height: 16px;
      overflow: hidden;
      border-radius: var(--mat-sys-corner-extra-small);
      background: var(--mat-sys-surface-container-high);
    }
    .bf-week-chart__bar > span {
      display: block;
      height: 100%;
    }
    .bf-week-swatch--through {
      background: var(--categorical-data-viz-1);
    }
    .bf-week-swatch--approval {
      background: var(--categorical-data-viz-2);
    }
    .bf-week-swatch--warned {
      background: var(--categorical-data-viz-5);
    }
    .bf-week-swatch--blocked {
      background: var(--categorical-data-viz-3);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RulesOverviewPage {
  private readonly api = injectApi();
  protected readonly valueOf = valueOf;

  /** The six counts with their icons; conflicts and late approvals are toned when there are any. */
  protected kpis(k: RulesDashboard['kpis']) {
    return [
      { label: 'Active rules', value: k.activeRules, icon: 'circle_check' },
      { label: 'Drafts not published', value: k.draftsAwaitingPublish, icon: 'note_edit' },
      {
        label: 'Conflicts to resolve',
        value: k.conflicts,
        icon: 'error',
        alert: k.conflicts > 0 ? 'important' : undefined,
        link: '/admin/rules/list',
        linkText: 'See the conflicting rules',
      },
      { label: 'Starting later', value: k.scheduledToStart, icon: 'calendar' },
      {
        label: 'Open exceptions',
        value: k.openExceptions,
        icon: 'flag',
        alert: k.openExceptions > 0 ? 'warning' : undefined,
        link: '/admin/rules/exceptions',
        linkText: 'Settle them',
      },
      {
        label: 'Approvals past their time',
        value: k.approvalsPastSla,
        icon: 'alarm',
        alert: k.approvalsPastSla > 0 ? 'warning' : undefined,
      },
    ];
  }

  protected readonly view = resource({ loader: () => data(this.api.getRulesDashboard({})) });
}
