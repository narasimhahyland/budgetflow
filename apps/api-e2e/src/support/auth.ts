// Real Keycloak access tokens per seeded user from the local realm (direct grant is enabled only on the
// local budgetflow-e2e client). Credentials are the dev-only seed placeholder; tokens never leave memory.
import { request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { userById, type SeedUserId } from '@bf/seed';
import { env, KEYCLOAK_ISSUER } from './env';

const cache = new Map<SeedUserId, { token: string; expires: number }>();

export async function token(user: SeedUserId): Promise<string> {
  const hit = cache.get(user);
  if (hit && hit.expires > Date.now() + 30_000) return hit.token;
  const ctx = await request.newContext();
  const res = await ctx.post(`${KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
    form: {
      grant_type: 'password',
      client_id: env('BF_E2E_CLIENT_ID'),
      username: userById(user).username,
      password: env('BF_E2E_PASSWORD'),
    },
  });
  if (!res.ok())
    throw new Error(
      `token for ${user}: HTTP ${res.status()} (is the stack up? scripts/stack.sh up && scripts/stack.sh reset)`,
    );
  const body = (await res.json()) as { access_token: string; expires_in: number };
  await ctx.dispose();
  cache.set(user, { token: body.access_token, expires: Date.now() + body.expires_in * 1000 });
  return body.access_token;
}

/** Authorization plus X-Tenant-Id for the user's own tenant (override with `tenant`), plus extra headers. */
export async function as(
  user: SeedUserId,
  extra: Record<string, string> = {},
  tenant?: string | null,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${await token(user)}`,
    ...extra,
  };
  const t = tenant === undefined ? userById(user).tenantId : tenant;
  if (t) headers['x-tenant-id'] = t;
  return headers;
}

/** Headers for a mutation: a fresh Idempotency-Key unless one is given. */
export async function mutate(
  user: SeedUserId,
  key: string = randomUUID(),
  tenant?: string | null,
): Promise<Record<string, string>> {
  return as(user, { 'idempotency-key': key }, tenant);
}
