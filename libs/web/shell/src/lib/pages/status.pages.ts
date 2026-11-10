import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { AccessDenied } from '@bf/web/data-access';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';

/** A navigation area whose screens arrive in a later phase; reachable only with its permission. */
@Component({
  selector: 'bf-placeholder-page',
  imports: [MatButtonModule, RouterLink, SAT_EMPTY_STATE_IMPORTS],
  template: `
    <header class="bf-page__header">
      <h1 class="bf-page__title">{{ pageTitle() }}</h1>
    </header>
    <section class="bf-card bf-card--padded">
      <sat-empty-state>
        <h2 satEmptyStateHeadline>{{ pageTitle() }} is not open yet</h2>
        <p satEmptyStateDescription>
          This area arrives in a later BudgetFlow release. Your access to it is already in place.
        </p>
        <a mat-stroked-button satEmptyStateAction routerLink="/">Go to Home</a>
      </sat-empty-state>
    </section>
  `,
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bf-page-layout' },
})
export class PlaceholderPage {
  readonly pageTitle = input('');
}

/** Rendered in place (the URL stays) when a permission guard refuses a route. */
@Component({
  selector: 'bf-forbidden-page',
  imports: [MatButtonModule, RouterLink, SAT_EMPTY_STATE_IMPORTS],
  template: `
    <section class="bf-card bf-card--state">
      <sat-403-error-state>
        <h1 satErrorStateHeadline>You do not have access to this page</h1>
        <p satErrorStateDescription>
          {{ what() }} is not part of your role in BudgetFlow. Ask your administrator if you need
          access.
        </p>
        <a mat-flat-button satErrorStateAction routerLink="/">Go to Home</a>
      </sat-403-error-state>
    </section>
  `,
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bf-page-layout' },
})
export class ForbiddenPage {
  private readonly denied = inject(AccessDenied);
  protected readonly what = computed(() => this.denied.attempt()?.title ?? 'This page');
}

@Component({
  selector: 'bf-not-found-page',
  imports: [MatButtonModule, RouterLink, SAT_EMPTY_STATE_IMPORTS],
  template: `
    <section class="bf-card bf-card--state">
      <sat-404-error-state>
        <h1 satErrorStateHeadline>Page not found</h1>
        <p satErrorStateDescription>The page you asked for does not exist or has moved.</p>
        <a mat-flat-button satErrorStateAction routerLink="/">Go to Home</a>
      </sat-404-error-state>
    </section>
  `,
  styleUrl: './page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'bf-page-layout' },
})
export class NotFoundPage {}
