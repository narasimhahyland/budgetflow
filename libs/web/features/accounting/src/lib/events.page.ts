import { ChangeDetectionStrategy, Component, computed, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { ActualsTabs } from './actuals-tabs';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

/** Screen 53 (undesigned, built from the design system): events in reconciliation and what blocks their close. */
@Component({
  selector: 'bf-events-page',
  imports: [ActualsTabs, LoadState, MatButtonModule, MatTableModule, RouterLink, SAT_TAG_IMPORTS],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Event reconciliation</h1>
        <p class="bf-page__subtitle">
          An event closes when every actual with its event code is matched, cross-entity
          contributions have their recharge and open commitments are released or accrued.
        </p>
      </div>
    </header>
    <bf-actuals-tabs />
    <section class="bf-card" aria-label="Events">
      @if (list.isLoading() && !valueOf(list)) {
        <bf-load-state [loading]="true" what="events" />
      } @else if (list.error()) {
        <bf-load-state [error]="list.error()" what="events" (retry)="list.reload()" />
      } @else if (items().length === 0) {
        <p class="bf-empty">No events in progress or completed.</p>
      } @else {
        <div class="bf-table-scroll">
          <table mat-table [dataSource]="items()" aria-label="Events to reconcile">
            <ng-container matColumnDef="event">
              <th mat-header-cell *matHeaderCellDef>Event</th>
              <td mat-cell *matCellDef="let e">
                <a
                  class="bf-cell__primary"
                  [routerLink]="['/finance/actuals/events', e.id]"
                  [attr.data-testid]="'event-' + e.eventCode"
                  >{{ e.name }}</a
                >
                <span class="bf-cell__secondary">{{ e.eventCode }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let e">
                <sat-status-tag
                  [status]="e.status === 'closed' ? 'success' : 'neutral'"
                  [hideIcon]="e.status !== 'closed'"
                  >{{ statusText(e.status) }}</sat-status-tag
                >
              </td>
            </ng-container>
            <ng-container matColumnDef="unmatched">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Unmatched actuals</th>
              <td mat-cell *matCellDef="let e" class="bf-num">{{ e.unmatchedActuals }}</td>
            </ng-container>
            <ng-container matColumnDef="open">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Open commitments</th>
              <td mat-cell *matCellDef="let e" class="bf-num">{{ e.openCommitments }}</td>
            </ng-container>
            <ng-container matColumnDef="close">
              <th mat-header-cell *matHeaderCellDef>Close</th>
              <td mat-cell *matCellDef="let e">
                @if (e.status === 'closed') {
                  <sat-status-tag status="success">Closed</sat-status-tag>
                } @else if (e.canClose) {
                  <sat-status-tag status="info">Ready to close</sat-status-tag>
                } @else {
                  <sat-status-tag status="warning">Blocked</sat-status-tag>
                }
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
      }
    </section>
  `,
  styleUrls: ['./page.scss', './accounting.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventsPage {
  private readonly api = injectApi();
  protected readonly valueOf = valueOf;
  protected readonly columns = ['event', 'status', 'unmatched', 'open', 'close'];
  protected readonly list = resource({ loader: () => data(this.api.listEventReconciliations({})) });
  protected readonly items = computed(() => valueOf(this.list)?.items ?? []);

  protected statusText(s: string): string {
    return s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }
}
