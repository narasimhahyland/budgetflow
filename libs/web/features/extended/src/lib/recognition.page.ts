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
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type {
  GiveRecognitionRequest,
  Person,
  RecognitionAward,
  RecognitionAwardStatus,
  RecognitionAwardType,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const AWARD_STATUS_LABEL: Record<RecognitionAwardStatus, string> = {
  pending_approval: 'Waiting for approval',
  awarded: 'Awarded',
  redeemed: 'Redeemed',
  cancelled: 'Cancelled',
};

const AWARD_STATUS_TONE: Record<
  RecognitionAwardStatus,
  'warning' | 'success' | 'info' | 'neutral'
> = {
  pending_approval: 'warning',
  awarded: 'success',
  redeemed: 'info',
  cancelled: 'neutral',
};

const VALUE_TAG_LABEL: Record<string, string> = {
  customer_focus: 'Customer focus',
  teamwork: 'Teamwork',
  ownership: 'Ownership',
  learning: 'Learning',
};

interface GiveDialogData {
  types: readonly RecognitionAwardType[];
  people: readonly Person[];
}

/**
 * Give recognition (120a).
 *
 * A thank-you note moves no money and needs no budget, which is why it keeps working when a
 * Recognition budget is frozen. Every other award is real spend on that budget, so a type whose
 * funding is frozen is offered as disabled with the reason rather than quietly hidden.
 */
@Component({
  selector: 'bf-give-recognition-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    MatSelectModule,
    Money,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  template: `
    <h2 mat-dialog-title>Give recognition</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Who are you recognising?</mat-label>
        <mat-select [(ngModel)]="recipientPersonId" data-testid="recognition-recipient">
          @for (p of data.people; track p.id) {
            <mat-option [value]="p.id">{{ p.displayName }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <fieldset class="bf-give__types">
        <legend class="bf-give__legend">Award</legend>
        <mat-radio-group [(ngModel)]="awardTypeId" name="awardType">
          @for (t of data.types; track t.id) {
            <mat-radio-button
              [value]="t.id"
              [disabled]="t.fundingFrozen"
              [attr.data-testid]="'award-type-' + t.id"
            >
              <span class="bf-give__type">
                <span class="bf-cell__primary">{{ t.name }}</span>
                @if (t.amount) {
                  <bf-money [amountMinor]="t.amount.amountMinor" [currency]="t.amount.currency" />
                } @else {
                  <span class="bf-cell__secondary">No money attached</span>
                }
                @if (t.needsApproval) {
                  <span class="bf-cell__secondary">Needs your manager's approval</span>
                }
                @if (t.fundingFrozen) {
                  <span class="bf-cell__secondary">
                    Paused: {{ t.fundingBudgetName }} is frozen. Thank-you notes still work.
                  </span>
                }
              </span>
            </mat-radio-button>
          }
        </mat-radio-group>
      </fieldset>

      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Message</mat-label>
        <textarea
          matInput
          rows="4"
          [(ngModel)]="message"
          minlength="20"
          maxlength="500"
          data-testid="recognition-message"
        ></textarea>
        <mat-hint>{{ message().length }} of 500; at least 20 characters.</mat-hint>
      </mat-form-field>

      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Value</mat-label>
        <mat-select [(ngModel)]="valueTag" data-testid="recognition-value">
          <mat-option value="customer_focus">Customer focus</mat-option>
          <mat-option value="teamwork">Teamwork</mat-option>
          <mat-option value="ownership">Ownership</mat-option>
          <mat-option value="learning">Learning</mat-option>
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Who can see it</mat-label>
        <mat-select [(ngModel)]="visibility" data-testid="recognition-visibility">
          <mat-option value="private">Private, to them and their manager</mat-option>
          <mat-option value="public">Public, in the recognition feed</mat-option>
        </mat-select>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close()">Cancel</button>
      <button
        satImportantButton
        type="button"
        [disabled]="!canGive()"
        (click)="ref.close(request())"
        data-testid="recognition-give-confirm"
      >
        Give award
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .bf-field {
      width: 100%;
      margin-top: 12px;
    }
    .bf-give__types {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
      margin: 12px 0 0;
      padding: 12px;
    }
    .bf-give__legend {
      font: var(--mat-sys-label-large);
      padding: 0 4px;
    }
    .bf-give__types mat-radio-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .bf-give__type {
      display: inline-flex;
      flex-direction: column;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GiveRecognitionDialog {
  protected readonly data = inject<GiveDialogData>(MAT_DIALOG_DATA);
  protected readonly recipientPersonId = signal('');
  protected readonly awardTypeId = signal(this.data.types.find((t) => !t.fundingFrozen)?.id ?? '');
  protected readonly message = signal('');
  protected readonly valueTag = signal<'customer_focus' | 'teamwork' | 'ownership' | 'learning'>(
    'teamwork',
  );
  protected readonly visibility = signal<'public' | 'private'>('private');

  protected readonly ref =
    inject<MatDialogRef<GiveRecognitionDialog, GiveRecognitionRequest | undefined>>(MatDialogRef);

  protected readonly canGive = computed(
    () =>
      this.recipientPersonId().length > 0 &&
      this.awardTypeId().length > 0 &&
      this.message().trim().length >= 20,
  );

  protected request(): GiveRecognitionRequest {
    return {
      awardTypeId: this.awardTypeId(),
      recipientPersonId: this.recipientPersonId(),
      message: this.message().trim(),
      valueTag: this.valueTag(),
      visibility: this.visibility(),
    };
  }
}

/** Screen 120a: the recognition feed, the giver's allowance and the awards they may act on. */
@Component({
  selector: 'bf-recognition-page',
  imports: [
    DateTimePipe,
    LoadState,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Recognition</h1>
        <p class="bf-page__subtitle">Thank people properly, and pay for it from the right budget</p>
      </div>
      <div class="bf-page__actions">
        <button mat-flat-button type="button" (click)="give()" data-testid="give-recognition">
          <mat-icon svgIcon="star" />Thank someone
        </button>
      </div>
    </header>

    @if (failure(); as message) {
      <sat-banner variant="important" data-testid="recognition-error">
        <sat-banner-message>{{ message }}</sat-banner-message>
      </sat-banner>
    }

    <bf-load-state
      [loading]="feed.isLoading() && !feed.hasValue()"
      [error]="feed.error()"
      what="recognition"
      (retry)="feed.reload()"
    />

    @if (feed.hasValue()) {
      @if (allowances().length) {
        <section class="bf-card bf-section" data-testid="allowances">
          <h2 class="bf-section__title">Your recognition allowance</h2>
          @for (a of allowances(); track a.id) {
            <p [attr.data-testid]="'allowance-' + a.id">
              {{ a.periodKey }}:
              <bf-money [amountMinor]="a.remaining.amountMinor" [currency]="a.remaining.currency" />
              left of
              <bf-money [amountMinor]="a.granted.amountMinor" [currency]="a.granted.currency" />
              from {{ a.fundingBudgetName }}.
            </p>
          }
          <p class="bf-cell__secondary">
            Your allowance is one approved commitment on the Recognition budget. Each award you give
            draws on it; unused allowance is released at the end of the quarter.
          </p>
        </section>
      }

      @if (frozenTypes().length) {
        <sat-banner variant="info" data-testid="recognition-frozen">
          <sat-banner-message>
            {{ frozenTypes().join(', ') }}
            {{ frozenTypes().length === 1 ? 'is' : 'are' }} paused because the Recognition budget
            behind {{ frozenTypes().length === 1 ? 'it' : 'them' }} is frozen. Thank-you notes,
            which move no money, still work.
          </sat-banner-message>
        </sat-banner>
      }

      <section class="bf-card bf-section" data-testid="recognition-feed">
        <h2 class="bf-section__title">Recent recognition</h2>
        @if (awards().length === 0) {
          <sat-empty-state data-testid="recognition-empty">
            <h3 satEmptyStateHeadline>No recognition yet</h3>
            <p satEmptyStateDescription>Be the first to thank a colleague.</p>
            <button mat-stroked-button satEmptyStateAction type="button" (click)="give()">
              Thank someone
            </button>
          </sat-empty-state>
        } @else {
          <ul class="bf-awards">
            @for (a of awards(); track a.id) {
              <li class="bf-award" [attr.data-testid]="'award-' + a.id">
                <div class="bf-list__row">
                  <p class="bf-award__headline">
                    <strong>{{ a.giverName }}</strong> recognised
                    <strong>{{ a.recipientName }}</strong
                    >: {{ a.typeName }}
                  </p>
                  <sat-status-tag [status]="tone(a.status)">{{ label(a.status) }}</sat-status-tag>
                </div>
                <p class="bf-award__message">&ldquo;{{ a.message }}&rdquo;</p>
                <p class="bf-cell__secondary">
                  @if (a.valueTag) {
                    <span>{{ valueLabel(a.valueTag) }} &middot; </span>
                  }
                  @if (a.amount) {
                    <bf-money [amountMinor]="a.amount.amountMinor" [currency]="a.amount.currency" />
                  } @else {
                    <span>No money attached</span>
                  }
                  &middot;
                  <span data-testid="relative-time">{{
                    a.createdAt | bfDateTime: session.timezone()
                  }}</span>
                </p>
                @if (a.capWarning) {
                  <p class="bf-award__warning" [attr.data-testid]="'cap-warning-' + a.id">
                    <mat-icon svgIcon="info" class="bf-award__icon" />{{ a.capWarning }}
                  </p>
                }
                @if (a.status === 'pending_approval') {
                  <p class="bf-cell__secondary">
                    Waiting for {{ a.approverName ?? 'a manager' }} before any money is committed.
                  </p>
                }
                @if (a.status === 'awarded' && a.recipientPersonId === myPersonId()) {
                  <div class="bf-award__actions">
                    <button
                      mat-stroked-button
                      type="button"
                      (click)="redeem(a, 'payroll')"
                      [attr.data-testid]="'redeem-payroll-' + a.id"
                    >
                      Add to my next payroll (taxable)
                    </button>
                    <button
                      mat-button
                      type="button"
                      (click)="redeem(a, 'partner_catalogue')"
                      [attr.data-testid]="'redeem-partner-' + a.id"
                    >
                      Choose from the partner catalogue
                    </button>
                  </div>
                }
                @if (a.status === 'redeemed') {
                  <p class="bf-cell__secondary">
                    {{
                      a.rewardChoice === 'payroll'
                        ? 'Added to payroll.'
                        : 'A partner reward was chosen.'
                    }}
                    There is no cash or gift-card option.
                  </p>
                }
              </li>
            }
          </ul>
        }
      </section>

      <p class="bf-cell__secondary">
        Organising events is recognised too:
        <a routerLink="/participation">see how your office is taking part</a>.
      </p>
    }
  `,
  styles: `
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
    .bf-section > p {
      margin: 0;
    }
    .bf-awards {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .bf-award {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-medium);
    }
    .bf-award p {
      margin: 0;
    }
    .bf-award__headline {
      font: var(--mat-sys-body-large);
    }
    .bf-award__message {
      font-style: italic;
    }
    .bf-award__warning {
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--sat-sys-on-warning-container);
      background: var(--sat-sys-warning-container);
      border-radius: var(--mat-sys-corner-small);
      padding: 6px 8px;
    }
    .bf-award__icon {
      width: 16px;
      height: 16px;
    }
    .bf-award__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecognitionPage {
  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);

  protected readonly failure = signal<string | null>(null);
  protected readonly feed = resource({ loader: () => data(this.api.getRecognitionFeed({})) });
  /** The directory the giver picks a recipient from; roles that cannot read it simply get none. */
  private readonly directory = resource({
    loader: async (): Promise<readonly Person[]> => {
      try {
        return (await data(this.api.listPeople({ query: { limit: 100 } }))).items;
      } catch {
        return [];
      }
    },
  });

  protected readonly awards = computed(() => valueOf(this.feed)?.items ?? []);
  protected readonly allowances = computed(() => valueOf(this.feed)?.allowances ?? []);
  protected readonly awardTypes = computed(() => valueOf(this.feed)?.awardTypes ?? []);
  protected readonly frozenTypes = computed(() =>
    this.awardTypes()
      .filter((t) => t.fundingFrozen)
      .map((t) => t.name),
  );
  protected readonly myPersonId = computed(() => this.session.me()?.personId ?? null);

  protected label = (s: RecognitionAwardStatus) => AWARD_STATUS_LABEL[s];
  protected tone = (s: RecognitionAwardStatus) => AWARD_STATUS_TONE[s];
  protected valueLabel = (tag: string) => VALUE_TAG_LABEL[tag] ?? tag;

  protected give(): void {
    const me = this.myPersonId();
    this.dialog
      .open(GiveRecognitionDialog, {
        width: '560px',
        data: {
          types: this.awardTypes().filter((t) => t.active),
          // Nobody recognises themselves, so the giver is not offered as a recipient.
          people: (valueOf(this.directory) ?? []).filter((p) => p.id !== me),
        } satisfies GiveDialogData,
      })
      .afterClosed()
      .subscribe(async (request) => {
        if (!request) return;
        this.failure.set(null);
        try {
          const award = await data(this.api.giveRecognition({ body: request }));
          this.feed.reload();
          this.snackBar.open(
            award.status === 'pending_approval'
              ? 'Sent for approval. No money is committed until it is approved.'
              : `${award.recipientName} has been recognised.`,
            'Dismiss',
            { duration: 6000 },
          );
        } catch (error) {
          this.failure.set(errorMessage(error));
        }
      });
  }

  protected async redeem(
    award: RecognitionAward,
    rewardChoice: 'payroll' | 'partner_catalogue',
  ): Promise<void> {
    this.failure.set(null);
    try {
      await data(
        this.api.redeemRecognitionAward({
          params: { awardId: award.id },
          body: { rewardChoice },
        }),
      );
      this.feed.reload();
      this.snackBar.open(
        rewardChoice === 'payroll'
          ? 'Added to your next payroll. It is reported as a taxable benefit.'
          : 'You can now choose a reward from the partner catalogue.',
        'Dismiss',
        { duration: 6000 },
      );
    } catch (error) {
      this.failure.set(errorMessage(error));
    }
  }
}
