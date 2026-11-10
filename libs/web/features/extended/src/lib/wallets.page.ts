import { DecimalPipe, getNumberOfCurrencyDigits } from '@angular/common';
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
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { CreateWalletClaimRequest, Wallet, WalletClaimStatus } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateOnlyPipe, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, todayIso, valueOf } from './api';

export const CLAIM_STATUS_LABEL: Record<WalletClaimStatus, string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  paid: 'Paid',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

export const CLAIM_STATUS_TONE: Record<
  WalletClaimStatus,
  'info' | 'success' | 'important' | 'neutral'
> = {
  submitted: 'info',
  approved: 'success',
  paid: 'success',
  returned: 'important',
  cancelled: 'neutral',
};

interface ClaimDialogData {
  wallet: Wallet;
  /**
   * Whether a receipt can be attached at all. Every programme requires one, and the document
   * contract has no owner type for a wallet claim yet, so today this is always false and the form
   * says so rather than letting someone fill it in and be refused at the end.
   */
  canAttachReceipt: boolean;
}

/**
 * Claim from a wallet (120b).
 *
 * The claim is made against the programme, not against a wallet row: an employee who has never
 * claimed has an allowance but no wallet yet, and the first claim is what creates one. The check
 * line states what would be left afterwards, but it is only the wallet's own allowance — the
 * programme budget behind it is a second, harder limit, and the form says so rather than letting
 * a claim that fits the allowance look certain to succeed.
 */
@Component({
  selector: 'bf-wallet-claim-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
    Money,
  ],
  template: `
    <h2 mat-dialog-title>Claim from {{ data.wallet.programName }}</h2>
    <mat-dialog-content>
      @if (data.wallet.fundingFrozen) {
        <sat-banner variant="info" data-testid="claim-frozen">
          <sat-banner-message>
            New claims are paused while this programme's budget is frozen. Claims you have already
            submitted carry on being reviewed and paid.
          </sat-banner-message>
        </sat-banner>
      }
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Category</mat-label>
        <mat-select [(ngModel)]="category" data-testid="claim-category">
          @for (c of data.wallet.categories; track c) {
            <mat-option [value]="c">{{ c }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Merchant</mat-label>
        <input matInput [(ngModel)]="merchant" maxlength="160" data-testid="claim-merchant" />
      </mat-form-field>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Amount</mat-label>
        <span matTextPrefix>{{ data.wallet.balance.currency }}&nbsp;</span>
        <input
          matInput
          type="number"
          min="0.01"
          step="0.01"
          [(ngModel)]="amount"
          data-testid="claim-amount"
        />
      </mat-form-field>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Date of the spend</mat-label>
        <input matInput type="date" [(ngModel)]="claimDate" data-testid="claim-date" />
      </mat-form-field>
      <sat-banner variant="important" data-testid="claim-receipt-blocked">
        <sat-banner-message>
          Attach the receipt: this programme pays nothing without one. Attaching a receipt to a
          wallet claim is not available yet, so this claim cannot be submitted. Everything else on
          this page works as usual.
        </sat-banner-message>
      </sat-banner>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Note (optional)</mat-label>
        <textarea
          matInput
          rows="2"
          [(ngModel)]="note"
          maxlength="2000"
          data-testid="claim-note"
        ></textarea>
      </mat-form-field>

      <p class="bf-claim__check" data-testid="claim-check">
        @if (leftAfter() < 0) {
          More than your allowance allows.
        } @else {
          <bf-money [amountMinor]="leftAfter()" [currency]="data.wallet.balance.currency" /> left
          after this claim.
        }
      </p>
      @if (overBalance()) {
        <sat-banner variant="important" data-testid="claim-over-balance">
          <sat-banner-message
            >This claim is
            <bf-money [amountMinor]="-leftAfter()" [currency]="data.wallet.balance.currency" /> more
            than the
            <bf-money
              [amountMinor]="data.wallet.balance.amountMinor"
              [currency]="data.wallet.balance.currency"
            />
            left in your wallet.</sat-banner-message
          >
        </sat-banner>
      }
      <p class="bf-cell__secondary">
        The allowance is a cap on what you may claim. The programme budget behind it is a separate
        limit, so a claim that fits here can still be refused by the budget.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close()">Cancel</button>
      <button
        mat-flat-button
        satImportantButton
        type="button"
        [disabled]="!canSubmit()"
        (click)="ref.close(request())"
        data-testid="claim-submit"
      >
        Submit claim
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .bf-field {
      width: 100%;
      margin-top: 12px;
    }
    .bf-claim__check {
      margin: 12px 0 0;
      font: var(--mat-sys-title-small);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletClaimDialog {
  protected readonly data = inject<ClaimDialogData>(MAT_DIALOG_DATA);
  protected readonly category = signal(this.data.wallet.categories[0] ?? '');
  protected readonly merchant = signal('');
  protected readonly amount = signal<number | null>(null);
  protected readonly claimDate = signal(todayIso());
  protected readonly note = signal('');

  protected readonly ref =
    inject<MatDialogRef<WalletClaimDialog, CreateWalletClaimRequest | undefined>>(MatDialogRef);

  private readonly amountMinor = computed(() =>
    Math.round(
      (this.amount() ?? 0) * 10 ** getNumberOfCurrencyDigits(this.data.wallet.balance.currency),
    ),
  );

  protected readonly overBalance = computed(
    () => this.amountMinor() > this.data.wallet.balance.amountMinor,
  );

  protected readonly leftAfter = computed(
    () => this.data.wallet.balance.amountMinor - this.amountMinor(),
  );

  protected readonly canSubmit = computed(
    () =>
      this.data.canAttachReceipt &&
      !this.data.wallet.fundingFrozen &&
      !this.overBalance() &&
      this.amountMinor() > 0 &&
      this.merchant().trim().length > 0 &&
      this.category().length > 0,
  );

  protected request(): CreateWalletClaimRequest {
    return {
      // The wallet row may not exist yet, so the claim names the programme it draws on.
      programId: this.data.wallet.programId,
      category: this.category(),
      merchant: this.merchant().trim(),
      amountMinor: this.amountMinor(),
      currency: this.data.wallet.balance.currency,
      claimDate: this.claimDate(),
      ...(this.note().trim() ? { note: this.note().trim() } : {}),
    };
  }
}

/** Screen 120b: the employee's own wallets and the claims they have made. */
@Component({
  selector: 'bf-wallets-page',
  imports: [
    DecimalPipe,
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
        <h1 class="bf-page__title">My wallets</h1>
        <p class="bf-page__subtitle">Your wellbeing and learning allowances for this year</p>
      </div>
    </header>

    @if (failure(); as message) {
      <sat-banner variant="important" data-testid="wallet-error">
        <sat-banner-message>{{ message }}</sat-banner-message>
      </sat-banner>
    }

    <bf-load-state
      [loading]="overview.isLoading() && !overview.hasValue()"
      [error]="overview.error()"
      what="your wallets"
      (retry)="overview.reload()"
    />

    @if (overview.hasValue()) {
      @if (wallets().length === 0) {
        <sat-empty-state data-testid="wallets-empty">
          <h2 satEmptyStateHeadline>You have no wallets</h2>
          <p satEmptyStateDescription>
            Wallets are for employees; contractors and interns are not eligible by default. Ask
            People Ops if you think this is wrong.
          </p>
        </sat-empty-state>
      } @else {
        <div class="bf-wallets">
          @for (w of wallets(); track w.programId) {
            <article class="bf-card bf-wallet" [attr.data-testid]="'wallet-' + w.programId">
              <div class="bf-list__row">
                <h2 class="bf-wallet__name">{{ w.programName }}</h2>
                @if (w.fundingFrozen) {
                  <sat-status-tag status="info" [attr.data-testid]="'wallet-frozen-' + w.programId">
                    <mat-icon svgIcon="lock" />Paused
                  </sat-status-tag>
                }
              </div>
              <p class="bf-wallet__balance">
                <bf-money [amountMinor]="w.balance.amountMinor" [currency]="w.balance.currency" />
                left of
                <bf-money
                  [amountMinor]="w.proratedAllowance.amountMinor"
                  [currency]="w.proratedAllowance.currency"
                />
              </p>
              <div class="bf-wallet__use">
                <span class="bf-wallet__track" aria-hidden="true"
                  ><span class="bf-wallet__fill" [style.width.%]="usedPct(w)"></span
                ></span>
                <span class="bf-cell__secondary">{{ usedPct(w) | number: '1.0-0' }}% used</span>
              </div>
              @if (w.proratedAllowance.amountMinor !== w.allowance.amountMinor) {
                <p class="bf-cell__secondary">
                  Prorated from the full yearly allowance of
                  <bf-money
                    [amountMinor]="w.allowance.amountMinor"
                    [currency]="w.allowance.currency"
                  />
                  because you joined part-way through the year.
                </p>
              }
              @if (!w.id) {
                <p class="bf-cell__secondary" [attr.data-testid]="'wallet-unused-' + w.programId">
                  You have not claimed from this allowance yet.
                </p>
              }
              <p class="bf-cell__secondary">Pays for: {{ w.categories.join(', ') }}.</p>
              @if (w.lapsesOn) {
                <p class="bf-cell__secondary" [attr.data-testid]="'wallet-lapses-' + w.programId">
                  Unused money lapses on {{ w.lapsesOn | bfDate: session.timezone() }}.
                </p>
              }
              @if (w.fundingFrozen) {
                <p class="bf-wallet__paused" [attr.data-testid]="'wallet-paused-' + w.programId">
                  <mat-icon svgIcon="lock" class="bf-wallet__icon" />
                  Claims are paused while the programme budget is frozen. Claims already submitted
                  carry on.
                </p>
              }
              @if (w.closed) {
                <p class="bf-cell__secondary">
                  This wallet is closed. Claims made before it closed are still reviewed.
                </p>
              }
              <button
                mat-flat-button
                type="button"
                [disabled]="w.fundingFrozen || w.closed || w.balance.amountMinor <= 0"
                (click)="claim(w)"
                [attr.data-testid]="'claim-from-' + w.programId"
              >
                Claim
              </button>
            </article>
          }
        </div>

        <section class="bf-card bf-section" data-testid="claim-history">
          <h2 class="bf-section__title">Your claims</h2>
          @if (claims().length === 0) {
            <sat-empty-state data-testid="claims-empty">
              <h3 satEmptyStateHeadline>No claims yet</h3>
              <p satEmptyStateDescription>
                Choose Claim on one of your wallets above to be paid back for a purchase.
              </p>
            </sat-empty-state>
          } @else {
            <div class="bf-table-scroll">
              <table class="bf-split-table" aria-label="Your wallet claims">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Programme</th>
                    <th>Merchant</th>
                    <th class="bf-num">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of claims(); track c.id) {
                    <tr [attr.data-testid]="'claim-' + c.id">
                      <td>{{ c.claimDate | bfDate: session.timezone() }}</td>
                      <td>{{ c.programName }}</td>
                      <td>
                        <span class="bf-cell__primary">{{ c.merchant }}</span>
                        <span class="bf-cell__secondary">{{ c.category }}</span>
                      </td>
                      <td class="bf-num">
                        <bf-money
                          [amountMinor]="c.amount.amountMinor"
                          [currency]="c.amount.currency"
                        />
                        @if (c.amount.currency !== c.budgetAmount.currency) {
                          <span class="bf-cell__secondary">
                            <bf-money
                              [amountMinor]="c.budgetAmount.amountMinor"
                              [currency]="c.budgetAmount.currency"
                            />
                            against the budget
                          </span>
                        }
                      </td>
                      <td>
                        <sat-status-tag [status]="statusTone(c.status)">{{
                          statusLabel(c.status)
                        }}</sat-status-tag>
                        @if (c.status === 'returned' && c.decisionReason) {
                          <span class="bf-cell__secondary">{{ c.decisionReason }}</span>
                        }
                        @if (c.status === 'paid' && c.paidVia) {
                          <span class="bf-cell__secondary">
                            {{
                              c.paidVia === 'payroll' ? 'Through payroll' : 'On your expense report'
                            }}
                          </span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      }
    }
  `,
  styles: `
    .bf-wallet__use {
      display: flex;
      align-self: stretch;
      align-items: center;
      gap: 8px;
      max-width: 360px;
    }
    .bf-wallet__track {
      flex: 1;
      height: 6px;
      overflow: hidden;
      border-radius: var(--mat-sys-corner-full);
      background: var(--mat-sys-surface-container);
    }
    .bf-wallet__fill {
      display: block;
      height: 100%;
      background: var(--sat-sys-success-icon);
    }
    .bf-wallets {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .bf-wallet {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      padding: 16px;
    }
    .bf-wallet__name {
      margin: 0;
      font: var(--mat-sys-title-medium);
    }
    .bf-wallet p {
      margin: 0;
    }
    .bf-wallet__balance {
      font: var(--mat-sys-title-medium);
    }
    .bf-wallet__paused {
      display: flex;
      gap: 4px;
      align-items: center;
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-wallet__icon {
      width: 16px;
      height: 16px;
    }
    .bf-wallet > :last-child {
      margin-top: auto;
    }
    .bf-section {
      padding: 16px;
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bf-section__title {
      margin: 0;
      font: var(--mat-sys-title-small);
    }
    .bf-section p {
      margin: 0;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalletsPage {
  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);

  protected readonly failure = signal<string | null>(null);
  protected readonly overview = resource({ loader: () => data(this.api.getMyWallets({})) });
  protected readonly wallets = computed(() => valueOf(this.overview)?.wallets ?? []);

  /** Share of the allowance already claimed, for the bar (both amounts come from the API). */
  protected usedPct(w: Wallet): number {
    const total = w.proratedAllowance.amountMinor;
    return total <= 0
      ? 0
      : Math.min(100, Math.max(0, ((total - w.balance.amountMinor) * 100) / total));
  }
  protected readonly claims = computed(() => valueOf(this.overview)?.claims ?? []);

  protected statusLabel = (s: WalletClaimStatus) => CLAIM_STATUS_LABEL[s];
  protected statusTone = (s: WalletClaimStatus) => CLAIM_STATUS_TONE[s];

  protected claim(wallet: Wallet): void {
    this.dialog
      .open(WalletClaimDialog, {
        width: '520px',
        // Receipt upload for wallet claims needs a document owner type the contract does not
        // have yet, so the dialog opens in its blocked state and explains why.
        data: { wallet, canAttachReceipt: false } satisfies ClaimDialogData,
      })
      .afterClosed()
      .subscribe(async (request) => {
        if (!request) return;
        this.failure.set(null);
        try {
          await data(this.api.createWalletClaim({ body: request }));
          this.overview.reload();
          this.snackBar.open('Claim submitted for review.', 'Dismiss', { duration: 5000 });
        } catch (error) {
          this.failure.set(errorMessage(error));
        }
      });
  }
}
