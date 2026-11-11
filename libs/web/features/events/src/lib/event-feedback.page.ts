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
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { EventFeedbackView, GalleryPhotoView } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { EventTabs } from './event-tabs';
import { label } from './labels';

type Sub = 'results' | 'gallery';

/** Screen 54a: the post-event survey and the private photo gallery. */
@Component({
  selector: 'bf-event-feedback-page',
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
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Feedback</h1>
        <p class="bf-page__subtitle">
          The survey is anonymous, and results appear only once five people have answered.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button [routerLink]="['/events', eventId()]">Back to the event</a>
      </div>
    </header>

    <bf-event-tabs [eventId]="eventId()" section="feedback" />

    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }

    <bf-load-state
      [loading]="feedback.isLoading() && !feedback.hasValue()"
      [error]="feedback.hasValue() ? undefined : feedback.error()"
      what="the feedback"
      (retry)="feedback.reload()"
    />

    @if (view(); as v) {
      <sat-navigation-tabs class="bf-tabs" aria-label="Feedback sections">
        <a
          satNavigationTab
          [active]="sub() === 'results'"
          (click)="sub.set('results')"
          (keydown.enter)="sub.set('results')"
          tabindex="0"
          >Survey</a
        >
        <a
          satNavigationTab
          [active]="sub() === 'gallery'"
          (click)="sub.set('gallery')"
          (keydown.enter)="sub.set('gallery')"
          tabindex="0"
          >Gallery</a
        >
      </sat-navigation-tabs>

      @if (sub() === 'results') {
        @if (v.status === 'draft') {
          <sat-banner variant="info"
            ><sat-banner-message>
              The survey has not gone out yet. It goes to the people marked Attended, so no-shows do
              not rate an event they missed.
            </sat-banner-message></sat-banner
          >
        }
        @if (v.status === 'open' && !v.minimumResponsesMet) {
          <sat-banner variant="info"
            ><sat-banner-message data-testid="too-few-responses">
              Results appear after 5 responses ({{ v.responseCount }} so far).
            </sat-banner-message></sat-banner
          >
        }

        <section class="bf-kpis" aria-label="Survey results">
          <div class="bf-kpi">
            <div class="bf-kpi__head">
              <p class="bf-kpi__label">Responses</p>
              <mat-icon class="bf-kpi__icon" svgIcon="note_edit" aria-hidden="true" />
            </div>
            <p class="bf-kpi__value" data-testid="response-count">{{ v.responseCount }}</p>
            <div class="bf-kpi__foot">
              <span>Of {{ v.audienceCount }} attendees</span>
              <span class="bf-kpi__pct">{{ v.responseRatePct }}%</span>
              <span class="bf-kpi__track"
                ><span class="bf-kpi__fill" [style.width.%]="v.responseRatePct"></span
              ></span>
            </div>
          </div>
          <div class="bf-kpi">
            <div class="bf-kpi__head">
              <p class="bf-kpi__label">Average rating</p>
              <mat-icon class="bf-kpi__icon" svgIcon="star" aria-hidden="true" />
            </div>
            <p class="bf-kpi__value" data-testid="average-rating">
              {{ v.averageRating === null ? 'Not enough responses' : v.averageRating + ' of 5' }}
            </p>
          </div>
          <div class="bf-kpi bf-kpi--success">
            <div class="bf-kpi__head">
              <p class="bf-kpi__label">Would attend again</p>
              <mat-icon class="bf-kpi__icon" svgIcon="thumbsup" aria-hidden="true" />
            </div>
            <p class="bf-kpi__value">
              {{ v.wouldAttendAgainPct === null ? '—' : v.wouldAttendAgainPct + '%' }}
            </p>
            @if (v.wouldAttendAgainPct !== null) {
              <div class="bf-kpi__foot">
                <span>Of those who answered</span>
                <span class="bf-kpi__pct">{{ v.wouldAttendAgainPct }}%</span>
                <span class="bf-kpi__track"
                  ><span class="bf-kpi__fill" [style.width.%]="v.wouldAttendAgainPct"></span
                ></span>
              </div>
            }
          </div>
        </section>

        @if (v.minimumResponsesMet) {
          <section class="bf-card" aria-label="Rating distribution">
            <div class="bf-card__header"><h2 class="bf-card__title">How people rated it</h2></div>
            <div class="bf-table-scroll">
              <table class="bf-split-table" aria-label="Rating distribution">
                <caption>
                  Ratings from 5 down to 1; the bars show each rating's share of the responses.
                </caption>
                <thead>
                  <tr>
                    <th scope="col" class="bf-num">Rating</th>
                    <th scope="col">Share</th>
                    <th scope="col" class="bf-num">Responses</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of v.ratingDistribution; track row.rating) {
                    <tr>
                      <th scope="row" class="bf-num">{{ row.rating }}</th>
                      <td class="bf-rating" aria-hidden="true">
                        <span
                          class="bf-rating__bar"
                          [style.width.%]="share(row.count, v.responseCount)"
                        ></span>
                      </td>
                      <td class="bf-num">{{ row.count }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
          @if (v.comments.length) {
            <section class="bf-card" aria-label="Comments">
              <div class="bf-card__header">
                <h2 class="bf-card__title">What people said</h2>
                <p class="bf-card__hint">Anonymous, newest first.</p>
              </div>
              <ul class="bf-list">
                @for (c of v.comments; track c.id) {
                  <li class="bf-list__item">
                    <span class="bf-list__row">
                      <span>{{ c.hidden ? 'Hidden comment' : c.comment }}</span>
                      @if (v.canManage) {
                        <button
                          mat-button
                          type="button"
                          [disabled]="busy()"
                          (click)="moderate(c.id, !c.hidden)"
                        >
                          {{ c.hidden ? 'Restore' : 'Hide' }}
                        </button>
                      }
                    </span>
                    <span class="bf-cell__secondary">
                      {{ c.submittedAt | bfDateTime: session.timezone() }}
                      @if (c.hiddenReason) {
                        · {{ c.hiddenReason }}
                      }
                    </span>
                  </li>
                }
              </ul>
            </section>
          }
        }

        @if (v.canManage && v.status !== 'closed') {
          <section class="bf-card" aria-label="Survey status">
            <div class="bf-card__header">
              <h2 class="bf-card__title">Survey</h2>
              <sat-status-tag [status]="surveyTone(v.status)">{{ label(v.status) }}</sat-status-tag>
            </div>
            <div class="bf-form__actions">
              @if (v.status !== 'open') {
                <button
                  mat-flat-button
                  type="button"
                  [disabled]="busy()"
                  (click)="setStatus('open')"
                  data-testid="open-survey"
                >
                  Send the survey now
                </button>
              } @else {
                <button
                  mat-stroked-button
                  type="button"
                  [disabled]="busy()"
                  (click)="setStatus('closed')"
                >
                  Close the survey
                </button>
              }
            </div>
          </section>
        }
      } @else {
        @if (v.photoConsentNoCount > 0) {
          <sat-banner variant="warning"
            ><sat-banner-message>
              {{ v.photoConsentNoCount }} people at this event asked not to be in photos. Only
              upload photos of people who agreed.
            </sat-banner-message></sat-banner
          >
        }
        @if (v.photos.length === 0) {
          <sat-empty-state>
            <h2 satEmptyStateHeadline>No photos yet</h2>
            <p satEmptyStateDescription>
              The gallery is private to this event's participants, organizers and contributing
              owners.
            </p>
          </sat-empty-state>
        } @else {
          <section class="bf-card" aria-label="Event photos">
            <div class="bf-card__header"><h2 class="bf-card__title">Event photos</h2></div>
            <ul class="bf-list">
              @for (p of v.photos; track p.id) {
                <li class="bf-list__item">
                  <span class="bf-list__row">
                    <span>{{ p.caption }}</span>
                    <span class="bf-page__actions">
                      @if (p.status === 'removal_requested') {
                        <sat-status-tag status="warning">Removal requested</sat-status-tag>
                      }
                      @if (p.status === 'hidden') {
                        <sat-status-tag status="neutral">Hidden</sat-status-tag>
                      }
                      <button
                        mat-button
                        type="button"
                        [disabled]="busy()"
                        (click)="moderatePhoto(p, 'remove_me')"
                      >
                        Remove me from this photo
                      </button>
                      @if (v.canManage) {
                        <button
                          mat-button
                          type="button"
                          [disabled]="busy()"
                          (click)="moderatePhoto(p, p.status === 'visible' ? 'hide' : 'restore')"
                        >
                          {{ p.status === 'visible' ? 'Hide' : 'Restore' }}
                        </button>
                      }
                    </span>
                  </span>
                  <span class="bf-cell__secondary"
                    >{{ p.fileName }} · {{ p.uploadedByName }} ·
                    {{ p.createdAt | bfDateTime: session.timezone() }}</span
                  >
                </li>
              }
            </ul>
          </section>
        }
        <section class="bf-card" aria-label="Add a photo">
          <div class="bf-card__header"><h2 class="bf-card__title">Add a photo</h2></div>
          <div class="bf-form">
            <mat-form-field class="bf-form__wide">
              <mat-label>Caption</mat-label>
              <input matInput [(ngModel)]="caption" name="caption" maxlength="200" />
            </mat-form-field>
            <mat-form-field>
              <mat-label>File name</mat-label>
              <input matInput [(ngModel)]="fileName" name="fileName" maxlength="200" />
            </mat-form-field>
            <mat-checkbox [(ngModel)]="checked" name="checked"
              >I checked these photos against the photo preferences</mat-checkbox
            >
          </div>
          <div class="bf-form__actions">
            <button
              mat-flat-button
              type="button"
              [disabled]="busy() || !checked"
              (click)="upload()"
            >
              <mat-icon svgIcon="plus_small" />Upload
            </button>
          </div>
        </section>
      }
    }
  `,
  styles: `
    .bf-rating {
      width: 60%;
      min-width: 120px;
    }
    .bf-rating__bar {
      display: block;
      height: 12px;
      border-radius: var(--mat-sys-corner-extra-small);
      background: var(--sequential-data-viz-5);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventFeedbackPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  readonly eventId = input.required<string>();
  protected readonly sub = signal<Sub>('results');
  protected readonly label = label;
  protected share(part: number, whole: number): number {
    return whole > 0 ? Math.min(100, Math.round((part * 100) / whole)) : 0;
  }
  protected surveyTone(status: string): 'success' | 'info' | 'neutral' {
    return status === 'open' ? 'success' : status === 'scheduled' ? 'info' : 'neutral';
  }
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected caption = '';
  protected fileName = '';
  protected checked = false;

  protected readonly feedback = resource({
    params: () => ({ eventId: this.eventId() }),
    loader: ({ params }) => data(this.api.getEventFeedback({ params })),
  });
  protected readonly view = computed(() => valueOf(this.feedback));

  private async run(label: string, call: () => Promise<unknown>, done?: string): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await call();
      if (done) this.snack.open(done, undefined, { duration: 4000 });
      this.feedback.reload();
    } catch (e) {
      this.failure.set(`${label}: ${errorMessage(e)}`);
    } finally {
      this.busy.set(false);
    }
  }

  protected setStatus(status: EventFeedbackView['status']): void {
    void this.run(
      'Could not update the survey',
      () =>
        data(this.api.updateEventSurvey({ params: { eventId: this.eventId() }, body: { status } })),
      status === 'open' ? 'The survey is open for answers' : 'The survey is closed',
    );
  }

  protected moderate(responseId: string, hidden: boolean): void {
    void this.run(
      'Could not moderate the comment',
      () =>
        data(
          this.api.moderateSurveyComment({
            params: { eventId: this.eventId(), responseId },
            body: { hidden, ...(hidden ? { reason: 'Hidden by the organizer' } : {}) },
          }),
        ),
      hidden ? 'Comment hidden' : 'Comment restored',
    );
  }

  protected upload(): void {
    if (this.caption.trim().length < 1 || this.fileName.trim().length < 1) {
      this.failure.set('Give the photo a caption and a file name.');
      return;
    }
    void this.run(
      'Could not add the photo',
      async () => {
        await data(
          this.api.uploadGalleryPhoto({
            params: { eventId: this.eventId() },
            body: {
              caption: this.caption.trim(),
              fileName: this.fileName.trim(),
              photoPreferencesChecked: this.checked,
            },
          }),
        );
        this.caption = '';
        this.fileName = '';
        this.checked = false;
      },
      'Photo added to the gallery',
    );
  }

  protected moderatePhoto(p: GalleryPhotoView, action: 'remove_me' | 'hide' | 'restore'): void {
    void this.run(
      'Could not update the photo',
      () =>
        data(
          this.api.moderateGalleryPhoto({
            params: { eventId: this.eventId(), photoId: p.id },
            body: {
              action,
              ...(action === 'remove_me' ? { reason: 'Asked to be removed from this photo' } : {}),
            },
          }),
        ),
      action === 'remove_me'
        ? 'The photo is hidden while the organizer reviews it'
        : 'Photo updated',
    );
  }
}
