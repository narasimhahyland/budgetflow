// Shared setup for the Phase 13 journeys.
//
// AI feature switches are tenant-wide, so a journey that changes one would otherwise decide what the
// others see. Each journey therefore states the switch it needs and asserts that it holds before it
// starts, instead of depending on the order the suites happen to run in.
import { expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { apiToken } from '../support/auth';
import { API_URL } from '../support/env';
import type { RoleId } from '../support/roles';

const contexts = new Map<RoleId, Promise<APIRequestContext>>();

/**
 * One API context per role for the whole worker. The local Keycloak is a single container, and a
 * burst of direct grants from parallel journeys is enough to make a token request fail.
 */
export function apiAs(role: RoleId): Promise<APIRequestContext> {
  const existing = contexts.get(role);
  if (existing) return existing;
  const created = (async () =>
    pwRequest.newContext({
      baseURL: API_URL,
      extraHTTPHeaders: {
        authorization: `Bearer ${await apiToken(role)}`,
        'x-tenant-id': SEED.tenants.acme,
      },
    }))();
  contexts.set(role, created);
  return created;
}

const key = () => ({ 'idempotency-key': randomUUID() });

type FeatureState = { feature: string; enabled: boolean; pendingFinanceConfirmation: boolean };

async function featureState(api: APIRequestContext, feature: string): Promise<FeatureState> {
  const res = await api.get('/api/ai/settings');
  expect(res.status(), 'read AI settings').toBe(200);
  const body = (await res.json()) as { features: FeatureState[] };
  const state = body.features.find((f) => f.feature === feature);
  expect(state, `${feature} is in the settings view`).toBeDefined();
  return state!;
}

/**
 * Leaves `feature` switched to `enabled` and asserts it. Finance-affecting features need a Finance
 * Admin's confirmation to come on, which is exactly what the product requires of a person, so the
 * setup does it the same way.
 */
export async function setAiFeature(feature: string, enabled: boolean): Promise<void> {
  const orgAdmin = await apiAs('org-admin');
  const switched = await orgAdmin.post(`/api/ai/features/${feature}/switch`, {
    data: { enabled },
    headers: key(),
  });
  expect([201, 409]).toContain(switched.status());

  let state = await featureState(orgAdmin, feature);
  if (state.pendingFinanceConfirmation) {
    const financeAdmin = await apiAs('finance-admin');
    const confirmed = await financeAdmin.post(`/api/ai/features/${feature}/finance-confirmation`, {
      headers: key(),
    });
    expect(confirmed.status(), `finance confirmation for ${feature}`).toBe(201);
    state = await featureState(orgAdmin, feature);
  }
  expect(state.enabled, `${feature} is ${enabled ? 'on' : 'off'} before this journey`).toBe(
    enabled,
  );
}
