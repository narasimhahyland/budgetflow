import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import type { ForecastCycle } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { CYCLE_STATUS } from './forecast-format';
import { NewForecastCycleDialog } from './forecast-dialogs';
import { LoadState } from './load-state';

/**
 * Screen 87a, cycle list: every reforecast round with how far it has got. Opening a cycle needs
 * `forecast.manage`; reading one is open to finance roles and to owners, who then see only the
 * budgets they own inside it.
 */
@Component({
  selector: 'bf-forecast-cycles-page',
  imports: [
    DatePipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    RouterLink,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Forecast cycles</h1>
        <p class="bf-page__subtitle">
          A reforecast round: finance opens it, owners say where their budgets will land, finance
          accepts, and closing it locks the snapshot that reports and the board pack read. A
          forecast posts nothing and consumes no budget.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/reports/forecast-variance">
          <mat-icon svgIcon="bar_chart" />Forecast and variance report
        </a>
        @if (canManage()) {
          <button mat-flat-button type="button" (click)="open()" data-testid="new-cycle">
            <mat-icon svgIcon="add" />New cycle
          </button>
        }
      </div>
    </header>

    <section class="bf-card" aria-labelledby="cycles-title">
      <div class="bf-card__header">
        <div>
          <h2 class="bf-card__title" id="cycles-title">Cycles</h2>
          <p class="bf-card__hint">Newest first. A closed cycle is an immutable snapshot.</p>
        </div>
      </div>
      @if (cycles.isLoading() && !cycles.hasValue()) {
        <bf-load-state [loading]="true" what="forecast cycles" />
      } @else if (cycles.error()) {
        <bf-load-state [error]="cycles.error()" what="forecast cycles" (retry)="cycles.reload()" />
      } @else if (!rows().length) {
        <sat-empty-state>
          <h3 satEmptyStateHeadline>No forecast cycles yet</h3>
          <p satEmptyStateDescription>
            Open one to ask owners where their budgets will land by year end.
          </p>
          @if (canManage()) {
            <button mat-stroked-button type="button" satEmptyStateAction (click)="open()">
              New cycle
            </button>
          }
        </sat-empty-state>
      } @else {
        <div class="bf-table-scroll">
          <table mat-table [dataSource]="rows()" aria-label="Forecast cycles">
            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>Cycle</th>
              <td mat-cell *matCellDef="let c">
                <a
                  class="bf-cell__primary"
                  [routerLink]="['/finance/forecast-cycles', c.id]"
                  [attr.data-testid]="'cycle-' + c.id"
                  >{{ c.name }}</a
                >
                <span class="bf-cell__secondary">{{ c.scopeLabel }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="asOf">
              <th mat-header-cell *matHeaderCellDef>As of</th>
              <td mat-cell *matCellDef="let c">{{ c.asOfDate | date: 'd MMM y' }}</td>
            </ng-container>
            <ng-container matColumnDef="due">
              <th mat-header-cell *matHeaderCellDef>Due</th>
              <td mat-cell *matCellDef="let c">{{ c.dueDate | date: 'd MMM y' }}</td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let c">
                <span class="bf-tag-cell"
                  ><sat-status-tag [status]="statusOf(c).tone">{{
                    statusOf(c).text
                  }}</sat-status-tag></span
                >
              </td>
            </ng-container>
            <ng-container matColumnDef="progress">
              <th mat-header-cell *matHeaderCellDef>Progress</th>
              <td mat-cell *matCellDef="let c">
                <span class="bf-cell__primary"
                  >{{ c.progress.accepted + c.progress.submitted }} of
                  {{ c.progress.budgets }} in</span
                >
                <span class="bf-cell__secondary">
                  {{ c.progress.commentaryRequired }} need commentary ·
                  {{ c.progress.overdue }} overdue
                </span>
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
      }
    </section>
  `,
  styleUrl: './close.scss',
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForecastCyclesPage {
  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  protected readonly columns = ['name', 'asOf', 'due', 'status', 'progress'];
  protected readonly canManage = computed(() => this.session.can('forecast.manage'));

  protected readonly cycles = resource({
    loader: () => data(this.api.listForecastCycles({ query: {} })),
  });
  /** The API orders newest first and breaks ties on name then id; the screen keeps that order. */
  protected readonly rows = computed(() => valueOf(this.cycles)?.items ?? []);

  protected statusOf(c: ForecastCycle) {
    return CYCLE_STATUS[c.status];
  }

  protected open(): void {
    const ref = this.dialog.open(NewForecastCycleDialog, {
      data: { currency: this.session.me()?.reportingCurrency ?? 'USD' },
      width: '560px',
    });
    ref.afterClosed().subscribe((detail) => {
      if (!detail) return;
      void this.router.navigate(['/finance/forecast-cycles', detail.cycle.id]);
    });
  }
}
