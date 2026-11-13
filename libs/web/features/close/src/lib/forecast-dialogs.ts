import { DatePipe, formatNumber } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { ErrorStateMatcher } from '@angular/material/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import type {
  ForecastCycle,
  ForecastCycleDetail,
  ForecastMethod,
  ForecastSubmission,
} from '@bf/contracts';
import { formatMoney, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_INTERACTIVE_CARD_IMPORTS } from '@hylandsoftware/satori-ui/interactive-card';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { ApiError, data, errorMessage, injectApi, toMinorAllowingZero, todayIso } from './api';
import { COMMENTARY_MIN, METHOD_LABELS } from './forecast-format';

/** Screen 87a: finance opens a round, with the due date and the threshold that asks for commentary. */
@Component({
  selector: 'bf-new-forecast-cycle-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    SAT_BANNER_IMPORTS,
  ],
  styleUrl: './dialogs.scss',
  template: `
    <h2 mat-dialog-title>Open a forecast cycle</h2>
    <mat-dialog-content>
      <p class="bf-dialog__subtitle">
        Owners forecast where their budgets will land by year end. A forecast posts nothing and
        consumes no budget; it is a projection beside the ledger, never a part of it.
      </p>
      <mat-form-field class="bf-field">
        <mat-label>Name</mat-label>
        <input
          matInput
          [ngModel]="name()"
          (ngModelChange)="name.set($event)"
          maxlength="120"
          data-testid="cycle-name"
        />
        <mat-hint>For example “November reforecast”.</mat-hint>
      </mat-form-field>
      <mat-form-field class="bf-field">
        <mat-label>As of</mat-label>
        <input
          matInput
          type="date"
          [ngModel]="asOfDate()"
          (ngModelChange)="asOfDate.set($event)"
          data-testid="cycle-as-of"
        />
        <mat-hint>The last closed or soft-closed period end the cycle forecasts from.</mat-hint>
      </mat-form-field>
      <mat-form-field class="bf-field">
        <mat-label>Due</mat-label>
        <input
          matInput
          type="date"
          [ngModel]="dueDate()"
          (ngModelChange)="dueDate.set($event)"
          data-testid="cycle-due"
        />
      </mat-form-field>
      <p class="bf-note">
        Commentary is required at or above 10% and {{ thresholdText }} of the authorized amount,
        both together, so small budgets with large percentages and large budgets with tiny
        percentages do not create noise.
      </p>
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
        type="button"
        [disabled]="busy() || !ready()"
        (click)="submit()"
        data-testid="confirm-new-cycle"
      >
        Open the cycle
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewForecastCycleDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<NewForecastCycleDialog, ForecastCycleDetail>);
  protected readonly d = inject<{ currency: string }>(MAT_DIALOG_DATA);
  protected readonly thresholdText = formatMoney(100_000, this.d.currency);
  protected readonly name = signal('');
  protected readonly asOfDate = signal(todayIso());
  protected readonly dueDate = signal(todayIso());
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly ready = computed(
    () => this.name().trim().length > 0 && this.dueDate() >= this.asOfDate(),
  );

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.ref.close(
        await data(
          this.api.createForecastCycle({
            body: {
              name: this.name().trim(),
              asOfDate: this.asOfDate(),
              dueDate: this.dueDate(),
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

/**
 * Screen 87a, owner submission: the system methods come from the API with their amounts and the one
 * sentence that explains each, so the owner checks a number rather than inventing one. A variance
 * above the cycle threshold is refused without commentary; that refusal lands on the commentary
 * field with the variance written out, not as a general failure banner.
 */
@Component({
  selector: 'bf-submit-forecast-dialog',
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    Money,
    SAT_BANNER_IMPORTS,
    SAT_INTERACTIVE_CARD_IMPORTS,
    SatImportantButton,
  ],
  styleUrl: './dialogs.scss',
  template: `
    <h2 mat-dialog-title>Forecast {{ line().budgetName ?? line().eventName }}</h2>
    <mat-dialog-content>
      <p class="bf-dialog__subtitle">
        {{ d.cycle.name }} · as of {{ d.cycle.asOfDate | date: 'd MMM y' }} · due
        {{ d.cycle.dueDate | date: 'd MMM y' }}. A forecast is not an actual: it posts nothing and
        consumes no budget.
      </p>

      @if (line().commentaryNote; as note) {
        <sat-banner variant="warning" data-testid="commentary-note">
          <sat-banner-message>
            <strong>Finance asked for more explanation.</strong> “{{ note }}”
          </sat-banner-message>
        </sat-banner>
      }

      <div class="bf-panel">
        <dl class="bf-rows">
          <div>
            <dt>Authorized</dt>
            <dd>
              <bf-money
                [amountMinor]="line().authorized.amountMinor"
                [currency]="line().authorized.currency"
              />
            </dd>
          </div>
          <div>
            <dt>Actual to date</dt>
            <dd>
              <bf-money
                [amountMinor]="line().actualToDate.amountMinor"
                [currency]="line().actualToDate.currency"
              />
            </dd>
          </div>
          <div>
            <dt>Committed</dt>
            <dd>
              <bf-money
                [amountMinor]="line().committed.amountMinor"
                [currency]="line().committed.currency"
              />
            </dd>
          </div>
          <div>
            <dt>Requests waiting</dt>
            <dd>
              <bf-money
                [amountMinor]="line().pending.amountMinor"
                [currency]="line().pending.currency"
              />
            </dd>
          </div>
          <div>
            <dt>Planned events, not committed</dt>
            <dd>
              <bf-money
                [amountMinor]="line().plannedEvents.amountMinor"
                [currency]="line().plannedEvents.currency"
              />
            </dd>
          </div>
        </dl>
      </div>

      <h3 class="bf-section__title">How should the year-end figure be worked out?</h3>
      <mat-radio-group
        class="bf-method-cards"
        [ngModel]="method()"
        (ngModelChange)="pick($event)"
        aria-label="Forecast method"
      >
        @for (option of line().methodOptions; track option.method) {
          <sat-interactive-card [active]="method() === option.method">
            <mat-radio-button
              satInteractiveCardSelectionControl
              [value]="option.method"
              [attr.aria-label]="label(option.method)"
              [attr.data-testid]="'method-' + option.method"
            />
            <span satInteractiveCardTitle class="bf-method__title">{{ label(option.method) }}</span>
            <sat-interactive-card-content>
              <p class="bf-method__amount">
                <bf-money
                  [amountMinor]="option.amount.amountMinor"
                  [currency]="option.amount.currency"
                />
              </p>
              <p class="bf-method__why">{{ option.explanation }}</p>
            </sat-interactive-card-content>
          </sat-interactive-card>
        }
        <sat-interactive-card [active]="method() === 'owner_input'">
          <mat-radio-button
            satInteractiveCardSelectionControl
            value="owner_input"
            aria-label="My own figure"
            data-testid="method-owner_input"
          />
          <span satInteractiveCardTitle class="bf-method__title">My own figure</span>
          <sat-interactive-card-content>
            <mat-form-field class="bf-field">
              <mat-label>Year-end forecast in {{ line().authorized.currency }}</mat-label>
              <input
                matInput
                inputmode="decimal"
                [ngModel]="amount()"
                (ngModelChange)="amount.set($event)"
                data-testid="owner-amount"
              />
              <mat-hint>For example 24,900.00</mat-hint>
            </mat-form-field>
          </sat-interactive-card-content>
        </sat-interactive-card>
      </mat-radio-group>

      <mat-form-field class="bf-field">
        <mat-label>Commentary</mat-label>
        <textarea
          matInput
          rows="3"
          [ngModel]="commentary()"
          (ngModelChange)="commentary.set($event)"
          [errorStateMatcher]="refusedMatcher"
          data-testid="forecast-commentary"
        ></textarea>
        @if (commentaryError(); as text) {
          <mat-error data-testid="commentary-required">{{ text }}</mat-error>
        } @else {
          <mat-hint
            >At least {{ minLength }} characters when the variance is above the cycle
            threshold.</mat-hint
          >
        }
      </mat-form-field>

      @if (failure()) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end" class="bf-dialog__actions">
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button
        mat-stroked-button
        type="button"
        [disabled]="busy()"
        (click)="send(false)"
        data-testid="save-draft"
      >
        Save draft
      </button>
      <button
        mat-flat-button
        satImportantButton
        type="button"
        [disabled]="busy()"
        (click)="send(true)"
        data-testid="submit-forecast"
      >
        Submit forecast
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubmitForecastDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<SubmitForecastDialog, ForecastSubmission>);
  protected readonly d = inject<{ cycle: ForecastCycle; line: ForecastSubmission }>(
    MAT_DIALOG_DATA,
  );
  protected readonly minLength = COMMENTARY_MIN;
  protected readonly line = signal(this.d.line);
  protected readonly method = signal<ForecastMethod>(this.d.line.method);
  protected readonly amount = signal('');
  protected readonly commentary = signal(this.d.line.commentary ?? '');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  /** Set from the API's 422, so the field says what the server actually refused. */
  protected readonly commentaryError = signal<string | null>(null);
  /**
   * The refusal comes from the server, not from a validator, so the field is told to show its error
   * state explicitly. Without this `mat-error` stays hidden and a real refusal looks like nothing.
   */
  protected readonly refusedMatcher: ErrorStateMatcher = {
    isErrorState: () => this.commentaryError() !== null,
  };

  protected label(method: ForecastMethod): string {
    return METHOD_LABELS[method];
  }

  protected pick(method: ForecastMethod): void {
    this.method.set(method);
    this.commentaryError.set(null);
  }

  protected async send(submit: boolean): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    this.commentaryError.set(null);
    const currency = this.line().authorized.currency;
    const amountMinor =
      this.method() === 'owner_input' ? toMinorAllowingZero(this.amount(), currency) : undefined;
    if (this.method() === 'owner_input' && amountMinor === undefined) {
      this.failure.set(`Enter the year-end figure in ${currency}, for example 24,900.00.`);
      this.busy.set(false);
      return;
    }
    const commentary = this.commentary().trim();
    try {
      this.ref.close(
        await data(
          this.api.submitForecast({
            params: { cycleId: this.d.cycle.id },
            body: {
              budgetId: this.line().budgetId ?? undefined,
              eventId: this.line().budgetId ? undefined : (this.line().eventId ?? undefined),
              method: this.method(),
              amountMinor,
              commentary: commentary || undefined,
              submit,
            },
          }),
        ),
      );
    } catch (e) {
      if (e instanceof ApiError && e.problem?.code === 'FORECAST_COMMENTARY_REQUIRED') {
        this.commentaryError.set(varianceMessage(e, currency));
      } else {
        this.failure.set(errorMessage(e));
      }
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * The 422 carries the variance in `params`; the field repeats it in money and per cent rather than
 * the minor units the API phrases its own message in.
 */
function varianceMessage(e: ApiError, currency: string): string {
  const p = e.problem?.params ?? {};
  const minor = typeof p['varianceMinor'] === 'number' ? p['varianceMinor'] : null;
  const bps = typeof p['varianceBps'] === 'number' ? p['varianceBps'] : null;
  const min = typeof p['minLength'] === 'number' ? p['minLength'] : COMMENTARY_MIN;
  if (minor === null || bps === null) return e.problem?.detail ?? e.message;
  return `Explain the ${formatMoney(minor, currency)} (${formatNumber(bps / 100, 'en-US', '1.1-1')}%) variance in at least ${min} characters before submitting.`;
}

/** Screen 87a: finance asks the owner to explain a line rather than accepting it as it stands. */
@Component({
  selector: 'bf-request-commentary-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    SAT_BANNER_IMPORTS,
  ],
  styleUrl: './dialogs.scss',
  template: `
    <h2 mat-dialog-title>Ask for commentary</h2>
    <mat-dialog-content>
      <p class="bf-dialog__subtitle">
        {{ d.line.budgetName ?? d.line.eventName }} goes back to
        {{ d.line.ownerName ?? 'its owner' }} with your note. The figure stays as it is until they
        resubmit.
      </p>
      <mat-form-field class="bf-field">
        <mat-label>What do you need explained?</mat-label>
        <textarea
          matInput
          rows="3"
          [ngModel]="note()"
          (ngModelChange)="note.set($event)"
          data-testid="commentary-request-note"
        ></textarea>
        <mat-hint>At least 5 characters. The owner reads this.</mat-hint>
      </mat-form-field>
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
        type="button"
        [disabled]="busy() || note().trim().length < 5"
        (click)="submit()"
        data-testid="confirm-request-commentary"
      >
        Send it back
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestCommentaryDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<RequestCommentaryDialog, ForecastSubmission>);
  protected readonly d = inject<{ cycleId: string; line: ForecastSubmission }>(MAT_DIALOG_DATA);
  protected readonly note = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.ref.close(
        await data(
          this.api.decideForecast({
            params: { cycleId: this.d.cycleId, submissionId: this.d.line.id },
            body: { decision: 'request_commentary', note: this.note().trim() },
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

/** Screen 87a: closing locks the snapshot that 087 and the board pack read, so it is typed out. */
@Component({
  selector: 'bf-close-forecast-cycle-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  styleUrl: './dialogs.scss',
  template: `
    <h2 mat-dialog-title>Close {{ d.cycle.name }}</h2>
    <mat-dialog-content>
      <p class="bf-dialog__subtitle">
        Submitted forecasts are accepted as they stand. The
        {{ missing() }}
        {{ missing() === 1 ? 'budget' : 'budgets' }} nobody submitted get the system run-rate
        forecast, marked System, so reports have no gaps.
      </p>
      <div class="bf-panel">
        <dl class="bf-rows">
          <div>
            <dt>Lines in the cycle</dt>
            <dd>{{ d.cycle.progress.budgets }}</dd>
          </div>
          <div>
            <dt>Accepted</dt>
            <dd>{{ d.cycle.progress.accepted }}</dd>
          </div>
          <div>
            <dt>Submitted, not yet accepted</dt>
            <dd>{{ d.cycle.progress.submitted }}</dd>
          </div>
          <div class="bf-rows__total">
            <dt>Filled with the system run-rate</dt>
            <dd>{{ missing() }}</dd>
          </div>
        </dl>
      </div>
      <p class="bf-note">
        The snapshot cannot change afterwards, and this cycle supersedes the one before it.
      </p>
      <mat-form-field class="bf-field">
        <mat-label>Type {{ d.cycle.closeConfirmation }} to confirm</mat-label>
        <input
          matInput
          [ngModel]="confirmation()"
          (ngModelChange)="confirmation.set($event)"
          data-testid="cycle-close-confirmation"
        />
        <mat-hint>The phrase must match exactly.</mat-hint>
      </mat-form-field>
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
        (click)="submit()"
        data-testid="confirm-close-cycle"
      >
        Close the cycle
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CloseForecastCycleDialog {
  private readonly api = injectApi();
  private readonly ref = inject(MatDialogRef<CloseForecastCycleDialog, ForecastCycleDetail>);
  protected readonly d = inject<{ cycle: ForecastCycle }>(MAT_DIALOG_DATA);
  protected readonly confirmation = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly missing = computed(
    () => this.d.cycle.progress.notStarted + this.d.cycle.progress.draft,
  );
  protected readonly ready = computed(() => this.confirmation() === this.d.cycle.closeConfirmation);

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.failure.set(null);
    try {
      this.ref.close(
        await data(
          this.api.closeForecastCycle({
            params: { cycleId: this.d.cycle.id },
            body: { confirmation: this.confirmation() },
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
