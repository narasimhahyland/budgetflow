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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CreateRequestBody } from '@bf/contracts';
import { ApprovalRoute, BudgetImpactCard, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatGhost } from '@hylandsoftware/satori-ui/ghost';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SatCategoryTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { toMinor } from './money-input';

type Kind = CreateRequestBody['kind'];
const TITLES: Record<Kind, string> = {
  spending: 'Submit a spending request',
  over_budget: 'Create an over-budget request',
  additional_fund: 'Request additional funds',
};
const SPEND_TYPES = [
  { id: 'team_lunch', label: 'Team lunch' },
  { id: 'employee_events', label: 'Employee events' },
  { id: 'wellbeing', label: 'Wellbeing' },
  { id: 'recognition', label: 'Recognition' },
  { id: 'training', label: 'Training' },
  { id: 'travel', label: 'Travel' },
];

/** Screen 57 (and 56, 58, 117 by kind): ask for money with the budget impact and the approval route visible before submitting. */
@Component({
  selector: 'bf-new-request-page',
  imports: [
    ApprovalRoute,
    BudgetImpactCard,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatCategoryTag,
    SatGhost,
    SatImportantButton,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">{{ title() }}</h1>
        <p class="bf-page__subtitle">
          Submitting pre-encumbers the amount; it shows as pending until approved.
        </p>
      </div>
    </header>
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    <div class="bf-layout">
      <section class="bf-card bf-layout__main" aria-labelledby="form-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="form-title">What it is for</h2>
        </div>
        @if (event(); as e) {
          <p class="bf-section bf-event-line">
            <sat-category-tag category="purple"
              ><mat-icon svgIcon="calendar" aria-hidden="true" />Event</sat-category-tag
            >
            <span
              ><a [routerLink]="['/events', e.id]">{{ e.name }}</a> · charged to
              {{ e.homeBudgetName }}. To share the cost with another director's budget, send an
              Inter-Director Budget Contribution Request from the event (Request
              contribution).</span
            >
          </p>
        }
        @if (kind() !== 'additional_fund' && requestable.error()) {
          <!-- Loading shows as the Charge to hint, so the form does not shift when budgets arrive. -->
          <bf-load-state
            [error]="requestable.error()"
            what="the budgets you can charge"
            (retry)="requestable.reload()"
          />
        }
        <div class="bf-form">
          @if (kind() !== 'additional_fund') {
            <mat-form-field appearance="outline" class="bf-form__wide">
              <mat-label>Charge to</mat-label>
              <mat-select
                [ngModel]="budgetId()"
                (ngModelChange)="budgetId.set($event); currency.set(currencyOf($event))"
                name="budget"
                required
              >
                @for (b of budgets(); track b.budgetId) {
                  <mat-option [value]="b.budgetId" [disabled]="!!b.blockedReason"
                    >{{ b.name }}{{ b.blockedReason ? ' — ' + b.blockedReason : '' }}</mat-option
                  >
                }
              </mat-select>
              @if (requestable.isLoading() && !requestable.hasValue()) {
                <mat-hint>Loading the budgets you can charge…</mat-hint>
              }
              <mat-error
                ><mat-icon class="bf-error-icon" svgIcon="error" aria-hidden="true" />Choose the
                budget to charge.</mat-error
              >
            </mat-form-field>
            <mat-form-field appearance="outline" class="bf-form__wide">
              <mat-label>Title</mat-label>
              <input
                matInput
                [ngModel]="titleText()"
                (ngModelChange)="titleText.set($event)"
                name="title"
                required
              />
              <mat-error
                ><mat-icon class="bf-error-icon" svgIcon="error" aria-hidden="true" />Give the
                request a title.</mat-error
              >
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Spend type</mat-label>
              <mat-select
                [ngModel]="spendType()"
                (ngModelChange)="spendType.set($event)"
                name="spendType"
              >
                @for (s of spendTypes; track s.id) {
                  <mat-option [value]="s.id">{{ s.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }
          <mat-form-field appearance="outline">
            <mat-label>Amount</mat-label>
            <span matTextPrefix>{{ currency() }}&nbsp;</span>
            <input
              matInput
              inputmode="decimal"
              [ngModel]="amount()"
              (ngModelChange)="amount.set($event)"
              name="amount"
              required
            />
            <mat-error
              ><mat-icon class="bf-error-icon" svgIcon="error" aria-hidden="true" />Enter the amount
              you need.</mat-error
            >
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Currency</mat-label>
            <mat-select
              [ngModel]="currency()"
              (ngModelChange)="currency.set($event)"
              name="currency"
              [disabled]="kind() === 'additional_fund'"
            >
              @for (c of currencies(); track c) {
                <mat-option [value]="c">{{ c }}</mat-option>
              }
            </mat-select>
            @if (currency() !== budgetCurrency()) {
              <mat-hint>Converted to {{ budgetCurrency() }} at the locked plan rate</mat-hint>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Needed by</mat-label>
            <input
              matInput
              type="date"
              [ngModel]="neededBy()"
              (ngModelChange)="neededBy.set($event)"
              name="neededBy"
            />
          </mat-form-field>
          <mat-form-field appearance="outline" class="bf-form__wide">
            <mat-label>Justification</mat-label>
            <textarea
              matInput
              rows="4"
              [ngModel]="purpose()"
              (ngModelChange)="purpose.set($event)"
              name="purpose"
              required
            ></textarea>
            <mat-hint>Attach quotes or receipts on the request once it is saved.</mat-hint>
            <mat-error
              ><mat-icon class="bf-error-icon" svgIcon="error" aria-hidden="true" />Say what the
              money is for.</mat-error
            >
          </mat-form-field>
        </div>
        <div class="bf-form__actions">
          @let why = missing();
          @if (why) {
            <p class="bf-why" id="request-why">{{ why }}</p>
          }
          <a mat-button routerLink="/requests">Cancel</a>
          <button
            mat-stroked-button
            type="button"
            [disabled]="busy() || !valid()"
            [attr.aria-describedby]="why ? 'request-why' : null"
            (click)="save(false)"
          >
            Save draft
          </button>
          <button
            mat-flat-button
            satImportantButton
            type="button"
            [disabled]="busy() || !valid() || !!preview.value()?.blockedReason"
            [attr.aria-describedby]="why ? 'request-why' : null"
            (click)="save(true)"
          >
            {{ kind() === 'over_budget' ? 'Submit over-budget request' : 'Submit request' }}
          </button>
        </div>
      </section>
      <aside class="bf-layout__side">
        <section class="bf-card" aria-label="Budget impact">
          <div class="bf-section">
            @if (valueOf(preview); as p) {
              <bf-budget-impact [impact]="p.impact" title="Budget impact" />
            } @else if (preview.isLoading()) {
              <div class="bf-impact-ghost" aria-busy="true" aria-label="Loading the budget impact">
                <sat-ghost variant="box" [height]="72" fitContainer />
                <sat-ghost variant="box" [height]="12" fitContainer />
                <sat-ghost variant="box" [height]="40" fitContainer />
              </div>
            } @else {
              <sat-empty-state>
                <h3 satEmptyStateHeadline>Budget impact</h3>
                <p satEmptyStateDescription>
                  Choose a budget and an amount to see the impact and who approves.
                </p>
              </sat-empty-state>
            }
          </div>
        </section>
        @if (valueOf(preview)?.route; as route) {
          <section class="bf-card" aria-labelledby="who-title">
            <div class="bf-card__header">
              <h2 class="bf-card__title" id="who-title">Who approves</h2>
            </div>
            <div class="bf-section"><bf-approval-route [route]="route" /></div>
          </section>
        } @else if (valueOf(preview)?.blockedReason; as reason) {
          <sat-banner variant="important"
            ><sat-banner-message>{{ reason }}</sat-banner-message></sat-banner
          >
        }
      </aside>
    </div>
  `,
  styles: `
    .bf-event-line {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 0;
    }
    .bf-error-icon {
      width: 16px;
      height: 16px;
      margin-inline-end: 4px;
      vertical-align: -3px;
    }
    .bf-why {
      flex: 1 1 240px;
      margin: 0;
      align-self: center;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .bf-impact-ghost {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewRequestPage {
  private readonly api = injectApi();
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;
  protected readonly valueOf = valueOf;
  protected readonly spendTypes = SPEND_TYPES;
  protected readonly kind = signal<Kind>((this.query.get('kind') as Kind) ?? 'spending');
  protected readonly budgetId = signal(this.query.get('budgetId') ?? '');
  private readonly eventId = this.query.get('eventId');
  protected readonly titleText = signal('');
  protected readonly spendType = signal('team_lunch');
  protected readonly amount = signal('');
  protected readonly currency = signal('USD');
  protected readonly neededBy = signal('');
  protected readonly purpose = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal('');

  protected readonly title = computed(() => TITLES[this.kind()] ?? TITLES.spending);
  protected readonly requestable = resource({
    loader: () => data(this.api.requestableBudgets({})),
  });
  protected readonly budgets = computed(() => valueOf(this.requestable)?.items ?? []);
  protected readonly eventRes = resource({
    params: () => (this.eventId ? { eventId: this.eventId } : undefined),
    loader: ({ params }) => data(this.api.getEvent({ params })),
  });
  protected readonly event = computed(() => valueOf(this.eventRes));
  protected readonly budgetCurrency = computed(
    () => this.event()?.currency ?? this.currencyOf(this.budgetId()),
  );
  protected readonly currencies = computed(() => [
    ...new Set([this.budgetCurrency(), 'USD', 'INR', 'EUR']),
  ]);
  private readonly amountMinor = computed(() => toMinor(this.amount(), this.currency()));
  private readonly effectiveBudget = computed(() => this.event()?.homeBudgetId ?? this.budgetId());

  protected readonly preview = resource({
    params: () => {
      const minor = this.amountMinor();
      const budgetId = this.effectiveBudget();
      return budgetId && minor && minor > 0
        ? {
            budgetId,
            amountMinor: minor,
            currency: this.currency(),
            spendType: this.event()?.spendType ?? this.spendType(),
          }
        : undefined;
    },
    loader: ({ params }) => data(this.api.previewRoute({ query: params })),
  });

  constructor() {
    queueMicrotask(() => {
      if (this.event()) this.currency.set(this.event()!.currency);
    });
  }

  protected currencyOf(budgetId: string): string {
    return this.budgets().find((b) => b.budgetId === budgetId)?.currency ?? 'USD';
  }

  /** What is still missing, written next to the disabled Save and Submit buttons (section 4). */
  protected missing(): string | null {
    if (this.busy()) return null;
    const gaps: string[] = [];
    if (this.kind() !== 'additional_fund' && !this.effectiveBudget()) gaps.push('a budget');
    if (this.kind() !== 'additional_fund' && this.titleText().trim().length < 3)
      gaps.push('a title');
    if ((this.amountMinor() ?? 0) <= 0) gaps.push('an amount');
    if (this.purpose().trim().length < 3) gaps.push('a justification');
    if (gaps.length)
      return `Add ${gaps.join(', ').replace(/, ([^,]*)$/, ' and $1')} to save or submit.`;
    const blocked = this.preview.value()?.blockedReason;
    return blocked ? `Submitting is blocked: ${blocked}` : null;
  }

  protected valid(): boolean {
    const titleOk = this.kind() === 'additional_fund' || this.titleText().trim().length >= 3;
    return (
      Boolean(this.effectiveBudget()) &&
      (this.amountMinor() ?? 0) > 0 &&
      this.purpose().trim().length >= 3 &&
      titleOk
    );
  }

  protected async save(submit: boolean): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    const e = this.event();
    const body: CreateRequestBody = {
      kind: this.kind(),
      budgetId: this.effectiveBudget(),
      amount: { amountMinor: this.amountMinor()!, currency: e ? e.currency : this.currency() },
      spendType: e?.spendType ?? this.spendType(),
      title: e ? `Additional funds: ${e.name}` : this.titleText().trim(),
      purpose: this.purpose().trim(),
      submit,
      ...(e ? { eventId: e.id } : {}),
      ...(this.neededBy() ? { neededBy: this.neededBy() } : {}),
    };
    try {
      const r = await data(this.api.createRequest({ body }));
      this.snack.open(submit ? `Submitted ${r.ref}` : `Saved ${r.ref} as a draft`, undefined, {
        duration: 4000,
      });
      await this.router.navigate(['/requests', r.id]);
    } catch (err) {
      this.failure.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
