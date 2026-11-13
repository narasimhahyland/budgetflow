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
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import type { ReclaimNotice, ReclaimPool } from '@bf/contracts';
import { formatMoney, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { data, errorMessage, injectApi, toMinor, valueOf } from './api';
import { CloseTag } from './close-tag';
import { ConfirmReclaimPoolDialog, type ConfirmPoolData } from './reclaim-dialogs';
import { CAMPAIGN_STATUS, moneyText, noticeTag, responseText } from './reclaim-format';

/**
 * Screen 086a, one campaign: every notice with its owner's answer, the money released per legal
 * entity, and the redistribution of each pool to budgets that need it. After the deadline an
 * unanswered notice can be sent to the parent owner; it is never reclaimed automatically.
 */
@Component({
  selector: 'bf-reclaim-campaign-page',
  imports: [
    CloseTag,
    DatePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
  ],
  template: `
    <a class="bf-back" routerLink="/finance/reclaim"
      ><mat-icon svgIcon="arrow_left" aria-hidden="true" />Reclaim campaigns</a
    >
    @if (detail.isLoading() && !detail.hasValue()) {
      <bf-load-state [loading]="true" what="the campaign" />
    } @else if (detail.error()) {
      <bf-load-state [error]="detail.error()" what="the campaign" (retry)="detail.reload()" />
    } @else if (d(); as d) {
      <header class="bf-page__header">
        <div class="bf-page__heading">
          <h1 class="bf-page__title">{{ d.campaign.name }}</h1>
          <p class="bf-page__subtitle">
            Started {{ d.campaign.startedOn | date: 'd MMM y' }} · respond by
            {{ d.campaign.respondBy | date: 'd MMM y' }} · {{ d.campaign.answered }} of
            {{ d.campaign.candidates }} answered
          </p>
        </div>
        <div class="bf-page__actions">
          <bf-close-tag [tag]="status()" />
        </div>
      </header>

      @if (d.campaign.status === 'completed') {
        <sat-banner variant="success">
          <sat-banner-message
            >Completed: {{ d.executions.length }} pool{{
              d.executions.length === 1 ? '' : 's'
            }}
            redistributed with {{ journalCount() }} journals. Owners were
            notified.</sat-banner-message
          >
        </sat-banner>
      } @else if (overdueCount() > 0) {
        <sat-banner variant="warning">
          <sat-banner-message
            >{{ overdueCount() }} notice{{ overdueCount() === 1 ? ' is' : 's are' }} past the
            deadline with no answer. Nothing is reclaimed without an answer: send each one to its
            parent owner to decide.</sat-banner-message
          >
        </sat-banner>
      }
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

      <section class="bf-card" aria-labelledby="notices-title">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="notices-title">Owner responses</h2>
            <p class="bf-card__hint">
              Forecast unused is the run-rate projection of what lapses at year end; the proposal
              never goes below the floor (committed + actual + children).
            </p>
          </div>
        </div>
        <div class="bf-table-scroll">
          <table mat-table class="bf-table" [dataSource]="d.notices" aria-label="Owner responses">
            <ng-container matColumnDef="budget">
              <th mat-header-cell *matHeaderCellDef>Budget</th>
              <td mat-cell *matCellDef="let n" class="bf-reclaim__budget">
                <span class="bf-cell__primary">{{ n.budgetName }}</span>
                <span class="bf-cell__secondary"
                  >{{ n.ownerName ?? 'No owner' }} · {{ n.legalEntityCode }}</span
                >
              </td>
            </ng-container>
            <ng-container matColumnDef="unused">
              <th mat-header-cell *matHeaderCellDef class="bf-num bf-reclaim__wide">
                Forecast unused
              </th>
              <td mat-cell *matCellDef="let n" class="bf-num bf-reclaim__wide">
                <bf-money
                  [amountMinor]="n.forecastUnused.amountMinor"
                  [currency]="n.forecastUnused.currency"
                />
              </td>
            </ng-container>
            <ng-container matColumnDef="proposed">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Proposed</th>
              <td mat-cell *matCellDef="let n" class="bf-num">
                <bf-money [amountMinor]="n.proposed.amountMinor" [currency]="n.proposed.currency" />
              </td>
            </ng-container>
            <ng-container matColumnDef="response">
              <th mat-header-cell *matHeaderCellDef>Response</th>
              <td mat-cell *matCellDef="let n">
                <span class="bf-tag-cell"><bf-close-tag [tag]="tagOf(n)" /></span>
                <span class="bf-cell__secondary">{{ responseOf(n) }}</span>
                @if (n.canEscalate) {
                  <button
                    mat-stroked-button
                    type="button"
                    class="bf-reclaim__row-action"
                    [disabled]="busy()"
                    (click)="escalate(n)"
                    [attr.data-testid]="'escalate-' + n.id"
                  >
                    Reclaim without response
                  </button>
                }
              </td>
            </ng-container>
            <ng-container matColumnDef="released">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Released</th>
              <td mat-cell *matCellDef="let n" class="bf-num">
                @if (n.released.amountMinor > 0) {
                  <bf-money
                    [amountMinor]="n.released.amountMinor"
                    [currency]="n.released.currency"
                  />
                } @else {
                  –
                }
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
      </section>

      <section class="bf-card" aria-labelledby="pools-title">
        <div class="bf-card__header">
          <div>
            <h2 class="bf-card__title" id="pools-title">Redistribute released money</h2>
            <p class="bf-card__hint">
              Money stays within its legal entity. What you do not assign to a target returns to
              each source's parent budget.
            </p>
          </div>
        </div>
        @if (!d.pools.length) {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>Nothing released yet</h3>
            <p satEmptyStateDescription>
              Pools appear here per legal entity as owners release money.
            </p>
          </sat-empty-state>
        } @else {
          @for (p of d.pools; track p.legalEntityId + p.released.currency) {
            <div class="bf-reclaim__pool" [attr.data-testid]="'pool-' + p.legalEntityCode">
              <h3 class="bf-reclaim__pool-title">
                {{ p.legalEntityCode }} pool:
                <bf-money [amountMinor]="p.released.amountMinor" [currency]="p.released.currency" />
                <span class="bf-muted">
                  from {{ p.sourceCount }} budget{{ p.sourceCount === 1 ? '' : 's' }}</span
                >
              </h3>
              @if (p.executionId) {
                <p class="bf-note">Redistributed. The journals are listed below.</p>
              } @else {
                @if (!p.suggestedTargets.length) {
                  <p class="bf-note">
                    No budget in this entity shows a need right now; the pool can return to the
                    parents.
                  </p>
                }
                @for (t of p.suggestedTargets; track t.budgetId) {
                  <div class="bf-reclaim__target">
                    <div>
                      <span class="bf-cell__primary">{{ t.budgetName }}</span>
                      <span class="bf-cell__secondary">{{ t.reason }}</span>
                    </div>
                    <mat-form-field class="bf-reclaim__amount" subscriptSizing="dynamic">
                      <mat-label>Allocate ({{ t.need.currency }})</mat-label>
                      <input
                        matInput
                        inputmode="decimal"
                        [ngModel]="amountFor(p, t.budgetId)"
                        (ngModelChange)="setAmount(p, t.budgetId, $event)"
                        [attr.data-testid]="'target-' + t.budgetId"
                      />
                    </mat-form-field>
                  </div>
                }
                <p class="bf-reclaim__remainder">
                  Remainder to parents: <strong>{{ remainderText(p) }}</strong>
                </p>
                @if (overAssigned(p)) {
                  <p class="bf-reclaim__error" role="alert">
                    The targets add up to more than the pool.
                  </p>
                }
                @if (d.canRedistribute) {
                  <button
                    mat-flat-button
                    type="button"
                    [disabled]="overAssigned(p) || invalid(p)"
                    (click)="review(p)"
                    [attr.data-testid]="'review-' + p.legalEntityCode"
                  >
                    Review and confirm
                  </button>
                }
              }
            </div>
          }
        }
      </section>

      @if (d.executions.length) {
        <section class="bf-card" aria-labelledby="executions-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="executions-title">Journals posted</h2>
          </div>
          @for (e of d.executions; track e.id) {
            <div class="bf-reclaim__pool">
              <h3 class="bf-reclaim__pool-title">
                {{ e.legalEntityCode }}: {{ money(e.allocated) }} to targets,
                {{ money(e.remainder) }} to parents
              </h3>
              <ul class="bf-facts-list">
                @for (l of e.legs; track $index) {
                  <li>
                    {{ l.sourceBudgetName }} → {{ l.targetBudgetName }} {{ money(l.amount) }} ({{
                      l.destination === 'parent' ? 'remainder to parent' : 'reallocation'
                    }})
                  </li>
                }
              </ul>
              <p class="bf-note">{{ e.reasonCode }}: {{ e.reason }}</p>
            </div>
          }
        </section>
      }
    }
  `,
  styleUrls: ['./close.scss', './reclaim.scss'],
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReclaimCampaignPage {
  private readonly api = injectApi();
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  protected readonly campaignId = computed(() => this.params().get('campaignId') ?? '');
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly columns = ['budget', 'unused', 'proposed', 'response', 'released'];
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  /** Typed target amounts per pool and budget, as the user entered them. */
  private readonly amounts = signal<Record<string, string>>({});

  protected readonly detail = resource({
    params: () => this.campaignId(),
    loader: ({ params }) => data(this.api.getReclaimCampaign({ params: { campaignId: params } })),
  });
  protected readonly d = computed(() => valueOf(this.detail));
  protected readonly status = computed(
    () => CAMPAIGN_STATUS[this.d()?.campaign.status ?? 'collecting'],
  );
  protected readonly overdueCount = computed(
    () => this.d()?.notices.filter((n) => n.overdue).length ?? 0,
  );
  protected readonly journalCount = computed(
    () => this.d()?.executions.reduce((s, e) => s + e.journalIds.length, 0) ?? 0,
  );
  protected readonly money = moneyText;

  protected tagOf(n: ReclaimNotice) {
    return noticeTag(n);
  }

  protected responseOf(n: ReclaimNotice) {
    return responseText(n);
  }

  private key(p: ReclaimPool, budgetId: string) {
    return `${p.legalEntityId}:${p.released.currency}:${budgetId}`;
  }

  protected amountFor(p: ReclaimPool, budgetId: string): string {
    return this.amounts()[this.key(p, budgetId)] ?? '';
  }

  protected setAmount(p: ReclaimPool, budgetId: string, value: string): void {
    this.amounts.update((a) => ({ ...a, [this.key(p, budgetId)]: value }));
  }

  private targets(p: ReclaimPool) {
    return p.suggestedTargets
      .map((t) => ({
        budgetId: t.budgetId,
        text: this.amountFor(p, t.budgetId).trim(),
        amountMinor: toMinor(this.amountFor(p, t.budgetId), p.released.currency),
      }))
      .filter((t) => t.text !== '');
  }

  protected invalid(p: ReclaimPool): boolean {
    return this.targets(p).some((t) => t.amountMinor === undefined);
  }

  private assigned(p: ReclaimPool): number {
    return this.targets(p).reduce((s, t) => s + (t.amountMinor ?? 0), 0);
  }

  protected overAssigned(p: ReclaimPool): boolean {
    return this.assigned(p) > p.released.amountMinor;
  }

  protected remainderText(p: ReclaimPool): string {
    return formatMoney(Math.max(p.released.amountMinor - this.assigned(p), 0), p.released.currency);
  }

  protected review(p: ReclaimPool): void {
    const config: ConfirmPoolData = {
      campaignId: this.campaignId(),
      legalEntityId: p.legalEntityId,
      currency: p.released.currency,
      targets: this.targets(p).map((t) => ({ budgetId: t.budgetId, amountMinor: t.amountMinor! })),
    };
    this.dialog
      .open(ConfirmReclaimPoolDialog, { data: config, width: '720px' })
      .afterClosed()
      .subscribe((exec) => {
        if (!exec) return;
        this.notice.set(
          `${exec.legalEntityCode} redistributed: ${this.money(exec.allocated)} to targets and ${this.money(exec.remainder)} back to parents, in ${exec.journalIds.length} journal${exec.journalIds.length === 1 ? '' : 's'}.`,
        );
        this.snack.open('Redistribution posted', 'Close', { duration: 4000 });
        this.detail.reload();
      });
  }

  protected async escalate(n: ReclaimNotice): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      await data(
        this.api.escalateReclaimNotice({
          params: { noticeId: n.id },
          body: { reason: `No answer by ${n.respondBy}` },
        }),
      );
      this.notice.set(
        `${n.budgetName} was sent to ${n.parentOwnerName ?? 'the parent owner'} to decide.`,
      );
      this.detail.reload();
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
