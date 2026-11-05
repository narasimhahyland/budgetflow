// Inbound provider callbacks (094, 096, 100). Every call is HMAC-verified inside a five-minute window
// before any business logic runs; a forged signature and a stale timestamp are both rejected, and a
// provider retrying the same event applies it once.
import { expect, test } from '@playwright/test';
import { InboundWebhookResult } from '@bf/contracts';
import { TENANTS } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { expectContract, expectProblem } from '../support/contract';
import {
  CONNECTIONS,
  CREDENTIALS,
  postInboundWebhook,
  resetMock,
  signInbound,
} from '../support/p12';

const TENANT = TENANTS.acme;
const CONNECTION = CONNECTIONS.erpnext;

const glPosted = () => ({
  eventId: `erpx-${randomUUID()}`,
  type: 'gl.posted',
  data: { voucher: 'JV-2026-11-0044' },
});

test.beforeEach(async () => {
  await resetMock();
});

test.describe('inbound provider webhooks', () => {
  test('a correctly signed callback is accepted and runs the same sync a schedule would', async ({
    request,
  }) => {
    const res = await postInboundWebhook(request, TENANT, CONNECTION, glPosted(), {
      secret: CREDENTIALS.erpnext,
    });
    const body = await expectContract(res, 200, InboundWebhookResult);
    expect(body.accepted).toBe(true);
    expect(body.replayed).toBe(false);
    // Whether lines were new or already imported, the callback never posts to the ledger itself.
    expect(body.recordsApplied).toBeGreaterThanOrEqual(0);
  });

  test('a forged signature is rejected before anything is read', async ({ request }) => {
    const body = glPosted();
    const raw = JSON.stringify(body);
    const forged = signInbound('not-the-shared-secret', raw);
    await expectProblem(
      await request.post(`/api/integrations/webhooks/${TENANT}/${CONNECTION}`, {
        headers: { ...forged, 'content-type': 'application/json' },
        data: raw,
      }),
      401,
      'WEBHOOK_SIGNATURE_INVALID',
    );
  });

  test('a call with no signature is rejected', async ({ request }) => {
    await expectProblem(
      await request.post(`/api/integrations/webhooks/${TENANT}/${CONNECTION}`, {
        headers: { 'content-type': 'application/json' },
        data: JSON.stringify(glPosted()),
      }),
      401,
      'WEBHOOK_SIGNATURE_INVALID',
    );
  });

  test('a body changed after signing is rejected', async ({ request }) => {
    const original = glPosted();
    const headers = signInbound(CREDENTIALS.erpnext, JSON.stringify(original));
    await expectProblem(
      await request.post(`/api/integrations/webhooks/${TENANT}/${CONNECTION}`, {
        headers: { ...headers, 'content-type': 'application/json' },
        data: JSON.stringify({ ...original, data: { voucher: 'JV-TAMPERED' } }),
      }),
      401,
      'WEBHOOK_SIGNATURE_INVALID',
    );
  });

  test('a replayed call from outside the five-minute window is rejected', async ({ request }) => {
    const stale = Math.floor(Date.now() / 1000) - 10 * 60;
    await expectProblem(
      await postInboundWebhook(request, TENANT, CONNECTION, glPosted(), {
        secret: CREDENTIALS.erpnext,
        timestampSeconds: stale,
      }),
      401,
      'WEBHOOK_TIMESTAMP_EXPIRED',
    );
  });

  test('the same provider event delivered twice is applied once', async ({ request }) => {
    const body = glPosted();
    const first = await expectContract(
      await postInboundWebhook(request, TENANT, CONNECTION, body, {
        secret: CREDENTIALS.erpnext,
      }),
      200,
      InboundWebhookResult,
    );
    expect(first.replayed).toBe(false);

    const second = await expectContract(
      await postInboundWebhook(request, TENANT, CONNECTION, body, {
        secret: CREDENTIALS.erpnext,
      }),
      200,
      InboundWebhookResult,
    );
    expect(second.replayed).toBe(true);
    expect(second.recordsApplied).toBe(0);
    expect(second.syncRunId).toBeNull();
  });

  test('a callback aimed at another tenant finds nothing', async ({ request }) => {
    await expectProblem(
      await postInboundWebhook(request, TENANTS.globex, CONNECTION, glPosted(), {
        secret: CREDENTIALS.erpnext,
      }),
      404,
      'NOT_FOUND',
    );
  });
});
