import { ChangeDetectionStrategy, Component, computed, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { RequestSummary } from '@bf/contracts';
import { LoadState, Money } from '@bf/web/ui';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TABLE_WITH_ROW_STATES_IMPORTS } from '@hylandsoftware/satori-ui/table-with-row-states';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';

interface Row {
  r: RequestSummary;
  approvedMinor: number;
  usedMinor: number;
  openMinor: number;
  currency: string;
  receipt: 'due' | 'partly' | 'matched' | 'released';
}

// Section 5: a receipt still owed asks for action (warning); matched is done (success).
const RECEIPT: Record<
  Row['receipt'],
  { label: string; tone: 'warning' | 'info' | 'success' | 'neutral'; icon: string }
> = {
  due: { label: 'Receipt due', tone: 'warning', icon: 'clock' },
  partly: { label: 'Partly matched', tone: 'info', icon: 'trending_flat' },
  matched: { label: 'Matched', tone: 'success', icon: 'circle_check' },
  released: { label: 'Released', tone: 'neutral', icon: 'circle_minus' },
};

/** Screen 120: what was approved for me, how much is used (matched actuals) and what is still open. */
@Component({
  selector: 'bf-approved-page',
  imports: [
    LoadState,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TABLE_WITH_ROW_STATES_IMPORTS,
    SatStatusTag,
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
        <section class="bf-card bf-empty-card">
          <sat-empty-state>
            <h2 satEmptyStateHeadline>Nothing approved yet this year</h2>
            <p satEmptyStateDescription>
              Approved requests show here with what you have used and what is still open.
            </p>
            <a satEmptyStateAction mat-stroked-button routerLink="/requests/new">Request funds</a>
          </sat-empty-state>
        </section>
      } @else {
        <div class="bf-kpis" data-testid="approved-summary">
          <div class="bf-kpi bf-kpi--success">
            <div class="bf-kpi__head">
              <p class="bf-kpi__label">Approved</p>
              <mat-icon class="bf-kpi__icon" svgIcon="circle_check" aria-hidden="true" />
            </div>
            <p class="bf-kpi__value">
              <bf-money [amountMinor]="totals().approved" [currency]="totals().currency" />
            </p>
          </div>
          <div class="bf-kpi bf-kpi--actual">
            <div class="bf-kpi__head">
              <p class="bf-kpi__label">Used (receipts matched)</p>
              <mat-icon class="bf-kpi__icon" svgIcon="check_double" aria-hidden="true" />
            </div>
            <p class="bf-kpi__value">
              <bf-money [amountMinor]="totals().used" [currency]="totals().currency" />
            </p>
          </div>
          <div class="bf-kpi bf-kpi--warning">
            <div class="bf-kpi__head">
              <p class="bf-kpi__label">Open</p>
              <mat-icon class="bf-kpi__icon" svgIcon="shield_lock" aria-hidden="true" />
            </div>
            <p class="bf-kpi__value">
              <bf-money [amountMinor]="totals().open" [currency]="totals().currency" />
            </p>
          </div>
          <div class="bf-kpi bf-kpi--warning">
            <div class="bf-kpi__head">
              <p class="bf-kpi__label">Receipts due</p>
              <mat-icon class="bf-kpi__icon" svgIcon="upload" aria-hidden="true" />
            </div>
            <p class="bf-kpi__value">{{ totals().due }}</p>
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
          <ul class="bf-approved__cards" aria-label="Approved for you">
            @for (row of rows(); track row.r.id) {
              <li class="bf-approved__card">
                @let card = receipt(row.receipt);
                <sat-status-tag [status]="card.tone"
                  ><mat-icon [svgIcon]="card.icon" aria-hidden="true" />{{
                    card.label
                  }}</sat-status-tag
                >
                <a class="bf-cell__primary" [routerLink]="['/requests', row.r.id]">{{
                  row.r.title
                }}</a>
                <span class="bf-cell__secondary">{{ row.r.ref }} · {{ row.r.budgetName }}</span>
                <dl class="bf-approved__figures">
                  <div>
                    <dt>Approved</dt>
                    <dd>
                      <bf-money [amountMinor]="row.approvedMinor" [currency]="row.currency" />
                    </dd>
                  </div>
                  <div>
                    <dt>Used</dt>
                    <dd><bf-money [amountMinor]="row.usedMinor" [currency]="row.currency" /></dd>
                  </div>
                  <div>
                    <dt>Open</dt>
                    <dd><bf-money [amountMinor]="row.openMinor" [currency]="row.currency" /></dd>
                  </div>
                </dl>
                @if (row.receipt === 'due' || row.receipt === 'partly') {
                  <a
                    mat-stroked-button
                    routerLink="/requests/upload"
                    [queryParams]="{ request: row.r.id }"
                    >Upload receipt</a
                  >
                }
              </li>
            }
          </ul>
          <div class="bf-table-scroll bf-approved__table">
            <table
              mat-table
              satTableWithRowStates
              class="bf-table"
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
                  <span class="bf-cell__secondary"
                    ><span class="bf-cell__code">{{ row.r.ref }}</span> {{ row.r.budgetName }}</span
                  >
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
                  @let view = receipt(row.receipt);
                  <sat-status-tag [status]="view.tone" [attr.data-receipt]="row.receipt"
                    ><mat-icon [svgIcon]="view.icon" aria-hidden="true" />{{
                      view.label
                    }}</sat-status-tag
                  >
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
    /* Used is actual spend: section 10 draws actual in the tertiary colour. */
    .bf-kpi--actual {
      --bf-kpi-tone: var(--mat-sys-tertiary);
    }
    .bf-empty-card {
      padding: 24px 16px;
      overflow: visible;
    }
    .bf-approved__cards {
      display: none;
      flex-direction: column;
      gap: 12px;
      margin: 0;
      padding: 0 16px 16px;
      list-style: none;
    }
    .bf-approved__card {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      padding: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
    }
    .bf-approved__figures {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      width: 100%;
      margin: 0;
    }
    .bf-approved__figures dt {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-small);
    }
    .bf-approved__figures dd {
      margin: 0;
      font: var(--mat-sys-body-medium);
      font-variant-numeric: tabular-nums;
    }
    @media (width < 600px) {
      .bf-approved__cards {
        display: flex;
      }
      .bf-approved__table {
        display: none;
      }
    }
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

  protected receipt(k: Row['receipt']) {
    return RECEIPT[k];
  }
}
