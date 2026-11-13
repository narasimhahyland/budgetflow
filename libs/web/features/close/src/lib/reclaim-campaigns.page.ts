import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { Router, RouterLink } from '@angular/router';
import type { ReclaimCampaign } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { LoadState } from '@bf/web/ui';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { data, injectApi, todayIso, valueOf } from './api';
import { CloseTag } from './close-tag';
import { NewReclaimCampaignDialog, type NewCampaignData } from './reclaim-dialogs';
import { CAMPAIGN_STATUS, moneyText } from './reclaim-format';

/**
 * Screen 086a, campaigns list: each reclaim campaign with its window, how many owners answered,
 * what they released and what has been redistributed. Starting one needs `reclaim.manage`.
 */
@Component({
  selector: 'bf-reclaim-campaigns-page',
  imports: [
    CloseTag,
    DatePipe,
    LoadState,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    RouterLink,
    SAT_EMPTY_STATE_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Reclaim campaigns</h1>
        <p class="bf-page__subtitle">
          Ask owners to release money forecast to lapse, then move what they release to budgets that
          need it in the same legal entity. Owners decide; nothing is reclaimed automatically.
        </p>
      </div>
      <div class="bf-page__actions">
        @if (canManage()) {
          <button mat-flat-button type="button" (click)="open()" data-testid="new-reclaim">
            <mat-icon svgIcon="plus_small" />New campaign
          </button>
        }
      </div>
    </header>

    <section class="bf-card" aria-labelledby="campaigns-title">
      <div class="bf-card__header">
        <div>
          <h2 class="bf-card__title" id="campaigns-title">Campaigns</h2>
          <p class="bf-card__hint">Newest first. Amounts are in each budget's currency.</p>
        </div>
      </div>
      @if (campaigns.isLoading() && !campaigns.hasValue()) {
        <bf-load-state [loading]="true" what="reclaim campaigns" />
      } @else if (campaigns.error()) {
        <bf-load-state
          [error]="campaigns.error()"
          what="reclaim campaigns"
          (retry)="campaigns.reload()"
        />
      } @else if (!rows().length) {
        <sat-empty-state>
          <h3 satEmptyStateHeadline>No reclaim campaigns yet</h3>
          <p satEmptyStateDescription>
            Start one before year end to find money that would otherwise lapse.
          </p>
          @if (canManage()) {
            <button mat-stroked-button type="button" satEmptyStateAction (click)="open()">
              New campaign
            </button>
          }
        </sat-empty-state>
      } @else {
        <div class="bf-table-scroll">
          <table mat-table class="bf-table" [dataSource]="rows()" aria-label="Reclaim campaigns">
            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>Campaign</th>
              <td mat-cell *matCellDef="let c">
                <a
                  class="bf-cell__primary"
                  [routerLink]="['/finance/reclaim', c.id]"
                  [attr.data-testid]="'campaign-' + c.id"
                  >{{ c.name }}</a
                >
              </td>
            </ng-container>
            <ng-container matColumnDef="started">
              <th mat-header-cell *matHeaderCellDef>Started</th>
              <td mat-cell *matCellDef="let c">{{ c.startedOn | date: 'd MMM y' }}</td>
            </ng-container>
            <ng-container matColumnDef="respondBy">
              <th mat-header-cell *matHeaderCellDef>Respond by</th>
              <td mat-cell *matCellDef="let c">{{ c.respondBy | date: 'd MMM y' }}</td>
            </ng-container>
            <ng-container matColumnDef="candidates">
              <th mat-header-cell *matHeaderCellDef>Candidates</th>
              <td mat-cell *matCellDef="let c">
                <span class="bf-cell__primary">{{ c.candidates }}</span>
                <span class="bf-cell__secondary">{{ c.answered }} answered</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="released">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Released</th>
              <td mat-cell *matCellDef="let c" class="bf-num">{{ amounts(c.released) }}</td>
            </ng-container>
            <ng-container matColumnDef="redistributed">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Redistributed</th>
              <td mat-cell *matCellDef="let c" class="bf-num">{{ amounts(c.redistributed) }}</td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let c">
                <span class="bf-tag-cell"><bf-close-tag [tag]="statusOf(c)" /></span>
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
      }
    </section>
  `,
  styleUrl: './close.scss',
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReclaimCampaignsPage {
  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  protected readonly columns = [
    'name',
    'started',
    'respondBy',
    'candidates',
    'released',
    'redistributed',
    'status',
  ];
  protected readonly campaigns = resource({
    loader: () => data(this.api.listReclaimCampaigns({})),
  });
  protected readonly rows = computed(() => valueOf(this.campaigns)?.items ?? []);
  protected readonly canManage = computed(() => this.session.can('reclaim.manage'));

  protected statusOf(c: ReclaimCampaign) {
    return CAMPAIGN_STATUS[c.status];
  }

  protected amounts(list: { amountMinor: number; currency: string }[]): string {
    return list.length ? list.map(moneyText).join(' · ') : '–';
  }

  protected open(): void {
    const years = this.session.me()?.fiscalYears ?? [];
    const today = todayIso();
    const fy =
      years.find((y) => y.startDate <= today && y.endDate >= today) ?? years[years.length - 1];
    if (!fy) return;
    const config: NewCampaignData = {
      fiscalYearId: fy.id,
      fiscalYearLabel: fy.label,
      currency: this.session.me()?.reportingCurrency ?? 'USD',
    };
    this.dialog
      .open(NewReclaimCampaignDialog, { data: config, width: '720px' })
      .afterClosed()
      .subscribe((detail) => {
        if (detail) void this.router.navigate(['/finance/reclaim', detail.campaign.id]);
      });
  }
}
