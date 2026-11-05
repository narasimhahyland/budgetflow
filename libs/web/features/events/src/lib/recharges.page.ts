import { ChangeDetectionStrategy, Component, inject, resource, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, Money, SpendStatus } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

/** Screen 53a: intercompany recharges for cross-entity contributions; the tax approver signs them off. */
@Component({
  selector: 'bf-recharges-page',
  imports: [
    DateTimePipe,
    LoadState,
    MatButtonModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
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
          {{ valueOf(list)?.items?.length ?? 0 }} recharges
        </h2>
      </div>
      <bf-load-state
        [loading]="list.isLoading() && !list.hasValue()"
        [error]="list.error()"
        what="recharges"
        (retry)="list.reload()"
      />
      @if (list.hasValue()) {
        <div class="bf-table-scroll">
          <table class="bf-split-table" aria-label="Recharge schedule">
            <thead>
              <tr>
                <th>Contribution</th>
                <th>Event</th>
                <th>From (charging)</th>
                <th>To (charged)</th>
                <th>Mode</th>
                <th class="bf-num">Amount</th>
                <th class="bf-num">Markup</th>
                <th class="bf-num">Total</th>
                <th>Status</th>
                <th><span class="bf-cell__secondary">Actions</span></th>
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
                  <td>
                    @if (r.eventId) {
                      <a [routerLink]="['/events', r.eventId]">{{ r.eventName }}</a>
                    }
                  </td>
                  <td>{{ r.fromEntityName }}</td>
                  <td>{{ r.toEntityName }}</td>
                  <td>
                    {{
                      r.mode === 'recharge_with_markup'
                        ? 'With ' + r.markupBps / 100 + '% markup'
                        : 'At cost'
                    }}
                  </td>
                  <td class="bf-num">
                    <bf-money [amountMinor]="r.amount.amountMinor" [currency]="r.amount.currency" />
                  </td>
                  <td class="bf-num">
                    <bf-money [amountMinor]="r.markup.amountMinor" [currency]="r.markup.currency" />
                  </td>
                  <td class="bf-num">
                    <bf-money [amountMinor]="r.total.amountMinor" [currency]="r.total.currency" />
                  </td>
                  <td>
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
                  <td>
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
                </tr>
              } @empty {
                <tr>
                  <td colspan="10">
                    No recharges yet. They appear when a cross-entity contribution is approved.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </section>
  `,
  styleUrl: './page.scss',
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
