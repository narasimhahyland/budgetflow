import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { data, injectApi, valueOf } from './api';
import { RuleEffectTag } from './rule-tags';
import { LoadState } from './load-state';
import { RulesTabs } from './rules-tabs';

/** Screen 066: what the rules are doing right now and what needs a decision. */
@Component({
  selector: 'bf-rules-overview-page',
  imports: [
    DecimalPipe,
    LoadState,
    MatButtonModule,
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
        <a mat-flat-button routerLink="/admin/rules/list">All rules</a>
      </div>
    </header>
    <bf-rules-tabs current="overview" />
    <bf-load-state
      [loading]="view.isLoading() && !view.hasValue()"
      [error]="view.error()"
      what="rules and policies"
      (retry)="view.reload()"
    />
    @if (valueOf(view); as v) {
      <dl class="bf-kpis">
        <div class="bf-kpi">
          <dt class="bf-kpi__label">Active rules</dt>
          <dd class="bf-kpi__value">{{ v.kpis.activeRules | number }}</dd>
        </div>
        <div class="bf-kpi">
          <dt class="bf-kpi__label">Drafts not published</dt>
          <dd class="bf-kpi__value">{{ v.kpis.draftsAwaitingPublish | number }}</dd>
        </div>
        <div class="bf-kpi">
          <dt class="bf-kpi__label">Conflicts to resolve</dt>
          <dd class="bf-kpi__value">{{ v.kpis.conflicts | number }}</dd>
        </div>
        <div class="bf-kpi">
          <dt class="bf-kpi__label">Starting later</dt>
          <dd class="bf-kpi__value">{{ v.kpis.scheduledToStart | number }}</dd>
        </div>
        <div class="bf-kpi">
          <dt class="bf-kpi__label">Open exceptions</dt>
          <dd class="bf-kpi__value">{{ v.kpis.openExceptions | number }}</dd>
        </div>
        <div class="bf-kpi">
          <dt class="bf-kpi__label">Approvals past their time</dt>
          <dd class="bf-kpi__value">{{ v.kpis.approvalsPastSla | number }}</dd>
        </div>
      </dl>

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
              <a sat-banner-action mat-button [routerLink]="item.linkPath">Open</a>
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
        <div class="bf-table-scroll">
          <table class="bf-split-table" aria-label="Decisions by week">
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
                  <td>{{ w.weekLabel }}</td>
                  <td class="bf-num">{{ w.autoApproved | number }}</td>
                  <td class="bf-num">{{ w.approvalRequired | number }}</td>
                  <td class="bf-num">{{ w.warned | number }}</td>
                  <td class="bf-num">{{ w.blocked | number }}</td>
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
          <table class="bf-split-table" aria-label="Most matched rules">
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
                  <td><bf-rule-effect [effect]="r.effect" /></td>
                  <td class="bf-num">{{ r.matches | number }}</td>
                  <td class="bf-num">{{ r.sharePct }}%</td>
                  <td>{{ r.lastChange }}</td>
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
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RulesOverviewPage {
  private readonly api = injectApi();
  protected readonly valueOf = valueOf;
  protected readonly view = resource({ loader: () => data(this.api.getRulesDashboard({})) });
}
