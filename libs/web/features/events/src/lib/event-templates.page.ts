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
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import type { EventTemplate } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { Money } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SAT_NAVIGATION_TABS_IMPORTS } from '@hylandsoftware/satori-ui/navigation-tabs';
import { SatImportantButton } from '@hylandsoftware/satori-ui/important-button';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';
import { toMinor } from './money-input';

type Scope = 'company' | 'personal';

/** Screen 45a: the template library and its editor. Templates never reserve or move money. */
@Component({
  selector: 'bf-event-templates-page',
  imports: [
    FormsModule,
    LoadState,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatSelectModule,
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
        <h1 class="bf-page__title">Event templates</h1>
        <p class="bf-page__subtitle">
          Start from a template that already carries the budget per head, checklist, agenda,
          invitation and survey. Templates never reserve or move money.
        </p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/events">Events</a>
        <button mat-flat-button satImportantButton type="button" (click)="startNew()">
          <mat-icon svgIcon="plus_small" />New template
        </button>
      </div>
    </header>

    <sat-navigation-tabs class="bf-tabs" aria-label="Template scope">
      <a
        satNavigationTab
        [active]="scope() === 'company'"
        (click)="scope.set('company')"
        (keydown.enter)="scope.set('company')"
        tabindex="0"
        >Company templates</a
      >
      <a
        satNavigationTab
        [active]="scope() === 'personal'"
        (click)="scope.set('personal')"
        (keydown.enter)="scope.set('personal')"
        tabindex="0"
        >My templates</a
      >
    </sat-navigation-tabs>

    @if (failure()) {
      <sat-banner variant="important"
        ><sat-banner-message>{{ failure() }}</sat-banner-message></sat-banner
      >
    }

    <bf-load-state
      [loading]="templates.isLoading() && !templates.hasValue()"
      [error]="templates.hasValue() ? undefined : templates.error()"
      what="the template library"
      (retry)="templates.reload()"
    />

    @if (templates.hasValue()) {
      @if (shown().length === 0) {
        <sat-empty-state>
          <h2 satEmptyStateHeadline>
            {{ scope() === 'company' ? 'No company templates yet' : 'You have no templates yet' }}
          </h2>
          <p satEmptyStateDescription>
            Save the way you run an event once, and the next one starts with the checklist, agenda,
            invitation and survey already in place.
          </p>
          <button mat-flat-button type="button" (click)="startNew()">Create a template</button>
        </sat-empty-state>
      } @else {
        <div class="bf-options" data-testid="template-cards">
          @for (t of shown(); track t.id) {
            <article class="bf-option" [class.bf-option--selected]="editing()?.id === t.id">
              <span class="bf-list__row">
                <span class="bf-option__title">{{ t.name }}</span>
                <span class="bf-chip">{{ t.category.replace('_', ' ') }}</span>
              </span>
              <span class="bf-cell__secondary"
                >{{ t.eventType.replace('_', ' ') }} · {{ t.typicalDuration }} ·
                {{ t.locationType }}</span
              >
              <span class="bf-cell__primary"
                ><bf-money
                  [amountMinor]="t.estimatePerAttendee.amountMinor"
                  [currency]="t.estimatePerAttendee.currency"
                />
                per attendee</span
              >
              <span class="bf-cell__secondary">
                {{ t.checklistTasks.length }} checklist tasks · {{ t.agendaItems.length }} agenda
                items · {{ t.surveyQuestions.length }} survey questions ·
                {{ t.preferredVendors.length }} preferred vendors
              </span>
              <span class="bf-page__actions">
                <a
                  mat-flat-button
                  [routerLink]="['/events/new']"
                  [queryParams]="{ templateId: t.id }"
                  >Use template</a
                >
                <button mat-stroked-button type="button" (click)="edit(t)">Edit</button>
                <button
                  mat-button
                  type="button"
                  [disabled]="busy()"
                  (click)="archive(t)"
                  [attr.aria-label]="'Archive ' + t.name"
                >
                  Archive
                </button>
              </span>
            </article>
          }
        </div>
      }
    }

    @if (editing(); as draft) {
      <section class="bf-card" aria-label="Template editor">
        <div class="bf-card__header">
          <h2 class="bf-card__title">{{ draft.id ? 'Edit template' : 'New template' }}</h2>
          <p class="bf-card__hint">
            Company templates are published by Finance Admin or Organization Admin; anyone can keep
            personal templates.
          </p>
        </div>
        <div class="bf-form">
          <mat-form-field class="bf-form__wide">
            <mat-label>Name</mat-label>
            <input matInput [(ngModel)]="draft.name" name="name" maxlength="200" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Scope</mat-label>
            <mat-select [(ngModel)]="draft.scope" name="scope">
              <mat-option value="personal">My template</mat-option>
              <mat-option value="company">Company template</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Event type</mat-label>
            <input matInput [(ngModel)]="draft.eventType" name="eventType" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Typical duration</mat-label>
            <input matInput [(ngModel)]="draft.typicalDuration" name="typicalDuration" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Where it happens</mat-label>
            <mat-select [(ngModel)]="draft.locationType" name="locationType">
              <mat-option value="office">Office</mat-option>
              <mat-option value="venue">Venue</mat-option>
              <mat-option value="remote">Remote</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Estimate per attendee (USD)</mat-label>
            <input matInput inputmode="decimal" [(ngModel)]="draft.estimate" name="estimate" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Tolerance (basis points)</mat-label>
            <input matInput type="number" [(ngModel)]="draft.toleranceBps" name="toleranceBps" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Cost split</mat-label>
            <mat-select [(ngModel)]="draft.costSplitRule" name="costSplitRule">
              <mat-option value="location">By location</mat-option>
              <mat-option value="legal_entity">By legal entity</mat-option>
              <mat-option value="cost_center">By cost center</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field class="bf-form__wide">
            <mat-label>Invitation message</mat-label>
            <textarea matInput rows="3" [(ngModel)]="draft.message" name="message"></textarea>
          </mat-form-field>
          <mat-checkbox [(ngModel)]="draft.publish" name="publish"
            >Publish it so organizers can use it</mat-checkbox
          >
        </div>
        <div class="bf-form__actions">
          <button
            mat-flat-button
            satImportantButton
            type="button"
            [disabled]="busy()"
            (click)="save()"
          >
            Save template
          </button>
          <button mat-button type="button" (click)="editing.set(null)">Cancel</button>
        </div>
      </section>
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventTemplatesPage {
  private readonly api = injectApi();
  private readonly snack = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);
  protected readonly scope = signal<Scope>('company');
  protected readonly busy = signal(false);
  protected readonly failure = signal('');
  protected readonly editing = signal<{
    id: string | null;
    name: string;
    scope: Scope;
    eventType: string;
    typicalDuration: string;
    locationType: 'office' | 'venue' | 'remote';
    estimate: string;
    toleranceBps: number;
    costSplitRule: 'location' | 'legal_entity' | 'cost_center';
    message: string;
    publish: boolean;
  } | null>(null);

  protected readonly templates = resource({
    params: () => ({}),
    loader: () => data(this.api.listEventTemplates({ query: { scope: 'all' } })),
  });

  protected readonly shown = computed(
    () => valueOf(this.templates)?.items.filter((t) => t.scope === this.scope()) ?? [],
  );

  protected startNew(): void {
    this.failure.set('');
    this.editing.set({
      id: null,
      name: '',
      scope: this.scope(),
      eventType: 'celebration',
      typicalDuration: 'Half day',
      locationType: 'office',
      estimate: '',
      toleranceBps: 500,
      costSplitRule: 'location',
      message: '',
      publish: true,
    });
  }

  protected edit(t: EventTemplate): void {
    this.failure.set('');
    this.editing.set({
      id: t.id,
      name: t.name,
      scope: t.scope,
      eventType: t.eventType,
      typicalDuration: t.typicalDuration,
      locationType: t.locationType,
      estimate: (t.estimatePerAttendee.amountMinor / 100).toFixed(2),
      toleranceBps: t.toleranceBps,
      costSplitRule: t.costSplitRule,
      message: t.invitationDefaults.message,
      publish: t.status === 'published',
    });
  }

  private async run(label: string, call: () => Promise<unknown>, done: string): Promise<void> {
    this.busy.set(true);
    this.failure.set('');
    try {
      await call();
      this.snack.open(done, undefined, { duration: 4000 });
      this.editing.set(null);
      this.templates.reload();
    } catch (e) {
      this.failure.set(`${label}: ${errorMessage(e)}`);
    } finally {
      this.busy.set(false);
    }
  }

  protected save(): void {
    const draft = this.editing();
    if (!draft) return;
    const amountMinor = toMinor(draft.estimate, 'USD');
    if (draft.name.trim().length < 2 || !amountMinor || amountMinor <= 0) {
      this.failure.set('Give the template a name and an estimate per attendee above zero.');
      return;
    }
    const body = {
      scope: draft.scope,
      status: draft.publish ? ('published' as const) : ('draft' as const),
      name: draft.name.trim(),
      eventType: draft.eventType.trim() || 'celebration',
      typicalDuration: draft.typicalDuration.trim() || 'Half day',
      locationType: draft.locationType,
      estimatePerAttendee: { amountMinor, currency: 'USD' },
      toleranceBps: draft.toleranceBps,
      costSplitRule: draft.costSplitRule,
      invitationDefaults: { message: draft.message.trim() },
    };
    void this.run(
      'Could not save the template',
      () =>
        draft.id
          ? data(this.api.updateEventTemplate({ params: { templateId: draft.id }, body }))
          : data(this.api.createEventTemplate({ body })),
      draft.id ? 'Template saved' : 'Template created',
    );
  }

  protected archive(t: EventTemplate): void {
    void this.run(
      'Could not archive the template',
      () =>
        data(
          this.api.archiveEventTemplate({
            params: { templateId: t.id },
            body: { reason: 'Archived from the template library' },
          }),
        ),
      `${t.name} archived`,
    );
  }
}
