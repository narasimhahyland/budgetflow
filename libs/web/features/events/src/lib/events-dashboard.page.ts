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
import { MatMenuModule } from '@angular/material/menu';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { SessionStore } from '@bf/web/data-access';
import { DateOnlyPipe, Money, SpendStatus } from '@bf/web/ui';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

/** Screen 043: the Events landing page — what is coming up, what needs me, and is the money in place. */
@Component({
  selector: 'bf-events-dashboard-page',
  imports: [
    DateOnlyPipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SpendStatus,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Events</h1>
        <p class="bf-page__subtitle">Your events, their RSVPs and whether the money is in place</p>
      </div>
      <div class="bf-page__actions">
        <button
          mat-stroked-button
          type="button"
          [class.bf-toggle--on]="onlyMine()"
          (click)="toggleMine()"
          data-testid="only-mine"
        >
          <mat-icon svgIcon="user" />{{
            onlyMine() ? 'Only events I organize' : 'All events I see'
          }}
        </button>
        <a mat-stroked-button routerLink="/events/templates"
          ><mat-icon svgIcon="copy" />Templates</a
        >
        <a mat-stroked-button routerLink="/events/all">All events</a>
        <a mat-flat-button routerLink="/events/new"
          ><mat-icon svgIcon="plus_small" />Create event</a
        >
      </div>
    </header>

    <bf-load-state
      [loading]="dashboard.isLoading() && !dashboard.hasValue()"
      [error]="dashboard.hasValue() ? undefined : dashboard.error()"
      what="the events dashboard"
      (retry)="dashboard.reload()"
    />

    @if (view(); as v) {
      <section class="bf-kpis" aria-label="Event figures">
        <div class="bf-kpi">
          <p class="bf-kpi__label">Upcoming events (next 30 days)</p>
          <p class="bf-kpi__value" data-testid="kpi-upcoming">{{ v.kpis.upcomingCount }}</p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">Funded for upcoming events</p>
          <p class="bf-kpi__value">
            <bf-money
              [amountMinor]="v.kpis.upcomingFunded.amountMinor"
              [currency]="v.kpis.upcomingFunded.currency"
            />
          </p>
          <p class="bf-kpi__delta">
            of
            <bf-money
              [amountMinor]="v.kpis.upcomingCaps.amountMinor"
              [currency]="v.kpis.upcomingCaps.currency"
            />
            in caps
            @if (v.kpis.upcomingGap.amountMinor > 0) {
              · gap
              <bf-money
                [amountMinor]="v.kpis.upcomingGap.amountMinor"
                [currency]="v.kpis.upcomingGap.currency"
              />
            }
          </p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">Cost per attendee, events closed</p>
          <p class="bf-kpi__value">
            <bf-money
              [amountMinor]="v.kpis.closedActualPerAttendee.amountMinor"
              [currency]="v.kpis.closedActualPerAttendee.currency"
            />
          </p>
          <p class="bf-kpi__delta">
            planned
            <bf-money
              [amountMinor]="v.kpis.closedPlannedPerAttendee.amountMinor"
              [currency]="v.kpis.closedPlannedPerAttendee.currency"
            />
          </p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">Participation, events closed</p>
          <p class="bf-kpi__value">{{ v.kpis.closedParticipationPct }}%</p>
          <p class="bf-kpi__delta">attended of those invited</p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">Waiting for reconciliation</p>
          <p class="bf-kpi__value">{{ v.kpis.waitingForReconciliationCount }}</p>
        </div>
      </section>

      <section class="bf-card" aria-label="Needs your attention">
        <div class="bf-card__header"><h2 class="bf-card__title">Needs your attention</h2></div>
        <ul class="bf-list">
          @for (item of v.attention; track item.id) {
            <li class="bf-list__item bf-attention">
              <span>
                @if (item.tone === 'warning') {
                  <mat-icon class="bf-attention__icon" svgIcon="exclamation" />
                }
                {{ item.text }}
              </span>
              <a mat-button [routerLink]="item.actionPath">{{ item.actionLabel }}</a>
            </li>
          }
        </ul>
      </section>

      <section class="bf-card" aria-label="Upcoming events">
        <div class="bf-card__header"><h2 class="bf-card__title">Upcoming events</h2></div>
        @if (v.upcoming.length === 0) {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>No events in the next 30 days</h3>
            <p satEmptyStateDescription>
              Start from a template or create a blank event to plan the next one.
            </p>
            <a mat-stroked-button routerLink="/events/templates">Start from a template</a>
            <a mat-flat-button routerLink="/events/new">Create a blank event</a>
          </sat-empty-state>
        } @else {
          <div class="bf-table-scroll">
            <table mat-table [dataSource]="v.upcoming">
              <ng-container matColumnDef="date">
                <th mat-header-cell *matHeaderCellDef>Date</th>
                <td mat-cell *matCellDef="let e">{{ e.startsAt | bfDate: session.timezone() }}</td>
              </ng-container>
              <ng-container matColumnDef="event">
                <th mat-header-cell *matHeaderCellDef>Event</th>
                <td mat-cell *matCellDef="let e">
                  <a class="bf-cell__primary" [routerLink]="['/events', e.id]">{{ e.name }}</a>
                  <span class="bf-cell__secondary"
                    >{{ e.eventCode }} · {{ e.locationNames.join(', ') }}</span
                  >
                </td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let e">
                  <bf-spend-status kind="event" [status]="e.status" />
                </td>
              </ng-container>
              <ng-container matColumnDef="rsvp">
                <th mat-header-cell *matHeaderCellDef>RSVP</th>
                <td mat-cell *matCellDef="let e">
                  <span class="bf-cell__primary"
                    >{{ e.goingCount }} going of {{ e.capacityCount }}</span
                  >
                  <span class="bf-progress"
                    ><span
                      class="bf-progress__fill bf-progress__fill--approved"
                      [style.width.%]="share(e.goingCount, e.capacityCount)"
                    ></span
                  ></span>
                </td>
              </ng-container>
              <ng-container matColumnDef="funding">
                <th mat-header-cell *matHeaderCellDef>Funding</th>
                <td mat-cell *matCellDef="let e">
                  <span class="bf-cell__primary"
                    ><bf-money
                      [amountMinor]="e.funded.amountMinor"
                      [currency]="e.funded.currency" />
                    of <bf-money [amountMinor]="e.cap.amountMinor" [currency]="e.cap.currency"
                  /></span>
                  <span class="bf-cell__secondary">{{
                    e.fullyFunded ? 'Fully funded' : 'Funding gap'
                  }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="nextTask">
                <th mat-header-cell *matHeaderCellDef>Next task</th>
                <td mat-cell *matCellDef="let e">
                  @if (e.nextTaskTitle) {
                    <span class="bf-cell__primary">{{ e.nextTaskTitle }}</span>
                    @if (e.nextTaskOverdue) {
                      <span class="bf-chip">Overdue</span>
                    }
                  } @else {
                    <span class="bf-cell__secondary">Nothing open</span>
                  }
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr mat-row *matRowDef="let row; columns: columns"></tr>
            </table>
          </div>
        }
      </section>

      <section class="bf-card" aria-label="Recently closed events">
        <div class="bf-card__header"><h2 class="bf-card__title">Recently closed</h2></div>
        @if (v.recentlyClosed.length === 0) {
          <p class="bf-empty">No events have closed yet.</p>
        } @else {
          <ul class="bf-list">
            @for (e of v.recentlyClosed; track e.id) {
              <li class="bf-list__item">
                <span class="bf-list__row">
                  <a [routerLink]="['/events', e.id, 'scorecard']">{{ e.name }}</a>
                  <span
                    ><bf-money
                      [amountMinor]="e.costPerAttendee.amountMinor"
                      [currency]="e.costPerAttendee.currency"
                    />
                    per attendee</span
                  >
                </span>
                <span class="bf-cell__secondary">
                  {{ e.eventCode }} ·
                  {{
                    e.averageRating === null
                      ? 'Not enough feedback yet'
                      : e.averageRating + ' of 5 from ' + e.responseCount + ' responses'
                  }}
                </span>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: `
    .bf-attention {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .bf-attention__icon {
      vertical-align: text-bottom;
      color: var(--sat-sys-warning);
    }

    .bf-toggle--on {
      background: var(--mat-sys-secondary-container);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventsDashboardPage {
  private readonly api = injectApi();
  protected readonly session = inject(SessionStore);
  protected readonly onlyMine = signal(false);
  protected readonly columns = ['date', 'event', 'status', 'rsvp', 'funding', 'nextTask'];

  protected readonly dashboard = resource({
    params: () => ({ onlyMine: this.onlyMine() ? ('true' as const) : ('false' as const) }),
    loader: ({ params }) => data(this.api.getEventsDashboard({ query: params })),
  });
  protected readonly view = computed(() => valueOf(this.dashboard));

  protected toggleMine(): void {
    this.onlyMine.update((v) => !v);
  }

  protected share(part: number, whole: number): number {
    return whole > 0 ? Math.min(100, Math.round((part * 100) / whole)) : 0;
  }
}
