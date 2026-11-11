// Sign-in helpers for journeys: the real Keycloak pages (BudgetFlow theme), TOTP codes for the MFA test
// user, API tokens for cross-checking what the UI shows. Credentials are the dev-only seed placeholders.
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, request, type Page } from '@playwright/test';
import { userById, type SeedUserId } from '@bf/seed';
import { env, KEYCLOAK_ISSUER } from './env';

export const password = () => env('BF_E2E_PASSWORD');

/** RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s) with Keycloak's secret encoding (UTF-8 bytes). */
export function totp(secret = env('BF_E2E_TOTP_SECRET'), at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', Buffer.from(secret, 'utf8')).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

const TOTP_LEDGER = resolve(__dirname, '../../../../tmp/e2e-totp-used.json');

/** Codes Keycloak would accept right now (previous, current and next 30-second window). */
export const acceptedTotps = (at = Date.now()) =>
  [-1, 0, 1].map((w) => totp(undefined, at + w * 30_000));

/**
 * An accepted code not used recently. Keycloak refuses a reused code, so runs record what they submit in
 * tmp/ (shared with the API scenarios) and wait for the next 30-second window when needed.
 */
export async function freshTotp(): Promise<string> {
  for (;;) {
    const now = Date.now();
    const used: Record<string, number> = existsSync(TOTP_LEDGER)
      ? (JSON.parse(readFileSync(TOTP_LEDGER, 'utf8')) as Record<string, number>)
      : {};
    for (const code of Object.keys(used)) if (now - used[code] > 120_000) delete used[code];
    for (const window of [0, 1]) {
      const code = totp(undefined, now + window * 30_000);
      if (!used[code]) {
        used[code] = now;
        mkdirSync(resolve(TOTP_LEDGER, '..'), { recursive: true });
        writeFileSync(TOTP_LEDGER, JSON.stringify(used));
        return code;
      }
    }
    await new Promise((r) => setTimeout(r, 30_000 - (now % 30_000) + 500));
  }
}

/** Fills the BudgetFlow sign-in page (Keycloak) and submits. */
export async function submitSignIn(page: Page, user: SeedUserId, pass = password()): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Sign in to BudgetFlow' })).toBeVisible();
  // Keycloak's page scripts may reload a fresh form right after load; type only once it has settled.
  await page.waitForLoadState('networkidle');
  const username = page.getByLabel(/username or email/i);
  const passwordField = page.getByLabel('Password', { exact: true });
  await username.fill(userById(user).username);
  await passwordField.fill(pass);
  await expect(username).toHaveValue(userById(user).username);
  await expect(passwordField).toHaveValue(pass);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

/** The signed-in shell is on screen (Satori platform navigation and the header company name). */
export async function expectShell(page: Page): Promise<void> {
  await expect(page.getByRole('navigation', { name: 'Platform Navigation' })).toBeAttached();
  await expect(page.getByTestId('header-company')).toHaveText('Hyland');
}

/**
 * A real access token from the local realm (direct grant on the local test client) to cross-check the UI.
 *
 * The local Keycloak is a single container and refuses a direct grant when several workers mint their
 * first token at the same moment, so a refusal is retried a few times before the test is failed. The
 * message carries the status and body: a bare "token for X" says nothing about whether Keycloak was
 * overloaded, the realm was missing or the credentials were wrong.
 */
export async function apiToken(user: SeedUserId): Promise<string> {
  const ctx = await request.newContext();
  let last = '';
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 250 * 2 ** (attempt - 1)));
      const res = await ctx.post(`${KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
        form: {
          grant_type: 'password',
          client_id: env('BF_E2E_CLIENT_ID'),
          username: userById(user).username,
          password: password(),
        },
      });
      if (res.ok()) return ((await res.json()) as { access_token: string }).access_token;
      last = `HTTP ${res.status()} ${(await res.text()).slice(0, 200)}`;
    }
  } finally {
    await ctx.dispose();
  }
  throw new Error(`token for ${user}: ${last} (4 attempts; is the stack up?)`);
}
