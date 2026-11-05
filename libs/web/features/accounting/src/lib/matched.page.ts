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
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import type { ActualLine } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { ActualsTabs } from './actuals-tabs';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

/** Matched actuals with the budget amount, FX effect and the correction (linked reversal) action. */
@Component({
  selector: 'bf-matched-page',
  imports: [
    ActualsTabs,
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Matched actuals</h1>
        <p class="bf-page__subtitle">
          Posted to budgets at the locked plan rate; FX effect shown separately. Corrections post
          linked reversals and return the line to the queue.
        </p>
      </div>
    </header>
    <bf-actuals-tabs [queueCount]="valueOf(list)?.counts?.queue ?? null" />
    @if (notice()) {
      <sat-banner variant="success"
        ><sat-banner-message>{{ notice() }}</sat-banner-message></sat-banner
      >
    }
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    <section class="bf-card bf-filters" aria-label="Filters">
      <mat-form-field appearance="outline" class="bf-filters__search">
        <mat-label>Filter by vendor, description or reference</mat-label>
        <input matInput [ngModel]="search()" (ngModelChange)="search.set($event)" />
      </mat-form-field>
    </section>
    <section class="bf-card" aria-label="Matched actuals">
      @if (list.isLoading() && !valueOf(list)) {
        <bf-load-state [loading]="true" what="matched actuals" />
      } @else if (list.error()) {
        <bf-load-state [error]="list.error()" what="matched actuals" (retry)="list.reload()" />
      } @else if (items().length === 0) {
        <p class="bf-empty">No matched actuals yet.</p>
      } @else {
        <div class="bf-table-scroll">
          <table mat-table [dataSource]="items()" aria-label="Matched actuals">
            <ng-container matColumnDef="date">
              <th mat-header-cell *matHeaderCellDef>Date</th>
              <td mat-cell *matCellDef="let a">{{ a.transactionDate | date: 'd MMM y' }}</td>
            </ng-container>
            <ng-container matColumnDef="line">
              <th mat-header-cell *matHeaderCellDef>Line</th>
              <td mat-cell *matCellDef="let a">
                <span class="bf-cell__primary">{{
                  a.vendorName ?? a.merchant ?? a.memo ?? a.sourceRef
                }}</span>
                <span class="bf-cell__secondary">{{ a.sourceRef }} · {{ kindText(a) }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="transaction">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Transaction</th>
              <td mat-cell *matCellDef="let a" class="bf-num">
                <bf-money
                  [amountMinor]="a.transaction.amountMinor"
                  [currency]="a.transaction.currency"
                />
              </td>
            </ng-container>
            <ng-container matColumnDef="budget">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Budget at plan rate</th>
              <td mat-cell *matCellDef="let a" class="bf-num">
                @if (a.budget; as b) {
                  <bf-money [amountMinor]="b.amountMinor" [currency]="b.currency" />
                } @else {
                  —
                }
              </td>
            </ng-container>
            <ng-container matColumnDef="fx">
              <th mat-header-cell *matHeaderCellDef class="bf-num">FX effect (separate)</th>
              <td mat-cell *matCellDef="let a" class="bf-num">
                <bf-money [amountMinor]="a.fxEffect.amountMinor" [currency]="a.fxEffect.currency" />
              </td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let a">
                <sat-status-tag [status]="a.status === 'matched' ? 'success' : 'info'">{{
                  a.status === 'matched' ? 'Matched' : 'Partially matched'
                }}</sat-status-tag>
              </td>
            </ng-container>
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef><span class="bf-sr">Actions</span></th>
              <td mat-cell *matCellDef="let a">
                @if (canManage() && a.kind !== 'reversal') {
                  @if (undoing() === a.id) {
                    <span class="bf-row-actions">
                      <mat-form-field appearance="outline">
                        <mat-label>Reason for the correction</mat-label>
                        <input matInput [ngModel]="reason()" (ngModelChange)="reason.set($event)" />
                      </mat-form-field>
                      <button
                        mat-flat-button
                        type="button"
                        [disabled]="busy() || reason().trim().length < 5"
                        (click)="undo(a)"
                      >
                        Reverse match
                      </button>
                      <button mat-button type="button" (click)="undoing.set(null)">Cancel</button>
                    </span>
                  } @else {
                    <button mat-button type="button" (click)="undoing.set(a.id); reason.set('')">
                      Undo match
                    </button>
                  }
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
export class MatchedPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly columns = ['date', 'line', 'transaction', 'budget', 'fx', 'status', 'actions'];
  protected readonly canManage = computed(() => this.session.can('actuals.manage'));
  protected readonly search = signal('');
  protected readonly undoing = signal<string | null>(null);
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly list = resource({
    params: () => ({
      status: 'matched' as const,
      limit: 100,
      ...(this.search().trim() ? { q: this.search().trim() } : {}),
    }),
    loader: ({ params }) => data(this.api.listActuals({ query: params })),
  });
  protected readonly items = computed(() => valueOf(this.list)?.items ?? []);

  protected kindText(a: ActualLine): string {
    return {
      charge: 'Charge',
      refund: 'Refund',
      credit_note: 'Credit note',
      reversal: 'Source reversal',
    }[a.kind];
  }

  protected async undo(a: ActualLine): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await data(
        this.api.unmatchActual({
          params: { actualId: a.id },
          body: { reasonCode: 'CORRECTION', reason: this.reason() },
        }),
      );
      this.notice.set(`${a.sourceRef} reversed and back in the unmatched queue.`);
      this.undoing.set(null);
      this.list.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
