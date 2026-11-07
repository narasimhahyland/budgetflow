// Shared helpers for the Phase 15 journeys: one API context per role to cross-check what the screen
// shows against what the server actually holds, and the money formatting the UI renders.
import { expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { SEED } from '@bf/seed';
import { apiToken } from '../support/auth';
import { API_URL } from '../support/env';
import type { RoleId } from '../support/roles';

// One token per role for the whole file: Keycloak refuses a burst of direct grants for one user.
const tokens = new Map<RoleId, Promise<string>>();
const tokenFor = (role: RoleId): Promise<string> => {
  const hit = tokens.get(role) ?? apiToken(role);
  tokens.set(role, hit);
  return hit;
};

export async function apiAs(role: RoleId): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: API_URL,
    extraHTTPHeaders: {
      authorization: `Bearer ${await tokenFor(role)}`,
      'x-tenant-id': SEED.tenants.acme,
      accept: 'application/json',
    },
  });
}

export async function getJson<T>(role: RoleId, path: string): Promise<T> {
  const ctx = await apiAs(role);
  const res = await ctx.get(path);
  expect(res.status(), `${role} GET ${path}: ${await res.text()}`).toBe(200);
  const body = (await res.json()) as T;
  await ctx.dispose();
  return body;
}

export async function postJson<T>(
  role: RoleId,
  path: string,
  data: unknown,
  expected = 201,
): Promise<T> {
  const ctx = await apiAs(role);
  const res = await ctx.post(path, {
    data,
    headers: { 'idempotency-key': crypto.randomUUID(), 'content-type': 'application/json' },
  });
  expect(res.status(), `${role} POST ${path}: ${await res.text()}`).toBe(expected);
  const body = (await res.json()) as T;
  await ctx.dispose();
  return body;
}

/** The exact text `bf-money` renders for an amount in integer minor units. */
export const money = (minor: number, currency = 'USD'): string =>
  `${currency} ${new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100)}`;

export interface Money {
  amountMinor: number;
  currency: string;
}

export interface SuppressibleFigure {
  valueMilli: number | null;
  groupSize: number;
  suppressed: boolean;
  suppressionReason: string | null;
}
