import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  resource,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { SessionStore } from '@bf/web/data-access';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { ActualsTabs } from './actuals-tabs';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

/** Screens 53 and 54 (undesigned, built from the design system): event reconciliation and close with surplus returns. */
@Component({
  selector: 'bf-event-page',
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
            <sat-status-tag
              [status]="r.event.status === 'closed' ? 'success' : 'neutral'"
              [hideIcon]="r.event.status !== 'closed'"
              >{{ statusText(r.event.status) }}</sat-status-tag
            >
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
          <p class="bf-kpi__label">Actual spend (plan rate)</p>
          <p class="bf-kpi__value">
            <bf-money [amountMinor]="r.spent.amountMinor" [currency]="r.spent.currency" />
          </p>
          <p class="bf-kpi__delta">{{ r.actuals.matched }} matched lines</p>
        </div>
        <div class="bf-kpi" [class.bf-kpi--warning]="r.actuals.unmatched > 0">
          <p class="bf-kpi__label">Unmatched actuals</p>
          <p class="bf-kpi__value" data-testid="event-unmatched">{{ r.actuals.unmatched }}</p>
          <p class="bf-kpi__delta">
            <bf-money
              [amountMinor]="r.actuals.unmatchedReporting.amountMinor"
              [currency]="r.actuals.unmatchedReporting.currency"
            />
          </p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">FX effect (separate)</p>
          <p class="bf-kpi__value">
            <bf-money
              [amountMinor]="r.actuals.fxEffect.amountMinor"
              [currency]="r.actuals.fxEffect.currency"
            />
          </p>
          <p class="bf-kpi__delta">Never consumes budget</p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">Surplus to return</p>
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
            @if (canManage()) {
              <mat-form-field appearance="outline">
                <mat-label>Reason</mat-label>
                <input
                  matInput
                  [ngModel]="reason()"
                  (ngModelChange)="reason.set($event)"
                  data-testid="close-reason"
                />
              </mat-form-field>
              <button
                mat-flat-button
                satImportantButton
                type="button"
                [disabled]="busy() || !r.canClose || reason().trim().length < 5"
                (click)="close()"
                data-testid="close-event"
              >
                Close event and return surplus
              </button>
              @if (!r.canClose) {
                <p class="bf-muted">Resolve the items above first.</p>
              }
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
            <table mat-table [dataSource]="r.commitments" aria-label="Event commitments">
              <ng-container matColumnDef="commitment">
                <th mat-header-cell *matHeaderCellDef>Commitment</th>
                <td mat-cell *matCellDef="let c">
                  <span class="bf-cell__primary">{{ c.reference }} — {{ c.description }}</span>
                  <span class="bf-cell__secondary"
                    >{{ c.vendorName ?? '' }} · service end
                    {{ c.serviceEnd ? (c.serviceEnd | date: 'd MMM y') : '—' }}</span
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
                  <sat-status-tag status="neutral" [hideIcon]="true">{{
                    statusText(c.status)
                  }}</sat-status-tag>
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
            Contributors (Inter-Director Budget Contribution Requests)
          </h2>
        </div>
        @if (r.contributions.length === 0 && r.surplusReturns.length === 0) {
          <p class="bf-empty">No co-funding on this event.</p>
        } @else {
          <div class="bf-table-scroll">
            <table mat-table [dataSource]="r.contributions" aria-label="Contributors">
              <ng-container matColumnDef="giver">
                <th mat-header-cell *matHeaderCellDef>Contributor</th>
                <td mat-cell *matCellDef="let c">
                  <span class="bf-cell__primary">{{ c.giverBudgetName }}</span>
                  <span class="bf-cell__secondary"
                    >{{ c.mode === 'earmark' ? 'Earmark' : 'Transfer'
                    }}{{
                      c.crossEntity
                        ? ' · cross-entity, recharge ' + (c.rechargeStatus ?? 'missing')
                        : ''
                    }}</span
                  >
                </td>
              </ng-container>
              <ng-container matColumnDef="approved">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Approved</th>
                <td mat-cell *matCellDef="let c" class="bf-num">
                  <bf-money
                    [amountMinor]="c.approved.amountMinor"
                    [currency]="c.approved.currency"
                  />
                </td>
              </ng-container>
              <ng-container matColumnDef="held">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Still earmarked</th>
                <td mat-cell *matCellDef="let c" class="bf-num">
                  <bf-money [amountMinor]="c.held.amountMinor" [currency]="c.held.currency" />
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
                  <sat-status-tag
                    [status]="c.status === 'settled' ? 'success' : 'neutral'"
                    [hideIcon]="c.status !== 'settled'"
                    >{{ statusText(c.status) }}</sat-status-tag
                  >
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="contribColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: contribColumns"></tr>
            </table>
          </div>
          @for (s of r.surplusReturns; track s.budgetId + s.contributionId) {
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
  private readonly session = inject(SessionStore);
  readonly eventId = input.required<string>();
  protected readonly valueOf = valueOf;
  protected readonly commitmentColumns = ['commitment', 'encumbered', 'accrued', 'status'];
  protected readonly contribColumns = ['giver', 'approved', 'held', 'surplus', 'status'];
  protected readonly canManage = computed(() => this.session.can('actuals.manage'));
  protected readonly recon = resource({
    params: () => ({ eventId: this.eventId() }),
    loader: ({ params }) => data(this.api.getEventReconciliation({ params })),
  });
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly failure = signal<string | null>(null);

  protected statusText(s: string): string {
    return s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
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
        `${r.event.name} closed; surplus returned to ${r.surplusReturns.length} contributor(s).`,
      );
      this.recon.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
