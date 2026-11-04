import { inject, Injectable, signal } from '@angular/core';
import { RedirectCommand, Router, type CanActivateFn } from '@angular/router';
import { AuthService, SIGN_IN_PROBLEM_PATH } from './auth.service';
import { SessionStore } from './session.store';

/** Routes behind sign-in: starts the OIDC redirect (silent with an SSO session) and keeps the target URL. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const status = auth.status();
  if (status === 'signed-in') return true;
  if (status === 'unavailable' || status === 'failed') {
    return inject(Router).parseUrl(SIGN_IN_PROBLEM_PATH);
  }
  await auth.signIn(state.url);
  return false;
};

/**
 * Loads the current user before the shell renders; the shell shows the not-member and error states.
 * Guards run concurrently, so this one leaves signed-out visits to `authGuard`.
 */
export const sessionGuard: CanActivateFn = async () => {
  if (inject(AuthService).status() !== 'signed-in') return false;
  await inject(SessionStore).ensureLoaded();
  return true;
};

/** What the user tried to open when a permission guard sent them to the forbidden page. */
@Injectable({ providedIn: 'root' })
export class AccessDenied {
  readonly attempt = signal<{ title: string; url: string } | null>(null);
}

/**
 * Route guard on an API permission (never a role name). Without it the forbidden page renders in
 * place, keeping the URL the user asked for.
 */
export function requirePermission(action: string, title: string): CanActivateFn {
  return async (_route, state) => {
    const session = inject(SessionStore);
    const denied = inject(AccessDenied);
    const router = inject(Router);
    await session.ensureLoaded();
    if (session.state() !== 'ready' || session.can(action)) return true;
    denied.attempt.set({ title, url: state.url });
    return new RedirectCommand(router.parseUrl('/forbidden'), { skipLocationChange: true });
  };
}
