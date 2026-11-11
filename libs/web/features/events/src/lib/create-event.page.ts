import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import { FormsModule, type NgForm } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { type MatStepper, MatStepperModule } from '@angular/material/stepper';
import { Router, RouterLink } from '@angular/router';
import type { CreateEventBody, Person } from '@bf/contracts';
import { formatMoney, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { data, errorMessage, injectApi, valueOf } from './api';
import { toMinor } from './money-input';

interface CostLine {
  category: string;
  description: string;
  quantity: number;
  unitCost: string;
}

const EVENT_TYPES = ['celebration', 'offsite', 'team_event', 'workshop', 'wellbeing', 'townhall'];
const CATEGORIES = ['venue', 'catering', 'travel', 'activities', 'decor', 'gifts', 'contingency'];

/** Screen 45 (with 47, 48, 49): create an event and its budget in five steps, then submit the own funds for approval. */
@Component({
  selector: 'bf-create-event-page',
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatStepperModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Create event budget</h1>
        <p class="bf-page__subtitle">
          Draft until you submit; the home budget's owner approves the own funds.
        </p>
      </div>
      <div class="bf-page__actions"><a mat-button routerLink="/events">Cancel</a></div>
    </header>
    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }
    <div class="bf-layout">
      <section class="bf-card bf-layout__main">
        <mat-stepper
          #stepper
          [linear]="false"
          [orientation]="'horizontal'"
          labelPosition="bottom"
          aria-label="Create event steps"
        >
          <mat-step label="Event details" [completed]="detailsValid()">
            <form
              class="bf-form"
              #detailsForm="ngForm"
              (ngSubmit)="continueDetails(stepper, detailsForm)"
            >
              <mat-form-field appearance="outline" class="bf-form__wide">
                <mat-label>Event name</mat-label>
                <input matInput required minlength="3" [(ngModel)]="name" name="name" />
                <mat-error
                  ><mat-icon svgIcon="error" aria-hidden="true" />Give the event a name of at least
                  3 characters</mat-error
                >
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Event type</mat-label>
                <mat-select [(ngModel)]="eventType" name="eventType">
                  @for (t of eventTypes; track t) {
                    <mat-option [value]="t">{{ label(t) }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Expected attendance</mat-label>
                <input matInput type="number" min="1" [(ngModel)]="expected" name="expected" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Starts</mat-label>
                <input
                  matInput
                  type="datetime-local"
                  required
                  [(ngModel)]="startsAt"
                  name="startsAt"
                />
                <mat-error
                  ><mat-icon svgIcon="error" aria-hidden="true" />Choose when the event
                  starts</mat-error
                >
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Ends</mat-label>
                <input matInput type="datetime-local" required [(ngModel)]="endsAt" name="endsAt" />
                <mat-error
                  ><mat-icon svgIcon="error" aria-hidden="true" />Choose when the event
                  ends</mat-error
                >
              </mat-form-field>
              <mat-form-field appearance="outline" class="bf-form__wide">
                <mat-label>Venue</mat-label>
                <input matInput [(ngModel)]="venue" name="venue" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="bf-form__wide">
                <mat-label>Description</mat-label>
                <textarea matInput rows="3" [(ngModel)]="description" name="description"></textarea>
              </mat-form-field>
            </form>
            <div class="bf-form__actions">
              <button mat-flat-button type="button" (click)="continueDetails(stepper, detailsForm)">
                Continue
              </button>
            </div>
          </mat-step>

          <mat-step label="Locations and participants" [completed]="locationIds.length > 0">
            <div class="bf-form">
              <mat-form-field appearance="outline" class="bf-form__wide">
                <mat-label>Locations</mat-label>
                <mat-select multiple [(ngModel)]="locationIds" name="locations">
                  @for (u of locations(); track u.id) {
                    <mat-option [value]="u.id">{{ u.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="bf-form__wide">
                <mat-label>Find people to add</mat-label>
                <input
                  matInput
                  [ngModel]="personQuery()"
                  (ngModelChange)="personQuery.set($event)"
                  name="personQuery"
                />
              </mat-form-field>
            </div>
            @if (personQuery().length > 1) {
              <ul class="bf-list" aria-label="Directory matches">
                @for (p of matches(); track p.id) {
                  <li>
                    <button type="button" class="bf-list__item" (click)="addPerson(p)">
                      <span class="bf-list__row"
                        ><span>{{ p.displayName }}</span
                        ><span class="bf-cell__secondary"
                          >{{ p.locationName }} · {{ p.employingEntityCode }} ·
                          {{ p.costCenterCode }}</span
                        ></span
                      >
                    </button>
                  </li>
                }
              </ul>
            }
            <div class="bf-section">
              <h3 class="bf-section__title">
                {{ participants().length }}
                {{ participants().length === 1 ? 'participant' : 'participants' }}
              </h3>
              @for (p of participants(); track p.id) {
                <div class="bf-list__row">
                  <span
                    >{{ p.displayName }}
                    <span class="bf-cell__secondary"
                      >{{ p.locationName }} · {{ p.employingEntityCode }}</span
                    ></span
                  >
                  <button mat-button type="button" (click)="removePerson(p.id)">Remove</button>
                </div>
              }
            </div>
            <div class="bf-form__actions">
              <button mat-stroked-button matStepperPrevious type="button">Back</button>
              <button mat-flat-button matStepperNext type="button">Continue</button>
            </div>
          </mat-step>

          <mat-step
            label="Budget and cost split"
            [completed]="estimateMinor() > 0 && !!homeBudgetId"
          >
            <div class="bf-form">
              <mat-form-field appearance="outline" class="bf-form__wide">
                <mat-label>Home budget (funds the event first)</mat-label>
                <mat-select [(ngModel)]="homeBudgetId" name="home">
                  @for (b of budgets(); track b.budgetId) {
                    <mat-option [value]="b.budgetId" [disabled]="!!b.blockedReason"
                      >{{ b.name }}
                      @if (b.blockedReason) {
                        <span> — {{ b.blockedReason }}</span>
                      }
                    </mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>
            <div class="bf-section">
              <h3 class="bf-section__title">Cost lines</h3>
              @for (l of lines(); track $index; let i = $index) {
                <div class="bf-form">
                  <mat-form-field appearance="outline">
                    <mat-label>Category</mat-label>
                    <mat-select
                      [(ngModel)]="l.category"
                      [name]="'cat' + i"
                      (ngModelChange)="touch()"
                    >
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
                    <mat-label>Quantity</mat-label>
                    <input
                      matInput
                      type="number"
                      min="1"
                      [(ngModel)]="l.quantity"
                      [name]="'qty' + i"
                      (ngModelChange)="touch()"
                    />
                  </mat-form-field>
                  <mat-form-field appearance="outline">
                    <mat-label>Unit cost</mat-label>
                    <span matTextPrefix>{{ currency() }}&nbsp;</span>
                    <input
                      matInput
                      inputmode="decimal"
                      [(ngModel)]="l.unitCost"
                      [name]="'unit' + i"
                      (ngModelChange)="touch()"
                    />
                  </mat-form-field>
                </div>
              }
              <button mat-stroked-button type="button" (click)="addLine()">
                <mat-icon svgIcon="circle_add" />Add cost line
              </button>
            </div>
            <div class="bf-form">
              <mat-form-field appearance="outline">
                <mat-label>Tolerance (%)</mat-label>
                <input
                  matInput
                  type="number"
                  min="0"
                  max="50"
                  [(ngModel)]="tolerancePct"
                  name="tol"
                  (ngModelChange)="touch()"
                />
              </mat-form-field>
            </div>
            <div class="bf-section">
              <h3 class="bf-section__title">Cost split by location</h3>
              @for (s of split(); track s.name) {
                <div class="bf-list__row">
                  <span
                    >{{ s.name }} · {{ s.count }}
                    {{ s.count === 1 ? 'participant' : 'participants' }}</span
                  ><span
                    >{{ s.pct }}% · <bf-money [amountMinor]="s.amount" [currency]="currency()"
                  /></span>
                </div>
              } @empty {
                <p class="bf-cell__secondary">
                  Add participants to see how the cost splits by location and employing entity.
                </p>
              }
            </div>
            <div class="bf-form__actions">
              <button mat-stroked-button matStepperPrevious type="button">Back</button>
              <button mat-flat-button matStepperNext type="button">Continue to funding</button>
            </div>
          </mat-step>

          <mat-step label="Funding" [completed]="ownFundsMinor() !== null">
            <div class="bf-form">
              <mat-form-field appearance="outline">
                <mat-label>Own funds from the home budget</mat-label>
                <span matTextPrefix>{{ currency() }}&nbsp;</span>
                <input
                  matInput
                  inputmode="decimal"
                  [(ngModel)]="ownFunds"
                  name="ownFunds"
                  (ngModelChange)="touch()"
                />
                <mat-hint>At most the estimate plus tolerance.</mat-hint>
              </mat-form-field>
            </div>
            <p class="bf-section bf-cell__secondary">
              After the event is created you can ask other directors' budgets for the rest with an
              Inter-Director Budget Contribution Request; each giving director decides within their
              delegation of authority.
            </p>
            @if (ownFundsTooHigh()) {
              <sat-banner variant="important" class="bf-banner"
                ><sat-banner-message
                  >Own funds cannot be more than the funding ceiling ({{
                    ceilingText()
                  }}).</sat-banner-message
                ></sat-banner
              >
            }
            <div class="bf-form__actions">
              <button mat-stroked-button matStepperPrevious type="button">Back</button>
              <button mat-flat-button matStepperNext type="button">Review</button>
            </div>
          </mat-step>

          <mat-step label="Review and submit">
            <dl class="bf-facts">
              <div>
                <dt>Event</dt>
                <dd>{{ name || '—' }}</dd>
              </div>
              <div>
                <dt>Locations</dt>
                <dd>{{ locationNames() }}</dd>
              </div>
              <div>
                <dt>Participants</dt>
                <dd>{{ participants().length }}</dd>
              </div>
              <div>
                <dt>Estimate</dt>
                <dd><bf-money [amountMinor]="estimateMinor()" [currency]="currency()" /></dd>
              </div>
              <div>
                <dt>Own funds asked</dt>
                <dd><bf-money [amountMinor]="ownFundsMinor() ?? 0" [currency]="currency()" /></dd>
              </div>
            </dl>
            <div class="bf-form__actions">
              <button mat-stroked-button matStepperPrevious type="button">Back</button>
              <button
                mat-stroked-button
                type="button"
                [disabled]="busy() || !canSave()"
                (click)="save(false)"
              >
                Save draft
              </button>
              <button
                mat-flat-button
                satImportantButton
                type="button"
                [disabled]="busy() || !canSave()"
                (click)="save(true)"
              >
                Submit for approval
              </button>
            </div>
          </mat-step>
        </mat-stepper>
      </section>
      <aside class="bf-layout__side">
        <section class="bf-card" aria-labelledby="summary-title">
          <div class="bf-card__header">
            <h2 class="bf-card__title" id="summary-title">Budget and funding summary</h2>
          </div>
          <dl class="bf-facts">
            <div>
              <dt>Total estimated expense</dt>
              <dd><bf-money [amountMinor]="estimateMinor()" [currency]="currency()" /></dd>
            </div>
            <div>
              <dt>Tolerance ({{ tolerancePct }}%)</dt>
              <dd><bf-money [amountMinor]="toleranceMinor()" [currency]="currency()" /></dd>
            </div>
            <div>
              <dt>Funding ceiling</dt>
              <dd>
                <bf-money
                  [amountMinor]="estimateMinor() + toleranceMinor()"
                  [currency]="currency()"
                />
              </dd>
            </div>
            <div>
              <dt>Own funds</dt>
              <dd><bf-money [amountMinor]="ownFundsMinor() ?? 0" [currency]="currency()" /></dd>
            </div>
            <div>
              <dt>Still to raise</dt>
              <dd><bf-money [amountMinor]="gapMinor()" [currency]="currency()" /></dd>
            </div>
            <div>
              <dt>Per head</dt>
              <dd>
                @if (participants().length) {
                  <bf-money [amountMinor]="perHead()" [currency]="currency()" />
                } @else {
                  —
                }
              </dd>
            </div>
          </dl>
        </section>
      </aside>
    </div>
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateEventPage {
  private readonly api = injectApi();
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly eventTypes = EVENT_TYPES;
  protected readonly categories = CATEGORIES;

  protected name = '';
  protected eventType = 'celebration';
  protected expected: number | null = null;
  protected startsAt = '';
  protected endsAt = '';
  protected venue = '';
  protected description = '';
  protected locationIds: string[] = [];
  protected homeBudgetId = '';
  protected tolerancePct = 5;
  protected ownFunds = '';
  protected readonly lines = signal<CostLine[]>([
    { category: 'venue', description: 'Venue', quantity: 1, unitCost: '' },
  ]);
  protected readonly participants = signal<Person[]>([]);
  protected readonly personQuery = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  private readonly version = signal(0);

  protected readonly units = resource({ loader: () => data(this.api.listOrgUnits({ query: {} })) });
  protected readonly locations = computed(() =>
    (valueOf(this.units)?.items ?? []).filter((u) => u.kind === 'location'),
  );
  protected readonly requestable = resource({
    loader: () => data(this.api.requestableBudgets({})),
  });
  protected readonly budgets = computed(() => valueOf(this.requestable)?.items ?? []);
  protected readonly people = resource({
    params: () =>
      this.personQuery().trim().length > 1 ? { q: this.personQuery().trim(), limit: 8 } : undefined,
    loader: ({ params }) => data(this.api.listPeople({ query: params })),
  });
  protected readonly matches = computed(() =>
    (valueOf(this.people)?.items ?? []).filter(
      (p) => !this.participants().some((x) => x.id === p.id),
    ),
  );

  protected readonly currency = computed(() => {
    this.version();
    return (
      this.budgets().find((b) => b.budgetId === this.homeBudgetId)?.currency ??
      this.budgets()[0]?.currency ??
      'USD'
    );
  });
  protected readonly estimateMinor = computed(() => {
    this.version();
    return this.lines().reduce(
      (a, l) => a + (toMinor(l.unitCost, this.currency()) ?? 0) * (Number(l.quantity) || 0),
      0,
    );
  });
  protected readonly toleranceMinor = computed(() => {
    this.version();
    return Math.floor(
      (this.estimateMinor() * Math.round((Number(this.tolerancePct) || 0) * 100)) / 10_000,
    );
  });
  protected readonly ownFundsMinor = computed(() => {
    this.version();
    return toMinor(this.ownFunds, this.currency());
  });
  protected readonly ownFundsTooHigh = computed(
    () => (this.ownFundsMinor() ?? 0) > this.estimateMinor() + this.toleranceMinor(),
  );
  protected readonly gapMinor = computed(() =>
    Math.max(this.estimateMinor() - (this.ownFundsMinor() ?? 0), 0),
  );
  protected readonly perHead = computed(() =>
    Math.floor(this.estimateMinor() / Math.max(this.participants().length, 1)),
  );
  protected readonly ceilingText = computed(() =>
    formatMoney(this.estimateMinor() + this.toleranceMinor(), this.currency()),
  );
  protected readonly split = computed(() => {
    const ps = this.participants();
    const groups = new Map<string, number>();
    for (const p of ps)
      groups.set(
        p.locationName ?? 'No location',
        (groups.get(p.locationName ?? 'No location') ?? 0) + 1,
      );
    return [...groups.entries()].map(([name, count]) => ({
      name,
      count,
      pct: Math.round((count * 100) / ps.length),
      amount: Math.floor((this.estimateMinor() * count) / ps.length),
    }));
  });
  protected readonly locationNames = computed(() => {
    this.version();
    return (
      this.locations()
        .filter((l) => this.locationIds.includes(l.id))
        .map((l) => l.name)
        .join(', ') || '—'
    );
  });

  /** Step 1 shows every missing field with its message instead of moving on silently. */
  protected continueDetails(stepper: MatStepper, form: NgForm): void {
    form.control.markAllAsTouched();
    if (this.detailsValid()) stepper.next();
  }

  protected detailsValid(): boolean {
    return this.name.trim().length >= 3 && !!this.startsAt && !!this.endsAt;
  }

  protected canSave(): boolean {
    return (
      this.detailsValid() &&
      this.locationIds.length > 0 &&
      !!this.homeBudgetId &&
      this.estimateMinor() > 0 &&
      this.ownFundsMinor() !== null &&
      !this.ownFundsTooHigh()
    );
  }

  protected label(v: string): string {
    return v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ');
  }

  protected touch(): void {
    this.version.update((v) => v + 1);
  }

  protected addLine(): void {
    this.lines.update((ls) => [
      ...ls,
      { category: 'catering', description: '', quantity: 1, unitCost: '' },
    ]);
  }

  protected addPerson(p: Person): void {
    this.participants.update((ps) => [...ps, p]);
    this.personQuery.set('');
  }

  protected removePerson(id: string): void {
    this.participants.update((ps) => ps.filter((p) => p.id !== id));
  }

  protected async save(submit: boolean): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    const ccy = this.currency();
    const body: CreateEventBody = {
      name: this.name.trim(),
      eventType: this.eventType,
      homeBudgetId: this.homeBudgetId,
      startsAt: new Date(this.startsAt).toISOString(),
      endsAt: new Date(this.endsAt).toISOString(),
      toleranceBps: Math.round((Number(this.tolerancePct) || 0) * 100),
      ownFunds: { amountMinor: this.ownFundsMinor() ?? 0, currency: ccy },
      locationOrgUnitIds: this.locationIds,
      participantPersonIds: this.participants().map((p) => p.id),
      costLines: this.lines()
        .filter((l) => toMinor(l.unitCost, ccy) !== null && l.description.trim())
        .map((l) => ({
          category: l.category,
          description: l.description.trim(),
          quantity: Number(l.quantity) || 1,
          unitCost: { amountMinor: toMinor(l.unitCost, ccy)!, currency: ccy },
        })),
      ...(this.venue.trim() ? { venue: this.venue.trim() } : {}),
      ...(this.description.trim() ? { description: this.description.trim() } : {}),
      ...(this.expected ? { expectedAttendance: Number(this.expected) } : {}),
    };
    try {
      const created = await data(this.api.createEvent({ body }));
      if (submit) await data(this.api.submitEvent({ params: { eventId: created.id }, body: {} }));
      this.snack.open(
        submit ? `Submitted ${created.name} for approval` : `Saved ${created.name} as a draft`,
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
