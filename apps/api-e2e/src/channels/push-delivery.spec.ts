// Real Web Push delivery (B8, screens 059a and 059c). A person's registered devices receive an
// encrypted (RFC 8291), VAPID-signed (RFC 8292) message on the push service, sent by the worker:
// - lock-screen privacy: amounts stay out of the message unless the person opted in;
// - a subscription the push service reports gone (404/410) is removed, and the removal is audited;
// - a push service that keeps failing is retried with backoff and ends in the dead letter;
// - a worker re-run of a delivery that was sent sends nothing more.
// Every scenario owns its devices (fresh mock subscription ids) and asserts on them alone.
import { expect, test } from '@playwright/test';
import { PushVapidKey, RequestDetail, TestChannelResponse } from '@bf/contracts';
import { userById } from '@bf/seed';
import { mutate, as } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { asOwner } from '../support/db';
import { auditEvents, patchSettings } from '../support/p8';
import { directorTree, spendingRequest, taskOf, usd } from '../support/p5';
import {
  deliveriesFor,
  mockSubscription,
  receivedBy,
  registerDevice,
  removeDevice,
  waitForDelivery,
} from '../support/push';

const APPROVER = 'department-head' as const;
const TESTER = 'regional-manager' as const;

async function sendTestPush(request: Parameters<typeof registerDevice>[0]) {
  return expectContract(
    await request.post('/api/me/notification-settings/test', {
      headers: await mutate(TESTER),
      data: { channel: 'push' },
    }),
    200,
    TestChannelResponse,
  );
}

test.describe('Web Push delivery', () => {
  test('an approval reaches the phone encrypted and signed, without the amount unless the person opted in', async ({
    request,
  }) => {
    const sub = mockSubscription('ok');
    const device = await registerDevice(request, APPROVER, sub);
    try {
      const { team } = await directorTree(request);
      const vapid = await expectContract(
        await request.get('/api/me/push-devices/vapid-key', { headers: await as(APPROVER) }),
        200,
        PushVapidKey,
      );

      // Default: amounts hidden on the lock screen.
      const hidden = await expectContract(
        await spendingRequest(request, 'budget-owner', team.id, usd(55_000)),
        201,
        RequestDetail,
      );
      await taskOf(request, APPROVER, 'request', hidden.id);
      const sentHidden = await waitForDelivery(
        request,
        APPROVER,
        device.id,
        (d) => d.subjectId === hidden.id && d.status === 'sent',
      );
      expect(sentHidden).toMatchObject({ kind: 'approval.assigned', attempts: 1 });

      const arrivals = await receivedBy(sub);
      const messages = arrivals.map((a) => ({ a, m: sub.decrypt(a.body) }));
      const forHidden = messages.filter(({ m }) => m['deliveryId'] === sentHidden.id);
      expect(forHidden).toHaveLength(1);
      const { a: wire, m: hiddenMsg } = forHidden[0];
      // The push service accepted it: valid VAPID for its origin, signed with the API's public key.
      expect(wire).toMatchObject({
        answered: 201,
        vapidValid: true,
        vapidPublicKey: vapid.publicKey,
        contentEncoding: 'aes128gcm',
        urgency: 'high',
      });
      expect(Number(wire.ttl)).toBeGreaterThan(0);
      // The request and person are there; the amount is not, in any form.
      expect(String(hiddenMsg['title'])).toContain(hidden.ref);
      expect(JSON.stringify(hiddenMsg)).not.toMatch(/USD|550/);
      expect(hiddenMsg['url']).toMatch(/^\/m\/approvals\//);
      // What was stored is exactly what was sent.
      expect(sentHidden.payload['title']).toBe(hiddenMsg['title']);
      expect(sentHidden.payload['showAmounts']).toBe(false);

      // Opted in: the amount is part of the message.
      await patchSettings(request, APPROVER, { privacy: { showAmountsInPush: true } });
      try {
        const shown = await expectContract(
          await spendingRequest(request, 'budget-owner', team.id, usd(66_000)),
          201,
          RequestDetail,
        );
        const sentShown = await waitForDelivery(
          request,
          APPROVER,
          device.id,
          (d) => d.subjectId === shown.id && d.status === 'sent',
        );
        const shownMsg = (await receivedBy(sub))
          .map((a) => sub.decrypt(a.body))
          .find((m) => m['deliveryId'] === sentShown.id);
        expect(String(shownMsg?.['title'])).toContain(shown.ref);
        expect(String(shownMsg?.['title'])).toContain('USD 660.00');
        expect(sentShown.payload['showAmounts']).toBe(true);
      } finally {
        await patchSettings(request, APPROVER, { privacy: { showAmountsInPush: false } });
      }
    } finally {
      await removeDevice(request, APPROVER, device.id);
    }
  });

  test('a subscription the push service reports gone is removed and the removal is audited', async ({
    request,
  }) => {
    for (const mode of ['gone', 'missing'] as const) {
      const sub = mockSubscription(mode);
      const device = await registerDevice(request, TESTER, sub, `Old phone (${mode})`);
      const test = await sendTestPush(request);
      expect(test.status).toBe('queued');

      const gone = await waitForDelivery(request, TESTER, device.id, (d) => d.status === 'gone');
      expect(gone.attempts).toBe(1);
      expect(gone.errorMessage).toContain(mode === 'gone' ? '410' : '404');
      // One attempt only: a gone subscription is never retried.
      expect(await receivedBy(sub)).toHaveLength(1);

      const settings = await request.get('/api/me/notification-settings', {
        headers: await as(TESTER),
      });
      const view = (await settings.json()) as { pushDevices: { id: string }[] };
      expect(view.pushDevices.some((d) => d.id === device.id)).toBe(false);

      const audit = await auditEvents(request, device.id);
      const removed = audit.filter((e) => e.action === 'channel.push_device_removed');
      expect(removed).toHaveLength(1);
      expect(removed[0].reason).toContain(mode === 'gone' ? '410' : '404');
    }
  });

  test('a push service that keeps failing is retried with backoff and ends in the dead letter', async ({
    request,
  }) => {
    const sub = mockSubscription('down');
    const device = await registerDevice(request, TESTER, sub, 'Phone behind a failing service');
    try {
      await sendTestPush(request);
      const dead = await waitForDelivery(
        request,
        TESTER,
        device.id,
        (d) => d.status === 'dead_letter',
        60_000,
      );
      // The first attempt and three retries, then the dead letter.
      expect(dead.attempts).toBe(4);
      expect(dead.errorMessage).toContain('503');
      const arrivals = await receivedBy(sub);
      expect(arrivals).toHaveLength(4);
      // Retries back off: each gap is longer than the delay before it started (2 s base).
      const at = arrivals.map((a) => Date.parse(a.at));
      for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(900);

      // The job itself sits in the worker's dead-letter queue, where operators see it.
      await expect
        .poll(
          () =>
            asOwner(async (c) =>
              Number(
                (
                  await c.query<{ n: string }>(
                    `select count(*)::text as n from pgboss.job
                      where name = 'integrity.dead-letter' and data->>'deliveryId' = $1`,
                    [dead.id],
                  )
                ).rows[0].n,
              ),
            ),
          { timeout: 15_000 },
        )
        .toBe(1);
      // The device stays: a failing service is not a gone subscription.
      expect((await deliveriesFor(request, TESTER, device.id)).length).toBe(1);
    } finally {
      await removeDevice(request, TESTER, device.id);
    }
  });

  test('a worker re-run of a sent delivery sends nothing more', async ({ request }) => {
    const sub = mockSubscription('ok');
    const device = await registerDevice(request, TESTER, sub, 'Phone for the re-run');
    try {
      await sendTestPush(request);
      // The device is new, so its only delivery is this test.
      const sent = await waitForDelivery(request, TESTER, device.id, (d) => d.status === 'sent');
      expect(await receivedBy(sub)).toHaveLength(1);
      expect(sub.decrypt((await receivedBy(sub))[0].body)).toMatchObject({
        title: 'BudgetFlow test notification',
        deliveryId: sent.id,
      });

      // Publish the same job again through the outbox, as a redelivery would.
      const tenantId = userById(TESTER).tenantId;
      await asOwner((c) =>
        c.query(
          `insert into outbox_messages (tenant_id, topic, payload) values ($1, 'channels.push.send', $2)`,
          [tenantId, JSON.stringify({ deliveryId: sent.id })],
        ),
      );
      await expect
        .poll(
          () =>
            asOwner(async (c) =>
              Number(
                (
                  await c.query<{ n: string }>(
                    `select count(*)::text as n from pgboss.job
                      where name = 'channels.push.send' and data->>'deliveryId' = $1
                        and state = 'completed'`,
                    [sent.id],
                  )
                ).rows[0].n,
              ),
            ),
          { timeout: 30_000, intervals: [250, 500, 1000] },
        )
        .toBe(2);
      expect(await receivedBy(sub)).toHaveLength(1);
      const after = (await deliveriesFor(request, TESTER, device.id)).find((d) => d.id === sent.id);
      expect(after).toMatchObject({ status: 'sent', attempts: 1 });
    } finally {
      await removeDevice(request, TESTER, device.id);
    }
  });

  test('push needs a registered device and a push service on the allowed list', async ({
    request,
  }) => {
    await expectProblem(
      await request.post('/api/me/notification-settings/test', {
        headers: await mutate('auditor'),
        data: { channel: 'push' },
      }),
      409,
      'PUSH_DEVICE_NOT_REGISTERED',
    );
    await expectProblem(
      await request.post('/api/me/push-devices', {
        headers: await mutate(TESTER),
        data: {
          deviceLabel: 'Somewhere else',
          userAgentFamily: 'Desktop, Chrome',
          endpoint: 'https://push.attacker.example.test/sub/1',
          p256dh: mockSubscription('ok').p256dh,
          authKey: 'AAAAAAAAAAAAAAAAAAAAAA',
        },
      }),
      422,
      'OUTBOUND_HOST_NOT_ALLOWED',
    );

    // Subscribing again from the same browser refreshes it rather than adding a second device.
    const sub = mockSubscription('ok');
    const first = await registerDevice(request, TESTER, sub);
    try {
      const again = await registerDevice(request, TESTER, sub);
      expect(again.id).toBe(first.id);
    } finally {
      await removeDevice(request, TESTER, first.id);
    }
  });
});
