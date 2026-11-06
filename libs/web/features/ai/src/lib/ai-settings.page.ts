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
import { MatCheckboxModule } from '@angular/material/checkbox';
import {
  MatDialog,
  MatDialogModule,
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { AiFeature, AiFeatureState, AiSettings, AiSettingsView } from '@bf/contracts';
import { formatMoney } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { AiLabel } from './ai-output';
import { AiTabs } from './ai-tabs';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

/**
 * The turn-on dialog of 113a. It shows the exact field names the feature would send to the model,
 * from `AiFeatureState.dataSent`, before anyone agrees to switch it on, plus what the feature can
 * never do whatever its switch says.
 */
@Component({
  selector: 'bf-ai-turn-on-dialog',
  imports: [MatButtonModule, MatDialogModule, SatImportantButton],
  template: `
    <h2 mat-dialog-title>Turn on {{ feature.title }}?</h2>
    <mat-dialog-content>
      <p>It appears on: {{ feature.appearsOn }}.</p>
      <h3 class="bf-dialog__title">What this feature sends to the model</h3>
      <ul class="bf-dialog__list" data-testid="data-sent">
        @for (field of feature.dataSent; track field) {
          <li>{{ field }}</li>
        }
        @if (feature.dataSent.length === 0) {
          <li>Nothing: this feature sends no record fields to the model.</li>
        }
      </ul>
      <h3 class="bf-dialog__title">What it can never do</h3>
      <ul class="bf-dialog__list">
        @for (never of feature.neverDoes; track never) {
          <li>{{ never }}</li>
        }
      </ul>
      @if (feature.needsFinanceConfirmation) {
        <p data-testid="needs-finance">
          This feature affects figures finance is accountable for, so it stays pending until a
          Finance Admin confirms it in their own right.
        </p>
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" (click)="close(false)">Cancel</button>
      <button satImportantButton type="button" (click)="close(true)" data-testid="confirm-turn-on">
        Turn on
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .bf-dialog__title {
      margin: 16px 0 4px;
      font: var(--mat-sys-title-small);
    }
    .bf-dialog__list {
      margin: 0;
      padding-inline-start: 20px;
      font: var(--mat-sys-body-medium);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiTurnOnDialog {
  private readonly ref = inject<MatDialogRef<AiTurnOnDialog, boolean>>(MatDialogRef);
  protected readonly feature = inject<AiFeatureState>(MAT_DIALOG_DATA);
  protected close(confirmed: boolean): void {
    this.ref.close(confirmed);
  }
}

/** The turn-off dialog: suggestions stop immediately, decisions already taken are untouched. */
@Component({
  selector: 'bf-ai-turn-off-dialog',
  imports: [MatButtonModule, MatDialogModule],
  template: `
    <h2 mat-dialog-title>Turn off {{ feature.title }}?</h2>
    <mat-dialog-content>
      <p>
        People will stop seeing these suggestions immediately. Suggestions people already accepted
        are not changed, and the records they led to stay exactly as they are.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" (click)="close(false)">Cancel</button>
      <button mat-flat-button type="button" (click)="close(true)" data-testid="confirm-turn-off">
        Turn off
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiTurnOffDialog {
  private readonly ref = inject<MatDialogRef<AiTurnOffDialog, boolean>>(MatDialogRef);
  protected readonly feature = inject<AiFeatureState>(MAT_DIALOG_DATA);
  protected close(confirmed: boolean): void {
    this.ref.close(confirmed);
  }
}

/**
 * Screen 113a, Features tab: the per-feature kill switches, the limits, and the read-only provider
 * status. Finance-affecting features stay pending until a Finance Admin confirms them, and no switch
 * on this page can let an AI feature post to the ledger, approve or change a control.
 */
@Component({
  selector: 'bf-ai-settings-page',
  imports: [
    AiLabel,
    AiTabs,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    SAT_BANNER_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <div class="bf-title-row">
          <h1 class="bf-page__title">AI settings</h1>
          <bf-ai-label text="AI features" />
        </div>
        <p class="bf-page__subtitle">
          Which AI features are on, exactly what each one sends to the model, and the limits they
          run under. No switch here can let AI approve, move money or change a rule.
        </p>
      </div>
    </header>

    <bf-ai-tabs class="bf-tabs" />

    <bf-load-state
      [loading]="view.isLoading() && !view.hasValue()"
      [error]="view.error()"
      what="AI settings"
      (retry)="view.reload()"
    />

    @if (valueOf(view); as v) {
      @if (!v.provider.configured) {
        <sat-banner variant="important" data-testid="provider-missing">
          <sat-banner-message>
            No model provider is configured. AI features cannot be turned on.
          </sat-banner-message>
        </sat-banner>
      }
      @if (!v.canManage) {
        <sat-banner variant="info" data-testid="read-only">
          <sat-banner-message>
            You can see these settings but not change them.
            @if (v.canConfirmFinance) {
              You can confirm finance-affecting features that an Organization Admin has requested.
            }
          </sat-banner-message>
        </sat-banner>
      }
      @if (pendingFeatures(v).length) {
        <sat-banner variant="warning" data-testid="pending-banner">
          <sat-banner-message>
            Waiting for a Finance Admin to confirm: {{ pendingNames(v) }}. These features stay off
            until the people accountable for the numbers agree.
          </sat-banner-message>
        </sat-banner>
      }

      <section class="bf-card" aria-labelledby="features-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="features-title">Features</h2>
        </div>
        <div class="bf-table-scroll">
          <table class="bf-split-table" aria-label="AI features and their switches">
            <thead>
              <tr>
                <th>Feature</th>
                <th>Where it appears</th>
                <th>Status</th>
                <th>Data sent to the model</th>
                <th>Last changed</th>
                <th>Switch</th>
              </tr>
            </thead>
            <tbody>
              @for (f of v.features; track f.feature) {
                <tr [attr.data-testid]="'feature-row-' + f.feature">
                  <td>
                    <span class="bf-cell__primary">{{ f.title }}</span>
                    <span class="bf-cell__secondary">{{ f.flagKey }}</span>
                  </td>
                  <td>{{ f.appearsOn }}</td>
                  <td>
                    @if (f.pendingFinanceConfirmation) {
                      <sat-status-tag status="warning" [attr.data-testid]="'status-' + f.feature"
                        >Waiting for Finance Admin confirmation</sat-status-tag
                      >
                    } @else {
                      <sat-status-tag
                        [status]="f.enabled ? 'success' : 'neutral'"
                        [attr.data-testid]="'status-' + f.feature"
                        >{{ f.enabled ? 'On' : 'Off' }}</sat-status-tag
                      >
                    }
                  </td>
                  <td>
                    <button
                      mat-button
                      type="button"
                      (click)="expanded.set(expanded() === f.feature ? null : f.feature)"
                      [attr.data-testid]="'data-sent-' + f.feature"
                    >
                      {{ f.dataSent.length }} fields
                    </button>
                    @if (expanded() === f.feature) {
                      <ul class="bf-fields" [attr.data-testid]="'fields-' + f.feature">
                        @for (field of f.dataSent; track field) {
                          <li>{{ field }}</li>
                        }
                      </ul>
                    }
                  </td>
                  <td>
                    @if (f.lastChangedAt) {
                      <span class="bf-cell__primary">{{ f.lastChangedByName ?? 'Someone' }}</span>
                      <span class="bf-cell__secondary" data-testid="relative-time">{{
                        f.lastChangedAt
                      }}</span>
                    } @else {
                      <span class="bf-cell__secondary">Never changed</span>
                    }
                  </td>
                  <td>
                    @if (v.canManage) {
                      <mat-slide-toggle
                        [checked]="f.enabled"
                        [disabled]="busy() || (!f.enabled && !v.provider.configured)"
                        (change)="toggle(f, $event.checked)"
                        [attr.aria-label]="(f.enabled ? 'Turn off ' : 'Turn on ') + f.title"
                        [attr.data-testid]="'switch-' + f.feature"
                      >
                        {{ f.enabled ? 'On' : 'Off' }}
                      </mat-slide-toggle>
                    } @else {
                      <span class="bf-cell__secondary">{{ f.enabled ? 'On' : 'Off' }}</span>
                    }
                    @if (f.pendingFinanceConfirmation && v.canConfirmFinance) {
                      <button
                        mat-flat-button
                        type="button"
                        [disabled]="busy()"
                        (click)="confirmFinance(f)"
                        [attr.data-testid]="'confirm-finance-' + f.feature"
                      >
                        Confirm as Finance Admin
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="bf-card" aria-labelledby="limits-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="limits-title">Limits and nudges</h2>
        </div>
        <div class="bf-form">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Questions per person per hour</mat-label>
            <input
              matInput
              type="number"
              min="10"
              max="200"
              [ngModel]="draft().questionsPerPersonPerHour"
              (ngModelChange)="patch({ questionsPerPersonPerHour: +$event })"
              [disabled]="!v.canManage"
              data-testid="questions-per-hour"
            />
            <mat-hint>Between 10 and 200</mat-hint>
          </mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Conversation history kept (days)</mat-label>
            <input
              matInput
              type="number"
              min="7"
              max="90"
              [ngModel]="draft().conversationHistoryDays"
              (ngModelChange)="patch({ conversationHistoryDays: +$event })"
              [disabled]="!v.canManage"
              data-testid="history-days"
            />
            <mat-hint>Between 7 and 90</mat-hint>
          </mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Nudge minimum gap (percent of authorized)</mat-label>
            <input
              matInput
              type="number"
              min="1"
              max="100"
              [ngModel]="draft().nudgeMinimumPct"
              (ngModelChange)="patch({ nudgeMinimumPct: +$event })"
              [disabled]="!v.canManage"
              data-testid="nudge-pct"
            />
          </mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Nudge frequency (days per budget)</mat-label>
            <input
              matInput
              type="number"
              min="1"
              max="90"
              [ngModel]="draft().nudgeFrequencyDays"
              (ngModelChange)="patch({ nudgeFrequencyDays: +$event })"
              [disabled]="!v.canManage"
              data-testid="nudge-days"
            />
          </mat-form-field>
          <div class="bf-form__wide">
            <p class="bf-cell__secondary">
              Nudge minimum amount
              {{ formatted(draft().nudgeMinimumAmount) }} (changed with the tenant currency
              settings).
            </p>
            <mat-checkbox
              [ngModel]="draft().showFlagsToApprovers"
              (ngModelChange)="patch({ showFlagsToApprovers: $event })"
              [disabled]="!v.canManage"
              data-testid="show-flags"
            >
              Show AI flags to approvers
            </mat-checkbox>
          </div>
        </div>
        @if (validation(); as message) {
          <sat-banner variant="important" data-testid="settings-validation">
            <sat-banner-message>{{ message }}</sat-banner-message>
          </sat-banner>
        }
        @if (v.canManage) {
          <div class="bf-form__actions">
            <button
              mat-flat-button
              type="button"
              [disabled]="busy() || !!validation()"
              (click)="save()"
              data-testid="save-settings"
            >
              Save limits
            </button>
          </div>
        }
      </section>

      <section class="bf-card" aria-labelledby="provider-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="provider-title">Model provider</h2>
        </div>
        <dl class="bf-facts" data-testid="provider">
          <div>
            <dt>Provider</dt>
            <dd>{{ v.provider.provider }}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{{ v.provider.modelId }} {{ v.provider.modelVersion }}</dd>
          </div>
          <div>
            <dt>Configured</dt>
            <dd>{{ v.provider.configured ? 'Yes' : 'No' }}</dd>
          </div>
          <div class="bf-form__wide">
            <dt>Keys</dt>
            <dd>{{ v.provider.note }}</dd>
          </div>
        </dl>
      </section>
    }
  `,
  styles: `
    .bf-fields {
      margin: 4px 0 0;
      padding-inline-start: 18px;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiSettingsPage {
  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly valueOf = valueOf;

  protected readonly busy = signal(false);
  protected readonly expanded = signal<AiFeature | null>(null);
  private readonly edits = signal<Partial<AiSettings>>({});

  protected readonly view = resource({
    loader: async () => {
      const v = await data(this.api.getAiSettings({}));
      this.edits.set({});
      return v;
    },
  });

  protected readonly draft = computed<AiSettings>(() => ({
    ...(valueOf(this.view)?.settings ?? {
      questionsPerPersonPerHour: 50,
      conversationHistoryDays: 30,
      nudgeMinimumAmount: { amountMinor: 50_000, currency: 'USD' },
      nudgeMinimumPct: 10,
      nudgeFrequencyDays: 14,
      showFlagsToApprovers: true,
    }),
    ...this.edits(),
  }));

  protected readonly validation = computed(() => {
    const d = this.draft();
    if (d.conversationHistoryDays < 7 || d.conversationHistoryDays > 90)
      return 'History must be 7 to 90 days.';
    if (d.questionsPerPersonPerHour < 10 || d.questionsPerPersonPerHour > 200)
      return 'Questions per hour must be 10 to 200.';
    if (d.nudgeMinimumPct < 1 || d.nudgeMinimumPct > 100)
      return 'The nudge minimum percent must be 1 to 100.';
    if (d.nudgeFrequencyDays < 1 || d.nudgeFrequencyDays > 90)
      return 'Nudge frequency must be 1 to 90 days.';
    return null;
  });

  protected formatted(amount: { amountMinor: number; currency: string }): string {
    return formatMoney(amount.amountMinor, amount.currency);
  }

  protected pendingFeatures(v: AiSettingsView): AiFeatureState[] {
    return v.features.filter((f) => f.pendingFinanceConfirmation);
  }

  protected pendingNames(v: AiSettingsView): string {
    return this.pendingFeatures(v)
      .map((f) => f.title)
      .join(', ');
  }

  protected patch(change: Partial<AiSettings>): void {
    this.edits.update((e) => ({ ...e, ...change }));
  }

  protected async toggle(feature: AiFeatureState, enabled: boolean): Promise<void> {
    const dialog = this.dialog.open<AiTurnOnDialog | AiTurnOffDialog, AiFeatureState, boolean>(
      enabled ? AiTurnOnDialog : AiTurnOffDialog,
      { data: feature, width: '560px' },
    );
    const confirmed = await new Promise<boolean | undefined>((resolve) =>
      dialog.afterClosed().subscribe(resolve),
    );
    if (!confirmed) {
      this.view.reload();
      return;
    }
    this.busy.set(true);
    try {
      await data(
        this.api.switchAiFeature({ params: { feature: feature.feature }, body: { enabled } }),
      );
      this.view.reload();
      this.snack.open(
        enabled && feature.needsFinanceConfirmation
          ? `${feature.title} is pending a Finance Admin's confirmation.`
          : `${feature.title} is now ${enabled ? 'on' : 'off'}.`,
        'Dismiss',
        { duration: 6000 },
      );
    } catch (error) {
      this.snack.open(errorMessage(error), 'Dismiss', { duration: 6000 });
      this.view.reload();
    } finally {
      this.busy.set(false);
    }
  }

  protected async confirmFinance(feature: AiFeatureState): Promise<void> {
    this.busy.set(true);
    try {
      await data(this.api.confirmAiFinanceFeature({ params: { feature: feature.feature } }));
      this.view.reload();
      this.snack.open(`${feature.title} confirmed and on.`, 'Dismiss', { duration: 5000 });
    } catch (error) {
      this.snack.open(errorMessage(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    try {
      await data(this.api.updateAiSettings({ body: this.draft() }));
      this.view.reload();
      this.snack.open('AI limits saved.', 'Dismiss', { duration: 4000 });
    } catch (error) {
      this.snack.open(errorMessage(error), 'Dismiss', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }
}
