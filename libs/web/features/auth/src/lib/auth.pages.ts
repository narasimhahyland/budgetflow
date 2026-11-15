import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { AuthService, NetworkStatus } from '@bf/web/data-access';
import { SAT_EMPTY_STATE_IMPORTS } from '@hylandsoftware/satori-ui/empty-state';
import { SatHMarkLogo } from '@hylandsoftware/satori-ui/logo';

/** After sign-out: the BudgetFlow and Keycloak sessions have ended; signing in asks for credentials. */
@Component({
  selector: 'bf-signed-out-page',
  imports: [MatButtonModule, SAT_EMPTY_STATE_IMPORTS, SatHMarkLogo],
  template: `
    <main class="bf-auth-page">
      <div class="bf-auth-page__brand">
        <sat-h-mark-logo class="bf-auth-page__mark" ariaLabel="Hyland" />
        <p class="bf-auth-page__product">BudgetFlow<span>Enterprise</span></p>
      </div>
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
  imports: [MatButtonModule, SAT_EMPTY_STATE_IMPORTS, SatHMarkLogo],
  template: `
    <main class="bf-auth-page">
      <div class="bf-auth-page__brand">
        <sat-h-mark-logo class="bf-auth-page__mark" ariaLabel="Hyland" />
        <p class="bf-auth-page__product">BudgetFlow<span>Enterprise</span></p>
      </div>
      <section class="bf-auth-page__card">
        @if (offline()) {
          <!-- 059a offline: the app shell came from this device; no figures are kept on it. -->
          <sat-empty-state data-testid="offline-state">
            <h1 satEmptyStateHeadline>You're offline</h1>
            <p satEmptyStateDescription>
              BudgetFlow needs a connection to sign in and to show budgets, balances and approvals.
              Nothing from an earlier visit is shown, so no figure you see is out of date. This page
              tries again when the connection is back.
            </p>
            <button mat-flat-button satEmptyStateAction type="button" (click)="reload()">
              Try again
            </button>
          </sat-empty-state>
        } @else {
          <sat-401-error-state>
            <h1 satErrorStateHeadline>We could not sign you in</h1>
            <p satErrorStateDescription>{{ reason() }}</p>
            <button mat-flat-button satErrorStateAction type="button" (click)="signIn()">
              Try again
            </button>
          </sat-401-error-state>
        }
      </section>
    </main>
  `,
  styleUrl: './auth.pages.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignInProblemPage {
  private readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);
  private readonly network = inject(NetworkStatus);
  protected readonly offline = computed(() => !this.network.online());
  protected readonly reason = computed(
    () => this.auth.failure() ?? 'Sign-in did not complete. Try again.',
  );
  private wasOffline = this.offline();

  constructor() {
    // Back online after an offline start: sign in again from the top.
    effect(() => {
      const offline = this.offline();
      if (this.wasOffline && !offline) this.reload();
      this.wasOffline = offline;
    });
  }

  protected reload(): void {
    const asked = new URL(this.document.location.href).searchParams.get('returnUrl') ?? '/';
    // Same-origin app paths only.
    const target = asked.startsWith('/') && !asked.startsWith('//') ? asked : '/';
    this.document.location.assign(target);
  }

  protected signIn(): void {
    void this.auth.signIn('/');
  }
}
