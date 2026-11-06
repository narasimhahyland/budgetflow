import { DatePipe } from '@angular/common';
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
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { ClosePeriodSummary } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { CloseTabs } from './close-tabs';
import { ordered, PERIOD_STATUS } from './close-format';
import { LoadState } from './load-state';

/** Screen 80e, period list: every accounting period of a fiscal year with where its close stands. */
@Component({
  selector: 'bf-close-periods-page',
  imports: [
    CloseTabs,
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    MatTableModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Period close</h1>
        <p class="bf-page__subtitle">
          Close each month once every legal entity's checks pass. Closing takes an as-of snapshot
          that cannot change; anything dated in the period afterwards posts to the next open period
          with a late flag.
        </p>
      </div>
    </header>
    <bf-close-tabs />
    @if (pendingReopens().length) {
      <sat-banner variant="warning" data-testid="reopen-pending-banner">
        <sat-banner-message>
          A break-glass reopen is waiting for a second person:
          {{ pendingReopens().join(', ') }}.
        </sat-banner-message>
      </sat-banner>
    }
    <section class="bf-card" aria-labelledby="periods-title">
      <div class="bf-card__header">
        <div>
          <h2 class="bf-card__title" id="periods-title">Accounting periods</h2>
          <p class="bf-card__hint">
            One fiscal year at a time: each legal entity's calendar has its own periods.
          </p>
        </div>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Fiscal year</mat-label>
          <mat-select
            [ngModel]="fiscalYearId()"
            (ngModelChange)="chosenYear.set($event)"
            data-testid="fiscal-year"
          >
            @for (y of fiscalYears(); track y.id) {
              <mat-option [value]="y.id">{{ y.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
      @if (periods.isLoading() && !valueOf(periods)) {
        <bf-load-state [loading]="true" what="accounting periods" />
      } @else if (periods.error()) {
        <bf-load-state
          [error]="periods.error()"
          what="accounting periods"
          (retry)="periods.reload()"
        />
      } @else if (!rows().length) {
        <sat-empty-state>
          <h3 satEmptyStateHeadline>No accounting periods</h3>
          <p satEmptyStateDescription>
            This fiscal year has no periods yet. Finance creates them on the fiscal calendar.
          </p>
          <a mat-stroked-button routerLink="/finance/periods" satEmptyStateAction
            >Open the fiscal calendar</a
          >
        </sat-empty-state>
      } @else {
        <div class="bf-table-scroll">
          <table mat-table [dataSource]="rows()" aria-label="Accounting periods">
            <ng-container matColumnDef="period">
              <th mat-header-cell *matHeaderCellDef>Period</th>
              <td mat-cell *matCellDef="let p">
                <a class="bf-cell__primary" [routerLink]="['/finance/close', p.id]">{{
                  p.label
                }}</a>
                <span class="bf-cell__secondary"
                  >{{ p.startDate | date: 'd MMM' }} – {{ p.endDate | date: 'd MMM y' }}</span
                >
              </td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let p">
                <sat-status-tag [status]="statusOf(p).tone">{{ statusOf(p).text }}</sat-status-tag>
                @if (p.reopenRequestPending) {
                  <span class="bf-cell__secondary">Reopen requested</span>
                }
              </td>
            </ng-container>
            <ng-container matColumnDef="target">
              <th mat-header-cell *matHeaderCellDef>Target close</th>
              <td mat-cell *matCellDef="let p">
                {{ p.targetCloseDate ? (p.targetCloseDate | date: 'd MMM y') : '—' }}
              </td>
            </ng-container>
            <ng-container matColumnDef="snapshots">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Snapshots</th>
              <td mat-cell *matCellDef="let p" class="bf-num">{{ p.snapshotCount }}</td>
            </ng-container>
            <ng-container matColumnDef="late">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Late items</th>
              <td mat-cell *matCellDef="let p" class="bf-num">{{ p.lateItemCount }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
      }
    </section>
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClosePeriodsPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly columns = ['period', 'status', 'target', 'snapshots', 'late'];
  protected readonly fiscalYears = computed(() => this.session.me()?.fiscalYears ?? []);
  private readonly chosenYear = signal<string | null>(null);
  /**
   * Each legal entity's fiscal calendar has its own periods, so the unfiltered list repeats every
   * month once per calendar. The screen always asks for one fiscal year: today's by default.
   */
  protected readonly fiscalYearId = computed(() => {
    const chosen = this.chosenYear();
    if (chosen) return chosen;
    const years = this.fiscalYears();
    const today = new Date().toISOString().slice(0, 10);
    return (
      years.find((y) => y.startDate <= today && today <= y.endDate)?.id ??
      years[years.length - 1]?.id ??
      null
    );
  });
  protected readonly periods = resource({
    params: () => ({ fiscalYearId: this.fiscalYearId() }),
    loader: ({ params }) =>
      params.fiscalYearId
        ? data(this.api.listClosePeriods({ query: { fiscalYearId: params.fiscalYearId } }))
        : Promise.resolve({ items: [] }),
  });
  /** Chronological, then by period number, then by id: a tie never depends on the query order. */
  protected readonly rows = computed(() =>
    ordered(
      valueOf(this.periods)?.items ?? [],
      (p) => p.startDate,
      (p) => p.periodNumber,
    ),
  );
  protected readonly pendingReopens = computed(() =>
    this.rows()
      .filter((p) => p.reopenRequestPending)
      .map((p) => p.label),
  );

  protected statusOf(p: ClosePeriodSummary) {
    return PERIOD_STATUS[p.status];
  }
}
