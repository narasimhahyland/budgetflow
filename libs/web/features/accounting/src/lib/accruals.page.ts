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
import type { Accrual } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { formatMoney, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { ActualsTabs } from './actuals-tabs';
import { data, errorMessage, injectApi, todayIso, valueOf } from './api';
import { MatIconModule } from '@angular/material/icon';

const STATUS: Record<
  Accrual['status'],
  { tone: 'info' | 'success' | 'neutral' | 'warning'; text: string }
> = {
  proposed: { tone: 'warning', text: 'Proposed' },
  approved: { tone: 'info', text: 'Approved' },
  posted: { tone: 'success', text: 'Posted' },
  reversed: { tone: 'neutral', text: 'Reversed' },
  rejected: { tone: 'neutral', text: 'Rejected' },
};

/** Screen 80d (undesigned, built from the design system): accrual proposals, export, auto-reversal and prepaids. */
@Component({
  selector: 'bf-accruals-page',
  imports: [
    MatIconModule,
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
        <h1 class="bf-page__title">Accruals and prepaids</h1>
        <p class="bf-page__subtitle">
          Accruals cover commitments past their service end without an invoice; they never consume
          budget and reverse when the actual arrives or the next period starts. Prepaids are
          consumed in their service period.
        </p>
      </div>
    </header>
    <bf-actuals-tabs />
    @if (notice()) {
      <sat-banner variant="success" data-testid="accruals-notice"
        ><sat-banner-message>{{ notice() }}</sat-banner-message></sat-banner
      >
    }
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    @if (canManage()) {
      <section class="bf-card bf-filters" aria-label="Accrual run">
        <mat-form-field appearance="outline">
          <mat-label>As of</mat-label>
          <input matInput type="date" [ngModel]="asOf()" (ngModelChange)="asOf.set($event)" />
        </mat-form-field>
        <button
          mat-flat-button
          type="button"
          [disabled]="busy()"
          (click)="propose()"
          data-testid="propose-accruals"
        >
          Propose accruals
        </button>
        <button mat-stroked-button type="button" [disabled]="busy()" (click)="reverseDue()">
          Run auto-reversals
        </button>
        <button mat-stroked-button type="button" [disabled]="busy()" (click)="exportFile()">
          Export accrual journal (CSV)
        </button>
        <button mat-stroked-button type="button" [disabled]="busy()" (click)="recognize()">
          Recognize prepaids
        </button>
      </section>
    }
    <sat-banner variant="info">
      <sat-banner-message>
        Accruals record cost already incurred. They never consume budget and reverse automatically
        when the invoice arrives or when the next period starts.
      </sat-banner-message>
    </sat-banner>
    <div class="bf-kpis">
      <div class="bf-kpi bf-kpi--warning">
        <div class="bf-kpi__head">
          <p class="bf-kpi__label">Proposed</p>
          <mat-icon class="bf-kpi__icon" svgIcon="note_edit" aria-hidden="true" />
        </div>
        <p class="bf-kpi__value">{{ count('proposed') }}</p>
        <p class="bf-kpi__delta">Waiting for approval</p>
      </div>
      <div class="bf-kpi bf-kpi--success">
        <div class="bf-kpi__head">
          <p class="bf-kpi__label">Posted (accrued)</p>
          <mat-icon class="bf-kpi__icon" svgIcon="clock" aria-hidden="true" />
        </div>
        <p class="bf-kpi__value">{{ count('posted') }}</p>
        <p class="bf-kpi__delta">Accrued; never consumes budget</p>
      </div>
      <div class="bf-kpi">
        <div class="bf-kpi__head">
          <p class="bf-kpi__label">Reversed</p>
          <mat-icon class="bf-kpi__icon" svgIcon="undo" aria-hidden="true" />
        </div>
        <p class="bf-kpi__value">{{ count('reversed') }}</p>
        <p class="bf-kpi__delta">By the actual or the next period</p>
      </div>
    </div>
    <section class="bf-card" aria-labelledby="accruals-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="accruals-title">Accruals</h2>
      </div>
      @if (accruals.isLoading() && !valueOf(accruals)) {
        <bf-load-state [loading]="true" what="accruals" />
      } @else if (accruals.error()) {
        <bf-load-state [error]="accruals.error()" what="accruals" (retry)="accruals.reload()" />
      } @else if (items().length === 0) {
        <p class="bf-empty">
          No accruals yet. Propose accruals for commitments past their service end.
        </p>
      } @else {
        <div class="bf-table-scroll">
          <table mat-table class="bf-table" [dataSource]="items()" aria-label="Accruals">
            <ng-container matColumnDef="commitment">
              <th mat-header-cell *matHeaderCellDef>Commitment</th>
              <td mat-cell *matCellDef="let a">
                <span class="bf-cell__primary"
                  >{{ a.commitmentReference }} — {{ a.description }}</span
                >
                <span class="bf-cell__secondary">{{ a.budgetName }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="amount">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Accrued amount</th>
              <td mat-cell *matCellDef="let a" class="bf-num">
                <bf-money [amountMinor]="a.amount.amountMinor" [currency]="a.amount.currency" />
              </td>
            </ng-container>
            <ng-container matColumnDef="period">
              <th mat-header-cell *matHeaderCellDef>Period</th>
              <td mat-cell *matCellDef="let a">
                <span class="bf-cell__primary">{{ a.period.label }}</span>
                <span class="bf-cell__secondary"
                  >Reverses {{ a.autoReversePeriod?.label ?? 'with the actual' }}</span
                >
              </td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let a">
                <sat-status-tag [status]="status(a).tone">{{ status(a).text }}</sat-status-tag>
                @if (a.reversalTrigger) {
                  <span class="bf-cell__secondary">{{
                    a.reversalTrigger === 'actual' ? 'Actual arrived' : 'Next period started'
                  }}</span>
                }
                @if (a.exportedAt) {
                  <span class="bf-cell__secondary"
                    >Exported {{ a.exportedAt | date: 'd MMM' }}</span
                  >
                }
              </td>
            </ng-container>
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef><span class="bf-sr">Actions</span></th>
              <td mat-cell *matCellDef="let a">
                @if (canManage() && a.status === 'proposed') {
                  @if (rejecting() === a.id) {
                    <span class="bf-row-actions">
                      <mat-form-field appearance="outline">
                        <mat-label>Reason</mat-label>
                        <input matInput [ngModel]="reason()" (ngModelChange)="reason.set($event)" />
                      </mat-form-field>
                      <button
                        mat-button
                        type="button"
                        [disabled]="busy() || reason().trim().length < 5"
                        (click)="reject(a)"
                      >
                        Reject
                      </button>
                    </span>
                  } @else {
                    <span class="bf-row-actions">
                      <button
                        mat-flat-button
                        type="button"
                        [disabled]="busy()"
                        (click)="approve(a)"
                        [attr.data-testid]="'approve-' + a.commitmentReference"
                      >
                        Approve and post
                      </button>
                      <button
                        mat-button
                        type="button"
                        (click)="rejecting.set(a.id); reason.set('')"
                      >
                        Reject
                      </button>
                    </span>
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
    <section class="bf-card" aria-labelledby="prepaids-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="prepaids-title">Prepaids and deposits</h2>
        <span class="bf-muted">Consumed straight-line over the service days</span>
      </div>
      @if ((valueOf(prepaids)?.items ?? []).length === 0) {
        <p class="bf-empty">
          No prepaids. Match a deposit as a prepayment from the unmatched queue.
        </p>
      } @else {
        <div class="bf-table-scroll">
          <table
            mat-table
            class="bf-table"
            [dataSource]="valueOf(prepaids)!.items"
            aria-label="Prepaids"
          >
            <ng-container matColumnDef="commitment">
              <th mat-header-cell *matHeaderCellDef>Commitment</th>
              <td mat-cell *matCellDef="let p">
                <span class="bf-cell__primary">{{ p.commitmentReference }}</span>
                <span class="bf-cell__secondary"
                  >{{ p.budgetName }}{{ p.nonRefundable ? ' · non-refundable' : '' }}</span
                >
              </td>
            </ng-container>
            <ng-container matColumnDef="service">
              <th mat-header-cell *matHeaderCellDef>Service period</th>
              <td mat-cell *matCellDef="let p">
                {{ p.serviceStart | date: 'd MMM y' }} –
                {{ p.serviceEnd | date: 'd MMM y' }}
              </td>
            </ng-container>
            <ng-container matColumnDef="amount">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Deposit</th>
              <td mat-cell *matCellDef="let p" class="bf-num">
                <bf-money [amountMinor]="p.amount.amountMinor" [currency]="p.amount.currency" />
              </td>
            </ng-container>
            <ng-container matColumnDef="recognized">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Consumed (actual)</th>
              <td mat-cell *matCellDef="let p" class="bf-num">
                <bf-money
                  [amountMinor]="p.recognized.amountMinor"
                  [currency]="p.recognized.currency"
                />
              </td>
            </ng-container>
            <ng-container matColumnDef="remaining">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Still encumbered</th>
              <td mat-cell *matCellDef="let p" class="bf-num">
                <bf-money
                  [amountMinor]="p.remaining.amountMinor"
                  [currency]="p.remaining.currency"
                />
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="prepaidColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: prepaidColumns"></tr>
          </table>
        </div>
      }
    </section>
  `,
  styleUrls: ['./page.scss', './accounting.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccrualsPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly columns = ['commitment', 'amount', 'period', 'status', 'actions'];
  protected readonly prepaidColumns = [
    'commitment',
    'service',
    'amount',
    'recognized',
    'remaining',
  ];
  protected readonly canManage = computed(() => this.session.can('actuals.manage'));
  protected readonly accruals = resource({
    loader: () => data(this.api.listAccruals({ query: {} })),
  });
  protected readonly prepaids = resource({ loader: () => data(this.api.listPrepaids({})) });
  protected readonly items = computed(() => valueOf(this.accruals)?.items ?? []);
  protected readonly asOf = signal(todayIso());
  protected readonly rejecting = signal<string | null>(null);
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected status(a: Accrual) {
    return STATUS[a.status];
  }

  protected count(status: Accrual['status']): number {
    return this.items().filter((a) => a.status === status).length;
  }

  protected money(minor: number, currency: string): string {
    return formatMoney(minor, currency);
  }

  protected propose = () =>
    this.run(async () => {
      const r = await data(this.api.proposeAccruals({ body: { asOfDate: this.asOf() } }));
      this.notice.set(
        r.count
          ? `${r.count} accrual(s) proposed as of ${this.asOf()}.`
          : 'No commitment needs an accrual.',
      );
    });

  protected reverseDue = () =>
    this.run(async () => {
      const r = await data(this.api.reverseDueAccruals({ body: { asOfDate: this.asOf() } }));
      this.notice.set(`${r.count} accrual(s) reversed for the new period.`);
    });

  protected recognize = () =>
    this.run(async () => {
      const r = await data(this.api.recognizePrepaids({ body: { asOfDate: this.asOf() } }));
      this.notice.set(
        `${r.count} prepaid(s) recognized: ${this.money(r.recognizedMinor, r.currency)} moved to actual.`,
      );
    });

  protected exportFile = () =>
    this.run(async () => {
      const f = await data(this.api.exportAccruals({}));
      if (f.rows) {
        const url = URL.createObjectURL(new Blob([f.content], { type: f.contentType }));
        const a = document.createElement('a');
        a.href = url;
        a.download = f.fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
      this.notice.set(
        f.rows ? `${f.rows} accrual(s) exported to ${f.fileName}.` : 'Nothing new to export.',
      );
    });

  protected approve = (a: Accrual) =>
    this.run(async () => {
      await data(this.api.approveAccrual({ params: { accrualId: a.id } }));
      this.notice.set(
        `${a.commitmentReference} accrued: ${this.money(a.amount.amountMinor, a.amount.currency)}.`,
      );
    });

  protected reject = (a: Accrual) =>
    this.run(async () => {
      await data(
        this.api.rejectAccrual({ params: { accrualId: a.id }, body: { reason: this.reason() } }),
      );
      this.rejecting.set(null);
      this.notice.set(`${a.commitmentReference} accrual rejected.`);
    });

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.notice.set(null);
    try {
      await action();
      this.accruals.reload();
      this.prepaids.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
