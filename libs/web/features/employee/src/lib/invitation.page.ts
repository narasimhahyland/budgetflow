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
import { MatRadioModule } from '@angular/material/radio';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { data, errorMessage, injectApi, valueOf } from './api';

const DIETARY = [
  ['no_preference', 'No preference'],
  ['vegetarian', 'Vegetarian'],
  ['vegan', 'Vegan'],
  ['jain', 'Jain'],
  ['halal', 'Halal'],
  ['kosher', 'Kosher'],
  ['other', 'Other'],
] as const;
const ALLERGIES = ['nuts', 'gluten', 'dairy', 'shellfish', 'eggs'] as const;
const ACCESSIBILITY = ['step_free_access', 'hearing_loop', 'seating_near_an_exit'] as const;

/** Screens 47a and 47b for the invited employee: answer the invitation and give dietary or access needs. */
@Component({
  selector: 'bf-invitation-page',
  imports: [
    DateTimePipe,
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatRadioModule,
    MatSlideToggleModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  template: `
    <bf-load-state
      [loading]="invitation.isLoading() && !invitation.hasValue()"
      [error]="invitation.hasValue() ? undefined : invitation.error()"
      what="this invitation"
      (retry)="invitation.reload()"
    />

    @if (view(); as v) {
      <header class="bf-page__header">
        <div class="bf-page__heading">
          <h1 class="bf-page__title">{{ v.eventName }}</h1>
          <p class="bf-meta">
            <span>{{ v.startsAt | bfDateTime: session.timezone() }}</span>
            <span>{{ v.venue ?? 'Place to be confirmed' }}</span>
            <span>organizer {{ v.organizerName }}</span>
          </p>
        </div>
        <div class="bf-page__actions">
          <a mat-stroked-button routerLink="/my">My view</a>
        </div>
      </header>

      @if (failure()) {
        <sat-banner variant="important"
          ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
        >
      }

      @if (v.eventStatus === 'cancelled') {
        <sat-banner variant="warning"
          ><sat-banner-message>This event was cancelled.</sat-banner-message></sat-banner
        >
      } @else if (v.rsvpClosed) {
        <sat-banner variant="info"
          ><sat-banner-message data-testid="rsvp-closed">
            RSVPs for this event are closed. Contact {{ v.organizerName }}.
          </sat-banner-message></sat-banner
        >
      }

      <section class="bf-card" aria-label="Your answer">
        <div class="bf-card__header">
          <h2 class="bf-card__title">
            @switch (v.rsvpStatus) {
              @case ('going') {
                You're going
              }
              @case ('cant_go') {
                You said you can't go
              }
              @case ('waitlisted') {
                You're on the waitlist (position {{ v.waitlistPosition }})
              }
              @default {
                Will you attend?
              }
            }
          </h2>
          @if (v.deadline) {
            <p class="bf-card__hint">
              You can change your answer until
              {{ v.deadline | bfDateTime: session.timezone() }}.
            </p>
          }
        </div>
        <p class="bf-empty">{{ v.message }}</p>
        @if (v.rsvpStatus === 'waitlisted') {
          <p class="bf-empty">We'll tell you if a place opens.</p>
        }
        @if (!v.rsvpClosed && v.eventStatus !== 'cancelled') {
          <div class="bf-form__actions">
            <button
              mat-flat-button
              satImportantButton
              type="button"
              [disabled]="busy()"
              (click)="respond('going')"
              data-testid="rsvp-going"
            >
              Going
            </button>
            <button
              mat-stroked-button
              type="button"
              [disabled]="busy()"
              (click)="respond('cant_go')"
              data-testid="rsvp-cant-go"
            >
              Can't go
            </button>
          </div>
        }
      </section>

      @if (v.visibleAgenda.length) {
        <section class="bf-card" aria-label="Agenda">
          <div class="bf-card__header"><h2 class="bf-card__title">What happens</h2></div>
          <ul class="bf-timeline">
            @for (item of v.visibleAgenda; track item.id) {
              <li>
                <span class="bf-cell__primary"
                  >{{ item.startTime }}
                  @if (item.endTime) {
                    <span>–{{ item.endTime }}</span>
                  }
                  · {{ item.title }}</span
                >
                <span class="bf-cell__secondary">{{ item.locationRoom ?? '' }}</span>
              </li>
            }
          </ul>
        </section>
      }

      @if (v.rsvpStatus === 'going') {
        <section class="bf-card" aria-label="Your needs">
          <div class="bf-card__header">
            <h2 class="bf-card__title">Dietary, accessibility and photos</h2>
            <p class="bf-card__hint">
              Only the organizers of this event see your answers. They are deleted 30 days after the
              event closes.
            </p>
          </div>
          @if (v.needsSubmitted && !editing()) {
            <p class="bf-empty" data-testid="needs-saved">
              Thanks, {{ v.organizerName }} will plan for this.
            </p>
            <div class="bf-form__actions">
              <button mat-stroked-button type="button" (click)="startEdit()">Edit</button>
            </div>
          } @else {
            <fieldset class="bf-fieldset">
              <legend class="bf-section__title">Dietary preference</legend>
              <mat-radio-group [(ngModel)]="dietary" name="dietary" class="bf-choices">
                @for (option of dietaryOptions; track option[0]) {
                  <mat-radio-button [value]="option[0]">{{ option[1] }}</mat-radio-button>
                }
              </mat-radio-group>
              @if (dietary === 'other') {
                <mat-form-field class="bf-form__wide">
                  <mat-label>Describe the other dietary need</mat-label>
                  <input matInput [(ngModel)]="dietaryOther" name="dietaryOther" maxlength="200" />
                </mat-form-field>
              }
            </fieldset>
            <fieldset class="bf-fieldset">
              <legend class="bf-section__title">Allergies</legend>
              <div class="bf-choices">
                @for (a of allergyOptions; track a) {
                  <mat-checkbox [checked]="allergies.includes(a)" (change)="toggleAllergy(a)">{{
                    a
                  }}</mat-checkbox>
                }
              </div>
              <mat-slide-toggle [(ngModel)]="severe" name="severe"
                >Severe: needs separate preparation</mat-slide-toggle
              >
            </fieldset>
            <fieldset class="bf-fieldset">
              <legend class="bf-section__title">Accessibility</legend>
              <div class="bf-choices">
                @for (a of accessibilityOptions; track a) {
                  <mat-checkbox
                    [checked]="accessibility.includes(a)"
                    (change)="toggleAccessibility(a)"
                    >{{ a.replace('_', ' ') }}</mat-checkbox
                  >
                }
              </div>
            </fieldset>
            @if (v.collectTravelNeeds) {
              <fieldset class="bf-fieldset">
                <legend class="bf-section__title">Travel</legend>
                <mat-slide-toggle [(ngModel)]="needsTravel" name="needsTravel"
                  >I need travel from another city</mat-slide-toggle
                >
                @if (needsTravel) {
                  <mat-form-field>
                    <mat-label>From city</mat-label>
                    <input matInput [(ngModel)]="travelFromCity" name="travelFromCity" />
                  </mat-form-field>
                  <mat-slide-toggle [(ngModel)]="hotelNight" name="hotelNight"
                    >I need a hotel night</mat-slide-toggle
                  >
                }
              </fieldset>
            }
            <fieldset class="bf-fieldset">
              <legend class="bf-section__title">Photos</legend>
              <mat-slide-toggle [(ngModel)]="photoConsent" name="photoConsent"
                >You may include me in event photos</mat-slide-toggle
              >
              <mat-slide-toggle [(ngModel)]="reuse" name="reuse"
                >Use these answers for my future events</mat-slide-toggle
              >
            </fieldset>
            <div class="bf-form__actions">
              <button
                mat-flat-button
                satImportantButton
                type="button"
                [disabled]="busy()"
                (click)="saveNeeds()"
                data-testid="save-needs"
              >
                Save
              </button>
              @if (v.needsSubmitted) {
                <button mat-button type="button" (click)="editing.set(false)">Cancel</button>
              }
            </div>
          }
        </section>
      }
    }
  `,
  styles: `
    .bf-fieldset {
      margin: 0 20px 12px;
      padding: 12px 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-large);
    }

    .bf-choices {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      margin-bottom: 8px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InvitationPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  readonly invitationId = input.required<string>();
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly editing = signal(false);
  protected readonly dietaryOptions = DIETARY;
  protected readonly allergyOptions = ALLERGIES;
  protected readonly accessibilityOptions = ACCESSIBILITY;

  protected dietary = 'no_preference';
  protected dietaryOther = '';
  protected allergies: string[] = [];
  protected severe = false;
  protected accessibility: string[] = [];
  protected needsTravel = false;
  protected travelFromCity = '';
  protected hotelNight = false;
  protected photoConsent = true;
  protected reuse = false;

  protected readonly invitation = resource({
    params: () => ({ invitationId: this.invitationId() }),
    loader: async ({ params }) => {
      const view = await data(this.api.getEmployeeInvitation({ params }));
      this.dietary = view.needs.dietaryPreference;
      this.dietaryOther = view.needs.dietaryOther ?? '';
      this.allergies = [...view.needs.allergies];
      this.severe = view.needs.severeAllergy;
      this.accessibility = [...view.needs.accessibility];
      this.needsTravel = view.needs.needsTravel;
      this.travelFromCity = view.needs.travelFromCity ?? '';
      this.hotelNight = view.needs.needsHotelNight;
      this.photoConsent = view.needs.photoConsent;
      this.reuse = view.needs.reuseForFutureEvents;
      return view;
    },
  });
  protected readonly view = computed(() => valueOf(this.invitation));

  protected toggleAllergy(value: string): void {
    this.allergies = this.allergies.includes(value)
      ? this.allergies.filter((a) => a !== value)
      : [...this.allergies, value];
  }

  protected toggleAccessibility(value: string): void {
    this.accessibility = this.accessibility.includes(value)
      ? this.accessibility.filter((a) => a !== value)
      : [...this.accessibility, value];
  }

  protected startEdit(): void {
    this.editing.set(true);
  }

  private async run(label: string, call: () => Promise<unknown>, done: string): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await call();
      this.snack.open(done, undefined, { duration: 4000 });
      this.editing.set(false);
      this.invitation.reload();
    } catch (e) {
      this.failure.set(`${label}: ${errorMessage(e)}`);
    } finally {
      this.busy.set(false);
    }
  }

  protected respond(response: 'going' | 'cant_go'): void {
    void this.run(
      'Could not save your answer',
      () =>
        data(
          this.api.respondToInvitation({
            params: { invitationId: this.invitationId() },
            body: { response },
          }),
        ),
      response === 'going' ? "You're going" : 'Thanks for letting us know',
    );
  }

  protected saveNeeds(): void {
    if (this.dietary === 'other' && this.dietaryOther.trim().length === 0) {
      this.failure.set('Describe the other dietary need.');
      return;
    }
    void this.run(
      'Could not save your answers',
      () =>
        data(
          this.api.submitAttendeeNeeds({
            params: { invitationId: this.invitationId() },
            body: {
              dietaryPreference: this.dietary as 'no_preference',
              dietaryOther: this.dietaryOther.trim() || null,
              allergies: this.allergies,
              severeAllergy: this.severe,
              accessibility: this.accessibility,
              needsTravel: this.needsTravel,
              travelFromCity: this.travelFromCity.trim() || null,
              needsHotelNight: this.hotelNight,
              photoConsent: this.photoConsent,
              reuseForFutureEvents: this.reuse,
            },
          }),
        ),
      'Thanks, the organizer will plan for this',
    );
  }
}
