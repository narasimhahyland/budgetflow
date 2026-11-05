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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { SessionStore } from '@bf/web/data-access';
import { DateOnlyPipe, Money, SpendStatus } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { data, errorMessage, injectApi, valueOf } from './api';
import { EventTabs } from './event-tabs';
import { LoadState } from './load-state';

/** Screen 54b: the event ROI scorecard — planned against actual, side by side, never a single score. */
@Component({
  selector: 'bf-event-scorecard-page',
  imports: [
    DateOnlyPipe,
    EventTabs,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SpendStatus,
  ],
  template: `
    <bf-load-state
      [loading]="scorecard.isLoading() && !scorecard.hasValue()"
      [error]="scorecard.hasValue() ? undefined : scorecard.error()"
      what="the scorecard"
      (retry)="scorecard.reload()"
    />

    @if (view(); as v) {
      <header class="bf-page__header">
        <div class="bf-page__heading">
          <div class="bf-title-row">
            <h1 class="bf-page__title">{{ v.eventName }}</h1>
            <bf-spend-status kind="event" [status]="v.status" />
          </div>
          <p class="bf-meta">
            <span>{{ v.eventCode }}</span>
            <span>{{ v.startsAt | bfDate: session.timezone() }}</span>
            @if (v.closedAt) {
              <span>closed {{ v.closedAt | bfDate: session.timezone() }}</span>
            }
          </p>
        </div>
        <div class="bf-page__actions">
          <a mat-stroked-button [routerLink]="['/events', v.eventId]">Back to the event</a>
        </div>
      </header>

      <bf-event-tabs [eventId]="v.eventId" section="scorecard" />

      @if (v.provisional) {
        <sat-banner variant="warning"
          ><sat-banner-message data-testid="provisional">{{
            v.provisionalReason
          }}</sat-banner-message></sat-banner
        >
      }
      @if (!v.attendanceFinal) {
        <sat-banner variant="info"
          ><sat-banner-message>
            Mark attendance to see participation and cost per attendee.
          </sat-banner-message></sat-banner
        >
      }

      <section class="bf-kpis" aria-label="Event measures">
        <div class="bf-kpi">
          <p class="bf-kpi__label">Cost per attendee</p>
          <p class="bf-kpi__value" data-testid="cost-per-attendee">
            @if (v.kpis.actualCostPerAttendee) {
              <bf-money
                [amountMinor]="v.kpis.actualCostPerAttendee.amountMinor"
                [currency]="v.kpis.actualCostPerAttendee.currency"
              />
            } @else {
              Mark attendance to see this
            }
          </p>
          <p class="bf-kpi__delta">
            planned
            <bf-money
              [amountMinor]="v.kpis.plannedCostPerAttendee.amountMinor"
              [currency]="v.kpis.plannedCostPerAttendee.currency"
            />
            @if (v.kpis.costPerAttendeeDeltaBps !== null) {
              · {{ v.kpis.costPerAttendeeDeltaBps >= 0 ? '+' : ''
              }}{{ v.kpis.costPerAttendeeDeltaBps / 100 }}% against plan
            }
          </p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">Total cost</p>
          <p class="bf-kpi__value">
            <bf-money
              [amountMinor]="v.kpis.spentTotal.amountMinor"
              [currency]="v.kpis.spentTotal.currency"
            />
          </p>
          <p class="bf-kpi__delta">
            of
            <bf-money
              [amountMinor]="v.kpis.fundedTotal.amountMinor"
              [currency]="v.kpis.fundedTotal.currency"
            />
            funded · surplus
            <bf-money
              [amountMinor]="v.kpis.surplusTotal.amountMinor"
              [currency]="v.kpis.surplusTotal.currency"
            />
            returned by share
          </p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">Participation</p>
          <p class="bf-kpi__value">{{ v.kpis.participationPct }}%</p>
          <p class="bf-kpi__delta">
            {{ v.kpis.attendedCount }} attended of {{ v.kpis.invitedCount }} invited
          </p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">No-shows</p>
          <p class="bf-kpi__value">{{ v.kpis.noShowCount }}</p>
          <p class="bf-kpi__delta">
            {{ v.kpis.noShowRatePct }}% of those going · cost
            <bf-money
              [amountMinor]="v.kpis.noShowCost.amountMinor"
              [currency]="v.kpis.noShowCost.currency"
            />
          </p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">Feedback</p>
          <p class="bf-kpi__value">
            {{
              v.kpis.averageRating === null
                ? 'Not enough responses yet'
                : v.kpis.averageRating + ' of 5'
            }}
          </p>
          <p class="bf-kpi__delta">
            from {{ v.kpis.responseCount }} responses
            @if (v.kpis.wouldAttendAgainPct !== null) {
              · {{ v.kpis.wouldAttendAgainPct }}% would attend again
            }
          </p>
        </div>
        <div class="bf-kpi">
          <p class="bf-kpi__label">FX effect</p>
          <p class="bf-kpi__value">
            <bf-money
              [amountMinor]="v.kpis.fxEffect.amountMinor"
              [currency]="v.kpis.fxEffect.currency"
            />
          </p>
          <p class="bf-kpi__delta">Not part of cost: the plan rate is locked for the year</p>
        </div>
      </section>

      <section class="bf-card" aria-label="Cost by category">
        <div class="bf-card__header"><h2 class="bf-card__title">Cost by category</h2></div>
        @if (v.costByCategory.length === 0) {
          <p class="bf-empty">No cost lines or commitments were recorded for this event.</p>
        } @else {
          <table class="bf-split-table">
            <caption class="bf-empty">
              Planned against actual, in the event currency.
            </caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col" class="bf-num">Planned</th>
                <th scope="col" class="bf-num">Actual</th>
              </tr>
            </thead>
            <tbody>
              @for (row of v.costByCategory; track row.category) {
                <tr>
                  <th scope="row">{{ row.category.replace('_', ' ') }}</th>
                  <td class="bf-num">
                    <bf-money
                      [amountMinor]="row.planned.amountMinor"
                      [currency]="row.planned.currency"
                    />
                  </td>
                  <td class="bf-num">
                    <bf-money
                      [amountMinor]="row.actual.amountMinor"
                      [currency]="row.actual.currency"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      <section class="bf-card" aria-label="Funding and returns">
        <div class="bf-card__header"><h2 class="bf-card__title">Funding and returns</h2></div>
        <table class="bf-split-table">
          <caption class="bf-empty">
            Surplus figures come from the posted returns, not a recalculation.
          </caption>
          <thead>
            <tr>
              <th scope="col">Contributor</th>
              <th scope="col">Mode</th>
              <th scope="col" class="bf-num">Approved</th>
              <th scope="col" class="bf-num">Actual share</th>
              <th scope="col" class="bf-num">Surplus returned</th>
            </tr>
          </thead>
          <tbody>
            @for (row of v.fundingAndReturns; track row.sourceId) {
              <tr>
                <th scope="row">
                  <span class="bf-cell__primary">{{ row.budgetName }}</span>
                  <span class="bf-cell__secondary">
                    {{ row.contributionRef ?? 'Own funds' }}
                    @if (row.crossEntity) {
                      · cross-entity
                    }
                  </span>
                </th>
                <td>{{ row.mode }}</td>
                <td class="bf-num">
                  <bf-money
                    [amountMinor]="row.approved.amountMinor"
                    [currency]="row.approved.currency"
                  />
                </td>
                <td class="bf-num">
                  <bf-money
                    [amountMinor]="row.actualShare.amountMinor"
                    [currency]="row.actualShare.currency"
                  />
                </td>
                <td class="bf-num">
                  <bf-money
                    [amountMinor]="row.surplusReturned.amountMinor"
                    [currency]="row.surplusReturned.currency"
                  />
                </td>
              </tr>
            }
          </tbody>
        </table>
      </section>

      <section class="bf-card" aria-label="Participation by location">
        <div class="bf-card__header">
          <h2 class="bf-card__title">Participation by location</h2>
        </div>
        <table class="bf-split-table">
          <caption class="bf-empty">
            Who came, per location.
          </caption>
          <thead>
            <tr>
              <th scope="col">Location</th>
              <th scope="col" class="bf-num">Invited</th>
              <th scope="col" class="bf-num">Attended</th>
              <th scope="col" class="bf-num">Rate</th>
            </tr>
          </thead>
          <tbody>
            @for (row of v.participationByLocation; track row.locationName) {
              <tr>
                <th scope="row">{{ row.locationName }}</th>
                <td class="bf-num">{{ row.invited }}</td>
                <td class="bf-num">{{ row.attended }}</td>
                <td class="bf-num">{{ row.ratePct }}%</td>
              </tr>
            }
          </tbody>
        </table>
      </section>

      <section class="bf-card" aria-label="Comparison">
        <div class="bf-card__header">
          <h2 class="bf-card__title">{{ v.comparison.label }}</h2>
        </div>
        @if (!v.comparison.enoughEvents) {
          <p class="bf-empty">Comparison needs at least 3 similar events.</p>
        } @else {
          <dl class="bf-facts">
            <div>
              <dt>Cost per attendee</dt>
              <dd>
                <bf-money
                  [amountMinor]="v.comparison.costPerAttendee!.amountMinor"
                  [currency]="v.comparison.costPerAttendee!.currency"
                />
              </dd>
            </div>
            <div>
              <dt>Participation</dt>
              <dd>{{ v.comparison.participationPct }}%</dd>
            </div>
            <div>
              <dt>No-show rate</dt>
              <dd>{{ v.comparison.noShowRatePct }}%</dd>
            </div>
            <div>
              <dt>Rating</dt>
              <dd>{{ v.comparison.averageRating ?? 'Not enough responses' }}</dd>
            </div>
          </dl>
        }
      </section>

      <section class="bf-card" aria-label="Organizer notes">
        <div class="bf-card__header">
          <h2 class="bf-card__title">Organizer notes</h2>
          <p class="bf-card__hint">What the next organizer should know.</p>
        </div>
        @if (v.canManage) {
          <div class="bf-form">
            <mat-form-field class="bf-form__wide">
              <mat-label>Notes</mat-label>
              <textarea
                matInput
                rows="3"
                [(ngModel)]="notes"
                name="notes"
                maxlength="2000"
              ></textarea>
            </mat-form-field>
          </div>
          <div class="bf-form__actions">
            <button mat-flat-button type="button" [disabled]="busy()" (click)="saveNotes()">
              Save notes
            </button>
          </div>
        } @else {
          <p class="bf-empty">{{ v.organizerNotes ?? 'No notes yet.' }}</p>
        }
      </section>

      @if (failure()) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventScorecardPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  readonly eventId = input.required<string>();
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected notes = '';

  protected readonly scorecard = resource({
    params: () => ({ eventId: this.eventId() }),
    loader: async ({ params }) => {
      const view = await data(this.api.getEventScorecard({ params, query: {} }));
      this.notes = view.organizerNotes ?? '';
      return view;
    },
  });
  protected readonly view = computed(() => valueOf(this.scorecard));

  protected saveNotes(): void {
    this.busy.set(true);
    this.failure.set('');
    void (async () => {
      try {
        await data(
          this.api.updateEventScorecardNotes({
            params: { eventId: this.eventId() },
            body: { notes: this.notes.trim() },
          }),
        );
        this.snack.open('Notes saved', undefined, { duration: 3000 });
        this.scorecard.reload();
      } catch (e) {
        this.failure.set(`Could not save the notes: ${errorMessage(e)}`);
      } finally {
        this.busy.set(false);
      }
    })();
  }
}
