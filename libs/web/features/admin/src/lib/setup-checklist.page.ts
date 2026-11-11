import { ChangeDetectionStrategy, Component, computed, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { LoadState } from '@bf/web/ui';
import { data, injectApi, valueOf } from './api';

// Steps in the order they depend on each other: places and people before money, money before
// authority, then the settings that tune the rest.
const STEP_ORDER = [
  'org_structure',
  'people',
  'legal_entities',
  'fiscal_calendar',
  'plan_version',
  'root_budget',
  'doa_matrix',
  'roles',
  'retention',
  'feature_flags',
];

/** Who can do a step, in words, instead of the permission key behind it. */
const ACTION_LABEL: Record<string, string> = {
  'org.manage': 'Organization administration',
  'master_data.manage': 'Finance master data administration',
  'budget.create_root': 'Creating top-level budgets',
  'doa.manage': 'Approval limits administration',
  'users.manage': 'User administration',
  'tenant.settings.manage': 'Company settings administration',
};

/**
 * Screen 010a: what a new tenant still has to set up. Every step is computed server-side from the
 * data that actually exists, so the list never claims something is done when it is not.
 */
@Component({
  selector: 'bf-setup-checklist-page',
  host: { class: 'bf-page-layout' },
  imports: [
    LoadState,
    MatButtonModule,
    MatProgressBarModule,
    RouterLink,
    SAT_BANNER_IMPORTS,
    SAT_TAG_IMPORTS,
  ],
  template: `
    <header class="bf-page__header">
      <div class="bf-page__heading">
        <h1 class="bf-page__title">Set up BudgetFlow</h1>
        <p class="bf-page__subtitle">
          What is already in place and what is still missing, worked out from the data in your
          tenant rather than from ticked boxes.
        </p>
      </div>
    </header>

    <bf-load-state
      [loading]="checklist.isLoading() && !checklist.hasValue()"
      [error]="checklist.error()"
      what="the setup checklist"
      shape="cards"
      [lines]="4"
      (retry)="checklist.reload()"
    />

    @if (valueOf(checklist); as c) {
      @if (c.completed === c.total) {
        <sat-banner variant="success" class="bf-banner">
          <sat-banner-message data-testid="setup-complete">
            BudgetFlow is set up. All {{ c.total }} steps are done.
          </sat-banner-message>
        </sat-banner>
      } @else {
        <sat-banner variant="info" class="bf-banner">
          <sat-banner-message data-testid="setup-progress">
            {{ c.completed }} of {{ c.total }} steps are done. {{ c.total - c.completed }} still to
            go.
          </sat-banner-message>
        </sat-banner>
      }

      <section class="bf-card" aria-labelledby="steps-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="steps-title">Steps</h2>
          <span class="bf-progress-label">{{ c.completed }} of {{ c.total }} done</span>
        </div>
        <div class="bf-card__body bf-progress-row">
          <mat-progress-bar
            mode="determinate"
            [value]="c.total === 0 ? 0 : (c.completed * 100) / c.total"
            aria-label="Setup progress"
          />
        </div>
        <ol class="bf-steps">
          @for (step of ordered(); track step.key) {
            <li class="bf-step" [attr.data-testid]="'step-' + step.key">
              <div class="bf-step__head">
                <span class="bf-step__number" aria-hidden="true">{{ $index + 1 }}</span>
                <span class="bf-cell__primary">{{ step.name }}</span>
                <sat-status-tag [status]="step.done ? 'success' : 'warning'">{{
                  step.done ? 'Done' : 'To do'
                }}</sat-status-tag>
              </div>
              <p class="bf-step__text">{{ step.description }}</p>
              <p class="bf-step__detail">{{ step.detail }}</p>
              <p class="bf-step__detail">
                Who can do it: {{ actionLabel[step.requiredAction] ?? step.requiredAction }}
              </p>
              @if (!step.done) {
                <a mat-stroked-button [routerLink]="step.route">Go and finish this</a>
              }
            </li>
          }
        </ol>
      </section>
    }
  `,
  styleUrls: ['./page.scss', './setup-checklist.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupChecklistPage {
  protected readonly valueOf = valueOf;
  private readonly api = injectApi();
  protected readonly checklist = resource({ loader: () => data(this.api.setupChecklist({})) });
  protected readonly actionLabel = ACTION_LABEL;
  protected readonly ordered = computed(() => {
    const items = valueOf(this.checklist)?.items ?? [];
    const rank = (key: string) => {
      const i = STEP_ORDER.indexOf(key);
      return i === -1 ? STEP_ORDER.length : i;
    };
    return [...items].sort((a, b) => rank(a.key) - rank(b.key));
  });
  protected readonly remaining = computed(() => {
    const value = valueOf(this.checklist);
    return value ? value.total - value.completed : 0;
  });
}
