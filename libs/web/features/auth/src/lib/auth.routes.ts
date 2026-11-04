import type { Routes } from '@angular/router';
import { SignedOutPage, SignInProblemPage } from './auth.pages';

/** Public sign-in pages outside the shell. Sign-in itself is Keycloak (login, SSO, MFA, forgot password). */
export const authRoutes: Routes = [
  { path: 'signed-out', component: SignedOutPage, title: 'Signed out' },
  { path: 'sign-in-problem', component: SignInProblemPage, title: 'Sign-in problem' },
  // The app initializer completes the OIDC callback and replaces this URL before routing starts.
  { path: 'auth/callback', redirectTo: '' },
];
