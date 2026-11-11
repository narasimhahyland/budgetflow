import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState, Money, SpendStatus } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { data, errorMessage, injectApi, valueOf } from './api';

/** Screen 53a: intercompany recharges for cross-entity contributions; the tax approver signs them off. */
@Component({
  selector: 'bf-recharges-page',
  imports: [
    DateTimePipe,
    DecimalPipe,
    LoadState,
    MatButtonModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SpendStatus,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Intercompany recharge schedule</h1>
        <p class="bf-page__subtitle">
          Cross-entity contributions recharged at cost or with a markup per the intercompany policy
        </p>
      </div>
    </header>
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    <section class="bf-card" aria-labelledby="recharges-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="recharges-title">
          {{ count() }} {{ count() === 1 ? 'recharge' : 'recharges' }}
        </h2>
      </div>
      <bf-load-state
        [loading]="list.isLoading() && !list.hasValue()"
        [error]="list.error()"
        what="recharges"
        (retry)="list.reload()"
      />
      @if (list.hasValue() && count() === 0) {
        <sat-empty-state>
          <h3 satEmptyStateHeadline>No recharges yet</h3>
          <p satEmptyStateDescription>
            They appear when a cross-entity Inter-Director Budget Contribution Request is approved.
          </p>
        </sat-empty-state>
      } @else if (list.hasValue()) {
        <div class="bf-table-scroll">
          <table class="bf-split-table bf-table--stack" aria-label="Recharge schedule">
            <thead>
              <tr>
                <th>Contribution</th>
                <th>Event</th>
                <th>From (charging)</th>
                <th>To (charged)</th>
                <th>Mode</th>
                <th class="bf-num bf-col--secondary">Amount</th>
                <th class="bf-num bf-col--secondary">Markup</th>
                <th class="bf-num">Total</th>
                <th>Status</th>
                @if (anyActions()) {
                  <th class="bf-num">Actions</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (r of valueOf(list)?.items ?? []; track r.id) {
                <tr>
                  <td>
                    @if (r.contributionId) {
                      <a [routerLink]="['/contributions', r.contributionId]">{{
                        r.contributionRef
                      }}</a>
                    }
                  </td>
                  <td data-label="Event">
                    @if (r.eventId) {
                      <a [routerLink]="['/events', r.eventId]">{{ r.eventName }}</a>
                    }
                  </td>
                  <td data-label="From (charging)">{{ r.fromEntityName }}</td>
                  <td data-label="To (charged)">{{ r.toEntityName }}</td>
                  <td data-label="Mode">
                    @if (r.mode === 'recharge_with_markup') {
                      With {{ r.markupBps / 100 | number: '1.0-2' }}% markup
                    } @else {
                      At cost
                    }
                  </td>
                  <td class="bf-num bf-col--secondary" data-label="Amount">
                    <bf-money [amountMinor]="r.amount.amountMinor" [currency]="r.amount.currency" />
                  </td>
                  <td class="bf-num bf-col--secondary" data-label="Markup">
                    <bf-money [amountMinor]="r.markup.amountMinor" [currency]="r.markup.currency" />
                  </td>
                  <td class="bf-num" data-label="Total">
                    <bf-money [amountMinor]="r.total.amountMinor" [currency]="r.total.currency" />
                  </td>
                  <td data-label="Status">
                    <bf-spend-status kind="recharge" [status]="r.status" />
                    <span class="bf-cell__secondary">{{
                      r.taxApproverName ? 'Tax approver ' + r.taxApproverName : ''
                    }}</span>
                    @if (r.taxApprovedAt) {
                      <span class="bf-cell__secondary" data-testid="relative-time">{{
                        r.taxApprovedAt | bfDateTime: session.timezone()
                      }}</span>
                    }
                  </td>
                  @if (anyActions()) {
                    <td class="bf-num">
                      @if (r.canApprove) {
                        <button
                          mat-flat-button
                          type="button"
                          [disabled]="busy()"
                          (click)="approve(r.id)"
                        >
                          Approve recharge
                        </button>
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styles: `
    /* At tablet width the schedule keeps the total and drops its two parts. */
    @media (600px <= width < 900px) {
      .bf-col--secondary {
        display: none;
      }
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RechargesPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  private readonly eventId = inject(ActivatedRoute).snapshot.queryParamMap.get('event');
  protected readonly count = computed(() => valueOf(this.list)?.items.length ?? 0);
  protected readonly anyActions = computed(() =>
    (valueOf(this.list)?.items ?? []).some((r) => r.canApprove),
  );
  protected readonly list = resource({
    loader: () =>
      data(this.api.listRecharges({ query: this.eventId ? { eventId: this.eventId } : {} })),
  });

  protected async approve(id: string): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await data(this.api.approveRecharge({ params: { rechargeId: id } }));
      this.snack.open('Recharge approved; the due-to / due-from journal is posted', undefined, {
        duration: 5000,
      });
      this.list.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
