// Helpers for the Phase 12 integration scenarios: the mock provider control plane, signing an
// inbound provider callback the way a real provider would, and finding seeded connections.
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { P12_IDS, P12_PLACEHOLDER_CREDENTIALS } from '@bf/seed';
import { env } from './env';

/** From the host: where the scenarios read the mock's control plane. */
export const MOCK_BASE = `http://localhost:${env('BF_MOCK_PROVIDERS_PORT')}`;
/** From inside Compose: where the API reaches the mock, and the only host webhooks may be sent to. */
export const MOCK_INTERNAL_BASE = process.env.BF_MOCK_INTERNAL_URL ?? 'http://mock-providers:4010';

export const CONNECTIONS = P12_IDS.connections;
export const CREDENTIALS = P12_PLACEHOLDER_CREDENTIALS;

let mock: APIRequestContext | undefined;

export async function mockApi(): Promise<APIRequestContext> {
  mock ??= await playwrightRequest.newContext({ baseURL: MOCK_BASE });
  return mock;
}

/** Forgets armed failures and received webhook deliveries, so each scenario starts from zero. */
export async function resetMock(): Promise<void> {
  const api = await mockApi();
  await api.post('/_control/reset');
}

/** Makes the next `times` calls to `path` at the mock fail with `status`. */
export async function armFailure(path: string, status: number, times = 1): Promise<void> {
  const api = await mockApi();
  await api.post('/_control/arm', { data: { path, status, times } });
}

export interface ReceivedWebhook {
  path: string;
  at: string;
  signature: string;
  signatureValid: boolean | null;
  body: { id: string; type: string; occurredAt: string; data: Record<string, unknown> } | null;
}

export async function receivedWebhooks(path = '/receiver/hook'): Promise<ReceivedWebhook[]> {
  const api = await mockApi();
  const res = await api.get('/_control/received', { params: { path } });
  const body = (await res.json()) as { items: ReceivedWebhook[] };
  return body.items;
}

/**
 * The `BudgetFlow-Signature` header a provider must send: `t=<unix seconds>,v1=<HMAC-SHA256 of
 * "<t>.<body>">`, keyed with the credential stored for the connection.
 */
export function signInbound(
  secret: string,
  rawBody: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const mac = createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex');
  return { 'budgetflow-signature': `t=${timestampSeconds},v1=${mac}` };
}

/** Posts a provider callback with a raw body so the signature covers exactly what was sent. */
export async function postInboundWebhook(
  api: APIRequestContext,
  tenantId: string,
  connectionId: string,
  body: Record<string, unknown>,
  options: { secret?: string; headers?: Record<string, string>; timestampSeconds?: number } = {},
) {
  const raw = JSON.stringify(body);
  const headers = options.headers ?? {
    ...signInbound(options.secret ?? CREDENTIALS.erpnext, raw, options.timestampSeconds),
  };
  return api.post(`/api/integrations/webhooks/${tenantId}/${connectionId}`, {
    headers: { ...headers, 'content-type': 'application/json' },
    data: raw,
  });
}

/**
 * The deliveries this receiver got that verify against `secret`: several endpoints point at the same
 * mock receiver, so a scenario identifies its own deliveries by the signature rather than by order.
 */
export async function deliveriesSignedWith(
  secret: string,
  path = '/receiver/hook',
): Promise<ReceivedWebhook[]> {
  const items = await receivedWebhooks(path);
  return items.filter((d) => {
    const parts = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(d.signature);
    if (!parts || !d.body) return false;
    const expected = createHmac('sha256', secret)
      .update(`${parts[1]}.${JSON.stringify(d.body)}`)
      .digest('hex');
    return expected === parts[2];
  });
}

/** Polls until the receiver has a delivery signed with `secret`, or gives up. */
export async function waitForDelivery(
  secret: string,
  timeoutMs = 20_000,
): Promise<ReceivedWebhook | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const hits = await deliveriesSignedWith(secret);
    if (hits.length > 0) return hits[0];
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** Calls the public API with a key instead of a session. */
export function withKey(secret: string, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${secret}`, ...extra };
}
