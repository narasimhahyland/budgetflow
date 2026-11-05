import { ChangeDetectionStrategy, Component, computed, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { RequestSummary } from '@bf/contracts';
import { Money } from '@bf/web/ui';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TABLE_WITH_ROW_STATES_IMPORTS } from '@hylandsoftware/satori-ui/table-with-row-states';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

interface Row {
  r: RequestSummary;
  approvedMinor: number;
  usedMinor: number;
  openMinor: number;
  currency: string;
  receipt: 'due' | 'partly' | 'matched' | 'released';
}

const RECEIPT: Record<Row['receipt'], string> = {
  due: 'Receipt due',
  partly: 'Partly matched',
  matched: 'Matched',
  released: 'Released',
};

/** Screen 120: what was approved for me, how much is used (matched actuals) and what is still open. */
@Component({
  selector: 'bf-approved-page',
  imports: [
    LoadState,
    MatButtonModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TABLE_WITH_ROW_STATES_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Approved for you</h1>
        <p class="bf-page__subtitle">
          What was approved, how much is used and what is still open to spend or claim
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/requests">My requests</a>
      </div>
    </header>
    <bf-load-state
      [loading]="list.isLoading() && !list.hasValue()"
      [error]="list.error()"
      what="your approvals"
      (retry)="list.reload()"
    />
    @if (list.hasValue()) {
      @if (rows().length === 0) {
        <section class="bf-card">
          <sat-empty-state>
            <h2 satEmptyStateHeadline>Nothing approved yet this year</h2>
            <p satEmptyStateDescription>
              Approved requests show here with what you have used and what is still open.
            </p>
            <a mat-stroked-button routerLink="/requests/new">Request funds</a>
          </sat-empty-state>
        </section>
      } @else {
        <div class="bf-kpis" data-testid="approved-summary">
          <div class="bf-kpi">
            <span class="bf-kpi__label">Approved</span>
            <span class="bf-kpi__value"
              ><bf-money [amountMinor]="totals().approved" [currency]="totals().currency"
            /></span>
          </div>
          <div class="bf-kpi">
            <span class="bf-kpi__label">Used (receipts matched)</span>
            <span class="bf-kpi__value"
              ><bf-money [amountMinor]="totals().used" [currency]="totals().currency"
            /></span>
          </div>
          <div class="bf-kpi">
            <span class="bf-kpi__label">Open</span>
            <span class="bf-kpi__value"
              ><bf-money [amountMinor]="totals().open" [currency]="totals().currency"
            /></span>
          </div>
          <div class="bf-kpi">
            <span class="bf-kpi__label">Receipts due</span>
            <span class="bf-kpi__value">{{ totals().due }}</span>
          </div>
        </div>
        <section class="bf-card" aria-labelledby="approved-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="approved-title">{{ rows().length }} approvals</h2>
            <span class="bf-card__hint"
              >Open money returns to the budget when finance matches the final receipt or the
              commitment is released.</span
            >
          </div>
          <div class="bf-table-scroll">
            <table
              mat-table
              satTableWithRowStates
              [dataSource]="rows()"
              aria-label="Approved for you"
            >
              <ng-container matColumnDef="request">
                <th mat-header-cell *matHeaderCellDef>Request</th>
                <td mat-cell *matCellDef="let row">
                  <a
                    satRowPrimaryAction
                    class="bf-cell__primary"
                    [routerLink]="['/requests', row.r.id]"
                    >{{ row.r.title }}</a
                  >
                  <span class="bf-cell__secondary">{{ row.r.ref }} · {{ row.r.budgetName }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="approved">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Approved</th>
                <td mat-cell *matCellDef="let row" class="bf-num">
                  <bf-money [amountMinor]="row.approvedMinor" [currency]="row.currency" />
                  @if (row.r.amount.currency !== row.currency) {
                    <span class="bf-cell__secondary"
                      ><bf-money
                        [amountMinor]="(row.r.approvedAmount ?? row.r.amount).amountMinor"
                        [currency]="row.r.amount.currency"
                    /></span>
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="used">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Used</th>
                <td mat-cell *matCellDef="let row" class="bf-num">
                  <bf-money [amountMinor]="row.usedMinor" [currency]="row.currency" />
                </td>
              </ng-container>
              <ng-container matColumnDef="open">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Open</th>
                <td mat-cell *matCellDef="let row" class="bf-num">
                  <bf-money [amountMinor]="row.openMinor" [currency]="row.currency" />
                </td>
              </ng-container>
              <ng-container matColumnDef="receipt">
                <th mat-header-cell *matHeaderCellDef>Receipt</th>
                <td mat-cell *matCellDef="let row">
                  <span class="bf-chip" [attr.data-receipt]="row.receipt">{{
                    receiptLabel(row.receipt)
                  }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef><span class="bf-sr-only">Actions</span></th>
                <td mat-cell *matCellDef="let row">
                  @if (row.receipt === 'due' || row.receipt === 'partly') {
                    <a
                      mat-button
                      routerLink="/requests/upload"
                      [queryParams]="{ request: row.r.id }"
                      >Upload receipt</a
                    >
                  }
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="columns"></tr>
              <tr mat-row satRowState *matRowDef="let row; columns: columns"></tr>
            </table>
          </div>
        </section>
      }
    }
  `,
  styles: `
    .bf-sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovedPage {
  private readonly api = injectApi();
  protected readonly columns = ['request', 'approved', 'used', 'open', 'receipt', 'actions'];

  protected readonly list = resource({
    loader: () =>
      data(this.api.listRequests({ query: { scope: 'mine', tab: 'approved', limit: 200 } })),
  });
  protected readonly rows = computed<Row[]>(() =>
    (valueOf(this.list)?.items ?? []).map((r) => {
      const committed = r.spend?.committed ?? r.budgetAmount ?? r.approvedAmount ?? r.amount;
      const usedMinor = r.spend?.used.amountMinor ?? 0;
      const releasedMinor = r.spend?.released.amountMinor ?? 0;
      const openMinor = Math.max(committed.amountMinor - usedMinor - releasedMinor, 0);
      const receipt: Row['receipt'] =
        openMinor === 0
          ? usedMinor > 0
            ? 'matched'
            : 'released'
          : usedMinor > 0
            ? 'partly'
            : 'due';
      return {
        r,
        approvedMinor: committed.amountMinor,
        usedMinor,
        openMinor,
        currency: committed.currency,
        receipt,
      };
    }),
  );
  protected readonly totals = computed(() => {
    const rows = this.rows();
    return {
      currency: rows[0]?.currency ?? 'USD',
      approved: rows.reduce((a, x) => a + x.approvedMinor, 0),
      used: rows.reduce((a, x) => a + x.usedMinor, 0),
      open: rows.reduce((a, x) => a + x.openMinor, 0),
      due: rows.filter((x) => x.receipt === 'due' || x.receipt === 'partly').length,
    };
  });

  protected receiptLabel(k: Row['receipt']): string {
    return RECEIPT[k];
  }
}
