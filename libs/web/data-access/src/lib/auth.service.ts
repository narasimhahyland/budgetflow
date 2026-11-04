import { DOCUMENT } from '@angular/common';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { createApiClient, type AuthConfigResponse } from '@bf/contracts';

/** Origin-relative base URL of the API (the web container proxies /api). */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '',
});

export const CALLBACK_PATH = '/auth/callback';
export const SIGNED_OUT_PATH = '/signed-out';
export const SIGN_IN_PROBLEM_PATH = '/sign-in-problem';
const PENDING_KEY = 'bf.signin.pending';

export type AuthStatus =
  | 'starting'
  | 'signed-out'
  | 'signed-in'
  /** The session ended (refresh failed or the API answered 401); the user signs in again. */
  | 'expired'
  /** The identity provider or the API could not be reached. */
  | 'unavailable'
  /** The identity provider returned an error or the callback could not be completed. */
  | 'failed';

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint: string;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  id_token?: string;
  refresh_token?: string;
}

interface PendingSignIn {
  state: string;
  verifier: string;
  nonce: string;
  returnUrl: string;
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const randomString = (bytes: number) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

function jwtClaims(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Same-origin app paths only; never the callback or signed-out pages. */
function safeReturnUrl(url: string | undefined): string {
  if (!url || !url.startsWith('/') || url.startsWith('//')) return '/';
  if (url.startsWith(CALLBACK_PATH) || url.startsWith(SIGNED_OUT_PATH)) return '/';
  if (url.startsWith(SIGN_IN_PROBLEM_PATH)) return '/';
  return url;
}

const IDP_ERRORS: Record<string, string> = {
  access_denied: 'Sign-in was cancelled or access was denied.',
  login_required: 'Your session ended. Sign in again.',
  temporarily_unavailable: 'Sign-in is temporarily unavailable. Try again in a moment.',
};

/**
 * OpenID Connect sign-in with Keycloak: authorization code + PKCE (S256) for the public web client.
 * Tokens stay in memory only (never in localStorage); a reload signs in again silently through the
 * Keycloak SSO session. Only the PKCE verifier, state and nonce of a sign-in in progress are kept in
 * sessionStorage, and only until the callback.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly document = inject(DOCUMENT);
  private readonly publicApi = createApiClient({ baseUrl: inject(API_BASE_URL) });

  readonly status = signal<AuthStatus>('starting');
  readonly accessToken = signal<string | null>(null);
  /** Plain-English reason when status is `failed` or `unavailable`. */
  readonly failure = signal<string | null>(null);
  /** True after a completed callback in this page load (drives the session.started analytics event). */
  readonly justSignedIn = signal(false);

  private config: AuthConfigResponse | null = null;
  private discovery: Discovery | null = null;
  private idToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** A redirect to Keycloak is under way; a second one would reload the sign-in form mid-typing. */
  private redirecting = false;

  private get location(): Location {
    return this.document.location;
  }

  /** App initializer: loads sign-in settings and completes a callback when the URL is one. */
  async init(): Promise<void> {
    try {
      await this.ensureConfig();
    } catch {
      this.failure.set('BudgetFlow cannot reach the sign-in service right now. Try again shortly.');
      this.status.set('unavailable');
      return;
    }
    if (this.location.pathname === CALLBACK_PATH) {
      await this.completeSignIn(new URL(this.location.href));
      return;
    }
    this.status.set('signed-out');
  }

  /** Redirects to Keycloak; with an SSO session in place it returns without asking for credentials. */
  async signIn(returnUrl?: string): Promise<void> {
    if (this.redirecting) return;
    this.redirecting = true;
    const { config, discovery } = await this.ensureConfig();
    const pending: PendingSignIn = {
      state: randomString(32),
      verifier: randomString(48),
      nonce: randomString(16),
      returnUrl: safeReturnUrl(returnUrl),
    };
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(pending.verifier),
    );
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: 'openid profile email',
      state: pending.state,
      nonce: pending.nonce,
      code_challenge: base64url(new Uint8Array(digest)),
      code_challenge_method: 'S256',
    }).toString();
    this.location.assign(url.toString());
  }

  /** Ends the BudgetFlow and Keycloak sessions, then lands on the signed-out page. */
  async signOut(): Promise<void> {
    const idToken = this.idToken;
    this.clearTokens();
    this.status.set('signed-out');
    const { config, discovery } = await this.ensureConfig();
    const url = new URL(discovery.end_session_endpoint);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      post_logout_redirect_uri: `${this.location.origin}${SIGNED_OUT_PATH}`,
      ...(idToken ? { id_token_hint: idToken } : {}),
    }).toString();
    this.location.assign(url.toString());
  }

  /** Called when the API answers 401: the token is no longer accepted. */
  markExpired(): void {
    if (this.status() !== 'signed-in') return;
    this.clearTokens();
    this.status.set('expired');
  }

  private redirectUri(): string {
    return `${this.location.origin}${CALLBACK_PATH}`;
  }

  private async ensureConfig(): Promise<{ config: AuthConfigResponse; discovery: Discovery }> {
    if (!this.config) {
      const res = await this.publicApi.authConfig({});
      if (!res.ok) throw new Error(`auth config: HTTP ${res.status}`);
      this.config = res.data;
    }
    if (!this.discovery) {
      const res = await fetch(`${this.config.issuer}/.well-known/openid-configuration`);
      if (!res.ok) throw new Error(`discovery: HTTP ${res.status}`);
      this.discovery = (await res.json()) as Discovery;
    }
    return { config: this.config, discovery: this.discovery };
  }

  private async completeSignIn(url: URL): Promise<void> {
    const raw = sessionStorage.getItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    const pending = raw ? (JSON.parse(raw) as PendingSignIn) : null;
    const params = url.searchParams;
    const error = params.get('error');
    if (error) return this.fail(IDP_ERRORS[error] ?? 'Sign-in did not complete. Try again.');
    const code = params.get('code');
    if (!pending || !code || params.get('state') !== pending.state) {
      return this.fail(
        'This sign-in link has expired or was opened in another tab. Sign in again.',
      );
    }
    const { config, discovery } = await this.ensureConfig();
    let tokens: TokenResponse;
    try {
      const res = await fetch(discovery.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.redirectUri(),
          client_id: config.clientId,
          code_verifier: pending.verifier,
        }),
      });
      if (!res.ok) return this.fail('We could not complete your sign-in. Sign in again.');
      tokens = (await res.json()) as TokenResponse;
    } catch {
      return this.fail('We could not complete your sign-in. Sign in again.');
    }
    if (tokens.id_token && jwtClaims(tokens.id_token)['nonce'] !== pending.nonce) {
      return this.fail('We could not verify your sign-in. Sign in again.');
    }
    this.accept(tokens);
    this.justSignedIn.set(true);
    history.replaceState(null, '', pending.returnUrl);
  }

  private fail(message: string): void {
    this.failure.set(message);
    this.status.set('failed');
    history.replaceState(null, '', SIGN_IN_PROBLEM_PATH);
  }

  private accept(tokens: TokenResponse): void {
    this.accessToken.set(tokens.access_token);
    this.idToken = tokens.id_token ?? this.idToken;
    this.refreshToken = tokens.refresh_token ?? null;
    this.status.set('signed-in');
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const inMs = Math.max(10, tokens.expires_in - 60) * 1000;
    this.refreshTimer = setTimeout(() => void this.refresh(), inMs);
  }

  private async refresh(): Promise<void> {
    if (!this.refreshToken || !this.config || !this.discovery) return this.markExpired();
    try {
      const res = await fetch(this.discovery.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken,
          client_id: this.config.clientId,
        }),
      });
      if (!res.ok) return this.markExpired();
      this.accept((await res.json()) as TokenResponse);
    } catch {
      this.markExpired();
    }
  }

  private clearTokens(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.accessToken.set(null);
    this.idToken = null;
    this.refreshToken = null;
  }
}
