import { ApiProblem } from '@bf/api/core';
import type { ChatApprovalCardView, ChatProvider, Money } from '@bf/contracts';
import { formatMoney } from '@bf/api/notifications';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const ChatEnv = z.object({
  SLACK_SIGNING_SECRET: z.string().optional(),
  TEAMS_WEBHOOK_SECRET: z.string().optional(),
  CHAT_LINK_SECRET: z.string().optional(),
  CHAT_TIMESTAMP_TOLERANCE_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
});

const DEV_SLACK_SECRET = 'slack-signing-secret-dev-only-0001';
const DEV_TEAMS_SECRET = 'teams-webhook-secret-dev-only-0001';
const DEV_CHAT_LINK_SECRET = 'chat-account-link-secret-dev-only-0001';

export function chatConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = ChatEnv.parse(env);
  return {
    slackSecret:
      parsed.SLACK_SIGNING_SECRET && parsed.SLACK_SIGNING_SECRET.length >= 16
        ? parsed.SLACK_SIGNING_SECRET
        : DEV_SLACK_SECRET,
    teamsSecret:
      parsed.TEAMS_WEBHOOK_SECRET && parsed.TEAMS_WEBHOOK_SECRET.length >= 16
        ? parsed.TEAMS_WEBHOOK_SECRET
        : DEV_TEAMS_SECRET,
    linkSecret:
      parsed.CHAT_LINK_SECRET && parsed.CHAT_LINK_SECRET.length >= 16
        ? parsed.CHAT_LINK_SECRET
        : DEV_CHAT_LINK_SECRET,
    toleranceSeconds: parsed.CHAT_TIMESTAMP_TOLERANCE_SECONDS,
  };
}

/**
 * Computes the HMAC-SHA256 signature for Slack (`v0=<hex>` over `v0:<ts>:<rawBody>`) or Microsoft Teams
 * (`sha256=<hex>` over `<ts>.<rawBody>`). Exported for deterministic scenario tests and local loopback.
 */
export function signChatWebhook(
  provider: ChatProvider,
  timestampSeconds: number | string,
  rawBody: string,
  secret?: string,
): string {
  const cfg = chatConfig();
  const key = secret ?? (provider === 'slack' ? cfg.slackSecret : cfg.teamsSecret);
  const ts = String(timestampSeconds);
  if (provider === 'slack') {
    const digest = createHmac('sha256', key).update(`v0:${ts}:${rawBody}`).digest('hex');
    return `v0=${digest}`;
  }
  const digest = createHmac('sha256', key).update(`${ts}.${rawBody}`).digest('hex');
  return `sha256=${digest}`;
}

/**
 * Verifies the incoming HMAC signature and timestamp window (default 5 minutes) for Slack and Teams
 * interactive webhook callbacks before any business logic runs.
 */
export function verifyChatWebhookSignature(
  provider: ChatProvider,
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
  nowMs = Date.now(),
): void {
  const get = (k: string) => {
    const v = headers[k.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const tsRaw =
    provider === 'slack'
      ? (get('x-slack-request-timestamp') ?? get('x-bf-chat-timestamp'))
      : (get('x-teams-request-timestamp') ?? get('x-bf-chat-timestamp'));
  const sig =
    provider === 'slack'
      ? (get('x-slack-signature') ?? get('x-bf-chat-signature'))
      : (get('x-teams-signature') ?? get('x-bf-chat-signature'));

  if (!tsRaw || !/^\d{9,12}$/.test(tsRaw.trim())) {
    throw new ApiProblem(
      401,
      'CHAT_TIMESTAMP_EXPIRED',
      'Missing or invalid webhook request timestamp.',
    );
  }
  const tsSec = Number(tsRaw.trim());
  const cfg = chatConfig();
  const ageSec = Math.abs(Math.floor(nowMs / 1000) - tsSec);
  if (ageSec > cfg.toleranceSeconds) {
    throw new ApiProblem(
      401,
      'CHAT_TIMESTAMP_EXPIRED',
      'Webhook timestamp is outside the allowed 5-minute replay window.',
    );
  }
  if (!sig) {
    throw new ApiProblem(401, 'CHAT_SIGNATURE_INVALID', 'Missing webhook HMAC signature.');
  }
  const expected = Buffer.from(signChatWebhook(provider, tsSec, rawBody));
  const given = Buffer.from(sig.trim());
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new ApiProblem(401, 'CHAT_SIGNATURE_INVALID', 'Webhook signature verification failed.');
  }
}

export interface ChatLinkTokenPayload {
  tenantId: string;
  personId: string;
  provider: ChatProvider;
  providerUserId: string;
  handle: string;
  verifiedEmail: string;
  exp: number;
}

/** Signs and verifies short-lived chat account-linking tokens (`v1.<base64url>.<sig>`). */
export function signChatLinkToken(payload: ChatLinkTokenPayload): string {
  const cfg = chatConfig();
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', cfg.linkSecret).update(`v1.${body}`).digest('base64url');
  return `v1.${body}.${sig}`;
}

export function verifyChatLinkToken(token: string): ChatLinkTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    throw new ApiProblem(404, 'CHAT_LINK_INVALID', 'This account-linking link is not valid.');
  }
  const [, body, sig] = parts;
  const cfg = chatConfig();
  const expected = Buffer.from(
    createHmac('sha256', cfg.linkSecret).update(`v1.${body}`).digest('base64url'),
  );
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new ApiProblem(404, 'CHAT_LINK_INVALID', 'This account-linking link is not valid.');
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as ChatLinkTokenPayload;
    if (!parsed.exp || parsed.exp < Date.now()) {
      throw new ApiProblem(404, 'CHAT_LINK_INVALID', 'This account-linking link has expired.');
    }
    return parsed;
  } catch (e) {
    if (e instanceof ApiProblem) throw e;
    throw new ApiProblem(404, 'CHAT_LINK_INVALID', 'This account-linking link is not valid.');
  }
}

/** Builds the Slack Block Kit JSON payload for an approval card (screen 061b). */
export function buildSlackApprovalBlockKit(
  c: Omit<ChatApprovalCardView, 'blockKit' | 'adaptiveCard'>,
): Record<string, unknown> {
  const amountText = formatMoney(c.amount);
  const amountLine = c.planRateNote ? `${amountText} (${c.planRateNote})` : amountText;
  const blocks: Record<string, unknown>[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: c.state === 'waiting' ? `Approval needed: ${c.ref}` : c.stateHeadline,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Request*\n${c.title}` },
        { type: 'mrkdwn', text: `*Amount*\n${amountLine}` },
        { type: 'mrkdwn', text: `*Requester*\n${c.requesterName}` },
        { type: 'mrkdwn', text: `*Charge to*\n${c.chargeTo}` },
        ...(c.eventName ? [{ type: 'mrkdwn', text: `*Event*\n${c.eventName}` }] : []),
        ...(c.neededBy ? [{ type: 'mrkdwn', text: `*Needed by*\n${c.neededBy}` }] : []),
      ],
    },
  ];
  if (c.availableBefore && c.availableAfter) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Available under this budget's rules: ${formatMoney(c.availableBefore)} now, ${formatMoney(c.availableAfter)} after approval.${
            c.warning ? `\n⚠️ ${c.warning}` : ''
          }`,
        },
      ],
    });
  }
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: c.whyYou }],
  });
  if (c.state !== 'waiting') {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${c.stateHeadline}*` },
    });
  }
  const elements: Record<string, unknown>[] = [];
  if (c.canApprove) {
    elements.push({
      type: 'button',
      style: 'primary',
      action_id: 'approve',
      value: c.taskId,
      text: { type: 'plain_text', text: `Approve ${amountText}` },
    });
  } else if (c.state === 'outside_doa' && c.stepUpUrl) {
    elements.push({
      type: 'button',
      action_id: 'escalate_web',
      url: c.stepUpUrl,
      text: { type: 'plain_text', text: 'Escalate in BudgetFlow' },
    });
  }
  if (c.canReject) {
    elements.push({
      type: 'button',
      style: 'danger',
      action_id: 'reject',
      value: c.taskId,
      text: { type: 'plain_text', text: 'Reject' },
    });
  }
  elements.push({
    type: 'button',
    action_id: 'open_details',
    url: c.detailsUrl,
    text: { type: 'plain_text', text: 'Open in BudgetFlow' },
  });
  if (c.stepUpUrl && c.state === 'waiting') {
    elements.push({
      type: 'button',
      action_id: 'approve_part',
      url: c.stepUpUrl,
      text: { type: 'plain_text', text: 'Approve part or request changes' },
    });
  }
  blocks.push({ type: 'actions', elements });
  return {
    text: `${c.stateHeadline}: ${c.ref} ${c.title} (${amountText}) — ${c.detailsUrl}`,
    blocks,
  };
}

/** Builds the Microsoft Teams Adaptive Card 1.5 JSON payload with Universal Actions (screen 061c). */
export function buildTeamsApprovalAdaptiveCard(
  c: Omit<ChatApprovalCardView, 'blockKit' | 'adaptiveCard'>,
): Record<string, unknown> {
  const amountText = formatMoney(c.amount);
  const amountLine = c.planRateNote ? `${amountText} (${c.planRateNote})` : amountText;
  const facts: { title: string; value: string }[] = [
    { title: 'Request', value: c.title },
    { title: 'Amount', value: amountLine },
    { title: 'Requester', value: c.requesterName },
    { title: 'Charge to', value: c.chargeTo },
  ];
  if (c.eventName) facts.push({ title: 'Event', value: c.eventName });
  if (c.neededBy) facts.push({ title: 'Needed by', value: c.neededBy });

  const body: Record<string, unknown>[] = [
    {
      type: 'TextBlock',
      weight: 'Bolder',
      size: 'Medium',
      text: c.state === 'waiting' ? `Approval needed · ${c.ref}` : c.stateHeadline,
    },
    {
      type: 'FactSet',
      facts,
    },
  ];
  if (c.availableBefore && c.availableAfter) {
    body.push({
      type: 'Container',
      style: 'emphasis',
      items: [
        {
          type: 'TextBlock',
          wrap: true,
          text: `Available under this budget's rules: ${formatMoney(c.availableBefore)} now, ${formatMoney(c.availableAfter)} after approval.`,
        },
        ...(c.warning
          ? [{ type: 'TextBlock', wrap: true, color: 'Warning', text: c.warning }]
          : []),
      ],
    });
  }
  body.push({
    type: 'TextBlock',
    wrap: true,
    isSubtle: true,
    text: c.whyYou,
  });

  const actions: Record<string, unknown>[] = [];
  if (c.canApprove) {
    actions.push({
      type: 'Action.Execute',
      title: `Approve ${amountText}`,
      verb: 'approve',
      style: 'positive',
      data: { taskId: c.taskId, decision: 'approve' },
    });
  } else if (c.state === 'outside_doa' && c.stepUpUrl) {
    actions.push({
      type: 'Action.OpenUrl',
      title: 'Escalate in BudgetFlow',
      url: c.stepUpUrl,
    });
  }
  if (c.canReject) {
    actions.push({
      type: 'Action.ShowCard',
      title: 'Reject',
      style: 'destructive',
      card: {
        type: 'AdaptiveCard',
        body: [
          {
            type: 'Input.ChoiceSet',
            id: 'reasonCode',
            label: 'Reason code',
            isRequired: true,
            errorMessage: 'Choose a reason code',
            choices: [
              { title: 'REJ-BUDGET · Insufficient budget', value: 'REJ-BUDGET' },
              { title: 'REJ-POLICY · Outside policy', value: 'REJ-POLICY' },
            ],
          },
          {
            type: 'Input.Text',
            id: 'reason',
            label: `Reason for ${c.requesterName.split(' ')[0]}`,
            isMultiline: true,
            isRequired: true,
            errorMessage: `Tell ${c.requesterName.split(' ')[0]} why`,
          },
        ],
        actions: [
          {
            type: 'Action.Execute',
            title: 'Submit rejection',
            verb: 'reject',
            style: 'destructive',
            data: { taskId: c.taskId, decision: 'reject' },
          },
        ],
      },
    });
  }
  actions.push({
    type: 'Action.OpenUrl',
    title: 'Open in BudgetFlow',
    url: c.detailsUrl,
  });

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.5',
    fallbackText: `${c.stateHeadline}: ${c.ref} ${c.title} (${amountText}) — ${c.detailsUrl}`,
    refresh: {
      action: {
        type: 'Action.Execute',
        title: 'Refresh',
        verb: 'refresh',
        data: { taskId: c.taskId },
      },
    },
    body,
    actions,
  };
}

export function formatMoneyTripletNote(amount: Money, budgetAmount: Money): string | null {
  if (amount.currency === budgetAmount.currency) return null;
  return `${formatMoney(budgetAmount)} at the FY2026 plan rate`;
}
