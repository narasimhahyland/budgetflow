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
import type { CommitmentHygieneItem } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { formatMoney, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { ActualsTabs } from './actuals-tabs';
import { data, errorMessage, injectApi, toMinor, valueOf } from './api';
import { LoadState } from './load-state';

/** Screen 85a (undesigned, built from the design system): commitment aging, release prompts, release and cancellation. */
@Component({
  selector: 'bf-commitments-page',
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
        <h1 class="bf-page__title">Commitment hygiene</h1>
        <p class="bf-page__subtitle">
          Open commitments by age since their service end. Release what will not be invoiced; a
          cancellation consumes its fee and any non-refundable deposit.
        </p>
      </div>
    </header>
    <bf-actuals-tabs />
    @if (notice()) {
      <sat-banner variant="success" data-testid="hygiene-notice"
        ><sat-banner-message>{{ notice() }}</sat-banner-message></sat-banner
      >
    }
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    @if (valueOf(list); as l) {
      <div class="bf-kpis">
        <div class="bf-kpi">
          <p class="bf-kpi__label">Open commitments</p>
          <p class="bf-kpi__value">{{ l.totals.open }}</p>
          <p class="bf-kpi__delta">
            <bf-money
              [amountMinor]="l.totals.encumbered.amountMinor"
              [currency]="l.totals.encumbered.currency"
            />
            encumbered
          </p>
        </div>
        <div class="bf-kpi bf-kpi--warning">
          <p class="bf-kpi__label">Release prompts</p>
          <p class="bf-kpi__value" data-testid="prompt-count">{{ l.totals.prompts }}</p>
          <p class="bf-kpi__delta">30+ days past service end, not accrued</p>
        </div>
        @for (b of l.totals.byBucket; track b.bucket) {
          <div class="bf-kpi">
            <p class="bf-kpi__label">
              {{ b.bucket === 'current' ? 'Not yet due' : b.bucket + ' days' }}
            </p>
            <p class="bf-kpi__value">{{ b.count }}</p>
            <p class="bf-kpi__delta">
              <bf-money
                [amountMinor]="b.encumberedMinor"
                [currency]="l.totals.encumbered.currency"
              />
            </p>
          </div>
        }
      </div>
    }
    <section class="bf-card" aria-label="Open commitments">
      @if (list.isLoading() && !valueOf(list)) {
        <bf-load-state [loading]="true" what="commitments" />
      } @else if (list.error()) {
        <bf-load-state [error]="list.error()" what="commitments" (retry)="list.reload()" />
      } @else if (items().length === 0) {
        <p class="bf-empty">No open commitments.</p>
      } @else {
        <div class="bf-table-scroll">
          <table mat-table [dataSource]="items()" aria-label="Open commitments">
            <ng-container matColumnDef="commitment">
              <th mat-header-cell *matHeaderCellDef>Commitment</th>
              <td mat-cell *matCellDef="let c">
                <span class="bf-cell__primary">{{ c.reference }} — {{ c.description }}</span>
                <span class="bf-cell__secondary"
                  >{{ c.budgetName }}{{ c.eventCode ? ' · ' + c.eventCode : ''
                  }}{{ c.vendorName ? ' · ' + c.vendorName : '' }}</span
                >
              </td>
            </ng-container>
            <ng-container matColumnDef="service">
              <th mat-header-cell *matHeaderCellDef>Service end</th>
              <td mat-cell *matCellDef="let c">
                <span class="bf-cell__primary">{{
                  c.serviceEnd ? (c.serviceEnd | date: 'd MMM y') : '—'
                }}</span>
                <span class="bf-cell__secondary">{{
                  c.daysPast ? c.daysPast + ' days ago' : 'Not yet due'
                }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="encumbered">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Encumbered</th>
              <td mat-cell *matCellDef="let c" class="bf-num">
                <bf-money
                  [amountMinor]="c.encumbered.amountMinor"
                  [currency]="c.encumbered.currency"
                />
              </td>
            </ng-container>
            <ng-container matColumnDef="consumed">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Consumed</th>
              <td mat-cell *matCellDef="let c" class="bf-num">
                <bf-money [amountMinor]="c.consumed.amountMinor" [currency]="c.consumed.currency" />
              </td>
            </ng-container>
            <ng-container matColumnDef="signals">
              <th mat-header-cell *matHeaderCellDef>Signals</th>
              <td mat-cell *matCellDef="let c">
                <span class="bf-chip-row">
                  @if (c.releasePrompt) {
                    <sat-status-tag status="warning">Release prompt</sat-status-tag>
                  }
                  @if (c.accrued.amountMinor) {
                    <sat-status-tag status="info"
                      >Accrued
                      {{ money(c.accrued.amountMinor, c.accrued.currency) }}</sat-status-tag
                    >
                  }
                  @if (c.prepaid.amountMinor) {
                    <sat-status-tag status="neutral" [hideIcon]="true"
                      >Deposit
                      {{ money(c.prepaid.amountMinor, c.prepaid.currency) }}</sat-status-tag
                    >
                  }
                  @if (c.nonRefundableDeposit.amountMinor) {
                    <sat-status-tag status="neutral" [hideIcon]="true"
                      >Non-refundable
                      {{
                        money(c.nonRefundableDeposit.amountMinor, c.nonRefundableDeposit.currency)
                      }}</sat-status-tag
                    >
                  }
                  <sat-status-tag
                    [status]="c.status === 'encumbered' ? 'neutral' : 'info'"
                    [hideIcon]="true"
                    >{{ statusText(c.status) }}</sat-status-tag
                  >
                </span>
              </td>
            </ng-container>
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef><span class="bf-sr">Actions</span></th>
              <td mat-cell *matCellDef="let c">
                @if (canManage()) {
                  @if (acting()?.id === c.id) {
                    <span class="bf-actions-col">
                      @if (acting()?.kind === 'cancel') {
                        <mat-form-field appearance="outline">
                          <mat-label>Cancellation fee ({{ c.encumbered.currency }})</mat-label>
                          <input
                            matInput
                            inputmode="decimal"
                            [ngModel]="fee()"
                            (ngModelChange)="fee.set($event)"
                          />
                        </mat-form-field>
                      }
                      <mat-form-field appearance="outline">
                        <mat-label>Reason</mat-label>
                        <input
                          matInput
                          [ngModel]="reason()"
                          (ngModelChange)="reason.set($event)"
                          [attr.data-testid]="'reason-' + c.reference"
                        />
                      </mat-form-field>
                      <span class="bf-row-actions">
                        <button
                          mat-flat-button
                          type="button"
                          [disabled]="busy() || reason().trim().length < 5"
                          (click)="confirm(c)"
                          [attr.data-testid]="'confirm-' + c.reference"
                        >
                          {{
                            acting()?.kind === 'cancel'
                              ? 'Cancel commitment'
                              : 'Release ' + money(c.encumbered.amountMinor, c.encumbered.currency)
                          }}
                        </button>
                        <button mat-button type="button" (click)="acting.set(null)">Back</button>
                      </span>
                    </span>
                  } @else {
                    <span class="bf-row-actions">
                      <button
                        mat-button
                        type="button"
                        (click)="start(c, 'release')"
                        [attr.data-testid]="'release-' + c.reference"
                      >
                        Release
                      </button>
                      @if (c.status === 'encumbered') {
                        <button mat-button type="button" (click)="start(c, 'cancel')">
                          Cancel
                        </button>
                      }
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
  `,
  styleUrls: ['./page.scss', './accounting.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitmentsPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly columns = [
    'commitment',
    'service',
    'encumbered',
    'consumed',
    'signals',
    'actions',
  ];
  protected readonly canManage = computed(() => this.session.can('actuals.manage'));
  protected readonly list = resource({
    loader: () => data(this.api.listCommitmentHygiene({ query: {} })),
  });
  protected readonly items = computed(() =>
    [...(valueOf(this.list)?.items ?? [])].sort(
      (a, b) => Number(b.releasePrompt) - Number(a.releasePrompt) || b.daysPast - a.daysPast,
    ),
  );
  protected readonly acting = signal<{ id: string; kind: 'release' | 'cancel' } | null>(null);
  protected readonly reason = signal('');
  protected readonly fee = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected money(minor: number, currency: string): string {
    return formatMoney(minor, currency);
  }

  protected statusText(s: string): string {
    return s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }

  protected start(c: CommitmentHygieneItem, kind: 'release' | 'cancel'): void {
    this.acting.set({ id: c.id, kind });
    this.reason.set('');
    this.fee.set('');
  }

  protected async confirm(c: CommitmentHygieneItem): Promise<void> {
    const kind = this.acting()?.kind;
    this.busy.set(true);
    this.failure.set(null);
    try {
      if (kind === 'cancel') {
        const r = await data(
          this.api.cancelCommitment({
            params: { commitmentId: c.id },
            body: {
              feeMinor: toMinor(this.fee(), c.encumbered.currency) ?? 0,
              reasonCode: 'CANCELLED',
              reason: this.reason(),
            },
          }),
        );
        this.notice.set(
          `${c.reference} cancelled: ${this.money(r.fees.amountMinor, r.fees.currency)} consumed as fees.`,
        );
      } else {
        await data(
          this.api.releaseCommitment({
            params: { commitmentId: c.id },
            body: { reasonCode: 'RELEASE', reason: this.reason() },
          }),
        );
        this.notice.set(
          `${c.reference} released: ${this.money(c.encumbered.amountMinor, c.encumbered.currency)} back to available.`,
        );
      }
      this.acting.set(null);
      this.list.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
