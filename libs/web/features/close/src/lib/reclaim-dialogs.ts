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
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import type {
  CreateReclaimCampaignRequest,
  ReclaimCampaignDetail,
  ReclaimCandidateList,
  ReclaimExecution,
  ReclaimPoolPreview,
} from '@bf/contracts';
import { formatMoney, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { data, errorMessage, injectApi, toMinor, todayIso, valueOf } from './api';

export interface NewCampaignData {
  fiscalYearId: string;
  fiscalYearLabel: string;
  currency: string;
}

/**
 * Screen 086a, new campaign: the criteria, the response window and a preview of the candidates
 * before any notice goes out. Sending creates the campaign and one notice per candidate; nothing is
 * reclaimed until an owner answers (or, after the deadline, their parent owner decides).
 */
@Component({
  selector: 'bf-new-reclaim-campaign-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatTableModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
  ],
  styleUrls: ['./dialogs.scss', './reclaim.scss'],
  template: `
    <h2 mat-dialog-title>New reclaim campaign</h2>
    <mat-dialog-content>
      <p class="bf-dialog__subtitle">
        Ask owners of budgets forecast to end {{ d.fiscalYearLabel }} with money left to release it
        or explain their plans. Released money moves by reductions to budgets that need it in the
        same legal entity; nothing is reclaimed automatically.
      </p>
      @if (step() === 'criteria') {
        <mat-form-field class="bf-field">
          <mat-label>Name</mat-label>
          <input
            matInput
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
            maxlength="120"
            data-testid="reclaim-name"
          />
          <mat-hint>For example “Q4 FY2026 reclaim”.</mat-hint>
        </mat-form-field>
        <div class="bf-reclaim__fields">
          <mat-form-field class="bf-field">
            <mat-label>Forecast unused above (% of authorized)</mat-label>
            <input
              matInput
              inputmode="numeric"
              [ngModel]="sharePct()"
              (ngModelChange)="sharePct.set($event)"
              data-testid="reclaim-share"
            />
          </mat-form-field>
          <mat-form-field class="bf-field">
            <mat-label>and above ({{ d.currency }})</mat-label>
            <input
              matInput
              inputmode="decimal"
              [ngModel]="minAmount()"
              (ngModelChange)="minAmount.set($event)"
              data-testid="reclaim-min-amount"
            />
          </mat-form-field>
          <mat-form-field class="bf-field">
            <mat-label>Fewer than this many days left</mat-label>
            <input
              matInput
              inputmode="numeric"
              [ngModel]="days()"
              (ngModelChange)="days.set($event)"
              data-testid="reclaim-days"
            />
          </mat-form-field>
          <mat-form-field class="bf-field">
            <mat-label>Respond by</mat-label>
            <input
              matInput
              type="date"
              [ngModel]="respondBy()"
              (ngModelChange)="respondBy.set($event)"
              data-testid="reclaim-respond-by"
            />
          </mat-form-field>
        </div>
        <p class="bf-note">
          Frozen and set-to-zero budgets are left out, as are budgets on “Carry full” or “Carry with
          approval” with a carry request still pending. The proposed amount is the run-rate forecast
          of what would lapse, never more than the budget's floor allows.
        </p>
      } @else {
        @if (candidates.isLoading()) {
          <p class="bf-note">Finding candidates…</p>
        } @else if (candidates.error()) {
          <sat-banner variant="important"
            ><sat-banner-message>{{ message(candidates.error()) }}</sat-banner-message></sat-banner
          >
        } @else if (rows().length === 0) {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>No budget meets the criteria</h3>
            <p satEmptyStateDescription>
              Nothing is forecast to lapse above the thresholds. Go back to widen the criteria.
            </p>
          </sat-empty-state>
        } @else {
          <p class="bf-note">
            {{ rows().length }} candidate{{ rows().length === 1 ? '' : 's' }} ·
            {{ list()?.daysLeft }} days left in the year
          </p>
          <div class="bf-table-scroll">
            <table mat-table class="bf-table" [dataSource]="rows()" aria-label="Candidates">
              <ng-container matColumnDef="budget">
                <th mat-header-cell *matHeaderCellDef>Budget</th>
                <td mat-cell *matCellDef="let c">
                  <span class="bf-cell__primary">{{ c.budgetName }}</span>
                  <span class="bf-cell__secondary"
                    >{{ c.ownerName ?? 'No owner' }} · {{ c.legalEntityCode }}</span
                  >
                </td>
              </ng-container>
              <ng-container matColumnDef="unused">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Forecast unused</th>
                <td mat-cell *matCellDef="let c" class="bf-num">
                  <bf-money
                    [amountMinor]="c.forecastUnused.amountMinor"
                    [currency]="c.forecastUnused.currency"
                  />
                </td>
              </ng-container>
              <ng-container matColumnDef="proposed">
                <th mat-header-cell *matHeaderCellDef class="bf-num">Proposed</th>
                <td mat-cell *matCellDef="let c" class="bf-num">
                  <bf-money
                    [amountMinor]="c.proposed.amountMinor"
                    [currency]="c.proposed.currency"
                  />
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="cols"></tr>
              <tr mat-row *matRowDef="let row; columns: cols"></tr>
            </table>
          </div>
        }
      }
      @if (failure()) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="bf-dialog__actions">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      @if (step() === 'criteria') {
        <button
          mat-flat-button
          type="button"
          [disabled]="!request()"
          (click)="step.set('preview')"
          data-testid="reclaim-preview"
        >
          Preview candidates
        </button>
      } @else {
        <button mat-stroked-button type="button" (click)="step.set('criteria')">Back</button>
        <button
          mat-flat-button
          type="button"
          [disabled]="busy() || rows().length === 0"
          (click)="send()"
          data-testid="reclaim-send"
        >
          Send notices
        </button>
      }
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewReclaimCampaignDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<NewReclaimCampaignDialog, ReclaimCampaignDetail>);
  protected readonly d = inject<NewCampaignData>(MAT_DIALOG_DATA);
  protected readonly cols = ['budget', 'unused', 'proposed'];
  protected readonly step = signal<'criteria' | 'preview'>('criteria');
  protected readonly name = signal('');
  protected readonly sharePct = signal('20');
  protected readonly minAmount = signal('1,000.00');
  protected readonly days = signal('90');
  protected readonly respondBy = signal(todayIso());
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly message = errorMessage;

  protected readonly request = computed<CreateReclaimCampaignRequest | null>(() => {
    const share = Number(this.sharePct());
    const days = Number(this.days());
    const min = toMinor(this.minAmount(), this.d.currency);
    if (!this.name().trim() || !Number.isInteger(share) || share < 0 || share > 100) return null;
    if (!Number.isInteger(days) || days < 1 || min === undefined || !this.respondBy()) return null;
    return {
      name: this.name().trim(),
      fiscalYearId: this.d.fiscalYearId,
      criteria: {
        minUnusedBps: share * 100,
        minUnused: { amountMinor: min, currency: this.d.currency },
        maxDaysLeft: days,
      },
      respondBy: this.respondBy(),
    };
  });

  protected readonly candidates = resource({
    params: () => (this.step() === 'preview' ? (this.request() ?? undefined) : undefined),
    loader: ({ params }) => data(this.api.previewReclaimCampaign({ body: params })),
  });
  protected readonly list = computed<ReclaimCandidateList | undefined>(() =>
    valueOf(this.candidates),
  );
  protected readonly rows = computed(() => this.list()?.items ?? []);

  protected async send(): Promise<void> {
    const body = this.request();
    if (!body) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.ref.close(await data(this.api.createReclaimCampaign({ body })));
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}

export interface ConfirmPoolData {
  campaignId: string;
  legalEntityId: string;
  currency: string;
  targets: { budgetId: string; amountMinor: number }[];
}

/**
 * Screen 086a, confirm: the reductions per source with their destination, the floor check per
 * source (never below committed + actual + children; pending requests listed, not floored), the
 * remainder that returns to parents, a reason code and typed reason. Confirm posts the whole pool
 * or nothing.
 */
@Component({
  selector: 'bf-confirm-reclaim-pool-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    Money,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  styleUrls: ['./dialogs.scss', './reclaim.scss'],
  template: `
    <h2 mat-dialog-title>Confirm the redistribution</h2>
    <mat-dialog-content>
      @if (preview.isLoading()) {
        <p class="bf-note">Checking floors…</p>
      } @else if (preview.error()) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ message(preview.error()) }}</sat-banner-message></sat-banner
        >
      } @else if (p(); as p) {
        <p class="bf-dialog__subtitle">
          {{ p.legalEntityCode }} pool {{ money(p.pool) }}: {{ money(p.allocated) }} to targets,
          {{ money(p.remainder) }} back to parents. Each move is a reduction with a destination; the
          ledger keeps both sides.
        </p>
        <h3 class="bf-section__title">Moves</h3>
        <div class="bf-table-scroll">
          <table mat-table class="bf-table" [dataSource]="p.legs" aria-label="Moves">
            <ng-container matColumnDef="source">
              <th mat-header-cell *matHeaderCellDef>From</th>
              <td mat-cell *matCellDef="let l">{{ l.sourceBudgetName }}</td>
            </ng-container>
            <ng-container matColumnDef="dest">
              <th mat-header-cell *matHeaderCellDef>To</th>
              <td mat-cell *matCellDef="let l">
                <span class="bf-cell__primary">{{ l.targetBudgetName }}</span>
                <span class="bf-cell__secondary">{{
                  l.destination === 'parent' ? 'Remainder to parent' : 'Reallocation'
                }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="amount">
              <th mat-header-cell *matHeaderCellDef class="bf-num">Amount</th>
              <td mat-cell *matCellDef="let l" class="bf-num">
                <bf-money [amountMinor]="l.amount.amountMinor" [currency]="l.amount.currency" />
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="legCols"></tr>
            <tr mat-row *matRowDef="let row; columns: legCols"></tr>
          </table>
        </div>
        <h3 class="bf-section__title">Floor check per source</h3>
        <ul class="bf-reclaim__floors">
          @for (s of p.sources; track s.budgetId) {
            <li [class.bf-reclaim__floor--bad]="!s.withinFloor">
              <strong>{{ s.budgetName }}</strong
              >: authorized {{ money(s.authorizedBefore) }} → {{ money(s.authorizedAfter) }}, floor
              {{ money(s.floor) }} (most {{ money(s.maxReclaimable) }})
              @if (s.pendingRequests.amountMinor > 0) {
                · pending requests {{ money(s.pendingRequests) }} are not floored and may go back to
                their requesters
              }
            </li>
          }
        </ul>
        @if (p.blockedReason) {
          <sat-banner variant="important"
            ><sat-banner-message>{{ p.blockedReason }}</sat-banner-message></sat-banner
          >
        }
        <mat-form-field class="bf-field">
          <mat-label>Reason code</mat-label>
          <mat-select
            [ngModel]="reasonCode()"
            (ngModelChange)="reasonCode.set($event)"
            data-testid="reclaim-reason-code"
          >
            @for (r of reasonCodes(); track r.code) {
              <mat-option [value]="r.code">{{ r.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field class="bf-field">
          <mat-label>Reason</mat-label>
          <textarea
            matInput
            rows="2"
            maxlength="500"
            [ngModel]="reason()"
            (ngModelChange)="reason.set($event)"
            data-testid="reclaim-reason"
          ></textarea>
          <mat-hint>Owners are notified when the money moves.</mat-hint>
        </mat-form-field>
      }
      @if (failure()) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="bf-dialog__actions">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-flat-button
        satImportantButton
        type="button"
        [disabled]="busy() || !ready()"
        (click)="confirm()"
        data-testid="reclaim-confirm"
      >
        Confirm
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmReclaimPoolDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<ConfirmReclaimPoolDialog, ReclaimExecution>);
  protected readonly d = inject<ConfirmPoolData>(MAT_DIALOG_DATA);
  protected readonly legCols = ['source', 'dest', 'amount'];
  protected readonly reasonCode = signal('RED-YEAR-END-RECLAIM');
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly message = errorMessage;
  protected readonly money = (m: { amountMinor: number; currency: string }) =>
    formatMoney(m.amountMinor, m.currency);

  protected readonly preview = resource({
    loader: () =>
      data(
        this.api.previewReclaimPool({
          params: { campaignId: this.d.campaignId },
          body: {
            legalEntityId: this.d.legalEntityId,
            currency: this.d.currency,
            targets: this.d.targets,
          },
        }),
      ),
  });
  protected readonly p = computed<ReclaimPoolPreview | undefined>(() => valueOf(this.preview));
  private readonly codes = resource({
    loader: () => data(this.api.listReasonCodes({ query: { category: 'reduction' } })),
  });
  protected readonly reasonCodes = computed(() => valueOf(this.codes)?.items ?? []);
  protected readonly ready = computed(
    () =>
      Boolean(this.p()?.canConfirm) &&
      Boolean(this.reasonCode()) &&
      this.reason().trim().length > 0,
  );

  protected async confirm(): Promise<void> {
    const p = this.p();
    if (!p) return;
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.ref.close(
        await data(
          this.api.executeReclaimPool({
            params: { campaignId: this.d.campaignId },
            body: {
              legalEntityId: this.d.legalEntityId,
              currency: this.d.currency,
              targets: this.d.targets,
              reasonCode: this.reasonCode(),
              reason: this.reason().trim(),
              confirmedFloors: p.sources.map((s) => ({
                budgetId: s.budgetId,
                floorMinor: s.floor.amountMinor,
              })),
            },
          }),
        ),
      );
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
