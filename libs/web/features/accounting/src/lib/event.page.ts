import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, resource, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import {
  formatMoney,
  LoadState,
  Money,
  SpendStatus,
  spendStatus,
  type StatusView,
} from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { ActualsTabs } from './actuals-tabs';
import { data, errorMessage, injectApi, valueOf } from './api';
import { MatIconModule } from '@angular/material/icon';

/** Screens 53 and 54 (undesigned, built from the design system): event reconciliation and close with surplus returns. */
@Component({
  selector: 'bf-event-page',
  imports: [
    SpendStatus,
    MatIconModule,
    ActualsTabs,
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
    SatImportantButton,
  ],
  template: `
    <bf-actuals-tabs />
    @if (recon.isLoading() && !valueOf(recon)) {
      <section class="bf-card"><bf-load-state [loading]="true" what="the event" /></section>
    } @else if (recon.error()) {
      <section class="bf-card">
        <bf-load-state [error]="recon.error()" what="the event" (retry)="recon.reload()" />
      </section>
    } @else if (valueOf(recon); as r) {
      <header class="bf-page__header">
        <div class="bf-page__heading">
          <h1 class="bf-page__title">{{ r.event.name }}</h1>
          <p class="bf-page__subtitle">
            {{ r.event.eventCode }} · {{ r.event.budgetName ?? 'No event budget' }} ·
            <bf-spend-status kind="event" [status]="r.event.status" />
          </p>
        </div>
        <a mat-button routerLink="/finance/actuals/events">All events</a>
      </header>
      @if (notice()) {
        <sat-banner variant="success" data-testid="event-notice"
          ><sat-banner-message>{{ notice() }}</sat-banner-message></sat-banner
        >
      }
      @if (failure()) {
        <sat-banner variant="important" data-testid="event-error"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
      <div class="bf-kpis">
        <div class="bf-kpi bf-kpi--success">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Actual spend (plan rate)</p>
            <mat-icon class="bf-kpi__icon" svgIcon="check_double" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value">
            <bf-money [amountMinor]="r.spent.amountMinor" [currency]="r.spent.currency" />
          </p>
          <p class="bf-kpi__delta">{{ r.actuals.matched }} matched lines</p>
        </div>
        <div class="bf-kpi" [class.bf-kpi--warning]="r.actuals.unmatched > 0">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Unmatched actuals</p>
            <mat-icon class="bf-kpi__icon" svgIcon="report_problem" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value" data-testid="event-unmatched">{{ r.actuals.unmatched }}</p>
          <p class="bf-kpi__delta">
            <bf-money
              [amountMinor]="r.actuals.unmatchedReporting.amountMinor"
              [currency]="r.actuals.unmatchedReporting.currency"
            />
          </p>
        </div>
        <div class="bf-kpi">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">FX effect (separate)</p>
            <mat-icon class="bf-kpi__icon" svgIcon="compare" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value">
            <bf-money
              [amountMinor]="r.actuals.fxEffect.amountMinor"
              [currency]="r.actuals.fxEffect.currency"
            />
          </p>
          <p class="bf-kpi__delta">Never consumes budget</p>
        </div>
        <div class="bf-kpi">
          <div class="bf-kpi__head">
            <p class="bf-kpi__label">Surplus to return</p>
            <mat-icon class="bf-kpi__icon" svgIcon="currency_dollar" aria-hidden="true" />
          </div>
          <p class="bf-kpi__value">
            <bf-money [amountMinor]="r.surplus.amountMinor" [currency]="r.surplus.currency" />
          </p>
          <p class="bf-kpi__delta">Released to contributors at close</p>
        </div>
      </div>

      <section class="bf-card" aria-labelledby="close-title" data-testid="close-card">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="close-title">Close the event</h2>
        </div>
        <div class="bf-card__body bf-actions-col">
          @if (r.event.status === 'closed') {
            <sat-banner variant="info"
              ><sat-banner-message
                >The event is closed; the surplus was returned to each
                contributor.</sat-banner-message
              ></sat-banner
            >
          } @else {
            @for (b of r.blockers; track b.code) {
              <sat-banner variant="important" [attr.data-testid]="'blocker-' + b.code"
                ><sat-banner-message
                  >{{ b.message }} ({{ b.count }})</sat-banner-message
                ></sat-banner
              >
            }
            @if (r.canManage) {
              <mat-form-field appearance="outline">
                <mat-label>Reason</mat-label>
                <input
                  matInput
                  [ngModel]="reason()"
                  (ngModelChange)="reason.set($event)"
                  data-testid="close-reason"
                />
              </mat-form-field>
              <mat-checkbox
                [checked]="confirmed()"
                (change)="confirmed.set($event.checked)"
                data-testid="close-confirm"
              >
                I confirm the final cost of {{ money(r.spent.amountMinor, r.spent.currency) }}
              </mat-checkbox>
              <button
                mat-flat-button
                satImportantButton
                type="button"
                [disabled]="busy() || !r.canClose || !confirmed() || reason().trim().length < 5"
                (click)="close()"
                data-testid="close-event"
              >
                Close event and return {{ money(r.surplus.amountMinor, r.surplus.currency) }}
              </button>
              @if (!r.canClose) {
                <p class="bf-muted">Resolve the items above first.</p>
              }
            } @else {
              <p class="bf-muted" data-testid="close-organizer-note">
                The event's organizers close it once nothing above blocks it. Closing releases open
                commitments and returns each funding source's surplus.
              </p>
            }
          }
        </div>
      </section>

      <section class="bf-card" aria-labelledby="commitments-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="commitments-title">Commitments</h2>
        </div>
        @if (r.commitments.length === 0) {
          <p class="bf-empty">No commitments on this event.</p>
        } @else {
          <div class="bf-table-scroll">
            <table
              mat-table
              class="bf-table"
              [dataSource]="r.commitments"
              aria-label="Event commitments"
            >
              <ng-container matColumnDef="commitment">
                <th mat-header-cell *matHeaderCellDef>Commitment</th>
                <td mat-cell *matCellDef="let c">
                  <span class="bf-cell__primary">{{ c.reference }} — {{ c.description }}</span>
                  <span class="bf-cell__secondary"
                    >{{ c.vendorName ?? '' }} · service end
                    {{ c.serviceEnd ? (c.serviceEnd | date: 'd MMM y' : 'UTC') : '—' }}</span
                  >
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
              <ng-container matColumnDef="accrued">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Accrued</th>
                <td mat-cell *matCellDef="let c" class="bf-num">
                  <bf-money [amountMinor]="c.accrued.amountMinor" [currency]="c.accrued.currency" />
                </td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let c">
                  <bf-spend-status kind="commitment" [status]="c.status" />
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="commitmentColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: commitmentColumns"></tr>
            </table>
          </div>
        }
      </section>

      <section class="bf-card" aria-labelledby="contrib-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="contrib-title">
            Funding (own funds and Inter-Director Budget Contribution Requests)
          </h2>
        </div>
        @if (r.sources.length === 0) {
          <p class="bf-empty">No funding sources on this event.</p>
        } @else {
          <div class="bf-table-scroll">
            <table mat-table class="bf-table" [dataSource]="r.sources" aria-label="Funding sources">
              <ng-container matColumnDef="giver">
                <th mat-header-cell *matHeaderCellDef>Source</th>
                <td mat-cell *matCellDef="let c">
                  <span class="bf-cell__primary">{{ c.budgetName }}</span>
                  <span class="bf-cell__secondary"
                    >{{
                      c.kind === 'own'
                        ? 'Own funds'
                        : c.mode === 'earmark'
                          ? 'Contribution, earmark'
                          : 'Contribution, transfer'
                    }}{{
                      c.crossEntity
                        ? ' · cross-entity, recharge ' + (c.rechargeStatus ?? 'missing')
                        : ''
                    }}</span
                  >
                </td>
              </ng-container>
              <ng-container matColumnDef="approved">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Funded</th>
                <td mat-cell *matCellDef="let c" class="bf-num">
                  <bf-money [amountMinor]="c.funded.amountMinor" [currency]="c.funded.currency" />
                </td>
              </ng-container>
              <ng-container matColumnDef="held">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Committed or spent</th>
                <td mat-cell *matCellDef="let c" class="bf-num">
                  <bf-money
                    [amountMinor]="c.consumed.amountMinor"
                    [currency]="c.consumed.currency"
                  />
                </td>
              </ng-container>
              <ng-container matColumnDef="surplus">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Surplus returned at close</th>
                <td mat-cell *matCellDef="let c" class="bf-num">
                  <bf-money
                    [amountMinor]="c.surplusShare.amountMinor"
                    [currency]="c.surplusShare.currency"
                  />
                </td>
              </ng-container>
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef>Status</th>
                <td mat-cell *matCellDef="let c">
                  @let v = contribution(c.status);
                  <sat-status-tag [status]="v.tone"
                    ><mat-icon [svgIcon]="v.icon" aria-hidden="true" />{{ v.label }}</sat-status-tag
                  >
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="contribColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: contribColumns"></tr>
            </table>
          </div>
          @for (s of r.surplusReturns; track s.sourceId) {
            <p class="bf-card__body bf-muted">
              Returned
              <bf-money [amountMinor]="s.amount.amountMinor" [currency]="s.amount.currency" /> to
              {{ s.budgetName }}.
            </p>
          }
        }
      </section>
    }
  `,
  styleUrls: ['./page.scss', './accounting.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventPage {
  private readonly api = injectApi();
  readonly eventId = input.required<string>();
  protected readonly valueOf = valueOf;
  protected readonly commitmentColumns = ['commitment', 'encumbered', 'accrued', 'status'];
  protected readonly contribColumns = ['giver', 'approved', 'held', 'surplus', 'status'];
  protected readonly recon = resource({
    params: () => ({ eventId: this.eventId() }),
    loader: ({ params }) => data(this.api.getEventReconciliation({ params })),
  });
  protected readonly reason = signal('');
  protected readonly confirmed = signal(false);
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected money(minor: number, currency: string): string {
    return formatMoney(minor, currency);
  }

  /** A contributor's line: the contribution status, or Returned once its surplus share went back. */
  protected contribution(status: string): StatusView {
    return status === 'returned'
      ? { label: 'Returned', tone: 'success', icon: 'redo' }
      : spendStatus('contribution', status);
  }

  protected async close(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      const r = await data(
        this.api.closeEvent({
          params: { eventId: this.eventId() },
          body: { reason: this.reason() },
        }),
      );
      this.notice.set(
        `${r.event.name} closed; surplus returned to ${r.surplusReturns.length} funding source(s).`,
      );
      this.recon.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
