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
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import type { Scenario, ScenarioStatus } from '@bf/contracts';
import { SessionStore } from '@bf/web/data-access';
import { DateTimePipe } from '@bf/web/ui';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatStatusTag } from '@hylandsoftware/satori-ui/tag';
import { data, errorMessage, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

const STATUS_LABEL: Record<ScenarioStatus, string> = {
  draft: 'Draft',
  promoted: 'Promoted',
  archived: 'Archived',
};

const STATUS_TONE: Record<ScenarioStatus, 'info' | 'success' | 'neutral'> = {
  draft: 'info',
  promoted: 'success',
  archived: 'neutral',
};

/** Create scenario (031a): a name and an optional note, nothing that touches a budget. */
@Component({
  selector: 'bf-create-scenario-dialog',
  imports: [FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  template: `
    <h2 mat-dialog-title>Create scenario</h2>
    <mat-dialog-content>
      <p class="bf-dialog__lead">
        A scenario is a private projection. Nothing you model here changes a budget until you
        promote it.
      </p>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Scenario name</mat-label>
        <input matInput [(ngModel)]="name" maxlength="120" data-testid="scenario-name" required />
      </mat-form-field>
      <mat-form-field appearance="outline" class="bf-field">
        <mat-label>Note (optional)</mat-label>
        <textarea
          matInput
          rows="3"
          [(ngModel)]="note"
          maxlength="2000"
          data-testid="scenario-note"
        ></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" (click)="ref.close()">Cancel</button>
      <button
        mat-flat-button
        type="button"
        [disabled]="!name().trim()"
        (click)="ref.close({ name: name().trim(), note: note().trim() || undefined })"
        data-testid="scenario-create-confirm"
      >
        Create scenario
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .bf-dialog__lead {
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-field {
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CreateScenarioDialog {
  protected readonly name = signal('');
  protected readonly note = signal('');
  protected readonly ref =
    inject<MatDialogRef<CreateScenarioDialog, { name: string; note?: string } | undefined>>(
      MatDialogRef,
    );
}

/** Screen 031a: the what-if scenarios this person authored or was invited to collaborate on. */
@Component({
  selector: 'bf-scenario-list-page',
  imports: [
    DateTimePipe,
    LoadState,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_EMPTY_STATE_IMPORTS,
    SatStatusTag,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">What-if scenarios</h1>
        <p class="bf-page__subtitle">Model a reallocation before anyone commits to it</p>
      </div>
      <div class="bf-page__actions">
        <a mat-stroked-button routerLink="/budgets/scenarios/compare" data-testid="open-compare">
          <mat-icon svgIcon="compare" />Compare
        </a>
        <button
          mat-flat-button
          type="button"
          (click)="create()"
          data-testid="create-scenario"
          [disabled]="creating()"
        >
          <mat-icon svgIcon="circle_add" />Create scenario
        </button>
      </div>
    </header>

    <sat-banner variant="info" data-testid="scenarios-note">
      <sat-banner-message>
        A scenario is a private projection, not a decision. Modelling a change moves no money and
        changes no budget status. Promoting one runs the ordinary reduce, transfer, freeze and
        set-to-zero commands, each with its own reason, preview and approvals.
      </sat-banner-message>
    </sat-banner>

    @if (failure(); as message) {
      <sat-banner variant="important" data-testid="scenario-error">
        <sat-banner-message>{{ message }}</sat-banner-message>
      </sat-banner>
    }

    <bf-load-state
      [loading]="scenarios.isLoading() && !scenarios.hasValue()"
      [error]="scenarios.error()"
      what="what-if scenarios"
      (retry)="scenarios.reload()"
    />

    @if (scenarios.hasValue()) {
      @if (items().length === 0) {
        <sat-empty-state data-testid="scenarios-empty">
          <h2 satEmptyStateHeadline>No scenarios yet</h2>
          <p satEmptyStateDescription>
            Model a mid-year cut or reallocation here before it becomes real.
          </p>
          <button mat-stroked-button satEmptyStateAction type="button" (click)="create()">
            Create scenario
          </button>
        </sat-empty-state>
      } @else {
        <ul class="bf-scenarios">
          @for (s of items(); track s.id) {
            <li class="bf-card bf-scenarios__item" [attr.data-testid]="'scenario-' + s.id">
              <div class="bf-list__row">
                <a
                  class="bf-scenarios__name"
                  [routerLink]="['/budgets/scenarios', s.id]"
                  [attr.data-testid]="'scenario-open-' + s.id"
                  >{{ s.name }}</a
                >
                <sat-status-tag [status]="tone(s)">{{ label(s) }}</sat-status-tag>
              </div>
              @if (s.note) {
                <p class="bf-scenarios__note">{{ s.note }}</p>
              }
              <dl class="bf-scenarios__facts">
                <div>
                  <dt>Modelled changes</dt>
                  <dd>{{ s.changes.length }}</dd>
                </div>
                <div>
                  <dt>Created by</dt>
                  <dd>{{ s.createdByName ?? 'Unknown' }}</dd>
                </div>
                <div>
                  <dt>Baseline</dt>
                  <dd>
                    Live ledger at
                    <span data-testid="relative-time">{{
                      s.baselineAt | bfDateTime: session.timezone()
                    }}</span>
                  </dd>
                </div>
                <div>
                  <dt>Collaborators</dt>
                  <dd>
                    {{ s.collaboratorNames.length ? s.collaboratorNames.join(', ') : 'Just you' }}
                  </dd>
                </div>
              </dl>
            </li>
          }
        </ul>
      }
    }
  `,
  styles: `
    .bf-scenarios {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin: 12px 0 0;
      padding: 0;
      list-style: none;
    }
    .bf-scenarios__item {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px;
    }
    .bf-scenarios__name {
      font: var(--mat-sys-title-medium);
    }
    .bf-scenarios__note {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .bf-scenarios__facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 8px;
      margin: 0;
    }
    .bf-scenarios__facts dt {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
    }
    .bf-scenarios__facts dd {
      margin: 2px 0 0;
      font: var(--mat-sys-body-medium);
    }
  `,
  host: { class: 'bf-page-layout' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScenarioListPage {
  private readonly api = injectApi();
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly session = inject(SessionStore);

  protected readonly creating = signal(false);
  protected readonly failure = signal<string | null>(null);
  protected readonly scenarios = resource({ loader: () => data(this.api.listScenarios({})) });
  /** The API already orders these; the list renders them as they arrive. */
  protected readonly items = computed(() => valueOf(this.scenarios)?.items ?? []);

  protected label = (s: Scenario) => STATUS_LABEL[s.status];
  protected tone = (s: Scenario) => STATUS_TONE[s.status];

  protected create(): void {
    this.dialog
      .open(CreateScenarioDialog, { width: '480px' })
      .afterClosed()
      .subscribe(async (result) => {
        if (!result) return;
        this.creating.set(true);
        this.failure.set(null);
        try {
          const scenario = await data(this.api.createScenario({ body: result }));
          this.snackBar.open(`Scenario "${scenario.name}" created.`, 'Dismiss', {
            duration: 5000,
          });
          await this.router.navigate(['/budgets/scenarios', scenario.id]);
        } catch (error) {
          this.failure.set(errorMessage(error));
        } finally {
          this.creating.set(false);
        }
      });
  }
}
