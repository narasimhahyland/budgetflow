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
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe, LoadState } from '@bf/web/ui';
import { SatAvatar } from '@hylandsoftware/satori-ui/avatar';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { data, errorMessage, initialsOf, injectApi, valueOf } from './api';
import { Suppressible } from './figures';

/** Leave a thank-you note for an organizer (122b). No money is attached to a note. */
@Component({
  selector: 'bf-say-thanks-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Say thanks</h2>
    <mat-dialog-content>
      <p>
        A thank-you note carries no money. Monetary recognition goes through the recognition
        programme, where it is committed against a budget.
      </p>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Your note</mat-label>
        <textarea
          matInput
          rows="4"
          [(ngModel)]="note"
          minlength="10"
          maxlength="300"
          data-testid="thanks-note"
        ></textarea>
        <mat-hint>{{ note().length }} of 300; at least 10 characters.</mat-hint>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close()">Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="note().trim().length < 10"
        (click)="ref.close(note().trim())"
        data-testid="thanks-send"
      >
        Send thanks
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
export class SayThanksDialog {
  protected readonly note = signal('');
  protected readonly ref = inject<MatDialogRef<SayThanksDialog, string | undefined>>(MatDialogRef);
}

/**
 * Screen 122b: what an organizer did and what people said about it.
 *
 * The feedback average only counts events with enough survey responses to stay anonymous, so where
 * there were too few it says "fewer than five responses" rather than showing a figure one or two
 * people could be identified from.
 */
@Component({
  selector: 'bf-organizer-page',
  imports: [
    DateTimePipe,
    LoadState,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatAvatar,
    Suppressible,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-profile">
        @if (organizer(); as o) {
          <sat-avatar size="64" [initials]="initials(o.personName)" aria-hidden="true" />
        }
        <div class="bf-page__heading">
          <h1 class="bf-page__title">{{ organizer()?.personName ?? 'Organizer' }}</h1>
          <p class="bf-page__subtitle">Events organised, people reached and thank-you notes</p>
        </div>
      </div>
      <div class="bf-page__actions">
        @if (organizer(); as o) {
          @if (o.personId !== myPersonId()) {
            <button mat-flat-button type="button" (click)="sayThanks()" data-testid="say-thanks">
              <mat-icon svgIcon="thumbsup" />Say thanks
            </button>
          }
        }
      </div>
    </header>

    @if (failure(); as message) {
      <sat-banner variant="important" data-testid="organizer-error">
        <sat-banner-message>{{ message }}</sat-banner-message>
      </sat-banner>
    }

    <bf-load-state
      [loading]="profile.isLoading() && !profile.hasValue()"
      [error]="profile.error()"
      what="this organizer's profile"
      (retry)="profile.reload()"
    />

    @if (organizer(); as o) {
      @if (!o.visibleToColleagues) {
        <sat-banner variant="info" data-testid="organizer-hidden">
          <sat-banner-message>
            Hidden from colleagues. {{ o.personName }} has chosen not to show this section, so only
            they can see it.
          </sat-banner-message>
        </sat-banner>
      }

      @if (o.eventsOrganised === 0) {
        <sat-empty-state data-testid="organizer-empty">
          <h2 satEmptyStateHeadline>No events organised yet</h2>
          <p satEmptyStateDescription>
            Organised events, the people they reached and the thanks for them appear here.
          </p>
        </sat-empty-state>
      } @else {
        <div class="bf-kpis">
          <article class="bf-kpi" data-testid="organizer-events">
            <div class="bf-kpi__head">
              <h2 class="bf-kpi__title">Events organised</h2>
              <mat-icon class="bf-kpi__icon" svgIcon="calendar" aria-hidden="true" />
            </div>
            <span class="bf-kpi__value">{{ o.eventsOrganised }}</span>
          </article>
          <article class="bf-kpi" data-testid="organizer-reach">
            <div class="bf-kpi__head">
              <h2 class="bf-kpi__title">Colleagues reached</h2>
              <mat-icon class="bf-kpi__icon" svgIcon="users" aria-hidden="true" />
            </div>
            <span class="bf-kpi__value">{{ o.colleaguesReached }}</span>
          </article>
          <article class="bf-kpi" data-testid="organizer-feedback">
            <div class="bf-kpi__head">
              <h2 class="bf-kpi__title">Average feedback</h2>
              <mat-icon class="bf-kpi__icon" svgIcon="thumbsup" aria-hidden="true" />
            </div>
            <bf-suppressible
              class="bf-kpi__value"
              [figure]="o.averagePulse"
              kind="rating"
              noun="responses"
              testId="organizer-pulse"
            />
            <p class="bf-cell__secondary">
              Only events with enough responses to stay anonymous are counted.
            </p>
          </article>
        </div>
      }

      <section class="bf-card bf-section" data-testid="thank-notes">
        <h2 class="bf-section__title">
          Thank-you notes
          @if (o.thankNoteCount) {
            <span class="bf-cell__secondary">{{ o.thankNoteCount }} in total</span>
          }
        </h2>
        @if (o.notes.length === 0) {
          <p>No notes yet.</p>
        } @else {
          <ul class="bf-notes">
            @for (n of o.notes; track n.id) {
              <li class="bf-note" [attr.data-testid]="'note-' + n.id">
                <sat-avatar size="28" [initials]="initials(n.authorName)" aria-hidden="true" />
                <div class="bf-note__body">
                  <p class="bf-note__text">&ldquo;{{ n.note }}&rdquo;</p>
                  <p class="bf-cell__secondary">
                    {{ n.authorName }} &middot;
                    <span data-testid="relative-time">{{
                      n.createdAt | bfDateTime: session.timezone()
                    }}</span>
                    @if (n.eventName) {
                      <span> &middot; {{ n.eventName }}</span>
                    }
                    @if (n.hidden) {
                      <span> &middot; Hidden from colleagues</span>
                    }
                  </p>
                </div>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: `
    .bf-profile {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .bf-kpi p {
      margin: 0;
    }
    .bf-section {
      padding: 16px;
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bf-section__title {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 8px;
      margin: 0;
      font: var(--mat-sys-title-small);
    }
    .bf-section > p {
      margin: 0;
    }
    .bf-notes {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .bf-note {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .bf-note__body {
      min-width: 0;
      padding-inline-start: 10px;
      border-inline-start: 3px solid var(--mat-sys-outline-variant);
    }
    .bf-note p {
      margin: 0;
    }
    .bf-note__text {
      font-style: italic;
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrganizerPage {
  readonly personId = input.required<string>();

  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  protected readonly initials = initialsOf;

  protected readonly failure = signal<string | null>(null);
  protected readonly profile = resource({
    params: () => ({ id: this.personId() }),
    loader: ({ params }) =>
      data(this.api.getOrganizerRecognition({ params: { personId: params.id } })),
  });
  protected readonly organizer = computed(() => valueOf(this.profile));
  protected readonly myPersonId = computed(() => this.session.me()?.personId ?? null);

  protected sayThanks(): void {
    const organizer = this.organizer();
    if (!organizer) return;
    this.dialog
      .open(SayThanksDialog, { width: '480px' })
      .afterClosed()
      .subscribe(async (note) => {
        if (!note) return;
        this.failure.set(null);
        try {
          await data(
            this.api.sayThanksToOrganizers({
              body: { organizerPersonIds: [organizer.personId], note },
            }),
          );
          this.profile.reload();
          this.snackBar.open(`Thanks sent to ${organizer.personName}.`, 'Dismiss', {
            duration: 5000,
          });
        } catch (error) {
          this.failure.set(errorMessage(error));
        }
      });
  }
}
