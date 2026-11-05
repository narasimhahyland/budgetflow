// Template for apps/api-e2e/src/support/auth.ts: real Keycloak access tokens per seeded role from the local
// realm (direct grant enabled only on the local test client). Credentials are dev-only seed values.
import { request } from '@playwright/test';
import type { RoleId } from '../../../web-e2e/src/support/roles';
import { ROLES } from '../../../web-e2e/src/support/roles';

const issuer = process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8080/realms/budgetflow';
const cache = new Map<RoleId, string>();

export async function token(role: RoleId): Promise<string> {
  const hit = cache.get(role);
  if (hit) return hit;
  const user = ROLES.find((r) => r.id === role);
  if (!user) throw new Error(`unknown role ${role}`);
  const ctx = await request.newContext();
  const res = await ctx.post(`${issuer}/protocol/openid-connect/token`, {
    form: {
      grant_type: 'password',
      client_id: process.env.BF_E2E_CLIENT_ID ?? 'budgetflow-e2e',
      username: user.username,
      password: process.env.BF_E2E_PASSWORD ?? '',
    },
  });
  if (!res.ok())
    throw new Error(
      `token for ${role}: HTTP ${res.status()} (is the stack up and BF_E2E_PASSWORD set?)`,
    );
  const { access_token } = await res.json();
  await ctx.dispose();
  cache.set(role, access_token);
  return access_token;
}

export async function bearer(role: RoleId, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${await token(role)}`, ...extra };
}
