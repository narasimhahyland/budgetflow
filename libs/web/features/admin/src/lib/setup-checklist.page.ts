import { ChangeDetectionStrategy, Component, computed, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { SAT_BANNER_IMPORTS } from '@hylandsoftware/satori-ui/banner';
import { SAT_TAG_IMPORTS } from '@hylandsoftware/satori-ui/tag';
import { data, injectApi, valueOf } from './api';
import { LoadState } from './load-state';

/**
 * Screen 010a: what a new tenant still has to set up. Every step is computed server-side from the
 * data that actually exists, so the list never claims something is done when it is not.
 */
@Component({
  selector: 'bf-setup-checklist-page',
  imports: [LoadState, MatButtonModule, RouterLink, SAT_BANNER_IMPORTS, SAT_TAG_IMPORTS],
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
            {{ c.completed }} of {{ c.total }} steps are done.
            {{ c.total - c.completed }} still to go.
          </sat-banner-message>
        </sat-banner>
      }

      <section class="bf-card" aria-labelledby="steps-title">
        <div class="bf-card__header">
          <h2 class="bf-card__title" id="steps-title">Steps</h2>
        </div>
        <ol class="bf-steps">
          @for (step of c.items; track step.key) {
            <li class="bf-step" [attr.data-testid]="'step-' + step.key">
              <div class="bf-step__head">
                <span class="bf-cell__primary">{{ step.name }}</span>
                <sat-status-tag [status]="step.done ? 'success' : 'warning'">{{
                  step.done ? 'Done' : 'To do'
                }}</sat-status-tag>
              </div>
              <p class="bf-step__text">{{ step.description }}</p>
              <p class="bf-step__detail">{{ step.detail }}</p>
              <p class="bf-step__detail">Needs: {{ step.requiredAction }}</p>
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
  protected readonly remaining = computed(() => {
    const value = valueOf(this.checklist);
    return value ? value.total - value.completed : 0;
  });
}
