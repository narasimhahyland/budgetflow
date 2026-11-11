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
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from '@bf/web/ui';

/** Screen 54a for the attendee: the anonymous post-event survey. */
@Component({
  selector: 'bf-survey-page',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatRadioModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SatImportantButton,
  ],
  template: `
    <bf-load-state
      [loading]="survey.isLoading() && !survey.hasValue()"
      [error]="survey.hasValue() ? undefined : survey.error()"
      what="this survey"
      (retry)="survey.reload()"
    />

    @if (view(); as v) {
      <header class="bf-page__header">
        <div class="bf-page__heading">
          <h1 class="bf-page__title">How was it?</h1>
          <p class="bf-page__subtitle">
            Your answer is anonymous. Results appear only once five people have answered.
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

      @if (v.mySurveyAnswered) {
        <sat-banner variant="success"
          ><sat-banner-message data-testid="survey-answered">
            Thanks for your feedback. You have answered this survey.
          </sat-banner-message></sat-banner
        >
      } @else if (v.status !== 'open') {
        <sat-banner variant="info"
          ><sat-banner-message>
            This survey is not open for answers right now.
          </sat-banner-message></sat-banner
        >
      } @else {
        <section class="bf-card" aria-label="Survey">
          <fieldset class="bf-fieldset">
            <legend class="bf-section__title">How would you rate the event?</legend>
            <mat-radio-group [(ngModel)]="rating" name="rating" class="bf-choices">
              @for (value of ratings; track value) {
                <mat-radio-button [value]="value">{{ value }}</mat-radio-button>
              }
            </mat-radio-group>
          </fieldset>
          <fieldset class="bf-fieldset">
            <legend class="bf-section__title">Would you attend a similar event again?</legend>
            <mat-radio-group [(ngModel)]="again" name="again" class="bf-choices">
              <mat-radio-button [value]="true">Yes</mat-radio-button>
              <mat-radio-button [value]="false">No</mat-radio-button>
            </mat-radio-group>
          </fieldset>
          <div class="bf-form">
            <mat-form-field class="bf-form__wide">
              <mat-label>What should we change next time?</mat-label>
              <textarea
                matInput
                rows="3"
                [(ngModel)]="comment"
                name="comment"
                maxlength="1000"
              ></textarea>
            </mat-form-field>
          </div>
          <div class="bf-form__actions">
            <button
              mat-flat-button
              satImportantButton
              type="button"
              [disabled]="busy()"
              (click)="submit()"
              data-testid="submit-survey"
            >
              Submit
            </button>
          </div>
        </section>
      }
    }
  `,
  styles: `
    .bf-fieldset {
      margin: 12px 20px;
      padding: 12px 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-large);
    }

    .bf-choices {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SurveyPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  readonly surveyId = input.required<string>();
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly ratings = [1, 2, 3, 4, 5];
  protected rating = 5;
  protected again = true;
  protected comment = '';

  protected readonly survey = resource({
    params: () => ({ surveyId: this.surveyId() }),
    loader: ({ params }) => data(this.api.getEmployeeSurvey({ params })),
  });
  protected readonly view = computed(() => valueOf(this.survey));

  protected submit(): void {
    this.busy.set(true);
    this.failure.set('');
    void (async () => {
      try {
        await data(
          this.api.submitEventSurveyResponse({
            params: { surveyId: this.surveyId() },
            body: {
              rating: this.rating,
              wouldAttendAgain: this.again,
              ...(this.comment.trim() ? { comment: this.comment.trim() } : {}),
            },
          }),
        );
        this.snack.open('Thanks for your feedback', undefined, { duration: 4000 });
        this.survey.reload();
      } catch (e) {
        this.failure.set(`Could not send your answer: ${errorMessage(e)}`);
      } finally {
        this.busy.set(false);
      }
    })();
  }
}
