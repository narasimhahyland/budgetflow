// Phase 8 channel helpers. The signatures are computed here from the documented wire format rather than
// reused from the API, so the scenarios prove what Slack and Microsoft Teams actually send over the wire.
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { ChatWebhookResponse, type ChatProvider } from '@bf/contracts';
import { createHmac } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { as, mutate } from './auth';
import { expectContract } from './contract';
import type { SeedUserId } from '@bf/seed';

/** Dev-only fallback secrets the API uses when SLACK_SIGNING_SECRET / TEAMS_WEBHOOK_SECRET are unset. */
const DEV_SECRETS: Record<ChatProvider, string> = {
  slack: 'slack-signing-secret-dev-only-0001',
  teams: 'teams-webhook-secret-dev-only-0001',
};

/** Slack signs `v0:<ts>:<body>` as `v0=<hex>`; Teams signs `<ts>.<body>` as `sha256=<hex>`. */
export function signChatWebhook(
  provider: ChatProvider,
  timestampSeconds: number,
  rawBody: string,
  secret = DEV_SECRETS[provider],
): string {
  if (provider === 'slack') {
    return `v0=${createHmac('sha256', secret).update(`v0:${timestampSeconds}:${rawBody}`).digest('hex')}`;
  }
  return `sha256=${createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex')}`;
}

export function chatHeaders(
  provider: ChatProvider,
  rawBody: string,
  opts: { timestampSeconds?: number; signature?: string } = {},
): Record<string, string> {
  const ts = opts.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const sig = opts.signature ?? signChatWebhook(provider, ts, rawBody);
  return provider === 'slack'
    ? {
        'content-type': 'application/json',
        'x-slack-request-timestamp': String(ts),
        'x-slack-signature': sig,
      }
    : {
        'content-type': 'application/json',
        'x-teams-request-timestamp': String(ts),
        'x-teams-signature': sig,
      };
}

export interface WebhookPayload {
  tenantId?: string;
  providerUserId: string;
  viewerProviderUserId?: string;
  interactionId?: string;
  kind: 'decision' | 'balance' | 'app_home' | 'quick_request' | 'card_view';
  taskId?: string;
  decision?: 'approve' | 'reject';
  reasonCode?: string;
  reason?: string;
  budgetQuery?: string;
  quickRequest?: Record<string, unknown>;
}

/** Posts a signed interactive callback exactly as the chat platform would: raw JSON body, signed headers. */
export function postChatWebhook(
  request: APIRequestContext,
  provider: ChatProvider,
  payload: WebhookPayload,
  opts: { timestampSeconds?: number; signature?: string } = {},
): Promise<APIResponse> {
  const raw = JSON.stringify({ interactionId: randomUUID(), ...payload });
  return request.post(`/api/channels/webhooks/${provider}`, {
    headers: chatHeaders(provider, raw, opts),
    data: raw,
  });
}

/** Same as `postChatWebhook` but reuses one raw body so a retry is byte-identical (idempotency). */
export function chatWebhookBody(payload: WebhookPayload): string {
  return JSON.stringify({ interactionId: randomUUID(), ...payload });
}

export function postRawChatWebhook(
  request: APIRequestContext,
  provider: ChatProvider,
  raw: string,
  opts: { timestampSeconds?: number; signature?: string } = {},
): Promise<APIResponse> {
  return request.post(`/api/channels/webhooks/${provider}`, {
    headers: chatHeaders(provider, raw, opts),
    data: raw,
  });
}

export async function webhookOk(
  request: APIRequestContext,
  provider: ChatProvider,
  payload: WebhookPayload,
): Promise<import('zod').output<typeof ChatWebhookResponse>> {
  return expectContract(
    await postChatWebhook(request, provider, payload),
    200,
    ChatWebhookResponse,
  );
}

// Discussion, settings and digest helpers ---------------------------------------------------------

export const discussion = (
  request: APIRequestContext,
  as_: SeedUserId,
  itemType: 'budget' | 'event' | 'request',
  itemId: string,
) =>
  as(as_).then((headers) => request.get(`/api/discussions/${itemType}/${itemId}`, { headers }));

export const comment = async (
  request: APIRequestContext,
  as_: SeedUserId,
  itemType: 'budget' | 'event' | 'request',
  itemId: string,
  body: Record<string, unknown>,
  key?: string,
) =>
  request.post(`/api/discussions/${itemType}/${itemId}/comments`, {
    headers: await mutate(as_, key),
    data: body,
  });

export const patchComment = async (
  request: APIRequestContext,
  as_: SeedUserId,
  commentId: string,
  body: Record<string, unknown>,
) =>
  request.patch(`/api/comments/${commentId}`, { headers: await mutate(as_), data: body });

export const deleteComment = async (
  request: APIRequestContext,
  as_: SeedUserId,
  commentId: string,
) => request.delete(`/api/comments/${commentId}`, { headers: await mutate(as_) });

export const follow = async (
  request: APIRequestContext,
  as_: SeedUserId,
  itemType: 'budget' | 'event' | 'request',
  itemId: string,
  body: Record<string, unknown>,
) =>
  request.put(`/api/discussions/${itemType}/${itemId}/follow`, {
    headers: await mutate(as_),
    data: body,
  });

export const settings = async (request: APIRequestContext, as_: SeedUserId) =>
  request.get('/api/me/notification-settings', { headers: await as(as_) });

export const patchSettings = async (
  request: APIRequestContext,
  as_: SeedUserId,
  body: Record<string, unknown>,
) =>
  request.patch('/api/me/notification-settings', { headers: await mutate(as_), data: body });

/** Audit entries for a resource, as the auditor. */
export async function auditEvents(request: APIRequestContext, resourceId: string) {
  const res = await request.get(`/api/audit/events?resourceId=${resourceId}&limit=100`, {
    headers: await as('auditor'),
  });
  expect(res.status()).toBe(200);
  return (
    (await res.json()) as {
      items: { action: string; changes: Record<string, { to?: unknown }>; reason: string | null }[];
    }
  ).items;
}
