// Notifications, preferences, push devices and role-based digests (123, 059c, 064a). People choose how
// they hear about things, but never whether they hear about an approval assigned to them: the required
// rows stay on, and personal quiet hours may only extend the company default, never shorten it. Every
// push device registration is audited, and a digest renders inside the recipient's own scope.
import { expect, test } from '@playwright/test';
import {
  DecisionResponse,
  DigestPreviewResponse,
  DigestTemplateList,
  DigestTemplateView,
  MarkNotificationsResponse,
  NotificationsFeed,
  NotificationSettingsView,
  PushDevice,
  RequestDetail,
  TestChannelResponse,
} from '@bf/contracts';
import { userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { auditEvents, patchSettings, settings } from '../support/p8';
import {
  auditFor,
  directorTree,
  getRequest,
  spendingRequest,
  taskOf,
  usd,
  waitForMail,
} from '../support/p5';

test.describe('notifications, preferences and push devices', () => {
  test('the feed separates notifications from the tasks that still need a decision', async ({
    request,
  }) => {
    const feed = await expectContract(
      await request.get('/api/notifications', { headers: await as('location-manager') }),
      200,
      NotificationsFeed,
    );
    expect(feed.items.length).toBeGreaterThan(0);
    expect(feed.tasks.length).toBeGreaterThan(0);
    expect(feed.counts.unread).toBeGreaterThan(0);

    const first = feed.items[0];
    const marked = await expectContract(
      await request.post('/api/notifications/mark', {
        headers: await mutate('location-manager'),
        data: { ids: [first.id], read: true },
      }),
      200,
      MarkNotificationsResponse,
    );
    expect(marked.updated).toBe(1);
    expect(marked.unreadCount).toBe(feed.counts.unread - 1);

    // Put it back so the seeded counts the visual baselines use stay stable.
    await request.post('/api/notifications/mark', {
      headers: await mutate('location-manager'),
      data: { ids: [first.id], read: false },
    });

    // One person's feed is their own: Rahul's notifications never show up for Ananya.
    const other = await expectContract(
      await request.get('/api/notifications?limit=100', {
        headers: await as('regional-manager'),
      }),
      200,
      NotificationsFeed,
    );
    expect(other.items.some((i) => i.id === first.id)).toBe(false);
  });

  test('required alerts cannot be switched off and quiet hours may only be extended', async ({
    request,
  }) => {
    const before = await expectContract(
      await settings(request, 'regional-manager'),
      200,
      NotificationSettingsView,
    );
    const assigned = before.matrix.find((r) => r.type === 'approval.assigned');
    expect(assigned).toMatchObject({ required: true, inApp: true, email: true });
    expect(before.quietHours).toMatchObject({
      companyDefaultStart: '20:00',
      companyDefaultEnd: '08:00',
    });

    for (const off of [{ email: false }, { inApp: false }]) {
      await expectProblem(
        await patchSettings(request, 'regional-manager', {
          matrixRow: { type: 'approval.assigned', ...off },
        }),
        422,
        'NOTIFICATION_REQUIRED',
      );
    }

    // Starting later or ending earlier than the company default would mean more noise, not less.
    for (const bad of [
      { start: '22:00', end: '07:00' },
      { start: '21:00' },
      { end: '07:30' },
    ]) {
      await expectProblem(
        await patchSettings(request, 'regional-manager', { quietHours: bad }),
        422,
        'QUIET_HOURS_INVALID',
      );
    }

    const updated = await expectContract(
      await patchSettings(request, 'regional-manager', {
        matrixRow: { type: 'approval.reminder', slack: true },
        quietHours: { start: '19:00', end: '08:30' },
      }),
      200,
      NotificationSettingsView,
    );
    expect(updated.quietHours).toMatchObject({ start: '19:00', end: '08:30' });
    expect(updated.matrix.find((r) => r.type === 'approval.reminder')?.slack).toBe(true);

    // Put the defaults back for the next run and the visual baselines.
    await expectContract(
      await patchSettings(request, 'regional-manager', {
        matrixRow: { type: 'approval.reminder', slack: false },
        quietHours: { start: '20:00', end: '08:00' },
      }),
      200,
      NotificationSettingsView,
    );
  });

  test('registering and removing a push device is audited', async ({ request }) => {
    const endpoint = `https://push.budgetflow.example.test/sub/${randomUUID()}`;
    const device = await expectContract(
      await request.post('/api/me/push-devices', {
        headers: await mutate('regional-manager'),
        data: {
          deviceLabel: 'Pixel 9, Chrome',
          userAgentFamily: 'Android, Chrome',
          endpoint,
          p256dh: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFg',
          authKey: 'UUQM145_auth_test',
        },
      }),
      201,
      PushDevice,
    );
    expect(device.deviceLabel).toBe('Pixel 9, Chrome');

    const withDevice = await expectContract(
      await settings(request, 'regional-manager'),
      200,
      NotificationSettingsView,
    );
    expect(withDevice.pushDevices.some((d) => d.id === device.id)).toBe(true);

    const added = await auditEvents(request, device.id);
    expect(added.map((a) => a.action)).toContain('channel.push_device_added');
    expect(added[0].changes['deviceLabel']?.to).toBe('Pixel 9, Chrome');

    await request.delete(`/api/me/push-devices/${device.id}`, {
      headers: await mutate('regional-manager'),
    });
    const after = await expectContract(
      await settings(request, 'regional-manager'),
      200,
      NotificationSettingsView,
    );
    expect(after.pushDevices.some((d) => d.id === device.id)).toBe(false);
    expect((await auditEvents(request, device.id)).map((a) => a.action)).toContain(
      'channel.push_device_removed',
    );
  });

  test('a decision taken on the phone is audited as the mobile channel', async ({ request }) => {
    const { team } = await directorTree(request);
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', team.id, usd(55_000)),
      201,
      RequestDetail,
    );
    const taskId = await taskOf(request, 'department-head', 'request', r.id);
    const decided = await expectContract(
      await request.post(`/api/approvals/tasks/${taskId}/decision`, {
        headers: await mutate('department-head'),
        data: { decision: 'approve', noConflictAttested: true, channel: 'mobile' },
      }),
      200,
      DecisionResponse,
    );
    expect(decided.subjectStatus).toBe('approved');
    expect(
      (await auditFor(request, r.id)).find((a) => a.action === 'request.approved')?.changes[
        'channel'
      ]?.to,
    ).toBe('mobile');
    expect((await getRequest(request, 'budget-owner', r.id)).route?.steps[0].channel).toBe(
      'mobile',
    );
  });
});

test.describe('role-based digest templates', () => {
  test('a digest renders inside the recipient\u2019s own scope and publishing bumps the version', async ({
    request,
  }) => {
    const list = await expectContract(
      await request.get('/api/digests/templates', { headers: await as('finance-admin') }),
      200,
      DigestTemplateList,
    );
    expect(list.canManage).toBe(true);
    expect(list.items.map((d) => d.code)).toEqual(
      expect.arrayContaining([
        'APPROVER_DAILY',
        'OWNER_WEEKLY',
        'ORGANIZER_WEEKLY',
        'FINANCE_WEEKLY',
        'EXECUTIVE_WEEKLY',
      ]),
    );

    const ownerWeekly = list.items.find((d) => d.code === 'OWNER_WEEKLY')!;
    const preview = await expectContract(
      await request.get(
        `/api/digests/templates/${ownerWeekly.id}/preview?personId=${userById('location-manager').personId}`,
        { headers: await as('finance-admin') },
      ),
      200,
      DigestPreviewResponse,
    );
    expect(preview.recipientName).toBe('Rahul Menon');
    expect(preview.emailText).toContain("Available under this budget's rules");
    expect(preview.slackBlockKit['blocks']).toBeTruthy();
    expect(preview.teamsAdaptiveCard['version']).toBe('1.5');

    const published = await expectContract(
      await request.patch(`/api/digests/templates/${ownerWeekly.id}`, {
        headers: await mutate('finance-admin'),
        data: { introLine: ownerWeekly.introLine, publish: true },
      }),
      200,
      DigestTemplateView,
    );
    expect(published.version).toBeGreaterThan(ownerWeekly.version);
    expect(published.status).toBe('published');

    const sent = await expectContract(
      await request.post(`/api/digests/templates/${ownerWeekly.id}/test`, {
        headers: await mutate('finance-admin'),
        data: { channel: 'email' },
      }),
      200,
      TestChannelResponse,
    );
    expect(sent.status).toBe('sent');
    await waitForMail('finance.admin@example.test', 'Owner weekly digest');
  });

  test('only people who may manage notifications can change a digest template', async ({
    request,
  }) => {
    const list = await expectContract(
      await request.get('/api/digests/templates', { headers: await as('budget-owner') }),
      200,
      DigestTemplateList,
    );
    expect(list.canManage).toBe(false);
    await expectProblem(
      await request.patch(`/api/digests/templates/${list.items[0].id}`, {
        headers: await mutate('budget-owner'),
        data: { introLine: 'Rewritten by somebody who should not.' },
      }),
      403,
      'FORBIDDEN',
    );
  });
});
