import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import type { SingleSimulationResponse } from '@bf/contracts';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi } from './api';
import { approverList } from './labels';
import { RuleEffectTag } from './rule-tags';
import { RulesTabs } from './rules-tabs';

const OUTCOME_TEXT: Record<string, string> = {
  block: 'This request would be blocked.',
  freeze: 'This request would wait until the budget is available again.',
  require_approval: 'This request would need approval.',
  warn: 'This request would go ahead with a warning.',
  auto_approve: 'This request would go through without an approval step.',
  none: 'No rule applies, so the usual hierarchy approvals apply.',
};

/** Screen 069: try a made-up request against the rules without creating anything. */
@Component({
  selector: 'bf-simulate-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    RouterLink,
    RuleEffectTag,
    RulesTabs,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Test a request</h1>
        <p class="bf-page__subtitle">
          Describe a request and see what the rules would do with it. Nothing is created and no
          budget is touched.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/admin/rules/backtest">Check against past requests</a>
      </div>
    </header>
    <bf-rules-tabs current="simulate" />
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    <section class="bf-card" aria-labelledby="form-title">
      <div class="bf-card__header">
        <h2 class="bf-card__title" id="form-title">The request to test</h2>
      </div>
      <div class="bf-form bf-sim-form">
        <mat-form-field appearance="outline">
          <mat-label>Amount</mat-label>
          <span matTextPrefix>USD&nbsp;</span>
          <input matInput inputmode="decimal" [(ngModel)]="amount" name="amount" />
          <mat-hint>In the reporting currency</mat-hint>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Spend type</mat-label>
          <mat-select [(ngModel)]="spendType" name="spendType">
            <mat-option value="employee_events">Employee events</mat-option>
            <mat-option value="team_lunch">Team meals</mat-option>
            <mat-option value="offsite">Offsite</mat-option>
            <mat-option value="gifts">Gifts</mat-option>
            <mat-option value="wellbeing">Wellbeing</mat-option>
            <mat-option value="travel">Travel</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Category</mat-label>
          <mat-select [(ngModel)]="category" name="category">
            <mat-option value="employee_events">Employee events</mat-option>
            <mat-option value="team_lunch">Team meals</mat-option>
            <mat-option value="gifts">Gifts</mat-option>
            <mat-option value="wellbeing">Wellbeing</mat-option>
            <mat-option value="alcohol">Alcohol</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Location</mat-label>
          <mat-select [(ngModel)]="location" name="location">
            <mat-option value="Bengaluru">Bengaluru</mat-option>
            <mat-option value="Hyderabad">Hyderabad</mat-option>
            <mat-option value="Westlake">Westlake</mat-option>
            <mat-option value="London">London</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Number of people</mat-label>
          <input matInput inputmode="numeric" [(ngModel)]="people" name="people" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Budget left</mat-label>
          <input matInput inputmode="numeric" [(ngModel)]="remaining" name="remaining" />
          <span matTextSuffix>%</span>
          <mat-hint>Share of the budget still available</mat-hint>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Vendor</mat-label>
          <mat-select [(ngModel)]="vendorStatus" name="vendorStatus">
            <mat-option value="preferred">Preferred</mat-option>
            <mat-option value="approved">Approved</mat-option>
            <mat-option value="unknown">Not known</mat-option>
            <mat-option value="blocked">Blocked</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Attendees</mat-label>
          <mat-select [(ngModel)]="attendeeType" name="attendeeType">
            <mat-option value="employee">Employees</mat-option>
            <mat-option value="client">Clients</mat-option>
          </mat-select>
        </mat-form-field>
      </div>
      <div class="bf-form">
        <mat-checkbox [(ngModel)]="alcohol" name="alcohol">Alcohol is included</mat-checkbox>
        <mat-checkbox [(ngModel)]="cash" name="cash">It is cash or a gift card</mat-checkbox>
        <mat-checkbox [(ngModel)]="includeDraft" name="includeDraft"
          >Include draft rules</mat-checkbox
        >
      </div>
      <div class="bf-form__actions">
        <button mat-flat-button type="button" [disabled]="busy()" (click)="run()">
          See what would happen
        </button>
      </div>
    </section>

    @if (result(); as r) {
      <section class="bf-card" aria-labelledby="outcome-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="outcome-title">What would happen</h2>
        </div>
        <div class="bf-card__body">
          <sat-banner [variant]="outcomeVariant(r.effect)" class="bf-outcome">
            <sat-banner-message>
              <span class="bf-outcome__line">
                @if (r.effect !== 'none') {
                  <bf-rule-effect [effect]="r.effect" />
                }
                <strong>{{ outcomeText(r.effect) }}</strong>
              </span>
            </sat-banner-message>
          </sat-banner>
          <p>{{ r.explanation }}</p>
          <dl class="bf-facts">
            <div>
              <dt>Decided by</dt>
              <dd>{{ r.decisiveRuleCode ?? 'No rule' }}</dd>
            </div>
            <div>
              <dt>Approvers needed</dt>
              <dd>{{ approverList(r.requiredApprovers) }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section class="bf-card" aria-labelledby="matches-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="matches-title">Rules that matched</h2>
          <p class="bf-card__hint">
            In priority order. The strictest outcome wins; the rest are recorded but do not change
            the result.
          </p>
        </div>
        @if (r.matches.length) {
          <div class="bf-table-scroll">
            <table class="bf-split-table bf-table--stack" aria-label="Matching rules">
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col" class="bf-num">Priority</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Approvers</th>
                  <th scope="col">Effect on the result</th>
                </tr>
              </thead>
              <tbody>
                @for (m of r.matches; track m.ruleCode) {
                  <tr>
                    <td>
                      <span class="bf-cell__primary">{{ m.ruleCode }}</span>
                      <span class="bf-cell__secondary">{{ m.ruleName }}</span>
                    </td>
                    <td class="bf-num" data-label="Priority">{{ m.priority }}</td>
                    <td data-label="Outcome"><bf-rule-effect [effect]="m.effect" /></td>
                    <td data-label="Approvers">{{ approverList(m.approvers) }}</td>
                    <td class="bf-nowrap" data-label="Effect on the result">
                      @if (m.decisive) {
                        <sat-status-tag status="info"
                          ><mat-icon svgIcon="check" aria-hidden="true" />Decided the
                          outcome</sat-status-tag
                        >
                      } @else {
                        <sat-status-tag status="neutral"
                          ><mat-icon svgIcon="circle_minus" aria-hidden="true" />Also
                          matched</sat-status-tag
                        >
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <sat-empty-state>
            <h3 satEmptyStateHeadline>No rule matched</h3>
            <p satEmptyStateDescription>This request would follow the usual hierarchy approvals.</p>
          </sat-empty-state>
        }
      </section>

      @if (r.conditionChecklist.length) {
        <section class="bf-card" aria-labelledby="checks-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="checks-title">Conditions that were checked</h2>
          </div>
          <div class="bf-table-scroll">
            <table class="bf-split-table bf-table--stack" aria-label="Conditions checked">
              <thead>
                <tr>
                  <th scope="col">Condition</th>
                  <th scope="col">This request</th>
                  <th scope="col">Met</th>
                </tr>
              </thead>
              <tbody>
                @for (c of r.conditionChecklist; track $index) {
                  <tr>
                    <td>{{ c.label }}</td>
                    <td [class.bf-figure]="isFigure(c.actualValue)" data-label="This request">
                      {{ c.actualValue }}
                    </td>
                    <td class="bf-nowrap" data-label="Met">
                      @if (c.passed) {
                        <mat-icon class="bf-met" svgIcon="check" aria-hidden="true" />Yes
                      } @else {
                        <mat-icon class="bf-met" svgIcon="circle_minus" aria-hidden="true" />No
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    }
  `,
  styles: `
    /* Room for the hints, so a hint never sits on the next field's label. */
    .bf-sim-form {
      row-gap: 16px;
    }
    .bf-outcome {
      display: block;
      margin-bottom: 12px;
    }
    .bf-outcome__line {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .bf-nowrap,
    .bf-figure {
      white-space: nowrap;
    }
    .bf-figure {
      font-variant-numeric: tabular-nums;
    }
    .bf-met {
      width: 18px;
      height: 18px;
      margin-inline-end: 4px;
      vertical-align: -4px;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SimulatePage {
  private readonly api = injectApi();
  protected readonly approverList = approverList;
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly result = signal<SingleSimulationResponse | null>(null);

  protected amount = '750.00';
  protected spendType = 'employee_events';
  protected category = 'employee_events';
  protected location = 'Bengaluru';
  protected people = '20';
  protected remaining = '50';
  protected vendorStatus = 'approved';
  protected attendeeType = 'employee';
  protected alcohol = false;
  protected cash = false;
  protected includeDraft = true;

  /** Hard block and hold stop the request; approval and warning let it continue with a check. */
  protected outcomeVariant(effect: string): 'important' | 'warning' | 'success' | 'info' {
    if (effect === 'block' || effect === 'freeze') return 'important';
    if (effect === 'warn' || effect === 'require_approval') return 'warning';
    if (effect === 'auto_approve') return 'success';
    return 'info';
  }

  /** A money amount, count or percentage the API wrote out (as opposed to a category or yes/no). */
  protected isFigure(value: string): boolean {
    return /^(?:[A-Z]{3}\s)?-?[\d,.]+%?$/.test(value.trim());
  }

  protected outcomeText(effect: string): string {
    return OUTCOME_TEXT[effect] ?? OUTCOME_TEXT['none'];
  }

  protected async run(): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    const amountMinor = Math.round(Number(this.amount.replace(/[,\s]/g, '')) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor < 1) {
      this.failure.set('Enter an amount above zero.');
      this.busy.set(false);
      return;
    }
    try {
      const r = await data(
        this.api.simulateSingleRequest({
          body: {
            includeDraft: this.includeDraft,
            facts: {
              amountMinor,
              spendType: this.spendType,
              category: this.category,
              location: this.location,
              employeeCount: Math.max(1, Number(this.people) || 1),
              remainingPct: Math.min(100, Math.max(0, Number(this.remaining) || 0)),
              vendorStatus: this.vendorStatus as 'approved',
              attendeeType: this.attendeeType as 'employee',
              alcoholRequested: this.alcohol,
              isCashEquivalent: this.cash,
            },
          },
        }),
      );
      this.result.set(r);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
