// Helpers for the Phase 16 ecosystem scenarios: connecting a personal tool, calling a surface with
// its connection token, and the mock marketplace partner's control plane.
//
// Every scenario makes its own connection rather than reusing the seeded ones, so two scenarios
// never share a rate-limit window, a revocation or an armed partner answer.
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  EcosystemConnectionCreated,
  type AssistantTool,
  type AutomationAction,
  type BiDataset,
} from '@bf/contracts';
import type { SeedUserId } from '@bf/seed';
import { mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { MOCK_BASE } from '../support/p12';

export const ALLOWED_ORIGIN = 'https://intranet.example.test';
export const OTHER_ORIGIN = 'https://copycat.example.test';

/** Authorization header for a connection token (no session, no X-Tenant-Id: the token names both). */
export const withToken = (token: string, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  ...extra,
});

export async function connectBi(
  request: APIRequestContext,
  user: SeedUserId,
  datasets: BiDataset[],
): Promise<{ token: string; id: string }> {
  const created = await expectContract(
    await request.post('/api/ecosystem/bi/connections', {
      headers: await mutate(user),
      data: { tool: 'power_bi', label: `scenario ${randomUUID().slice(0, 8)}`, datasets },
    }),
    201,
    EcosystemConnectionCreated,
  );
  return { token: created.token, id: created.connection.id };
}

export async function connectAssistant(
  request: APIRequestContext,
  user: SeedUserId,
  tools: AssistantTool[],
  appKey = 'bf-demo-assistant',
): Promise<{ token: string; id: string }> {
  const created = await expectContract(
    await request.post('/api/ecosystem/assistants/connections', {
      headers: await mutate(user),
      data: {
        appKey,
        label: `scenario ${randomUUID().slice(0, 8)}`,
        tools,
        consentAcknowledged: true,
      },
    }),
    201,
    EcosystemConnectionCreated,
  );
  return { token: created.token, id: created.connection.id };
}

export async function connectAutomation(
  request: APIRequestContext,
  user: SeedUserId,
  actions: AutomationAction[],
): Promise<{ token: string; id: string }> {
  const created = await expectContract(
    await request.post('/api/ecosystem/automations/connections', {
      headers: await mutate(user),
      data: {
        platform: 'zapier',
        label: `scenario ${randomUUID().slice(0, 8)}`,
        actions,
        consentAcknowledged: true,
      },
    }),
    201,
    EcosystemConnectionCreated,
  );
  return { token: created.token, id: created.connection.id };
}

/** Calls one Model Context Protocol tool with a connection token. */
export const callTool = (
  request: APIRequestContext,
  token: string,
  tool: AssistantTool,
  args: Record<string, unknown> = {},
) =>
  request.post('/api/mcp/v1/tools/call', {
    headers: withToken(token),
    data: { tool, arguments: args },
  });

let mock: APIRequestContext | undefined;

async function mockApi(): Promise<APIRequestContext> {
  mock ??= await playwrightRequest.newContext({ baseURL: MOCK_BASE });
  return mock;
}

/**
 * Tells the mock partner what to answer for one booking. The answer is stored against that booking
 * id rather than queued, so nothing another scenario does can consume it.
 */
export async function armPartnerAnswer(answer: {
  bookingId: string;
  available: boolean;
  reference?: string;
  pricePerHeadMinor?: number;
  currency?: string;
  reason?: string;
  alternatives?: string[];
}): Promise<void> {
  const api = await mockApi();
  await api.post('/_control/partner-answer', { data: answer });
}
