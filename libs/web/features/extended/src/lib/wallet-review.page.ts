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
import {
  MatDialog,
  MatDialogModule,
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { WalletClaim } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateOnlyPipe, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { CLAIM_STATUS_LABEL, CLAIM_STATUS_TONE } from './wallets.page';

interface DecisionData {
  claim: WalletClaim;
  decision: 'approve' | 'return';
}

/** Approve or return a claim; either way the reviewer says why (120b). */
@Component({
  selector: 'bf-claim-decision-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>
      {{ data.decision === 'approve' ? 'Approve' : 'Return' }} {{ data.claim.personName }}'s claim
    </h2>
    <mat-dialog-content>
      <p>
        {{
          data.decision === 'approve'
            ? 'Approving moves the money from pre-encumbered to encumbered on the programme budget.'
            : 'Returning releases the pre-encumbrance in full. The employee can fix the claim and resubmit.'
        }}
      </p>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Reason</mat-label>
        <textarea
          matInput
          rows="3"
          [(ngModel)]="reason"
          maxlength="500"
          data-testid="decision-reason"
        ></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close()">Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="!reason().trim()"
        (click)="ref.close(reason().trim())"
        data-testid="decision-confirm"
      >
        {{ data.decision === 'approve' ? 'Approve claim' : 'Return claim' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .bf-field {
      width: 100%;
      margin-top: 12px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClaimDecisionDialog {
  protected readonly data = inject<DecisionData>(MAT_DIALOG_DATA);
  protected readonly reason = signal('');
  protected readonly ref =
    inject<MatDialogRef<ClaimDecisionDialog, string | undefined>>(MatDialogRef);
}

/** Screen 120b, reviewer queue: the claims a programme reviewer has to decide. */
@Component({
  selector: 'bf-wallet-review-page',
  imports: [
    DateOnlyPipe,
    LoadState,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Wallet claims to review</h1>
        <p class="bf-page__subtitle">Claims waiting on you as a programme reviewer</p>
      </div>
    </header>

    @if (failure(); as message) {
      <sat-banner variant="important" data-testid="review-error">
        <sat-banner-message>{{ message }}</sat-banner-message>
      </sat-banner>
    }

    <sat-banner variant="info" data-testid="review-note">
      <sat-banner-message>
        A submitted claim has already pre-encumbered its programme budget. Approving turns that into
        an encumbrance; returning releases it in full. Nobody reviews their own claim.
      </sat-banner-message>
    </sat-banner>

    <bf-load-state
      [loading]="queue.isLoading() && !queue.hasValue()"
      [error]="queue.error()"
      what="the claim queue"
      (retry)="queue.reload()"
    />

    @if (queue.hasValue()) {
      @if (claims().length === 0) {
        <sat-empty-state data-testid="review-empty">
          <h2 satEmptyStateHeadline>No claims waiting</h2>
          <p satEmptyStateDescription>Submitted claims for your programmes appear here.</p>
        </sat-empty-state>
      } @else {
        <div class="bf-table-scroll">
          <table class="bf-split-table" aria-label="Wallet claims waiting for review">
            <thead>
              <tr>
                <th>Person</th>
                <th>Programme</th>
                <th>Merchant</th>
                <th class="bf-num">Amount</th>
                <th>Date</th>
                <th>Receipt</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              @for (c of claims(); track c.id) {
                <tr [attr.data-testid]="'review-claim-' + c.id">
                  <td>{{ c.personName }}</td>
                  <td>{{ c.programName }}</td>
                  <td>
                    <span class="bf-cell__primary">{{ c.merchant }}</span>
                    <span class="bf-cell__secondary">{{ c.category }}</span>
                  </td>
                  <td class="bf-num">
                    <bf-money [amountMinor]="c.amount.amountMinor" [currency]="c.amount.currency" />
                    @if (c.amount.currency !== c.budgetAmount.currency) {
                      <span class="bf-cell__secondary">
                        <bf-money
                          [amountMinor]="c.budgetAmount.amountMinor"
                          [currency]="c.budgetAmount.currency"
                        />
                        at the plan rate
                      </span>
                    }
                  </td>
                  <td>{{ c.claimDate | bfDate: session.timezone() }}</td>
                  <td>
                    @if (c.documentId) {
                      <span class="bf-cell__secondary">Attached</span>
                    } @else {
                      <span class="bf-review__missing">
                        <mat-icon svgIcon="error" class="bf-review__icon" />No receipt
                      </span>
                    }
                  </td>
                  <td>
                    @if (c.status === 'submitted') {
                      <div class="bf-review__actions">
                        <button
                          mat-flat-button
                          type="button"
                          (click)="decide(c, 'approve')"
                          [attr.data-testid]="'approve-' + c.id"
                        >
                          Approve
                        </button>
                        <button
                          mat-stroked-button
                          type="button"
                          (click)="decide(c, 'return')"
                          [attr.data-testid]="'return-' + c.id"
                        >
                          Return
                        </button>
                      </div>
                    } @else {
                      <sat-status-tag [status]="tone(c)">{{ label(c) }}</sat-status-tag>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    }
  `,
  styles: `
    .bf-split-table {
      margin-top: 12px;
    }
    .bf-review__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .bf-review__missing {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--mat-sys-error);
    }
    .bf-review__icon {
      width: 16px;
      height: 16px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletReviewPage {
  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);

  protected readonly failure = signal<string | null>(null);
  protected readonly queue = resource({
    loader: () => data(this.api.listWalletClaims({ query: { status: 'submitted' } })),
  });
  protected readonly claims = computed(() => valueOf(this.queue)?.items ?? []);

  protected label = (c: WalletClaim) => CLAIM_STATUS_LABEL[c.status];
  protected tone = (c: WalletClaim) => CLAIM_STATUS_TONE[c.status];

  protected decide(claim: WalletClaim, decision: 'approve' | 'return'): void {
    this.dialog
      .open(ClaimDecisionDialog, {
        width: '480px',
        data: { claim, decision } satisfies DecisionData,
      })
      .afterClosed()
      .subscribe(async (reason) => {
        if (!reason) return;
        this.failure.set(null);
        try {
          await data(
            this.api.decideWalletClaim({
              params: { claimId: claim.id },
              body: { decision, reason },
            }),
          );
          this.queue.reload();
          this.snackBar.open(
            decision === 'approve'
              ? 'Approved. The programme budget is now encumbered for it.'
              : 'Returned. The pre-encumbrance is released in full.',
            'Dismiss',
            { duration: 6000 },
          );
        } catch (error) {
          this.failure.set(errorMessage(error));
        }
      });
  }
}
