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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import type { EventParticipant } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { data, errorMessage, injectApi, valueOf } from './api';
import { EventTabs } from './event-tabs';
import { LoadState } from './load-state';

type Sub = 'invitations' | 'needs' | 'attendance';

const RSVP_LABEL: Record<string, string> = {
  invited: 'No response',
  going: 'Going',
  cant_go: "Can't go",
  waitlisted: 'Waitlisted',
};
const ATTENDANCE_LABEL: Record<string, string> = {
  unknown: 'Not marked',
  attended: 'Attended',
  no_show: 'No-show',
  walk_in: 'Walk-in',
};

/** Screens 47a, 47b and 47e: invitations and RSVP, attendee needs, attendance and the per-head split. */
@Component({
  selector: 'bf-event-people-page',
  imports: [
    DateTimePipe,
    EventTabs,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTableModule,
    Money,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
    SatImportantButton,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">People</h1>
        <p class="bf-page__subtitle">
          Who is invited, what they need, who came, and what that means for the cost split.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button [routerLink]="['/events', eventId()]">Back to the event</a>
      </div>
    </header>

    <bf-event-tabs [eventId]="eventId()" section="people" />

    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }

    <sat-navigation-tabs class="bf-tabs" aria-label="People sections">
      <a
        satNavigationTab
        [active]="sub() === 'invitations'"
        (click)="sub.set('invitations')"
        (keydown.enter)="sub.set('invitations')"
        tabindex="0"
        >Invitations</a
      >
      <a
        satNavigationTab
        [active]="sub() === 'needs'"
        (click)="sub.set('needs')"
        (keydown.enter)="sub.set('needs')"
        tabindex="0"
        >Needs</a
      >
      <a
        satNavigationTab
        [active]="sub() === 'attendance'"
        (click)="sub.set('attendance')"
        (keydown.enter)="sub.set('attendance')"
        tabindex="0"
        >Attendance</a
      >
    </sat-navigation-tabs>

    @if (sub() === 'invitations') {
      <bf-load-state
        [loading]="invitations.isLoading() && !invitations.hasValue()"
        [error]="invitations.hasValue() ? undefined : invitations.error()"
        what="the invitations"
        (retry)="invitations.reload()"
      />
      @if (inv(); as v) {
        @if (v.status === 'not_sent') {
          <section class="bf-card" aria-label="Invitation composer">
            <div class="bf-card__header">
              <h2 class="bf-card__title">Send invitations</h2>
              <p class="bf-card__hint">
                {{ v.counts.invited }} people are on the list. RSVPs never move money; they change
                the expected attendance the per-head split works from.
              </p>
            </div>
            <div class="bf-form">
              <mat-form-field class="bf-form__wide">
                <mat-label>Message</mat-label>
                <textarea matInput rows="3" [(ngModel)]="message" name="message"></textarea>
              </mat-form-field>
              <mat-form-field>
                <mat-label>RSVP deadline</mat-label>
                <input matInput type="datetime-local" [(ngModel)]="deadline" name="deadline" />
              </mat-form-field>
              <mat-form-field>
                <mat-label>Capacity (optional)</mat-label>
                <input matInput type="number" [(ngModel)]="capacity" name="capacity" />
              </mat-form-field>
              <mat-slide-toggle [(ngModel)]="waitlistEnabled" name="waitlist"
                >Keep a waitlist</mat-slide-toggle
              >
              <mat-slide-toggle [(ngModel)]="autoPromote" name="autoPromote"
                >Promote automatically when a place opens</mat-slide-toggle
              >
              <mat-slide-toggle [(ngModel)]="collectTravel" name="collectTravel"
                >Ask about travel needs</mat-slide-toggle
              >
            </div>
            <div class="bf-form__actions">
              <button
                mat-flat-button
                satImportantButton
                type="button"
                [disabled]="busy()"
                (click)="send()"
                data-testid="send-invitations"
              >
                Send invitations
              </button>
            </div>
          </section>
        } @else {
          @if (v.attendanceChangedFromPlan) {
            <sat-banner variant="info"
              ><sat-banner-message>
                Expected attendance changed from {{ v.plannedAttendance }} planned to
                {{ v.counts.going }} going. Review the per-head estimate and cost split on the
                Attendance tab.
              </sat-banner-message></sat-banner
            >
          }
          @if (v.capacity !== null && v.counts.going >= v.capacity) {
            <sat-banner variant="warning"
              ><sat-banner-message>
                All {{ v.capacity }} places are taken. New Going answers join the waitlist ({{
                  v.counts.waitlisted
                }}
                waiting).
              </sat-banner-message></sat-banner
            >
          }
          @if (v.status === 'closed') {
            <sat-banner variant="info"
              ><sat-banner-message>RSVPs are closed for this event.</sat-banner-message></sat-banner
            >
          }
          <section class="bf-kpis" aria-label="RSVP counts">
            <div class="bf-kpi">
              <p class="bf-kpi__label">Going</p>
              <p class="bf-kpi__value" data-testid="rsvp-going">{{ v.counts.going }}</p>
              <p class="bf-kpi__delta">of {{ v.counts.invited }} invited</p>
            </div>
            <div class="bf-kpi">
              <p class="bf-kpi__label">Can't go</p>
              <p class="bf-kpi__value">{{ v.counts.cantGo }}</p>
            </div>
            <div class="bf-kpi">
              <p class="bf-kpi__label">Waitlisted</p>
              <p class="bf-kpi__value">{{ v.counts.waitlisted }}</p>
            </div>
            <div class="bf-kpi">
              <p class="bf-kpi__label">No response</p>
              <p class="bf-kpi__value">{{ v.counts.noResponse }}</p>
              <p class="bf-kpi__delta">
                {{
                  v.deadline
                    ? 'closes ' + (v.deadline | bfDateTime: session.timezone())
                    : 'no deadline set'
                }}
              </p>
            </div>
          </section>
          <section class="bf-card" aria-label="RSVP tracker">
            <div class="bf-card__header">
              <h2 class="bf-card__title">RSVP tracker</h2>
              <span class="bf-page__actions">
                <button mat-stroked-button type="button" [disabled]="busy()" (click)="remind()">
                  Send reminder
                </button>
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="busy()"
                  (click)="setRsvpState(v.status === 'open' ? 'closed' : 'open')"
                >
                  {{ v.status === 'open' ? 'Close RSVPs' : 'Reopen RSVPs' }}
                </button>
              </span>
            </div>
            <div class="bf-table-scroll">
              <table mat-table [dataSource]="v.participants">
                <ng-container matColumnDef="name">
                  <th mat-header-cell *matHeaderCellDef>Name</th>
                  <td mat-cell *matCellDef="let p">
                    <span class="bf-cell__primary">{{ p.name }}</span>
                    <span class="bf-cell__secondary">{{ p.locationName ?? 'No location' }}</span>
                  </td>
                </ng-container>
                <ng-container matColumnDef="entity">
                  <th mat-header-cell *matHeaderCellDef>Employing entity</th>
                  <td mat-cell *matCellDef="let p">{{ p.employingEntityName ?? '—' }}</td>
                </ng-container>
                <ng-container matColumnDef="rsvp">
                  <th mat-header-cell *matHeaderCellDef>RSVP</th>
                  <td mat-cell *matCellDef="let p">
                    {{ rsvpLabel(p.rsvpStatus) }}
                    @if (p.waitlistPosition) {
                      <span class="bf-chip">position {{ p.waitlistPosition }}</span>
                    }
                  </td>
                </ng-container>
                <ng-container matColumnDef="responded">
                  <th mat-header-cell *matHeaderCellDef>Responded</th>
                  <td mat-cell *matCellDef="let p">
                    {{
                      p.rsvpRespondedAt
                        ? (p.rsvpRespondedAt | bfDateTime: session.timezone())
                        : 'Not yet'
                    }}
                  </td>
                </ng-container>
                <ng-container matColumnDef="needs">
                  <th mat-header-cell *matHeaderCellDef>Needs</th>
                  <td mat-cell *matCellDef="let p">
                    {{ p.needsSubmitted ? 'Submitted' : 'Not submitted' }}
                  </td>
                </ng-container>
                <ng-container matColumnDef="reminders">
                  <th mat-header-cell *matHeaderCellDef class="bf-num">Reminders</th>
                  <td mat-cell *matCellDef="let p" class="bf-num">{{ p.remindersSentCount }}</td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="rsvpColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: rsvpColumns"></tr>
              </table>
            </div>
          </section>
        }
      }
    }

    @if (sub() === 'needs') {
      <bf-load-state
        [loading]="needs.isLoading() && !needs.hasValue()"
        [error]="needs.hasValue() ? undefined : needs.error()"
        what="the attendee needs"
        (retry)="needs.reload()"
      />
      @if (needsView(); as n) {
        @if (n.deletedAt) {
          <sat-banner variant="info"
            ><sat-banner-message>
              Individual answers were deleted on
              {{ n.deletedAt | bfDateTime: session.timezone() }} as planned. Counts are kept.
            </sat-banner-message></sat-banner
          >
        }
        @if (!n.canSeeIndividual) {
          <sat-banner variant="info"
            ><sat-banner-message>
              Dietary and accessibility answers can reveal health or religion, so only the event's
              organizers see individual rows. You see the counts.
            </sat-banner-message></sat-banner
          >
        }
        @if (n.answeredCount === 0) {
          <sat-empty-state>
            <h2 satEmptyStateHeadline>No needs submitted yet</h2>
            <p satEmptyStateDescription>
              People who said they are going can tell you about dietary, allergy and accessibility
              needs from their invitation.
            </p>
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="remind()">
              Remind people who are going
            </button>
          </sat-empty-state>
        } @else {
          <section class="bf-kpis" aria-label="Needs counts">
            <div class="bf-kpi">
              <p class="bf-kpi__label">Answered</p>
              <p class="bf-kpi__value" data-testid="needs-answered">{{ n.answeredCount }}</p>
              <p class="bf-kpi__delta">of {{ n.goingCount }} going</p>
            </div>
            <div class="bf-kpi">
              <p class="bf-kpi__label">Severe allergies</p>
              <p class="bf-kpi__value">{{ n.severeAllergyCount }}</p>
              <p class="bf-kpi__delta">need separate preparation</p>
            </div>
            <div class="bf-kpi">
              <p class="bf-kpi__label">Photo consent</p>
              <p class="bf-kpi__value">{{ n.photoConsentYes }} yes</p>
              <p class="bf-kpi__delta">{{ n.photoConsentNo }} asked not to be in photos</p>
            </div>
          </section>
          <section class="bf-card" aria-label="Dietary and accessibility counts">
            <div class="bf-card__header"><h2 class="bf-card__title">Counts</h2></div>
            <dl class="bf-facts">
              @for (entry of entries(n.dietaryCounts); track entry[0]) {
                <div>
                  <dt>{{ entry[0].replace('_', ' ') }}</dt>
                  <dd>{{ entry[1] }}</dd>
                </div>
              }
              @for (entry of entries(n.allergyCounts); track entry[0]) {
                <div>
                  <dt>Allergy: {{ entry[0].replace('_', ' ') }}</dt>
                  <dd>{{ entry[1] }}</dd>
                </div>
              }
              @for (entry of entries(n.accessibilityCounts); track entry[0]) {
                <div>
                  <dt>{{ entry[0].replace(['_'].join(''), ' ') }}</dt>
                  <dd>{{ entry[1] }}</dd>
                </div>
              }
            </dl>
          </section>
          @if (n.canSeeIndividual) {
            <section class="bf-card" aria-label="Individual answers">
              <div class="bf-card__header">
                <h2 class="bf-card__title">Individual answers</h2>
                <span class="bf-page__actions">
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="busy()"
                    (click)="exportNeeds(false)"
                  >
                    Share counts with the caterer
                  </button>
                  <mat-checkbox [(ngModel)]="foodSafety" name="foodSafety"
                    >Needed for food safety</mat-checkbox
                  >
                  <button
                    mat-stroked-button
                    type="button"
                    [disabled]="busy() || !foodSafety"
                    (click)="exportNeeds(true)"
                  >
                    Share the allergy list with names
                  </button>
                </span>
              </div>
              <div class="bf-table-scroll">
                <table mat-table [dataSource]="n.individuals">
                  <ng-container matColumnDef="name">
                    <th mat-header-cell *matHeaderCellDef>Name</th>
                    <td mat-cell *matCellDef="let i">
                      <span class="bf-cell__primary">{{ i.name }}</span>
                      <span class="bf-cell__secondary">{{ i.locationName ?? 'No location' }}</span>
                    </td>
                  </ng-container>
                  <ng-container matColumnDef="dietary">
                    <th mat-header-cell *matHeaderCellDef>Dietary</th>
                    <td mat-cell *matCellDef="let i">
                      {{ (i.dietaryOther ?? i.dietaryPreference).replace('_', ' ') }}
                    </td>
                  </ng-container>
                  <ng-container matColumnDef="allergies">
                    <th mat-header-cell *matHeaderCellDef>Allergies</th>
                    <td mat-cell *matCellDef="let i">
                      {{ i.allergies.length ? i.allergies.join(', ') : 'None' }}
                      @if (i.severeAllergy) {
                        <span class="bf-chip">Severe</span>
                      }
                    </td>
                  </ng-container>
                  <ng-container matColumnDef="accessibility">
                    <th mat-header-cell *matHeaderCellDef>Accessibility</th>
                    <td mat-cell *matCellDef="let i">
                      {{ i.accessibility.length ? i.accessibility.join(', ') : 'None' }}
                    </td>
                  </ng-container>
                  <ng-container matColumnDef="photos">
                    <th mat-header-cell *matHeaderCellDef>Photos</th>
                    <td mat-cell *matCellDef="let i">
                      {{ i.photoConsent ? 'May be in photos' : 'Asked not to be in photos' }}
                    </td>
                  </ng-container>
                  <tr mat-header-row *matHeaderRowDef="needsColumns"></tr>
                  <tr mat-row *matRowDef="let row; columns: needsColumns"></tr>
                </table>
              </div>
              @if (exported()) {
                <p class="bf-empty" data-testid="needs-export">
                  Prepared {{ exported()!.fileName }}
                  {{ exported()!.audited ? '(this export was audited)' : '' }}
                </p>
              }
            </section>
          }
        }
      }
    }

    @if (sub() === 'attendance') {
      <bf-load-state
        [loading]="attendance.isLoading() && !attendance.hasValue()"
        [error]="attendance.hasValue() ? undefined : attendance.error()"
        what="the attendance"
        (retry)="attendance.reload()"
      />
      @if (att(); as a) {
        @if (a.locked) {
          <sat-banner variant="info"
            ><sat-banner-message>
              The split is locked once reconciliation starts.
            </sat-banner-message></sat-banner
          >
        } @else if (!a.attendanceFinal) {
          <sat-banner variant="info"
            ><sat-banner-message>
              Preview only, based on {{ a.counts.going }} going. The split changes when attendance
              is final.
            </sat-banner-message></sat-banner
          >
        }
        @if (a.perHeadLimit?.exceeded) {
          <sat-banner variant="warning"
            ><sat-banner-message>{{ a.perHeadLimit!.message }}</sat-banner-message></sat-banner
          >
        }
        @if (a.blockedReason) {
          <sat-banner variant="important"
            ><sat-banner-message data-testid="split-blocked">{{
              a.blockedReason
            }}</sat-banner-message></sat-banner
          >
        }
        @if (a.splitAppliedAt) {
          <sat-banner variant="success"
            ><sat-banner-message data-testid="split-applied">
              New split applied on {{ a.splitAppliedAt | bfDateTime: session.timezone() }}
              @if (a.splitAppliedByName) {
                by {{ a.splitAppliedByName }}
              }
            </sat-banner-message></sat-banner
          >
        }

        <section class="bf-kpis" aria-label="Attendance counts">
          <div class="bf-kpi">
            <p class="bf-kpi__label">Attended</p>
            <p class="bf-kpi__value" data-testid="attended-count">{{ a.counts.attended }}</p>
            <p class="bf-kpi__delta">
              {{ a.counts.walkIn }} walk-ins · {{ a.counts.noShow }} no-shows ·
              {{ a.counts.notMarked }} not marked
            </p>
          </div>
          <div class="bf-kpi">
            <p class="bf-kpi__label">Cost so far</p>
            <p class="bf-kpi__value">
              <bf-money [amountMinor]="a.costSoFar.amountMinor" [currency]="a.costSoFar.currency" />
            </p>
          </div>
          <div class="bf-kpi">
            <p class="bf-kpi__label">Per head planned</p>
            <p class="bf-kpi__value">
              <bf-money
                [amountMinor]="a.perHeadPlanned.amountMinor"
                [currency]="a.perHeadPlanned.currency"
              />
            </p>
          </div>
          <div class="bf-kpi">
            <p class="bf-kpi__label">Per attendee actual</p>
            <p class="bf-kpi__value">
              <bf-money
                [amountMinor]="a.perHeadActual.amountMinor"
                [currency]="a.perHeadActual.currency"
              />
            </p>
          </div>
          <div class="bf-kpi">
            <p class="bf-kpi__label">No-show cost</p>
            <p class="bf-kpi__value">
              <bf-money
                [amountMinor]="a.noShowCost.amountMinor"
                [currency]="a.noShowCost.currency"
              />
            </p>
            <p class="bf-kpi__delta">per-head catering and activities only</p>
          </div>
        </section>

        <section class="bf-card" aria-label="Cost split before and after">
          <div class="bf-card__header">
            <h2 class="bf-card__title">
              Cost split, planned and {{ a.attendanceFinal ? 'after attendance' : 'if RSVPs hold' }}
            </h2>
          </div>
          <table class="bf-split-table">
            <caption class="bf-empty">
              A contributor's share can only grow up to what its owner approved.
            </caption>
            <thead>
              <tr>
                <th scope="col">Funding source</th>
                <th scope="col" class="bf-num">Planned</th>
                <th scope="col" class="bf-num">After</th>
                <th scope="col" class="bf-num">Change</th>
              </tr>
            </thead>
            <tbody>
              @for (s of a.shares; track s.sourceId) {
                <tr>
                  <th scope="row">
                    <span class="bf-cell__primary">{{ s.budgetName }}</span>
                    <span class="bf-cell__secondary"
                      >{{ s.locationName }}
                      @if (s.contributionRef) {
                        · {{ s.contributionRef }}
                      }
                    </span>
                  </th>
                  <td class="bf-num">
                    {{ s.plannedHeadcount }} ·
                    <bf-money
                      [amountMinor]="s.plannedAmount.amountMinor"
                      [currency]="s.plannedAmount.currency"
                    />
                  </td>
                  <td class="bf-num">
                    {{ s.actualHeadcount }} ·
                    <bf-money
                      [amountMinor]="s.actualAmount.amountMinor"
                      [currency]="s.actualAmount.currency"
                    />
                  </td>
                  <td class="bf-num">{{ s.deltaMinor >= 0 ? '+' : '' }}{{ s.deltaMinor / 100 }}</td>
                </tr>
              }
            </tbody>
          </table>
          @if (a.canManage && !a.locked) {
            <div class="bf-form">
              <mat-form-field class="bf-form__wide">
                <mat-label>Reason</mat-label>
                <input
                  matInput
                  [(ngModel)]="splitReason"
                  name="splitReason"
                  maxlength="500"
                  placeholder="Actual attendance"
                />
              </mat-form-field>
            </div>
            <div class="bf-form__actions">
              <button
                mat-flat-button
                satImportantButton
                type="button"
                [disabled]="busy() || !a.attendanceFinal || a.blockedReason !== null"
                (click)="applySplit('apply')"
                data-testid="apply-split"
              >
                Apply new split
              </button>
              <button
                mat-stroked-button
                type="button"
                [disabled]="busy()"
                (click)="applySplit('keep_planned')"
              >
                Keep planned split
              </button>
            </div>
          }
        </section>

        <section class="bf-card" aria-label="Mark attendance">
          <div class="bf-card__header">
            <h2 class="bf-card__title">Mark attendance</h2>
            @if (a.canManage && !a.attendanceFinal && !a.locked) {
              <span class="bf-page__actions">
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="busy()"
                  (click)="markAllGoing()"
                >
                  Mark everyone going as attended
                </button>
                <button
                  mat-flat-button
                  type="button"
                  [disabled]="busy() || a.counts.notMarked > 0"
                  (click)="finalize()"
                  data-testid="finalize-attendance"
                >
                  Attendance final
                </button>
              </span>
            }
          </div>
          <div class="bf-table-scroll">
            <table mat-table [dataSource]="a.participants">
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Name</th>
                <td mat-cell *matCellDef="let p">
                  <span class="bf-cell__primary">{{ p.name }}</span>
                  <span class="bf-cell__secondary">{{ p.locationName ?? 'No location' }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="rsvp">
                <th mat-header-cell *matHeaderCellDef>RSVP</th>
                <td mat-cell *matCellDef="let p">{{ rsvpLabel(p.rsvpStatus) }}</td>
              </ng-container>
              <ng-container matColumnDef="attendance">
                <th mat-header-cell *matHeaderCellDef>Attendance</th>
                <td mat-cell *matCellDef="let p">
                  @if (a.canManage && !a.attendanceFinal && !a.locked) {
                    <mat-form-field subscriptSizing="dynamic">
                      <mat-label>Attendance for {{ p.name }}</mat-label>
                      <mat-select
                        [value]="p.attendanceStatus"
                        (valueChange)="setAttendance(p, $event)"
                      >
                        <mat-option value="unknown">Not marked</mat-option>
                        <mat-option value="attended">Attended</mat-option>
                        <mat-option value="no_show">No-show</mat-option>
                        <mat-option value="walk_in">Walk-in</mat-option>
                      </mat-select>
                    </mat-form-field>
                  } @else {
                    {{ attendanceLabel(p.attendanceStatus) }}
                  }
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="attendanceColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: attendanceColumns"></tr>
            </table>
          </div>
        </section>
      }
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventPeoplePage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  readonly eventId = input.required<string>();
  protected readonly sub = signal<Sub>('invitations');
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly exported = signal<{ fileName: string; audited: boolean } | null>(null);

  protected readonly rsvpColumns = ['name', 'entity', 'rsvp', 'responded', 'needs', 'reminders'];
  protected readonly needsColumns = ['name', 'dietary', 'allergies', 'accessibility', 'photos'];
  protected readonly attendanceColumns = ['name', 'rsvp', 'attendance'];

  protected message = 'Please tell us whether you can come.';
  protected deadline = '';
  protected capacity: number | null = null;
  protected waitlistEnabled = true;
  protected autoPromote = true;
  protected collectTravel = false;
  protected foodSafety = false;
  protected splitReason = '';

  protected readonly invitations = resource({
    params: () => (this.sub() === 'invitations' ? { eventId: this.eventId() } : undefined),
    loader: ({ params }) => data(this.api.getEventInvitations({ params })),
  });
  protected readonly needs = resource({
    params: () => (this.sub() === 'needs' ? { eventId: this.eventId() } : undefined),
    loader: ({ params }) => data(this.api.getEventNeeds({ params })),
  });
  protected readonly attendance = resource({
    params: () => (this.sub() === 'attendance' ? { eventId: this.eventId() } : undefined),
    loader: ({ params }) => data(this.api.getEventAttendance({ params })),
  });

  protected readonly inv = computed(() => valueOf(this.invitations));
  protected readonly needsView = computed(() => valueOf(this.needs));
  protected readonly att = computed(() => valueOf(this.attendance));

  protected rsvpLabel(status: string): string {
    return RSVP_LABEL[status] ?? status;
  }
  protected attendanceLabel(status: string): string {
    return ATTENDANCE_LABEL[status] ?? status;
  }
  protected entries(counts: Record<string, number>): [string, number][] {
    return Object.entries(counts);
  }

  private async run(label: string, call: () => Promise<unknown>, done?: string): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await call();
      if (done) this.snack.open(done, undefined, { duration: 4000 });
      this.invitations.reload();
      this.needs.reload();
      this.attendance.reload();
    } catch (e) {
      this.failure.set(`${label}: ${errorMessage(e)}`);
    } finally {
      this.busy.set(false);
    }
  }

  protected send(): void {
    if (!this.deadline) {
      this.failure.set('Set an RSVP deadline before the event starts.');
      return;
    }
    const count = this.inv()?.counts.invited ?? 0;
    void this.run(
      'Could not send the invitations',
      () =>
        data(
          this.api.sendEventInvitations({
            params: { eventId: this.eventId() },
            body: {
              message: this.message.trim(),
              deadline: new Date(this.deadline).toISOString(),
              capacity: this.capacity ? Number(this.capacity) : null,
              waitlistEnabled: this.waitlistEnabled,
              autoPromoteWaitlist: this.autoPromote,
              attachCalendarInvite: true,
              collectTravelNeeds: this.collectTravel,
            },
          }),
        ),
      `Invitations sent to ${count} people`,
    );
  }

  protected remind(): void {
    void this.run(
      'Could not send the reminders',
      () =>
        data(this.api.remindEventInvitations({ params: { eventId: this.eventId() }, body: {} })),
      'Reminders sent to everyone without a response',
    );
  }

  protected setRsvpState(status: 'open' | 'closed'): void {
    void this.run(
      'Could not change the RSVP state',
      () =>
        data(
          this.api.setEventRsvpState({
            params: { eventId: this.eventId() },
            body: {
              status,
              ...(status === 'open'
                ? { deadline: new Date(Date.now() + 7 * 86_400_000).toISOString() }
                : {}),
            },
          }),
        ),
      status === 'closed' ? 'RSVPs closed' : 'RSVPs reopened',
    );
  }

  protected exportNeeds(withNames: boolean): void {
    void this.run('Could not prepare the export', async () => {
      const result = await data(
        this.api.exportCatererNeeds({
          params: { eventId: this.eventId() },
          body: {
            content: withNames ? 'counts_and_allergies' : 'counts_only',
            foodSafetyConfirmed: withNames && this.foodSafety,
            format: 'csv',
          },
        }),
      );
      this.exported.set({ fileName: result.fileName, audited: result.audited });
    });
  }

  protected setAttendance(p: EventParticipant, status: string): void {
    void this.run('Could not mark attendance', () =>
      data(
        this.api.markEventAttendance({
          params: { eventId: this.eventId() },
          body: {
            marks: [
              {
                participantId: p.id,
                status: status as 'attended' | 'no_show' | 'walk_in' | 'unknown',
              },
            ],
          },
        }),
      ),
    );
  }

  protected markAllGoing(): void {
    void this.run(
      'Could not mark attendance',
      () =>
        data(
          this.api.markEventAttendance({
            params: { eventId: this.eventId() },
            body: { markAllGoingAttended: true },
          }),
        ),
      'Everyone going is marked as attended',
    );
  }

  protected finalize(): void {
    void this.run(
      'Could not finalize attendance',
      () =>
        data(
          this.api.markEventAttendance({
            params: { eventId: this.eventId() },
            body: { finalize: true },
          }),
        ),
      'Attendance is final',
    );
  }

  protected applySplit(action: 'apply' | 'keep_planned'): void {
    const attended = this.att()?.counts.totalActualAttendees ?? 0;
    const reason = this.splitReason.trim() || `Actual attendance: ${attended}`;
    void this.run(
      action === 'apply' ? 'Could not apply the split' : 'Could not keep the planned split',
      () =>
        data(
          this.api.applyEventAttendanceSplit({
            params: { eventId: this.eventId() },
            body: { action, reason, confirmed: true },
          }),
        ),
      action === 'apply'
        ? 'New cost split applied; the commitment funding lines were re-posted'
        : 'Planned split kept with your reason',
    );
  }
}
