import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '@bf/web/data-access';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';

/** After sign-out: the BudgetFlow and Keycloak sessions have ended; signing in asks for credentials. */
@Component({
  selector: 'bf-signed-out-page',
  imports: [MatButtonModule, SAT_EMPTY_STATE_IMPORTS],
  template: `
    <main class="bf-auth-page">
      <p class="bf-auth-page__brand">BudgetFlow</p>
      <section class="bf-auth-page__card">
        <sat-empty-state>
          <h1 satEmptyStateHeadline>You have signed out</h1>
          <p satEmptyStateDescription>Your BudgetFlow session on this device has ended.</p>
          <button mat-flat-button satEmptyStateAction type="button" (click)="signIn()">
            Sign in again
          </button>
        </sat-empty-state>
      </section>
    </main>
  `,
  styleUrl: './auth.pages.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignedOutPage {
  private readonly auth = inject(AuthService);

  protected signIn(): void {
    void this.auth.signIn('/');
  }
}

/** The identity provider refused or the callback could not be completed; the user can retry. */
@Component({
  selector: 'bf-sign-in-problem-page',
  imports: [MatButtonModule, SAT_EMPTY_STATE_IMPORTS],
  template: `
    <main class="bf-auth-page">
      <p class="bf-auth-page__brand">BudgetFlow</p>
      <section class="bf-auth-page__card">
        <sat-401-error-state>
          <h1 satErrorStateHeadline>We could not sign you in</h1>
          <p satErrorStateDescription>{{ reason() }}</p>
          <button mat-flat-button satErrorStateAction type="button" (click)="signIn()">
            Try again
          </button>
        </sat-401-error-state>
      </section>
    </main>
  `,
  styleUrl: './auth.pages.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInProblemPage {
  private readonly auth = inject(AuthService);
  protected readonly reason = computed(
    () => this.auth.failure() ?? 'Sign-in did not complete. Try again.',
  );

  protected signIn(): void {
    void this.auth.signIn('/');
  }
}
