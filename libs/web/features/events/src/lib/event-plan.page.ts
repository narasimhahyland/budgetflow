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
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import type { EventChecklistTask } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateOnlyPipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { data, errorMessage, injectApi, valueOf } from './api';
import { EventTabs } from './event-tabs';
import { LoadState } from './load-state';

type Sub = 'checklist' | 'agenda';
const SECTIONS = [
  { id: 'before', label: 'Before' },
  { id: 'on_the_day', label: 'On the day' },
  { id: 'after', label: 'After' },
] as const;

/** Screen 46b: one shared plan per event — the checklist and the agenda invitees see. */
@Component({
  selector: 'bf-event-plan-page',
  imports: [
    DateOnlyPipe,
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
    MatTooltipModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SAT_NAVIGATION_TABS_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Plan</h1>
        <p class="bf-page__subtitle">
          What has to happen before, on and after the day, and the agenda invitees see. The plan
          never moves money.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button [routerLink]="['/events', eventId()]">Back to the event</a>
      </div>
    </header>

    <bf-event-tabs [eventId]="eventId()" section="plan" />

    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }

    <bf-load-state
      [loading]="plan.isLoading() && !plan.hasValue()"
      [error]="plan.hasValue() ? undefined : plan.error()"
      what="the event plan"
      (retry)="plan.reload()"
    />

    @if (view(); as v) {
      @if (v.readOnly) {
        <sat-banner variant="info"
          ><sat-banner-message>
            This plan is read-only. It stays with the event for the next clone.
          </sat-banner-message></sat-banner
        >
      }

      <sat-navigation-tabs class="bf-tabs" aria-label="Plan sections">
        <a
          satNavigationTab
          [active]="sub() === 'checklist'"
          (click)="sub.set('checklist')"
          (keydown.enter)="sub.set('checklist')"
          tabindex="0"
          >Checklist</a
        >
        <a
          satNavigationTab
          [active]="sub() === 'agenda'"
          (click)="sub.set('agenda')"
          (keydown.enter)="sub.set('agenda')"
          tabindex="0"
          >Agenda</a
        >
      </sat-navigation-tabs>

      @if (sub() === 'checklist') {
        <section class="bf-card" aria-label="Checklist">
          <div class="bf-card__header">
            <h2 class="bf-card__title" data-testid="plan-progress">
              {{ v.doneTasks }} of {{ v.totalTasks }} tasks done
              @if (v.overdueTasks > 0) {
                · {{ v.overdueTasks }} overdue
              }
            </h2>
            @if (v.templateName) {
              <p class="bf-card__hint">From the {{ v.templateName }} template</p>
            }
          </div>

          @if (v.tasks.length === 0) {
            <sat-empty-state>
              <h3 satEmptyStateHeadline>No plan yet</h3>
              <p satEmptyStateDescription>
                Add the steps this event needs, or apply the checklist from its template.
              </p>
            </sat-empty-state>
          } @else {
            @for (section of sections; track section.id) {
              @if (tasksIn(v.tasks, section.id).length) {
                <div class="bf-section">
                  <h3 class="bf-section__title">{{ section.label }}</h3>
                  <ul class="bf-list">
                    @for (t of tasksIn(v.tasks, section.id); track t.id) {
                      <li class="bf-task">
                        <mat-checkbox
                          [checked]="t.status === 'done'"
                          [disabled]="v.readOnly || t.isSystem || busy()"
                          [matTooltip]="
                            t.isSystem ? 'Completes when the work it links to is done' : ''
                          "
                          (change)="toggle(t)"
                          >{{ t.title }}</mat-checkbox
                        >
                        <span class="bf-task__meta">
                          @if (t.assigneeName) {
                            <span class="bf-chip">{{ t.assigneeName }}</span>
                          }
                          @if (t.dueDate) {
                            <span class="bf-cell__secondary"
                              >due {{ t.dueDate | bfDate: session.timezone() }}</span
                            >
                          }
                          @if (t.overdue) {
                            <span class="bf-chip bf-chip--warning">Overdue</span>
                          }
                          @if (t.linkedLabel) {
                            <span class="bf-chip">{{ t.linkedLabel }}</span>
                          }
                        </span>
                      </li>
                    }
                  </ul>
                </div>
              }
            }
          }

          @if (!v.readOnly) {
            <div class="bf-form">
              <mat-form-field>
                <mat-label>Section</mat-label>
                <mat-select [(ngModel)]="newSection" name="newSection">
                  @for (section of sections; track section.id) {
                    <mat-option [value]="section.id">{{ section.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field class="bf-form__wide">
                <mat-label>Add a task</mat-label>
                <input matInput [(ngModel)]="newTitle" name="newTitle" maxlength="200" />
              </mat-form-field>
              <mat-form-field>
                <mat-label>Due date</mat-label>
                <input matInput type="date" [(ngModel)]="newDueDate" name="newDueDate" />
              </mat-form-field>
            </div>
            <div class="bf-form__actions">
              <button mat-flat-button type="button" [disabled]="busy()" (click)="addTask()">
                <mat-icon svgIcon="plus_small" />Add task
              </button>
            </div>
          }
        </section>
      } @else {
        <section class="bf-card" aria-label="Agenda">
          <div class="bf-card__header">
            <h2 class="bf-card__title">Agenda</h2>
            <p class="bf-card__hint">Only items marked visible appear on invitations.</p>
          </div>
          @if (v.agenda.length === 0) {
            <sat-empty-state>
              <h3 satEmptyStateHeadline>No agenda yet</h3>
              <p satEmptyStateDescription>
                Add what happens and when, so invitees know what to expect.
              </p>
            </sat-empty-state>
          } @else {
            <ul class="bf-timeline">
              @for (item of v.agenda; track item.id) {
                <li>
                  <span class="bf-cell__primary"
                    >{{ item.startTime }}
                    @if (item.endTime) {
                      <span>–{{ item.endTime }}</span>
                    }
                    · {{ item.title }}</span
                  >
                  <span class="bf-cell__secondary">
                    {{ item.locationRoom ?? 'No room given' }}
                    @if (item.hostName) {
                      · {{ item.hostName }}
                    }
                    · {{ item.visibleToInvitees ? 'Visible to invitees' : 'Organizers only' }}
                  </span>
                </li>
              }
            </ul>
          }
          @if (!v.readOnly) {
            <div class="bf-form">
              <mat-form-field>
                <mat-label>Start</mat-label>
                <input matInput [(ngModel)]="itemStart" name="itemStart" placeholder="18:00" />
              </mat-form-field>
              <mat-form-field>
                <mat-label>End</mat-label>
                <input matInput [(ngModel)]="itemEnd" name="itemEnd" placeholder="19:00" />
              </mat-form-field>
              <mat-form-field class="bf-form__wide">
                <mat-label>What happens</mat-label>
                <input matInput [(ngModel)]="itemTitle" name="itemTitle" maxlength="200" />
              </mat-form-field>
              <mat-form-field>
                <mat-label>Room</mat-label>
                <input matInput [(ngModel)]="itemRoom" name="itemRoom" maxlength="200" />
              </mat-form-field>
              <mat-slide-toggle [(ngModel)]="itemVisible" name="itemVisible"
                >Visible to invitees</mat-slide-toggle
              >
            </div>
            <div class="bf-form__actions">
              <button mat-flat-button type="button" [disabled]="busy()" (click)="addAgendaItem()">
                <mat-icon svgIcon="plus_small" />Add agenda item
              </button>
            </div>
          }
        </section>
      }
    }
  `,
  styles: `
    .bf-task {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 0;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }

    .bf-task__meta {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    .bf-chip--warning {
      background: var(--sat-sys-warning-container);
      color: var(--sat-sys-on-warning-container);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventPlanPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  readonly eventId = input.required<string>();
  protected readonly sections = SECTIONS;
  protected readonly sub = signal<Sub>('checklist');
  protected readonly busy = signal(false);
  protected readonly failure = signal('');

  protected newSection: 'before' | 'on_the_day' | 'after' = 'before';
  protected newTitle = '';
  protected newDueDate = '';
  protected itemStart = '';
  protected itemEnd = '';
  protected itemTitle = '';
  protected itemRoom = '';
  protected itemVisible = true;

  protected readonly plan = resource({
    params: () => ({ eventId: this.eventId() }),
    loader: ({ params }) => data(this.api.getEventPlan({ params })),
  });
  protected readonly view = computed(() => valueOf(this.plan));

  protected tasksIn(tasks: EventChecklistTask[], section: string): EventChecklistTask[] {
    return tasks.filter((t) => t.section === section);
  }

  private async run(label: string, call: () => Promise<unknown>, done?: string): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await call();
      if (done) this.snack.open(done, undefined, { duration: 3000 });
      this.plan.reload();
    } catch (e) {
      this.failure.set(`${label}: ${errorMessage(e)}`);
      this.plan.reload();
    } finally {
      this.busy.set(false);
    }
  }

  protected toggle(t: EventChecklistTask): void {
    const next = t.status === 'done' ? 'open' : 'done';
    void this.run('Could not update the task', () =>
      data(
        this.api.updateChecklistTask({
          params: { eventId: this.eventId(), taskId: t.id },
          body: { status: next },
        }),
      ),
    );
  }

  protected addTask(): void {
    if (this.newTitle.trim().length < 1) {
      this.failure.set('Give the task a title.');
      return;
    }
    void this.run(
      'Could not add the task',
      async () => {
        await data(
          this.api.createChecklistTask({
            params: { eventId: this.eventId() },
            body: {
              section: this.newSection,
              title: this.newTitle.trim(),
              ...(this.newDueDate ? { dueDate: this.newDueDate } : {}),
            },
          }),
        );
        this.newTitle = '';
        this.newDueDate = '';
      },
      'Task added',
    );
  }

  protected addAgendaItem(): void {
    if (!this.itemStart.trim() || this.itemTitle.trim().length < 1) {
      this.failure.set('Give the agenda item a start time and a title.');
      return;
    }
    void this.run(
      'Could not add the agenda item',
      async () => {
        await data(
          this.api.createAgendaItem({
            params: { eventId: this.eventId() },
            body: {
              startTime: this.itemStart.trim(),
              endTime: this.itemEnd.trim() || null,
              title: this.itemTitle.trim(),
              locationRoom: this.itemRoom.trim() || null,
              visibleToInvitees: this.itemVisible,
            },
          }),
        );
        this.itemStart = '';
        this.itemEnd = '';
        this.itemTitle = '';
        this.itemRoom = '';
      },
      'Agenda item added',
    );
  }
}
