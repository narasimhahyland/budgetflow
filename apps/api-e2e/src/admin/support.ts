// Helpers for the Phase 14 administration scenarios. Destructive retention runs happen in the
// Initech Sandbox tenant on records the scenario creates itself, so no other scenario's data moves.
import { expect, type APIRequestContext } from '@playwright/test';
import {
  AdminUserList,
  FeatureFlagList,
  RetentionPolicyList,
  RetentionRun,
  SwitchFeatureFlagResult,
  UpdateRetentionPolicyResult,
  type AdminUser,
  type FeatureFlag,
  type RetentionPolicy,
} from '@bf/contracts';
import { SEED, userById, type SeedUserId } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';

export const SANDBOX = SEED.tenants.sandbox;
export const HYLAND = SEED.tenants.acme;

export const reason = (what: string) => `Phase 14 scenario: ${what}.`;

export async function flags(
  request: APIRequestContext,
  user: SeedUserId = 'org-admin',
): Promise<FeatureFlag[]> {
  const body = await expectContract(
    await request.get('/api/admin/features', { headers: await as(user) }),
    200,
    FeatureFlagList,
  );
  return body.items;
}

export async function flag(
  request: APIRequestContext,
  key: string,
  user: SeedUserId = 'org-admin',
): Promise<FeatureFlag> {
  const found = (await flags(request, user)).find((f) => f.key === key);
  expect(found, `flag ${key} is in the catalog`).toBeTruthy();
  return found!;
}

export async function switchFlag(
  request: APIRequestContext,
  opts: {
    user: SeedUserId;
    key: string;
    enabled: boolean;
    rolloutMode?: 'everyone' | 'pilot';
    pilotOrgUnitIds?: string[];
    pilotRoleIds?: string[];
    reason: string;
    tenant?: string;
  },
) {
  const res = await request.post(`/api/admin/features/${opts.key}/switch`, {
    headers: await mutate(opts.user, randomUUID(), opts.tenant),
    data: {
      enabled: opts.enabled,
      rolloutMode: opts.rolloutMode ?? 'everyone',
      pilotOrgUnitIds: opts.pilotOrgUnitIds ?? [],
      pilotRoleIds: opts.pilotRoleIds ?? [],
      reason: opts.reason,
    },
  });
  return res;
}

export async function switchFlagOk(
  request: APIRequestContext,
  opts: Parameters<typeof switchFlag>[1],
) {
  return expectContract(await switchFlag(request, opts), 201, SwitchFeatureFlagResult);
}

export async function retentionPolicies(
  request: APIRequestContext,
  user: SeedUserId,
  tenant?: string,
): Promise<RetentionPolicy[]> {
  const body = await expectContract(
    await request.get('/api/admin/retention/policies', { headers: await as(user, {}, tenant) }),
    200,
    RetentionPolicyList,
  );
  return body.items;
}

export async function retentionPolicy(
  request: APIRequestContext,
  category: string,
  user: SeedUserId,
  tenant?: string,
): Promise<RetentionPolicy> {
  const found = (await retentionPolicies(request, user, tenant)).find(
    (p) => p.category === category,
  );
  expect(found, `retention category ${category} exists`).toBeTruthy();
  return found!;
}

export async function setRetentionPeriod(
  request: APIRequestContext,
  opts: {
    user: SeedUserId;
    category: string;
    periodDays: number | null;
    reason: string;
    tenant?: string;
  },
) {
  return request.put(`/api/admin/retention/policies/${opts.category}`, {
    headers: await mutate(opts.user, randomUUID(), opts.tenant),
    data: { periodDays: opts.periodDays, reason: opts.reason },
  });
}

export async function setRetentionPeriodOk(
  request: APIRequestContext,
  opts: Parameters<typeof setRetentionPeriod>[1],
) {
  return expectContract(await setRetentionPeriod(request, opts), 200, UpdateRetentionPolicyResult);
}

export async function startRun(
  request: APIRequestContext,
  opts: {
    user: SeedUserId;
    mode: 'dry_run' | 'apply';
    categories: string[];
    dryRunId?: string;
    confirmation?: string;
    reason: string;
    tenant?: string;
  },
) {
  return request.post('/api/admin/retention/runs', {
    headers: await mutate(opts.user, randomUUID(), opts.tenant),
    data: {
      mode: opts.mode,
      categories: opts.categories,
      ...(opts.dryRunId ? { dryRunId: opts.dryRunId } : {}),
      ...(opts.confirmation ? { confirmation: opts.confirmation } : {}),
      reason: opts.reason,
    },
  });
}

export async function startRunOk(request: APIRequestContext, opts: Parameters<typeof startRun>[1]) {
  return expectContract(await startRun(request, opts), 201, RetentionRun);
}

/** The per-category line of a run report. Fails the test when the category is missing. */
export function runItem(run: RetentionRun, category: string) {
  const item = run.items.find((i) => i.category === category);
  expect(item, `run ${run.id} reports on ${category}`).toBeTruthy();
  return item!;
}

/**
 * Records product analytics events the scenario owns, so a retention run has candidates that belong
 * to it rather than to the seed or to another scenario.
 */
export async function recordAnalytics(
  request: APIRequestContext,
  user: SeedUserId,
  count: number,
  tenant?: string,
): Promise<string[]> {
  const ids = Array.from({ length: count }, () => randomUUID());
  const res = await request.post('/api/analytics/events', {
    headers: await as(user, {}, tenant),
    data: {
      events: ids.map((id) => ({
        id,
        name: 'page.viewed' as const,
        properties: { route: '/admin/retention' },
      })),
    },
  });
  expect(res.status(), await res.text()).toBe(202);
  return ids;
}

export async function users(
  request: APIRequestContext,
  user: SeedUserId = 'org-admin',
): Promise<AdminUser[]> {
  const body = await expectContract(
    await request.get('/api/admin/users', { headers: await as(user) }),
    200,
    AdminUserList,
  );
  return body.items;
}

export async function userByRoleUser(
  request: APIRequestContext,
  seedUser: SeedUserId,
): Promise<AdminUser> {
  const personId = userById(seedUser).personId;
  const found = (await users(request)).find((u) => u.personId === personId);
  expect(found, `${seedUser} is listed in user administration`).toBeTruthy();
  return found!;
}

/** Places a legal hold and confirms it with a second person, returning the active hold id. */
export async function activeHold(
  request: APIRequestContext,
  opts: {
    placedBy: SeedUserId;
    confirmedBy: SeedUserId;
    scopeKind: 'person' | 'event' | 'budget' | 'date_range';
    scopeRefId?: string | null;
    scopeFrom?: string | null;
    scopeTo?: string | null;
    reason: string;
    tenant?: string;
  },
): Promise<string> {
  const placed = await request.post('/api/admin/retention/holds', {
    headers: await mutate(opts.placedBy, randomUUID(), opts.tenant),
    data: {
      scopeKind: opts.scopeKind,
      scopeRefId: opts.scopeRefId ?? null,
      scopeFrom: opts.scopeFrom ?? null,
      scopeTo: opts.scopeTo ?? null,
      reason: opts.reason,
    },
  });
  expect(placed.status(), await placed.text()).toBe(201);
  const hold = (await placed.json()) as { id: string; status: string };
  expect(hold.status).toBe('pending_confirmation');
  const confirmed = await request.post(`/api/admin/retention/holds/${hold.id}/decision`, {
    headers: await mutate(opts.confirmedBy, randomUUID(), opts.tenant),
    data: { decision: 'confirm', reason: opts.reason },
  });
  expect(confirmed.status(), await confirmed.text()).toBe(201);
  expect(((await confirmed.json()) as { status: string }).status).toBe('active');
  return hold.id;
}

export async function releaseHold(
  request: APIRequestContext,
  holdId: string,
  user: SeedUserId,
  tenant?: string,
): Promise<void> {
  const res = await request.post(`/api/admin/retention/holds/${holdId}/decision`, {
    headers: await mutate(user, randomUUID(), tenant),
    data: { decision: 'release', reason: reason('scenario cleanup') },
  });
  expect(res.status(), await res.text()).toBe(201);
}
