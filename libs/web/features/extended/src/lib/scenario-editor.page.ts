import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
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
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import type {
  AddScenarioChangeRequest,
  BudgetDetail,
  Scenario,
  ScenarioChangeImpact,
  ScenarioChangeKind,
  ScenarioImpact,
} from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorCode, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const KIND_LABEL: Record<ScenarioChangeKind, string> = {
  reduce: 'Reduce',
  transfer: 'Transfer',
  freeze: 'Freeze',
  set_to_zero: 'Set to zero',
};

/** The real control screen each modelled change becomes when the scenario is promoted. */
const KIND_BECOMES: Record<ScenarioChangeKind, string> = {
  reduce: 'a reduce-budget command (026) with its floor, destination and reason',
  transfer: 'a transfer command (025) approved by the parent owner',
  freeze: 'a freeze command (027) with its reason',
  set_to_zero: 'a set-to-zero command (028), floored at committed + actual + children',
};

interface AddChangeData {
  budgets: readonly BudgetDetail[];
}

/** Add a modelled change (031a). Submitting posts nothing: the impact is recomputed read-only. */
@Component({
  selector: 'bf-add-change-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    SAT_BANNER_IMPORTS,
  ],
  template: `
    <h2 mat-dialog-title>Add a modelled change</h2>
    <mat-dialog-content>
      <sat-banner variant="info">
        <sat-banner-message>
          Adding a change models it against the live ledger. No money moves and no budget status
          changes until the scenario is promoted.
        </sat-banner-message>
      </sat-banner>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Change</mat-label>
        <mat-select [(ngModel)]="kind" data-testid="change-kind">
          <mat-option value="reduce">Reduce a budget</mat-option>
          <mat-option value="transfer">Transfer between budgets</mat-option>
          <mat-option value="freeze">Freeze a budget</mat-option>
          <mat-option value="set_to_zero">Set a budget to zero</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Budget</mat-label>
        <mat-select [(ngModel)]="budgetId" data-testid="change-budget">
          @for (b of data.budgets; track b.id) {
            <mat-option [value]="b.id">{{ b.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      @if (kind() === 'reduce' || kind() === 'transfer') {
        <mat-form-field appearance="outline" class="bf-field">
          <mat-label>Amount in whole currency units</mat-label>
          <input
            matInput
            type="number"
            min="0.01"
            step="0.01"
            [(ngModel)]="amount"
            data-testid="change-amount"
          />
          <mat-hint>Leave empty on a reduction to use a percentage instead.</mat-hint>
        </mat-form-field>
      }
      @if (kind() === 'reduce') {
        <mat-form-field appearance="outline" class="bf-field">
          <mat-label>Or reduce by percent</mat-label>
          <input
            matInput
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            [(ngModel)]="percent"
            data-testid="change-percent"
          />
        </mat-form-field>
      }
      @if (kind() !== 'freeze') {
        <mat-form-field appearance="outline" class="bf-field">
          <mat-label>Where the money goes</mat-label>
          <mat-select [(ngModel)]="destination" data-testid="change-destination">
            <mat-option value="parent">Back to the parent budget</mat-option>
            <mat-option value="savings">To savings</mat-option>
            <mat-option value="reallocation">Reallocated to another budget</mat-option>
          </mat-select>
        </mat-form-field>
      }
      @if (destination() === 'reallocation' || kind() === 'transfer') {
        <mat-form-field appearance="outline" class="bf-field">
          <mat-label>Receiving budget</mat-label>
          <mat-select [(ngModel)]="destinationBudgetId" data-testid="change-destination-budget">
            @for (b of data.budgets; track b.id) {
              <mat-option [value]="b.id">{{ b.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close()">Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="!budgetId()"
        (click)="ref.close(request())"
        data-testid="change-add-confirm"
      >
        Add change
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
export class AddChangeDialog {
  protected readonly data = inject<AddChangeData>(MAT_DIALOG_DATA);
  protected readonly kind = signal<ScenarioChangeKind>('reduce');
  protected readonly budgetId = signal('');
  protected readonly amount = signal<number | null>(null);
  protected readonly percent = signal<number | null>(null);
  protected readonly destination = signal<'parent' | 'savings' | 'reallocation'>('parent');
  protected readonly destinationBudgetId = signal('');

  protected readonly ref =
    inject<MatDialogRef<AddChangeDialog, AddScenarioChangeRequest | undefined>>(MatDialogRef);

  protected request(): AddScenarioChangeRequest {
    const kind = this.kind();
    const amount = this.amount();
    const percent = this.percent();
    const wantsDestinationBudget =
      kind === 'transfer' || (kind !== 'freeze' && this.destination() === 'reallocation');
    return {
      kind,
      budgetId: this.budgetId(),
      ...(kind !== 'freeze' && amount ? { amountMinor: Math.round(amount * 100) } : {}),
      ...(kind === 'reduce' && !amount && percent ? { percentBps: Math.round(percent * 100) } : {}),
      ...(kind !== 'freeze' ? { destination: this.destination() } : {}),
      ...(wantsDestinationBudget && this.destinationBudgetId()
        ? { destinationBudgetId: this.destinationBudgetId() }
        : {}),
    };
  }
}

interface PromoteData {
  scenario: Scenario;
  impact: ScenarioImpact;
}

/**
 * The promote review step (031a). Every modelled change is listed as the real command it becomes,
 * and the reason the promoter types is carried into each of them. The `baselineAt` sent with the
 * request is the one on the impact shown here, so the API can refuse a promotion whose figures the
 * promoter never actually saw.
 */
@Component({
  selector: 'bf-promote-scenario-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    Money,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  template: `
    <h2 mat-dialog-title>Promote scenario</h2>
    <mat-dialog-content>
      <sat-banner variant="warning" data-testid="promote-warning">
        <sat-banner-message>
          This is where modelling stops. Each change below runs as the ordinary control command,
          with its own authorization check, impact preview, approvals and audit entry. There is no
          shortcut that applies them without those checks.
        </sat-banner-message>
      </sat-banner>
      <ol class="bf-promote__list" data-testid="promote-changes">
        @for (c of data.scenario.changes; track c.id) {
          <li>
            <strong>{{ label(c.kind) }} {{ c.budgetName }}</strong>
            @if (c.amount) {
              <span>
                by <bf-money [amountMinor]="c.amount.amountMinor" [currency]="c.amount.currency" />
              </span>
            } @else if (c.percentBps) {
              <span>by {{ c.percentBps / 100 }}%</span>
            }
            <span class="bf-cell__secondary">Becomes {{ becomes(c.kind) }}.</span>
          </li>
        }
      </ol>
      <p class="bf-cell__secondary" data-testid="promote-baseline">
        Reviewed against the ledger as it stood at {{ data.impact.baselineAt }}.
      </p>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Reason code</mat-label>
        <mat-select [(ngModel)]="reasonCode" data-testid="promote-reason-code">
          <mat-option value="RED-COST-SAVING">Cost saving</mat-option>
          <mat-option value="RED-REALLOCATION">Reallocation</mat-option>
          <mat-option value="RED-POLICY">Policy decision</mat-option>
        </mat-select>
      </mat-form-field>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Reason, in your own words</mat-label>
        <textarea
          matInput
          rows="3"
          [(ngModel)]="reason"
          maxlength="500"
          data-testid="promote-reason"
        ></textarea>
        <mat-hint>This reason is recorded on every command the promotion runs.</mat-hint>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close()">Cancel</button>
      <button
        satImportantButton
        type="button"
        [disabled]="reason().trim().length < 1"
        (click)="
          ref.close({
            reasonCode: reasonCode(),
            reason: reason().trim(),
            baselineAt: data.impact.baselineAt,
          })
        "
        data-testid="promote-confirm"
      >
        Submit changes
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .bf-field {
      width: 100%;
      margin-top: 12px;
    }
    .bf-promote__list {
      margin: 12px 0;
      padding-inline-start: 20px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .bf-promote__list .bf-cell__secondary {
      display: block;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromoteScenarioDialog {
  protected readonly data = inject<PromoteData>(MAT_DIALOG_DATA);
  protected readonly reasonCode = signal('RED-REALLOCATION');
  protected readonly reason = signal('');

  protected readonly ref =
    inject<
      MatDialogRef<
        PromoteScenarioDialog,
        { reasonCode: string; reason: string; baselineAt: string } | undefined
      >
    >(MatDialogRef);

  protected label = (kind: ScenarioChangeKind) => KIND_LABEL[kind];
  protected becomes = (kind: ScenarioChangeKind) => KIND_BECOMES[kind];
}

/**
 * Screen 031a: one what-if scenario, its modelled changes and the impact of all of them together.
 *
 * Everything on this page is a projection. The impact comes from the same domain checks the real
 * commands run — the same floor, the same available amount, the same per-head fairness — but
 * computing it writes nothing: no journal, no balance change, no budget status change. The page
 * says so where someone might otherwise assume a budget had already moved.
 */
@Component({
  selector: 'bf-scenario-editor-page',
  imports: [
    DateTimePipe,
    LoadState,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatTooltipModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatImportantButton,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">{{ scenario()?.name ?? 'Scenario' }}</h1>
        <p class="bf-page__subtitle">
          A private projection. Nothing here has changed a budget.
          <a routerLink="/budgets/scenarios">All scenarios</a>
        </p>
      </div>
      <div class="bf-page__actions">
        @if (scenario(); as s) {
          <sat-status-tag [status]="statusTone()" data-testid="scenario-status">{{
            statusLabel()
          }}</sat-status-tag>
          @if (s.status === 'draft') {
            <button mat-stroked-button type="button" (click)="addChange()" data-testid="add-change">
              <mat-icon svgIcon="circle_add" />Add change
            </button>
            <button
              satImportantButton
              type="button"
              [disabled]="!canPromote()"
              [matTooltip]="promoteBlockedReason()"
              (click)="promote()"
              data-testid="promote-scenario"
            >
              Promote to real changes
            </button>
          }
        }
      </div>
    </header>

    <bf-load-state
      [loading]="detail.isLoading() && !detail.hasValue()"
      [error]="detail.error()"
      what="this scenario"
      (retry)="detail.reload()"
    />

    @if (scenario(); as s) {
      @if (failure(); as message) {
        <sat-banner variant="important" data-testid="scenario-action-error">
          <sat-banner-message>{{ message }}</sat-banner-message>
        </sat-banner>
      }

      @if (s.status === 'archived') {
        <sat-banner variant="info" data-testid="scenario-archived">
          <sat-banner-message>
            This scenario is archived and read-only. Duplicate it to carry on modelling.
          </sat-banner-message>
        </sat-banner>
      } @else if (s.status === 'promoted') {
        <sat-banner variant="success" data-testid="scenario-promoted">
          <sat-banner-message>
            Promoted{{
              s.promotedAt ? ' on ' + (s.promotedAt | bfDateTime: session.timezone()) : ''
            }}. Each change below ran as its own control command; their statuses are the real ones.
          </sat-banner-message>
        </sat-banner>
      } @else {
        <sat-banner variant="info" data-testid="scenario-projection-note">
          <sat-banner-message>
            Modelling moves no money. These figures are computed against the live ledger and
            discarded; no journal, balance or budget status changes until you promote the scenario.
          </sat-banner-message>
        </sat-banner>
      }

      @if (impact(); as i) {
        @if (i.stale) {
          <sat-banner variant="warning" data-testid="scenario-stale">
            <sat-banner-message>
              The ledger has changed since this scenario took its baseline ({{
                i.ledgerWritesSinceBaseline
              }}
              {{ i.ledgerWritesSinceBaseline === 1 ? 'journal' : 'journals' }} posted since). The
              figures below are recomputed, but the scenario still holds the older baseline, so
              promotion is refused until it is rebuilt against today's ledger.
            </sat-banner-message>
          </sat-banner>
        }
        @if (i.blocked) {
          <sat-banner variant="important" data-testid="scenario-blocked">
            <sat-banner-message>
              This scenario cannot be promoted as it stands.
              @for (reason of i.blockingReasons; track reason) {
                <span class="bf-blocking">{{ reason }}</span>
              }
            </sat-banner-message>
          </sat-banner>
        }
      }

      <section class="bf-card bf-section">
        <div class="bf-list__row">
          <h2 class="bf-section__title">Modelled changes</h2>
          <button
            mat-button
            type="button"
            (click)="refreshImpact()"
            [disabled]="recomputing()"
            data-testid="recalculate"
          >
            <mat-icon svgIcon="refresh" />Recalculate
          </button>
        </div>
        @if (s.changes.length === 0) {
          <sat-empty-state data-testid="changes-empty">
            <h3 satEmptyStateHeadline>No changes modelled yet</h3>
            <p satEmptyStateDescription>
              Add a reduction, transfer, freeze or set-to-zero to see what it would do.
            </p>
          </sat-empty-state>
        } @else {
          <table class="bf-split-table" aria-label="Modelled changes and their impact">
            <thead>
              <tr>
                <th>Change</th>
                <th>Budget</th>
                <th class="bf-num">Authorized now</th>
                <th class="bf-num">Floor</th>
                <th class="bf-num">Authorized after</th>
                <th class="bf-num">Available after</th>
                <th>Outcome</th>
                @if (s.status === 'draft') {
                  <th><span class="bf-visually-hidden">Actions</span></th>
                }
              </tr>
            </thead>
            <tbody>
              @for (c of s.changes; track c.id) {
                @let ci = impactFor(c.id);
                <tr [attr.data-testid]="'change-' + c.id">
                  <td>
                    <span class="bf-cell__primary">{{ label(c.kind) }}</span>
                    @if (c.amount) {
                      <span class="bf-cell__secondary">
                        <bf-money
                          [amountMinor]="c.amount.amountMinor"
                          [currency]="c.amount.currency"
                        />
                      </span>
                    } @else if (c.percentBps) {
                      <span class="bf-cell__secondary">{{ c.percentBps / 100 }}%</span>
                    }
                  </td>
                  <td>
                    <span class="bf-cell__primary">{{ c.budgetName }}</span>
                    @if (c.destinationBudgetName) {
                      <span class="bf-cell__secondary">to {{ c.destinationBudgetName }}</span>
                    } @else if (c.destination) {
                      <span class="bf-cell__secondary">to {{ c.destination }}</span>
                    }
                  </td>
                  <td class="bf-num">
                    @if (ci) {
                      <bf-money
                        [amountMinor]="ci.currentAuthorized.amountMinor"
                        [currency]="ci.currentAuthorized.currency"
                      />
                    }
                  </td>
                  <td class="bf-num">
                    @if (ci) {
                      <span
                        [matTooltip]="
                          'Committed + actual + what children keep. A reduction cannot go below it.'
                        "
                        tabindex="0"
                      >
                        <bf-money
                          [amountMinor]="ci.floor.amountMinor"
                          [currency]="ci.floor.currency"
                        />
                      </span>
                    }
                  </td>
                  <td class="bf-num">
                    @if (ci) {
                      <bf-money
                        [amountMinor]="ci.newAuthorized.amountMinor"
                        [currency]="ci.newAuthorized.currency"
                      />
                    }
                  </td>
                  <td class="bf-num">
                    @if (ci) {
                      <bf-money
                        [amountMinor]="ci.availableAfter.amountMinor"
                        [currency]="ci.availableAfter.currency"
                      />
                    }
                  </td>
                  <td>
                    @if (c.promotion; as p) {
                      <sat-status-tag
                        [status]="
                          p.status === 'applied'
                            ? 'success'
                            : p.status === 'failed'
                              ? 'important'
                              : 'warning'
                        "
                        [attr.data-testid]="'promotion-' + c.id"
                      >
                        {{
                          p.status === 'applied'
                            ? 'Applied'
                            : p.status === 'failed'
                              ? 'Rejected'
                              : 'Waiting'
                        }}
                      </sat-status-tag>
                      @if (p.problemDetail) {
                        <span class="bf-cell__secondary">{{ p.problemDetail }}</span>
                      }
                    } @else if (ci && ci.blocked) {
                      <span class="bf-blocked" [attr.data-testid]="'change-blocked-' + c.id">
                        <mat-icon svgIcon="error" class="bf-blocked__icon" />
                        {{ ci.problemDetail ?? 'This change cannot be promoted.' }}
                        <span class="bf-cell__secondary">
                          The most this budget can give up is
                          <bf-money
                            [amountMinor]="ci.maxReduction.amountMinor"
                            [currency]="ci.maxReduction.currency"
                          />.
                        </span>
                      </span>
                    } @else if (ci && ci.unfitRequestIds.length) {
                      <span class="bf-cell__secondary">
                        {{ ci.unfitRequestIds.length }} pending
                        {{ ci.unfitRequestIds.length === 1 ? 'request' : 'requests' }} would no
                        longer fit and would be returned.
                      </span>
                    } @else {
                      <span class="bf-cell__secondary">Fits within the floor.</span>
                    }
                  </td>
                  @if (s.status === 'draft') {
                    <td>
                      <button
                        mat-button
                        type="button"
                        (click)="removeChange(c.id)"
                        [attr.data-testid]="'remove-change-' + c.id"
                        [attr.aria-label]="'Remove modelled change on ' + c.budgetName"
                      >
                        Remove
                      </button>
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      <bf-load-state
        [loading]="impactResource.isLoading() && !impactResource.hasValue()"
        [error]="impactResource.error()"
        what="the projected impact"
        [lines]="3"
        (retry)="impactResource.reload()"
      />

      @if (impact(); as i) {
        <section class="bf-card bf-section" data-testid="company-available">
          <h2 class="bf-section__title">Company-wide Available</h2>
          <div class="bf-figures">
            <div>
              <span class="bf-figures__label">Today</span>
              <bf-money
                class="bf-figures__value"
                [amountMinor]="i.companyAvailableBefore.amountMinor"
                [currency]="i.companyAvailableBefore.currency"
              />
            </div>
            <div>
              <span class="bf-figures__label">If promoted</span>
              <bf-money
                class="bf-figures__value"
                [amountMinor]="i.companyAvailableAfter.amountMinor"
                [currency]="i.companyAvailableAfter.currency"
              />
            </div>
          </div>
          <p class="bf-cell__secondary">
            A reallocation leaves this unchanged: the money moves between budgets. It falls only
            when money leaves through savings.
          </p>
        </section>

        <section class="bf-card bf-section" data-testid="at-risk">
          <h2 class="bf-section__title">Events and commitments at risk</h2>
          @if (i.atRisk.length === 0) {
            <p>No committed spend or pending request is affected by these changes.</p>
          } @else {
            <ul class="bf-at-risk">
              @for (r of i.atRisk; track r.budgetId) {
                <li>
                  <strong>{{ r.budgetName }}</strong>
                  <bf-money
                    [amountMinor]="r.committed.amountMinor"
                    [currency]="r.committed.currency"
                  />
                  is already committed across
                  {{ r.openCommitmentCount }}
                  {{ r.openCommitmentCount === 1 ? 'commitment' : 'commitments' }}; commitments stay
                  protected and can complete.
                  @if (r.pendingRequestCount) {
                    <span>
                      {{ r.pendingRequestCount }} pending
                      {{ r.pendingRequestCount === 1 ? 'request' : 'requests' }} would be returned.
                    </span>
                  }
                  @if (r.eventNames.length) {
                    <span class="bf-cell__secondary"
                      >Events funded here: {{ r.eventNames.join(', ') }}.</span
                    >
                  }
                </li>
              }
            </ul>
          }
        </section>

        <section class="bf-card bf-section" data-testid="fairness">
          <h2 class="bf-section__title">Spend per eligible head</h2>
          @if (i.fairness.length === 0) {
            <p>No budget in this scenario has an eligible headcount to divide by.</p>
          } @else {
            <table class="bf-split-table" aria-label="Spend per eligible head before and after">
              <thead>
                <tr>
                  <th>Budget</th>
                  <th class="bf-num">Eligible people</th>
                  <th class="bf-num">Per head today</th>
                  <th class="bf-num">Per head if promoted</th>
                </tr>
              </thead>
              <tbody>
                @for (f of i.fairness; track f.budgetId) {
                  <tr>
                    <td>{{ f.budgetName }}</td>
                    <td class="bf-num">{{ f.eligibleHeadcount }}</td>
                    <td class="bf-num">
                      @if (f.perHeadBefore) {
                        <bf-money
                          [amountMinor]="f.perHeadBefore.amountMinor"
                          [currency]="f.perHeadBefore.currency"
                        />
                      } @else {
                        <span class="bf-cell__secondary">Not available</span>
                      }
                    </td>
                    <td class="bf-num">
                      @if (f.perHeadAfter) {
                        <bf-money
                          [amountMinor]="f.perHeadAfter.amountMinor"
                          [currency]="f.perHeadAfter.currency"
                        />
                      } @else {
                        <span class="bf-cell__secondary">Not available</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>
      }
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
    .bf-blocking {
      display: block;
    }
    .bf-blocked {
      display: flex;
      flex-direction: column;
      gap: 2px;
      color: var(--mat-sys-error);
    }
    .bf-blocked__icon {
      width: 16px;
      height: 16px;
    }
    .bf-figures {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
    }
    .bf-figures > div {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .bf-figures__label {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    .bf-figures__value {
      font: var(--mat-sys-title-medium);
    }
    .bf-at-risk {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 0;
      padding-inline-start: 20px;
    }
    .bf-at-risk .bf-cell__secondary {
      display: block;
    }
    .bf-visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
    @media (max-width: 834px) {
      .bf-split-table {
        display: block;
        overflow-x: auto;
      }
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenarioEditorPage {
  readonly scenarioId = input.required<string>();

  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);

  protected readonly failure = signal<string | null>(null);
  protected readonly recomputing = signal(false);

  protected readonly detail = resource({
    params: () => ({ id: this.scenarioId() }),
    loader: ({ params }) => data(this.api.getScenario({ params: { scenarioId: params.id } })),
  });
  protected readonly impactResource = resource({
    params: () => ({ id: this.scenarioId() }),
    loader: ({ params }) => data(this.api.getScenarioImpact({ params: { scenarioId: params.id } })),
  });
  private readonly budgets = resource({
    loader: () => data(this.api.listBudgets({ query: { limit: 200 } })),
  });

  protected readonly scenario = computed<Scenario | undefined>(() => valueOf(this.detail));
  protected readonly impact = computed<ScenarioImpact | undefined>(() =>
    valueOf(this.impactResource),
  );

  protected readonly statusLabel = computed(() => {
    const status = this.scenario()?.status;
    return status === 'promoted' ? 'Promoted' : status === 'archived' ? 'Archived' : 'Draft';
  });
  protected readonly statusTone = computed<'info' | 'success' | 'neutral'>(() => {
    const status = this.scenario()?.status;
    return status === 'promoted' ? 'success' : status === 'archived' ? 'neutral' : 'info';
  });

  /**
   * Promotion is offered only when the scenario could actually succeed. A blocked impact, a moved
   * baseline or an empty scenario each disable the button and say which it is, so nobody clicks it
   * expecting the budgets to move.
   */
  protected readonly promoteBlockedReason = computed(() => {
    const s = this.scenario();
    const i = this.impact();
    if (!s || s.changes.length === 0) return 'Add at least one modelled change first.';
    if (!i) return 'Waiting for the projected impact.';
    if (i.stale)
      return 'The ledger moved since this scenario took its baseline. Review the recalculated figures; this scenario can no longer be promoted against them.';
    if (i.blocked) return i.blockingReasons[0] ?? 'This scenario cannot be promoted as it stands.';
    return 'Review each change and give a reason.';
  });
  protected readonly canPromote = computed(() => {
    const s = this.scenario();
    const i = this.impact();
    return Boolean(s && s.changes.length > 0 && i && !i.stale && !i.blocked);
  });

  protected label = (kind: ScenarioChangeKind) => KIND_LABEL[kind];

  protected impactFor(changeId: string): ScenarioChangeImpact | undefined {
    return this.impact()?.changes.find((c) => c.changeId === changeId);
  }

  protected async refreshImpact(): Promise<void> {
    this.recomputing.set(true);
    this.impactResource.reload();
    this.recomputing.set(false);
  }

  protected addChange(): void {
    this.dialog
      .open(AddChangeDialog, {
        width: '520px',
        data: { budgets: valueOf(this.budgets)?.items ?? [] } satisfies AddChangeData,
      })
      .afterClosed()
      .subscribe(async (request) => {
        if (!request) return;
        this.failure.set(null);
        try {
          await data(
            this.api.addScenarioChange({
              params: { scenarioId: this.scenarioId() },
              body: request,
            }),
          );
          this.detail.reload();
          this.impactResource.reload();
          this.snackBar.open('Change modelled. No money has moved.', 'Dismiss', { duration: 5000 });
        } catch (error) {
          this.failure.set(errorMessage(error));
        }
      });
  }

  protected async removeChange(changeId: string): Promise<void> {
    this.failure.set(null);
    try {
      await data(
        this.api.removeScenarioChange({
          params: { scenarioId: this.scenarioId(), changeId },
        }),
      );
      this.detail.reload();
      this.impactResource.reload();
    } catch (error) {
      this.failure.set(errorMessage(error));
    }
  }

  /**
   * Promotion always re-reads the impact first. The request carries the `baselineAt` of the figures
   * on screen, so if the ledger moved while the promoter was reading, the refusal happens before
   * anything is applied and the person is sent back to re-review rather than quietly promoting
   * against numbers that have already changed.
   */
  protected async promote(): Promise<void> {
    this.failure.set(null);
    const scenario = this.scenario();
    if (!scenario) return;
    let fresh: ScenarioImpact;
    try {
      fresh = await data(this.api.getScenarioImpact({ params: { scenarioId: this.scenarioId() } }));
    } catch (error) {
      this.failure.set(errorMessage(error));
      return;
    }
    this.impactResource.reload();
    if (fresh.stale) {
      this.failure.set(
        `The ledger changed while you were reviewing this scenario (${fresh.ledgerWritesSinceBaseline} journals posted since its baseline). Review the recalculated figures before promoting; BudgetFlow will not promote against figures you have not seen.`,
      );
      return;
    }
    if (fresh.blocked) {
      this.failure.set(
        `This scenario cannot be promoted as it stands: ${fresh.blockingReasons[0] ?? 'a modelled change falls below its floor.'}`,
      );
      return;
    }

    this.dialog
      .open(PromoteScenarioDialog, {
        width: '560px',
        data: { scenario, impact: fresh } satisfies PromoteData,
      })
      .afterClosed()
      .subscribe(async (request) => {
        if (!request) return;
        try {
          await data(
            this.api.promoteScenario({ params: { scenarioId: this.scenarioId() }, body: request }),
          );
          this.detail.reload();
          this.impactResource.reload();
          this.snackBar.open(
            'Promoted. Each change now runs as its own control command.',
            'Dismiss',
            { duration: 6000 },
          );
        } catch (error) {
          this.failure.set(
            errorCode(error) === 'SCENARIO_BASELINE_STALE'
              ? `${errorMessage(error)} Nothing was promoted.`
              : errorMessage(error),
          );
          this.impactResource.reload();
        }
      });
  }
}
