import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { PushItemView, PushKind } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { IntegrationsNav } from './integrations-nav';
import { type Tone } from './labels';
import { LoadState } from './load-state';
import { byNewest, byRank, byText, ordered, rankIn } from './order';

const STATUS_LABELS: Record<PushItemView['status'], string> = {
  pending: 'Waiting to be sent',
  pushed: 'Sent',
  failed: 'Failed',
  closed: 'Closed',
};

const STATUS_TONES: Record<PushItemView['status'], Tone> = {
  pending: 'info',
  pushed: 'success',
  failed: 'important',
  closed: 'neutral',
};

/** Screen 099b: event codes and card limits BudgetFlow pushes out, and whether they arrived. */
@Component({
  selector: 'bf-pushes-page',
  imports: [
    DateTimePipe,
    IntegrationsNav,
    LoadState,
    MatButtonModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Event codes and card limits</h1>
        <p class="bf-page__subtitle">
          What BudgetFlow sent to the card, expense and ERP systems, and what it is still waiting on
        </p>
      </div>
    </header>

    <bf-integrations-nav />

    <nav class="bf-tabs" aria-label="Push kinds">
      <button
        class="bf-tabs__tab"
        type="button"
        [class.bf-tabs__tab--active]="kind() === 'event_code'"
        [attr.aria-current]="kind() === 'event_code' ? 'page' : null"
        (click)="kind.set('event_code')"
        data-testid="tab-event-codes"
      >
        Event codes
      </button>
      <button
        class="bf-tabs__tab"
        type="button"
        [class.bf-tabs__tab--active]="kind() === 'card_limit'"
        [attr.aria-current]="kind() === 'card_limit' ? 'page' : null"
        (click)="kind.set('card_limit')"
        data-testid="tab-card-limits"
      >
        Card limits
      </button>
    </nav>

    @if (kind() === 'card_limit') {
      @if (cardLimitPushEnabled()) {
        <sat-banner variant="success" data-testid="card-limit-on">
          <sat-banner-message>
            <strong>Card-limit push is on.</strong> Approving a commitment paid by card creates a
            limit for the approved amount at the locked plan rate, and never more. Releasing or
            cancelling the commitment closes the limit.
          </sat-banner-message>
        </sat-banner>
      } @else {
        <sat-banner variant="info" data-testid="card-limit-off">
          <sat-banner-message>
            <strong>Card-limit push is off.</strong> BudgetFlow does not change spending power on
            any card. Approvals still govern budget; the card limits stay as the card provider has
            them. A Finance Admin turns it on from the card connector.
          </sat-banner-message>
        </sat-banner>
      }
    }

    @if (failed().length) {
      <sat-banner variant="important" data-testid="pushes-failed">
        <sat-banner-message>
          <strong
            >{{ failed().length }} {{ failed().length === 1 ? 'push' : 'pushes' }} did not
            arrive.</strong
          >
          The provider does not have
          {{ failed().length === 1 ? 'it' : 'them' }} yet, so whatever depends on
          {{ failed().length === 1 ? 'it' : 'them' }} is not in place.
          <a routerLink="/admin/integrations/errors">See why</a>.
        </sat-banner-message>
      </sat-banner>
    }

    @if (pushes.isLoading() && !valueOf(pushes)) {
      <section class="bf-card"><bf-load-state [loading]="true" what="the pushes" /></section>
    } @else if (pushes.error()) {
      <section class="bf-card">
        <bf-load-state [error]="pushes.error()" what="the pushes" (retry)="pushes.reload()" />
      </section>
    } @else if (items().length) {
      <section class="bf-card" aria-labelledby="pushes-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="pushes-title">
            {{ kind() === 'event_code' ? 'Event codes' : 'Card limits' }}
          </h2>
          <span class="bf-muted">{{ items().length }} shown</span>
        </div>
        <div class="bf-table-scroll">
          <table mat-table [dataSource]="items()" aria-label="Pushed items">
            <ng-container matColumnDef="reference">
              <th mat-header-cell *matHeaderCellDef>Reference</th>
              <td mat-cell *matCellDef="let p">
                <span class="bf-cell__primary">{{ p.reference }}</span>
                <span class="bf-cell__secondary">{{
                  p.externalId ?? 'No id at the provider'
                }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="amount">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Amount</th>
              <td mat-cell *matCellDef="let p" class="bf-num">
                @if (p.amount) {
                  <bf-money [amountMinor]="p.amount.amountMinor" [currency]="p.amount.currency" />
                } @else {
                  <span class="bf-muted">—</span>
                }
              </td>
            </ng-container>
            <ng-container matColumnDef="valid">
              <th mat-header-cell *matHeaderCellDef>Valid</th>
              <td mat-cell *matCellDef="let p">
                @if (p.validFrom || p.validTo) {
                  {{ p.validFrom ?? '—' }} to {{ p.validTo ?? '—' }}
                } @else {
                  <span class="bf-muted">No window</span>
                }
              </td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let p">
                <sat-status-tag [status]="statusTone(p.status)">{{
                  statusLabel(p.status)
                }}</sat-status-tag>
                @if (p.lastError) {
                  <span class="bf-cell__secondary bf-difference">{{ p.lastError }}</span>
                }
                @if (p.pushedAt) {
                  <span class="bf-cell__secondary" data-testid="relative-time">{{
                    p.pushedAt | bfDateTime: timezone()
                  }}</span>
                }
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr
              mat-row
              *matRowDef="let row; columns: columns"
              [attr.data-testid]="'push-row-' + row.reference"
            ></tr>
          </table>
        </div>
      </section>
    } @else {
      <section class="bf-card">
        <sat-empty-state data-testid="pushes-empty">
          <h2 satEmptyStateHeadline>
            {{ kind() === 'event_code' ? 'No event codes pushed' : 'No card limits pushed' }}
          </h2>
          <p satEmptyStateDescription>
            @if (kind() === 'event_code') {
              Event codes are pushed from an approved event, so spend made against them comes back
              matched.
            } @else {
              Card limits are created when a commitment paid by card is approved, and only while
              card-limit push is on.
            }
          </p>
        </sat-empty-state>
      </section>
    }

    <p class="bf-note" data-testid="pushes-origin">
      Pushes are created where the approval is: an event code from its approved event, a card limit
      from its approved commitment. Nothing on this screen raises a limit above what was approved.
    </p>
  `,
  styleUrls: ['./page.scss', './integrations.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PushesPage {
  private readonly api = injectApi();
  private readonly session = inject(SessionStore);
  protected readonly valueOf = valueOf;
  protected readonly timezone = computed(() => this.session.timezone());
  protected readonly columns = ['reference', 'amount', 'valid', 'status'];
  protected readonly kind = signal<PushKind>('event_code');

  protected readonly pushes = resource({
    params: () => ({ kind: this.kind() }),
    loader: ({ params }) => data(this.api.listIntegrationPushes({ query: params })),
  });

  protected readonly cardLimitPushEnabled = computed(
    () => valueOf(this.pushes)?.cardLimitPushEnabled ?? false,
  );

  /** Failures first, then what is still waiting, then the sent ones newest first. */
  protected readonly items = computed(() =>
    ordered(
      valueOf(this.pushes)?.items ?? [],
      byRank<PushItemView>((p) => rankIn(['failed', 'pending', 'pushed', 'closed'], p.status)),
      byNewest<PushItemView>((p) => p.pushedAt),
      byText<PushItemView>((p) => p.reference),
    ),
  );

  protected readonly failed = computed(() => this.items().filter((p) => p.status === 'failed'));

  protected statusLabel(status: PushItemView['status']): string {
    return STATUS_LABELS[status];
  }
  protected statusTone(status: PushItemView['status']): Tone {
    return STATUS_TONES[status];
  }
}
