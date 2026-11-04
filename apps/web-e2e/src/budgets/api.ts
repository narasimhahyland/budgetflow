// Scenario budgets for the Phase 4 journeys, created through the API (never by writing tables), so a
// journey owns its data and the seeded tree stays as it is.
import { expect, request } from '@playwright/test';
import { SEED, userById, type SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { password } from '../support/auth';
import { API_URL, env, KEYCLOAK_ISSUER } from '../support/env';

interface Budget {
  id: string;
  name: string;
  code: string | null;
  balances: { budgetCurrency: { authorized: { amountMinor: number; currency: string } } };
}

const tokens = new Map<SeedUserId, { token: string; at: number }>();

/** Cached per worker; Keycloak can refuse a burst of parallel sign-ins for one user, so retry briefly. */
async function token(user: SeedUserId): Promise<string> {
  const hit = tokens.get(user);
  if (hit && Date.now() - hit.at < 60_000) return hit.token;
  for (let attempt = 1; ; attempt++) {
    const ctx = await request.newContext();
    const res = await ctx.post(`${KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
      form: {
        grant_type: 'password',
        client_id: env('BF_E2E_CLIENT_ID'),
        username: userById(user).username,
        password: password(),
      },
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string };
    await ctx.dispose();
    if (res.ok() && body.access_token) {
      tokens.set(user, { token: body.access_token, at: Date.now() });
      return body.access_token;
    }
    if (attempt >= 5)
      throw new Error(`token for ${user}: HTTP ${res.status()} ${JSON.stringify(body)}`);
    await new Promise((r) => setTimeout(r, 400 * attempt));
  }
}

export async function api<T>(
  user: SeedUserId,
  method: 'get' | 'post',
  path: string,
  data?: unknown,
): Promise<T> {
  const ctx = await request.newContext();
  const res = await ctx.fetch(`${API_URL}${path}`, {
    method: method.toUpperCase(),
    headers: {
      authorization: `Bearer ${await token(user)}`,
      'idempotency-key': randomUUID(),
      'x-tenant-id': SEED.tenants.acme,
    },
    ...(data !== undefined ? { data } : {}),
  });
  const body = await res.json().catch(() => null);
  expect(res.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBe(true);
  await ctx.dispose();
  return body as T;
}

export const createRoot = (opts: { amountMinor: number; owner?: SeedUserId; name?: string }) =>
  api<Budget>('ceo', 'post', '/api/budgets', {
    name: opts.name ?? `Journey program ${randomUUID().slice(0, 6)}`,
    legalEntityId: SEED.legalEntities.acmeUs,
    fiscalYearId: SEED.fiscalYears.acmeFy2026,
    planVersionId: SEED.planVersions.acmeFy2026Original,
    originalAmount: { amountMinor: opts.amountMinor, currency: 'USD' },
    ...(opts.owner ? { ownerPersonId: userById(opts.owner).personId } : {}),
  });

export const createChild = (
  parentId: string,
  opts: {
    name: string;
    as?: SeedUserId;
    owner?: SeedUserId;
    currency?: string;
    orgUnitId?: string;
    code?: string;
  },
) =>
  api<Budget>(opts.as ?? 'finance-admin', 'post', '/api/budgets', {
    name: opts.name,
    parentId,
    legalEntityId:
      opts.currency === 'INR' ? SEED.legalEntities.acmeIndia : SEED.legalEntities.acmeUs,
    fiscalYearId: SEED.fiscalYears.acmeFy2026,
    ...(opts.currency ? { currency: opts.currency } : {}),
    ...(opts.orgUnitId ? { orgUnitId: opts.orgUnitId } : {}),
    ...(opts.code ? { code: opts.code } : {}),
    ...(opts.owner ? { ownerPersonId: userById(opts.owner).personId } : {}),
  });

export const allocate = (
  parentId: string,
  childId: string,
  amountMinor: number,
  as: SeedUserId = 'finance-admin',
) =>
  api(as, 'post', `/api/budgets/${parentId}/allocations`, {
    childBudgetId: childId,
    amount: { amountMinor, currency: 'USD' },
  });

export const getBudget = (id: string, as: SeedUserId = 'finance-admin') =>
  api<Budget>(as, 'get', `/api/budgets/${id}`);
