import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { type ErrorStateMatcher } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import type { CreateEventBody } from '@bf/contracts';
import { ApprovalRoute, formatMoney, LoadState, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { data, errorMessage, injectApi, todayIso, valueOf } from './api';
import { toMinor } from './money-input';

interface CostLine {
  category: string;
  description: string;
  amount: string;
}

const CATEGORIES = ['venue', 'catering', 'activities', 'travel', 'gifts', 'decor'];

type FieldKey = 'name' | 'date' | 'location' | 'people' | 'cost' | 'budget';

/** Screen 118: propose a small team event and ask for its funding in one step (draft event + submission). */
@Component({
  selector: 'bf-event-funding-page',
  imports: [
    ApprovalRoute,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    SatImportantButton,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Request event funding</h1>
        <p class="bf-page__subtitle">
          Propose a team event and ask for its funding in one step; the event code is created when
          it is approved
        </p>
      </div>
    </header>
    <!-- Loading shows as the budget field's hint: a skeleton above the form shifted it on load. -->
    @if (requestable.error()) {
      <bf-load-state
        [error]="requestable.error()"
        what="the budgets you may request from"
        (retry)="requestable.reload()"
      />
    }
    @if (errors().length && showErrors()) {
      <sat-banner #summary tabindex="-1" variant="important" data-testid="error-summary"
        ><sat-banner-message
          >Fix these before submitting: {{ errors().join('; ') }}.</sat-banner-message
        ></sat-banner
      >
    }
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    <div class="bf-layout">
      <div class="bf-layout__main">
        <section class="bf-card" aria-labelledby="event-title">
          <div class="bf-card__header"><h2 class="bf-card__title" id="event-title">Event</h2></div>
          <div class="bf-form">
            <mat-form-field appearance="outline" class="bf-form__wide">
              <mat-label>Event name</mat-label>
              <input
                matInput
                [(ngModel)]="name"
                name="name"
                [errorStateMatcher]="show.name"
                (ngModelChange)="touch()"
              />
              <mat-error
                ><mat-icon class="bf-error-icon" svgIcon="error" aria-hidden="true" />Name the event
                (at least 3 characters).</mat-error
              >
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Date</mat-label>
              <input
                matInput
                type="date"
                [min]="today"
                [(ngModel)]="date"
                name="date"
                [errorStateMatcher]="show.date"
                (ngModelChange)="touch()"
              />
              <mat-error
                ><mat-icon class="bf-error-icon" svgIcon="error" aria-hidden="true" />Choose the
                date of the event.</mat-error
              >
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Location</mat-label>
              <mat-select
                [(ngModel)]="locationId"
                name="location"
                [errorStateMatcher]="show.location"
                (ngModelChange)="touch()"
              >
                @for (l of locations(); track l.id) {
                  <mat-option [value]="l.id">{{ l.name }}</mat-option>
                }
              </mat-select>
              <mat-error
                ><mat-icon class="bf-error-icon" svgIcon="error" aria-hidden="true" />Choose where
                it happens.</mat-error
              >
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>People attending</mat-label>
              <input
                matInput
                type="number"
                min="1"
                [(ngModel)]="people"
                name="people"
                [errorStateMatcher]="show.people"
                (ngModelChange)="touch()"
              />
              <mat-error
                ><mat-icon class="bf-error-icon" svgIcon="error" aria-hidden="true" />Say how many
                people attend.</mat-error
              >
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Venue (optional)</mat-label>
              <input matInput [(ngModel)]="venue" name="venue" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="bf-form__wide">
              <mat-label>What is it and why</mat-label>
              <textarea matInput rows="2" [(ngModel)]="description" name="description"></textarea>
            </mat-form-field>
          </div>
        </section>
        <section class="bf-card" aria-labelledby="cost-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="cost-title">Cost estimate</h2>
            <button mat-button type="button" (click)="addLine()">
              <mat-icon svgIcon="circle_add" />Add a line
            </button>
          </div>
          @for (l of lines(); track $index; let i = $index) {
            <div class="bf-form bf-cost-line">
              <mat-form-field appearance="outline">
                <mat-label>Category</mat-label>
                <mat-select [(ngModel)]="l.category" [name]="'category' + i">
                  @for (c of categories; track c) {
                    <mat-option [value]="c">{{ label(c) }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Description</mat-label>
                <input matInput [(ngModel)]="l.description" [name]="'desc' + i" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Amount</mat-label>
                <span matTextPrefix>{{ currency() }}&nbsp;</span>
                <input
                  matInput
                  inputmode="decimal"
                  [(ngModel)]="l.amount"
                  [name]="'amount' + i"
                  [errorStateMatcher]="show.cost"
                  (ngModelChange)="touch()"
                />
                <mat-error
                  ><mat-icon class="bf-error-icon" svgIcon="error" aria-hidden="true" />Add at least
                  one cost.</mat-error
                >
              </mat-form-field>
              @if (lines().length > 1) {
                <button mat-button type="button" (click)="removeLine(i)">Remove</button>
              }
            </div>
          }
          <dl class="bf-facts">
            <div>
              <dt>Total</dt>
              <dd data-testid="estimate-total">
                <bf-money [amountMinor]="totalMinor()" [currency]="currency()" />
              </dd>
            </div>
            <div>
              <dt>Per person</dt>
              <dd><bf-money [amountMinor]="perPerson()" [currency]="currency()" /></dd>
            </div>
          </dl>
        </section>
        <section class="bf-card" aria-labelledby="funding-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="funding-title">Funding</h2>
          </div>
          <div class="bf-form">
            <mat-form-field appearance="outline" class="bf-form__wide">
              <mat-label>Charge to budget</mat-label>
              <mat-select
                [(ngModel)]="budgetId"
                name="budget"
                [errorStateMatcher]="show.budget"
                (ngModelChange)="touch()"
              >
                @for (b of budgets(); track b.budgetId) {
                  <mat-option [value]="b.budgetId" [disabled]="!!b.blockedCode"
                    >{{ b.name
                    }}{{ b.blockedReason ? ' (' + b.blockedReason + ')' : '' }}</mat-option
                  >
                }
              </mat-select>
              <mat-hint>{{
                requestable.isLoading() && !requestable.hasValue()
                  ? 'Loading the budgets you may request from…'
                  : 'The event code is created when the funding is approved.'
              }}</mat-hint>
              <mat-error
                ><mat-icon class="bf-error-icon" svgIcon="error" aria-hidden="true" />Choose the
                budget to charge.</mat-error
              >
            </mat-form-field>
          </div>
        </section>
      </div>
      <aside class="bf-layout__side">
        <section class="bf-card" aria-labelledby="check-title" data-testid="check-panel">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="check-title">Checks</h2>
          </div>
          @if (preview.hasValue() && preview.value(); as p) {
            @if (p.blockedReason) {
              <sat-banner variant="important"
                ><sat-banner-message>{{ p.blockedReason }}</sat-banner-message></sat-banner
              >
            }
            @if (p.route; as route) {
              <div class="bf-section">
                <h3 class="bf-section__title">Who approves</h3>
                <bf-approval-route [route]="route" />
              </div>
            }
          } @else {
            <p class="bf-card__hint bf-check__hint">
              Choose a budget and add costs to see who approves.
            </p>
          }
        </section>
      </aside>
    </div>
    <div class="bf-form__actions">
      <a mat-button routerLink="/requests">Cancel</a>
      <button mat-stroked-button type="button" [disabled]="busy()" (click)="save(false)">
        Save draft
      </button>
      <button
        mat-flat-button
        satImportantButton
        type="button"
        [disabled]="busy() || blocked()"
        (click)="save(true)"
        data-testid="submit-event-funding"
      >
        Submit for {{ totalText() }}
      </button>
    </div>
  `,
  styles: `
    .bf-cost-line {
      align-items: center;
      padding-bottom: 0;
    }
    .bf-error-icon {
      width: 16px;
      height: 16px;
      margin-inline-end: 4px;
      vertical-align: -3px;
    }
    .bf-check__hint {
      display: block;
      padding: 0 20px 16px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventFundingPage {
  private readonly api = injectApi();
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly categories = CATEGORIES;
  protected readonly today = todayIso();

  protected name = '';
  protected date = '';
  protected locationId = '';
  protected people: number | null = null;
  protected venue = '';
  protected description = '';
  protected budgetId = '';
  protected readonly lines = signal<CostLine[]>([
    { category: 'venue', description: 'Venue', amount: '' },
  ]);
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly showErrors = signal(false);
  private readonly version = signal(0);
  private readonly summary = viewChild('summary', { read: ElementRef });

  protected readonly units = resource({ loader: () => data(this.api.listOrgUnits({ query: {} })) });
  protected readonly locations = computed(() =>
    (valueOf(this.units)?.items ?? []).filter((u) => u.kind === 'location'),
  );
  protected readonly requestable = resource({
    loader: () => data(this.api.requestableBudgets({})),
  });
  protected readonly budgets = computed(() => valueOf(this.requestable)?.items ?? []);
  protected readonly currency = computed(() => {
    this.version();
    return this.budgets().find((b) => b.budgetId === this.budgetId)?.currency ?? 'USD';
  });
  protected readonly totalMinor = computed(() => {
    this.version();
    return this.lines().reduce((a, l) => a + (toMinor(l.amount, this.currency()) ?? 0), 0);
  });
  protected readonly perPerson = computed(() => {
    this.version();
    return Math.floor(this.totalMinor() / Math.max(Number(this.people) || 1, 1));
  });
  protected readonly totalText = computed(() => formatMoney(this.totalMinor(), this.currency()));
  protected readonly preview = resource({
    params: () => {
      this.version();
      return this.budgetId && this.totalMinor() > 0
        ? {
            budgetId: this.budgetId,
            amountMinor: this.totalMinor(),
            currency: this.currency(),
            spendType: 'team_event',
          }
        : undefined;
    },
    loader: ({ params }) => data(this.api.previewRoute({ query: params })),
  });
  protected readonly blocked = computed(() =>
    Boolean(this.preview.hasValue() && this.preview.value()?.blockedCode),
  );
  /** Per-field problems, so each field shows its own error once Submit was pressed (section 7). */
  private readonly invalid = computed((): Record<FieldKey, boolean> => {
    this.version();
    return {
      name: this.name.trim().length < 3,
      date: !this.date,
      location: !this.locationId,
      people: !Number(this.people) || Number(this.people) < 1,
      cost: this.totalMinor() <= 0,
      budget: !this.budgetId,
    };
  });
  private matcher(key: FieldKey): ErrorStateMatcher {
    return { isErrorState: () => this.showErrors() && this.invalid()[key] };
  }
  protected readonly show = {
    name: this.matcher('name'),
    date: this.matcher('date'),
    location: this.matcher('location'),
    people: this.matcher('people'),
    cost: this.matcher('cost'),
    budget: this.matcher('budget'),
  };
  protected readonly errors = computed(() => {
    this.version();
    const e: string[] = [];
    if (this.name.trim().length < 3) e.push('name the event');
    if (!this.date) e.push('choose a date');
    if (!this.locationId) e.push('choose a location');
    if (!Number(this.people) || Number(this.people) < 1) e.push('say how many people attend');
    if (this.totalMinor() <= 0) e.push('add at least one cost');
    if (!this.budgetId) e.push('choose the budget to charge');
    return e;
  });

  protected label(v: string): string {
    return v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ');
  }

  protected touch(): void {
    this.version.update((v) => v + 1);
  }

  protected addLine(): void {
    this.lines.update((ls) => [...ls, { category: 'catering', description: '', amount: '' }]);
  }

  protected removeLine(i: number): void {
    this.lines.update((ls) => ls.filter((_, j) => j !== i));
    this.touch();
  }

  protected async save(submit: boolean): Promise<void> {
    this.showErrors.set(true);
    if (this.errors().length) {
      setTimeout(() => {
        const el = this.summary()?.nativeElement as HTMLElement | undefined;
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ block: 'start' });
      });
      return;
    }
    this.busy.set(true);
    this.failure.set('');
    const ccy = this.currency();
    const body: CreateEventBody = {
      name: this.name.trim(),
      eventType: 'team_event',
      spendType: 'team_event',
      homeBudgetId: this.budgetId,
      startsAt: new Date(`${this.date}T09:00:00`).toISOString(),
      endsAt: new Date(`${this.date}T18:00:00`).toISOString(),
      toleranceBps: 0,
      ownFunds: { amountMinor: this.totalMinor(), currency: ccy },
      expectedAttendance: Number(this.people),
      locationOrgUnitIds: [this.locationId],
      costLines: this.lines()
        .filter((l) => (toMinor(l.amount, ccy) ?? 0) > 0)
        .map((l) => ({
          category: l.category,
          description: l.description.trim() || this.label(l.category),
          quantity: 1,
          unitCost: { amountMinor: toMinor(l.amount, ccy)!, currency: ccy },
        })),
      ...(this.venue.trim() ? { venue: this.venue.trim() } : {}),
      ...(this.description.trim() ? { description: this.description.trim() } : {}),
    };
    try {
      const created = await data(this.api.createEvent({ body }));
      if (submit) await data(this.api.submitEvent({ params: { eventId: created.id }, body: {} }));
      this.snack.open(
        submit
          ? `Funding request for ${created.name} sent for approval`
          : `Saved ${created.name} as a draft`,
        undefined,
        { duration: 4000 },
      );
      await this.router.navigate(['/events', created.id]);
    } catch (e) {
      this.failure.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
