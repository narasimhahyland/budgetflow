import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import type { ParticipationRankRow } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

type Period = 'month' | 'quarter' | 'year';

/**
 * Screen 122a: turnout by office and team.
 *
 * Nothing here is money. The ranking is the share of eligible people who took part, so no office
 * can climb the table by spending more, and offices too small to rank are listed with the reason
 * rather than dropped or parked at the bottom, where their position would still say something
 * about the handful of people in them.
 */
@Component({
  selector: 'bf-participation-page',
  imports: [
    DateTimePipe,
    LoadState,
    MatButtonToggleModule,
    MatIconModule,
    MatTabsModule,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Participation</h1>
        <p class="bf-page__subtitle">Friendly competition on turnout, never on spending</p>
      </div>
      <div class="bf-page__actions">
        <mat-button-toggle-group
          [value]="period()"
          (change)="period.set($event.value)"
          aria-label="Period"
          hideSingleSelectionIndicator
        >
          <mat-button-toggle value="month" data-testid="period-month">This month</mat-button-toggle>
          <mat-button-toggle value="quarter" data-testid="period-quarter"
            >This quarter</mat-button-toggle
          >
          <mat-button-toggle value="year" data-testid="period-year">This year</mat-button-toggle>
        </mat-button-toggle-group>
      </div>
    </header>

    <bf-load-state
      [loading]="leaderboard.isLoading() && !leaderboard.hasValue()"
      [error]="leaderboard.error()"
      what="the participation leaderboard"
      (retry)="leaderboard.reload()"
    />

    @if (board(); as b) {
      <sat-banner variant="info" data-testid="leaderboard-note">
        <sat-banner-message>{{ b.note }}</sat-banner-message>
      </sat-banner>
      <p class="bf-cell__secondary" data-testid="leaderboard-as-of">
        Groups of fewer than {{ b.minimumGroupSize }} eligible people are not ranked. As of
        <span data-testid="relative-time">{{ b.asOf | bfDateTime: session.timezone() }}</span
        >.
      </p>

      <mat-tab-group>
        <mat-tab label="Offices">
          <ng-template matTabContent>
            @if (b.locations.length === 0) {
              <sat-empty-state data-testid="locations-empty">
                <h2 satEmptyStateHeadline>Turnout appears once organizers mark attendance</h2>
                <p satEmptyStateDescription>
                  Nobody has been marked as attending an event in this period yet.
                </p>
              </sat-empty-state>
            } @else {
              <table class="bf-split-table" aria-label="Turnout by office">
                <thead>
                  <tr>
                    <th class="bf-num">Rank</th>
                    <th>Office</th>
                    <th class="bf-num">Turnout</th>
                    <th class="bf-num">Eligible people</th>
                    <th class="bf-num">Events held</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of b.locations; track row.orgUnitId) {
                    <tr [attr.data-testid]="'location-' + row.orgUnitId">
                      <td class="bf-num">
                        @if (row.rank !== null) {
                          {{ row.rank }}
                        } @else {
                          <span class="bf-cell__secondary">&mdash;</span>
                        }
                      </td>
                      <td>{{ row.name }}</td>
                      <td class="bf-num">
                        @if (row.ranked) {
                          {{ turnout(row) }}
                        } @else {
                          <sat-status-tag
                            status="neutral"
                            [attr.data-testid]="'not-ranked-' + row.orgUnitId"
                            >{{ row.notRankedReason }}</sat-status-tag
                          >
                        }
                      </td>
                      <td class="bf-num">{{ row.eligibleHeadcount }}</td>
                      <td class="bf-num">{{ row.eventsHeld }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </ng-template>
        </mat-tab>
        <mat-tab label="Teams">
          <ng-template matTabContent>
            @if (b.teams.length === 0) {
              <sat-empty-state data-testid="teams-empty">
                <h2 satEmptyStateHeadline>No team turnout yet</h2>
                <p satEmptyStateDescription>
                  Teams appear here once their people are marked as attending events.
                </p>
              </sat-empty-state>
            } @else {
              <table class="bf-split-table" aria-label="Turnout by team">
                <thead>
                  <tr>
                    <th class="bf-num">Rank</th>
                    <th>Team</th>
                    <th class="bf-num">Turnout</th>
                    <th class="bf-num">Eligible people</th>
                    <th class="bf-num">Events held</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of b.teams; track row.orgUnitId) {
                    <tr [attr.data-testid]="'team-' + row.orgUnitId">
                      <td class="bf-num">
                        @if (row.rank !== null) {
                          {{ row.rank }}
                        } @else {
                          <span class="bf-cell__secondary">&mdash;</span>
                        }
                      </td>
                      <td>{{ row.name }}</td>
                      <td class="bf-num">
                        @if (row.ranked) {
                          {{ turnout(row) }}
                        } @else {
                          <sat-status-tag
                            status="neutral"
                            [attr.data-testid]="'not-ranked-' + row.orgUnitId"
                            >{{ row.notRankedReason }}</sat-status-tag
                          >
                        }
                      </td>
                      <td class="bf-num">{{ row.eligibleHeadcount }}</td>
                      <td class="bf-num">{{ row.eventsHeld }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </ng-template>
        </mat-tab>
      </mat-tab-group>
    }
  `,
  styles: `
    mat-tab-group {
      margin-top: 12px;
    }
    .bf-split-table {
      margin-top: 12px;
    }
    @media (max-width: 834px) {
      .bf-split-table {
        display: block;
        overflow-x: auto;
      }
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ParticipationPage {
  private readonly api = injectApi();
  protected readonly session = inject(SessionStore);
  protected readonly period = signal<Period>('quarter');

  protected readonly leaderboard = resource({
    params: () => ({ period: this.period() }),
    loader: ({ params }) =>
      data(this.api.getParticipationLeaderboard({ query: { period: params.period } })),
  });
  protected readonly board = computed(() => valueOf(this.leaderboard));

  protected turnout = (row: ParticipationRankRow): string =>
    row.turnoutBps === null ? '' : `${(row.turnoutBps / 100).toFixed(1)}%`;
}
