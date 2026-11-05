import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { EventSummary } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateOnlyPipe, DateTimePipe, Money, SpendStatus } from '@bf/web/ui';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SAT_TABLE_WITH_ROW_STATES_IMPORTS } from '@hylandsoftware/satori-ui/table-with-row-states';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

type Tab = 'upcoming' | 'in_progress' | 'reconciling' | 'closed' | 'drafts';
const TABS: { id: Tab; label: string; statuses: EventSummary['status'][] }[] = [
  { id: 'upcoming', label: 'Upcoming', statuses: ['submitted', 'approved', 'funded'] },
  { id: 'in_progress', label: 'In progress', statuses: ['in_progress'] },
  { id: 'reconciling', label: 'Reconciling', statuses: ['completed', 'reconciling'] },
  { id: 'closed', label: 'Closed', statuses: ['closed', 'cancelled'] },
  { id: 'drafts', label: 'Drafts', statuses: ['draft'] },
];

/** Screen 44: events the user organizes, attends, funds or may see, by lifecycle stage. */
@Component({
  selector: 'bf-events-list-page',
  imports: [
    DateOnlyPipe,
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_NAVIGATION_TABS_IMPORTS,
    SAT_TABLE_WITH_ROW_STATES_IMPORTS,
    SpendStatus,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Events</h1>
        <p class="bf-page__subtitle">Hyland · cross-location events and their funding</p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/events/cofunding-board">Co-funding board</a>
        @if (session.can('event.manage')) {
          <a mat-flat-button routerLink="/events/new"
            ><mat-icon svgIcon="circle_add" />Create event</a
          >
        }
      </div>
    </header>
    <sat-navigation-tabs class="bf-tabs" aria-label="Event stages">
      @for (t of tabs; track t.id) {
        <a
          satNavigationTab
          [active]="tab() === t.id"
          (click)="setTab(t.id)"
          (keydown.enter)="setTab(t.id)"
          tabindex="0"
        >
          {{ t.label }} <span class="bf-chip">{{ count(t.id) }}</span>
        </a>
      }
    </sat-navigation-tabs>
    <section class="bf-card" aria-labelledby="events-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="events-title">
          {{ rows().length }} {{ rows().length === 1 ? 'event' : 'events' }}
        </h2>
      </div>
      <div class="bf-filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Search event name or code</mat-label>
          <input matInput [ngModel]="q()" (ngModelChange)="q.set($event)" />
        </mat-form-field>
      </div>
      <bf-load-state
        [loading]="list.isLoading() && !list.hasValue()"
        [error]="list.error()"
        what="events"
        (retry)="list.reload()"
      />
      @if (list.hasValue()) {
        @if (rows().length === 0) {
          <p class="bf-empty">
            No events here yet.
            {{ session.can('event.manage') ? 'Create one to start funding it.' : '' }}
          </p>
        } @else {
          <div class="bf-table-scroll">
            <table mat-table satTableWithRowStates [dataSource]="rows()" aria-label="Events">
              <ng-container matColumnDef="event">
                <th mat-header-cell *matHeaderCellDef>Event</th>
                <td mat-cell *matCellDef="let e">
                  <a
                    satRowPrimaryAction
                    class="bf-cell__primary"
                    [routerLink]="['/events', e.id]"
                    >{{ e.name }}</a
                  >
                  <span class="bf-cell__secondary"
                    >{{ e.eventCode }} · {{ e.locationNames.join(', ') }} ·
                    {{ e.organizerName }}</span
                  >
                </td>
              </ng-container>
              <ng-container matColumnDef="date">
                <th mat-header-cell *matHeaderCellDef>Date</th>
                <td mat-cell *matCellDef="let e">{{ e.startsAt | bfDate: session.timezone() }}</td>
              </ng-container>
              <ng-container matColumnDef="cap">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Estimate</th>
                <td mat-cell *matCellDef="let e" class="bf-num">
                  <bf-money
                    [amountMinor]="e.estimate.amountMinor"
                    [currency]="e.estimate.currency"
                  />
                </td>
              </ng-container>
              <ng-container matColumnDef="funded">
                <th mat-header-cell *matHeaderCellDef>Funded</th>
                <td mat-cell *matCellDef="let e">
                  <span class="bf-cell__primary"
                    ><bf-money
                      [amountMinor]="e.funded.amountMinor"
                      [currency]="e.funded.currency"
                    />
                    · {{ pct(e.funded.amountMinor, e.estimate.amountMinor) }}%</span
                  >
                  <span class="bf-progress"
                    ><span
                      class="bf-progress__fill"
                      [class.bf-progress__fill--approved]="e.fullyFunded"
                      [style.width.%]="pct(e.funded.amountMinor, e.estimate.amountMinor)"
                    ></span
                  ></span>
                </td>
              </ng-container>
              <ng-container matColumnDef="committed">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Committed</th>
                <td mat-cell *matCellDef="let e" class="bf-num">
                  <bf-money
                    [amountMinor]="e.committed.amountMinor"
                    [currency]="e.committed.currency"
                  />
                </td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let e">
                  <bf-spend-status kind="event" [status]="e.status" />
                  @if (e.pendingContributions) {
                    <span class="bf-cell__secondary"
                      >{{ e.pendingContributions }} contribution{{
                        e.pendingContributions === 1 ? '' : 's'
                      }}
                      pending</span
                    >
                  }
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr mat-row satRowState *matRowDef="let row; columns: columns"></tr>
            </table>
          </div>
        }
      }
    </section>
  `,
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventsListPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionStore);
  protected readonly tabs = TABS;
  protected readonly columns = ['event', 'date', 'cap', 'funded', 'committed', 'status'];
  protected readonly tab = signal<Tab>(
    (this.route.snapshot.queryParamMap.get('tab') as Tab) ?? 'upcoming',
  );
  protected readonly q = signal(this.route.snapshot.queryParamMap.get('q') ?? '');

  protected readonly list = resource({ loader: () => data(this.api.listEvents({ query: {} })) });

  private readonly all = computed(() => {
    const q = this.q().trim().toLowerCase();
    return (valueOf(this.list)?.items ?? []).filter(
      (e) => !q || e.name.toLowerCase().includes(q) || e.eventCode.toLowerCase().includes(q),
    );
  });
  protected readonly rows = computed(() => {
    const statuses = TABS.find((t) => t.id === this.tab())!.statuses;
    return this.all().filter((e) => statuses.includes(e.status));
  });

  protected count(tab: Tab): number {
    const statuses = TABS.find((t) => t.id === tab)!.statuses;
    return this.all().filter((e) => statuses.includes(e.status)).length;
  }

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    void this.router.navigate([], {
      queryParams: { tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected pct(part: number, whole: number): number {
    return whole <= 0 ? 0 : Math.min(100, Math.round((part * 100) / whole));
  }
}
