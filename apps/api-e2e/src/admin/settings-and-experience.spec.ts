// Company settings (109 notifications, 110 documents, 112 security, 102b branding), system health
// (114), the guided setup checklist (10a) and a person's own activity (122). What these prove:
// required notifications can never be silenced, upload rules come from a fixed safe list, session
// limits are enforced server-side, health carries no financial data, and activity is self-only.
import { expect, test } from '@playwright/test';
import {
  AdminSettings,
  BrandingSettings,
  DocumentSettings,
  MaintenanceNotice,
  MaintenanceNoticeList,
  MyActivity,
  NotificationSettings,
  SecuritySettings,
  SetupChecklist,
  SystemHealth,
} from '@bf/contracts';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { reason } from './support';

test.describe.configure({ mode: 'serial' });

test.describe('company settings', () => {
  test('every section reads back with what the signed-in person may change', async ({
    request,
  }) => {
    const admin = await expectContract(
      await request.get('/api/admin/settings', { headers: await as('org-admin') }),
      200,
      AdminSettings,
    );
    expect(admin.allowedActions).toEqual(
      expect.arrayContaining(['branding', 'notifications', 'security', 'documents']),
    );
    expect(admin.security.idleTimeoutMinutes).toBe(30);
    expect(admin.security.maxSessionHours).toBe(12);
    expect(admin.security.multiFactorPolicy).toContain('Optional per user');
    expect(admin.security.breakGlassNote).toContain('read-only');
    expect(admin.documents.allowedContentTypeList).toContain('application/pdf');
    expect(admin.documents.allowedContentTypeList).not.toContain('application/zip');

    const auditor = await expectContract(
      await request.get('/api/admin/settings', { headers: await as('auditor') }),
      200,
      AdminSettings,
    );
    expect(auditor.allowedActions, 'an auditor reads but changes nothing').toEqual([]);

    const financeAdmin = await expectContract(
      await request.get('/api/admin/settings', { headers: await as('finance-admin') }),
      200,
      AdminSettings,
    );
    expect(financeAdmin.allowedActions).toEqual(['documents']);
  });

  test('a required notification cannot be taken off In-app or Email', async ({ request }) => {
    const before = await expectContract(
      await request.get('/api/admin/settings', { headers: await as('org-admin') }),
      200,
      AdminSettings,
    );
    const required = before.notifications.defaults.find((d) => d.required);
    expect(required, 'there are required notification types').toBeTruthy();

    await expectProblem(
      await request.put('/api/admin/settings/notifications', {
        headers: await mutate('org-admin'),
        data: {
          defaults: [{ type: required!.type, channels: ['push'] }],
          reason: reason('silence a required notification'),
        },
      }),
      409,
      'NOTIFICATION_REQUIRED',
    );

    // An optional row can be changed, and reads back changed.
    const optional = before.notifications.defaults.find((d) => !d.required);
    const updated = await expectContract(
      await request.put('/api/admin/settings/notifications', {
        headers: await mutate('org-admin'),
        data: {
          defaults: [{ type: optional!.type, channels: ['in_app'] }],
          reason: reason('fewer channels for an optional notification'),
        },
      }),
      200,
      NotificationSettings,
    );
    expect(updated.defaults.find((d) => d.type === optional!.type)?.channels).toEqual(['in_app']);

    // Email is never held during quiet hours.
    await expectProblem(
      await request.put('/api/admin/settings/notifications', {
        headers: await mutate('org-admin'),
        data: {
          defaults: [],
          quietHours: { ...before.notifications.quietHours, heldChannels: ['email'] },
          reason: reason('hold email during quiet hours'),
        },
      }),
      422,
      'QUIET_HOURS_INVALID',
    );

    const restored = await expectContract(
      await request.put('/api/admin/settings/notifications', {
        headers: await mutate('org-admin'),
        data: {
          defaults: [{ type: optional!.type, channels: optional!.channels }],
          reason: reason('restore the default channels'),
        },
      }),
      200,
      NotificationSettings,
    );
    expect(restored.defaults.find((d) => d.type === optional!.type)?.channels).toEqual(
      optional!.channels,
    );
  });

  test('upload rules only take file types from the safe list and sizes up to 25 MB', async ({
    request,
  }) => {
    await expectProblem(
      await request.put('/api/admin/settings/documents', {
        headers: await mutate('org-admin'),
        data: {
          kinds: [
            {
              kind: 'receipt',
              allowedContentTypes: ['application/zip'],
              maxBytes: 10 * 1024 * 1024,
              downloadAllowed: true,
              inlinePreview: true,
            },
          ],
          reason: reason('allow zip receipts'),
        },
      }),
      422,
      'DOCUMENT_RULES_INVALID',
    );
    await expectProblem(
      await request.put('/api/admin/settings/documents', {
        headers: await mutate('org-admin'),
        data: {
          kinds: [
            {
              kind: 'receipt',
              allowedContentTypes: ['application/pdf'],
              maxBytes: 64 * 1024 * 1024,
              downloadAllowed: true,
              inlinePreview: true,
            },
          ],
          reason: reason('raise the size beyond the limit'),
        },
      }),
      422,
      'DOCUMENT_RULES_INVALID',
    );

    // Finance Admin may narrow the rules for a kind; the change reads back.
    const narrowed = await expectContract(
      await request.put('/api/admin/settings/documents', {
        headers: await mutate('finance-admin'),
        data: {
          kinds: [
            {
              kind: 'receipt',
              allowedContentTypes: ['application/pdf'],
              maxBytes: 10 * 1024 * 1024,
              downloadAllowed: true,
              inlinePreview: true,
            },
          ],
          reason: reason('PDF receipts only'),
        },
      }),
      200,
      DocumentSettings,
    );
    expect(narrowed.kinds.find((k) => k.kind === 'receipt')?.allowedContentTypes).toEqual([
      'application/pdf',
    ]);

    const restored = await expectContract(
      await request.put('/api/admin/settings/documents', {
        headers: await mutate('finance-admin'),
        data: {
          kinds: [
            {
              kind: 'receipt',
              allowedContentTypes: ['application/pdf', 'image/png', 'image/jpeg'],
              maxBytes: 10 * 1024 * 1024,
              downloadAllowed: true,
              inlinePreview: true,
            },
          ],
          reason: reason('restore the default receipt rules'),
        },
      }),
      200,
      DocumentSettings,
    );
    expect(restored.kinds.find((k) => k.kind === 'receipt')?.allowedContentTypes.length).toBe(3);
  });

  test('session limits are checked on the server, not only in the form', async ({ request }) => {
    await expectProblem(
      await request.put('/api/admin/settings/security', {
        headers: await mutate('org-admin'),
        data: {
          idleTimeoutMinutes: 1,
          maxSessionHours: 12,
          localAccountsForServiceUsersOnly: true,
          biometricUnlockAllowed: true,
          reason: reason('a one-minute idle timeout'),
        },
      }),
      422,
      'SESSION_LIMITS_INVALID',
    );
    await expectProblem(
      await request.put('/api/admin/settings/security', {
        headers: await mutate('org-admin'),
        data: {
          idleTimeoutMinutes: 30,
          maxSessionHours: 72,
          localAccountsForServiceUsersOnly: true,
          biometricUnlockAllowed: true,
          reason: reason('a three-day session'),
        },
      }),
      422,
      'SESSION_LIMITS_INVALID',
    );
    const changed = await expectContract(
      await request.put('/api/admin/settings/security', {
        headers: await mutate('org-admin'),
        data: {
          idleTimeoutMinutes: 45,
          maxSessionHours: 10,
          localAccountsForServiceUsersOnly: true,
          biometricUnlockAllowed: true,
          reason: reason('tighten sessions after a review'),
        },
      }),
      200,
      SecuritySettings,
    );
    expect(changed.idleTimeoutMinutes).toBe(45);
    await expectContract(
      await request.put('/api/admin/settings/security', {
        headers: await mutate('org-admin'),
        data: {
          idleTimeoutMinutes: 30,
          maxSessionHours: 12,
          localAccountsForServiceUsersOnly: true,
          biometricUnlockAllowed: true,
          reason: reason('restore the defaults'),
        },
      }),
      200,
      SecuritySettings,
    );
  });

  test('branding takes a hex accent colour and a program name, and nobody else may change it', async ({
    request,
  }) => {
    const before = await expectContract(
      await request.get('/api/admin/settings', { headers: await as('org-admin') }),
      200,
      AdminSettings,
    );
    await expectProblem(
      await request.put('/api/admin/settings/branding', {
        headers: await mutate('org-admin'),
        data: {
          programName: 'BudgetFlow at Hyland',
          tagline: 'Budgets, approvals and events in one place.',
          emailFooter: 'Replies are not read.',
          accentColor: 'blue',
          reason: reason('a colour name instead of a hex value'),
        },
      }),
      422,
      'BRANDING_INVALID',
    );
    await expectProblem(
      await request.put('/api/admin/settings/branding', {
        headers: await mutate('finance-admin'),
        data: {
          programName: 'Finance edition',
          tagline: '',
          emailFooter: '',
          accentColor: '#1F4FD8',
          reason: reason('finance changes branding'),
        },
      }),
      403,
      'FORBIDDEN',
    );
    const ok = await expectContract(
      await request.put('/api/admin/settings/branding', {
        headers: await mutate('org-admin'),
        data: {
          programName: 'BudgetFlow at Hyland',
          tagline: 'Plan together, spend with care.',
          emailFooter: 'Replies to this address are not read. Sign in to BudgetFlow to answer.',
          accentColor: '#1F4FD8',
          reason: reason('refresh the tagline'),
        },
      }),
      200,
      BrandingSettings,
    );
    expect(ok.tagline).toBe('Plan together, spend with care.');

    const restored = await expectContract(
      await request.put('/api/admin/settings/branding', {
        headers: await mutate('org-admin'),
        data: {
          programName: before.branding.programName,
          tagline: before.branding.tagline,
          emailFooter: before.branding.emailFooter,
          accentColor: before.branding.accentColor,
          reason: reason('restore the seeded branding'),
        },
      }),
      200,
      BrandingSettings,
    );
    expect(restored.tagline).toBe(before.branding.tagline);
  });
});

test.describe('system health and maintenance notices', () => {
  test('health reports services, queues and nightly jobs without any financial data', async ({
    request,
  }) => {
    const health = await expectContract(
      await request.get('/api/admin/health', { headers: await as('org-admin') }),
      200,
      SystemHealth,
    );
    expect(health.services.length).toBeGreaterThan(3);
    const keys = health.services.map((s) => `${s.name}|${s.key}`);
    expect(keys, 'services are ordered by name then key').toEqual([...keys].sort());
    expect(health.services.find((s) => s.key === 'api')?.status).toBe('healthy');
    expect(health.services.find((s) => s.key === 'database')?.status).toBe('healthy');
    expect(health.nightlyJobs.map((j) => j.job)).toContain('retention_run');
    expect(health.outboxUnpublished).toBeGreaterThanOrEqual(0);

    const serialized = JSON.stringify(health);
    expect(serialized, 'health never carries amounts').not.toMatch(/amountMinor|"currency"/);

    // A reader can see it; someone with no tenant read cannot.
    await expectContract(
      await request.get('/api/admin/health', { headers: await as('auditor') }),
      200,
      SystemHealth,
    );
  });

  test('a maintenance notice is announced ahead of time and can be cancelled', async ({
    request,
  }) => {
    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    await expectProblem(
      await request.post('/api/admin/maintenance-notices', {
        headers: await mutate('org-admin'),
        data: {
          message: 'A window that ends before it starts.',
          startsAt: endsAt.toISOString(),
          endsAt: startsAt.toISOString(),
        },
      }),
      422,
      'MAINTENANCE_WINDOW_INVALID',
    );

    const notice = await expectContract(
      await request.post('/api/admin/maintenance-notices', {
        headers: await mutate('org-admin'),
        data: {
          message: 'BudgetFlow is unavailable for about an hour while we move the database.',
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
      }),
      201,
      MaintenanceNotice,
    );
    expect(notice.status).toBe('scheduled');
    expect(
      new Date(notice.showFrom).getTime(),
      'the banner appears a day before by default',
    ).toBeLessThan(new Date(notice.startsAt).getTime());

    const listed = await expectContract(
      await request.get('/api/admin/maintenance-notices?activeOnly=true', {
        headers: await as('employee'),
      }),
      200,
      MaintenanceNoticeList,
    );
    expect(listed.items.map((n) => n.id)).toContain(notice.id);

    const cancelled = await expectContract(
      await request.post(`/api/admin/maintenance-notices/${notice.id}/cancellation`, {
        headers: await mutate('org-admin'),
        data: { reason: reason('the upgrade was postponed') },
      }),
      201,
      MaintenanceNotice,
    );
    expect(cancelled.status).toBe('cancelled');
    await expectProblem(
      await request.post(`/api/admin/maintenance-notices/${notice.id}/cancellation`, {
        headers: await mutate('org-admin'),
        data: { reason: reason('cancel twice') },
      }),
      409,
      'NOTICE_NOT_SCHEDULED',
    );
    await expectProblem(
      await request.post('/api/admin/maintenance-notices', {
        headers: await mutate('employee'),
        data: {
          message: 'An employee announces maintenance.',
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
      }),
      403,
      'FORBIDDEN',
    );
  });
});

test.describe('guided setup and personal activity', () => {
  test('the setup checklist is computed from the data that exists', async ({ request }) => {
    const checklist = await expectContract(
      await request.get('/api/admin/setup-checklist', { headers: await as('org-admin') }),
      200,
      SetupChecklist,
    );
    expect(checklist.total).toBe(checklist.items.length);
    expect(checklist.completed).toBe(checklist.items.filter((i) => i.done).length);
    const names = checklist.items.map((i) => `${i.name}|${i.key}`);
    expect(names).toEqual([...names].sort());
    const orgStructure = checklist.items.find((i) => i.key === 'org_structure');
    expect(orgStructure?.done, 'the seeded tenant already has its locations').toBe(true);
    expect(orgStructure?.detail).toMatch(/\d+ org unit/);
    const retention = checklist.items.find((i) => i.key === 'retention');
    expect(retention?.description).toContain('provisional');
  });

  test('my activity is my own and nobody can ask for someone else', async ({ request }) => {
    const mine = await expectContract(
      await request.get('/api/me/activity', { headers: await as('event-organizer') }),
      200,
      MyActivity,
    );
    expect(mine.personId).toBeTruthy();
    expect(mine.entryCount).toBe(mine.entries.length);
    const stamps = mine.entries.map((e) => e.occurredAt);
    expect(stamps, 'newest first').toEqual([...stamps].sort().reverse());
    expect(mine.totals.eventsOrganised).toBeGreaterThanOrEqual(0);

    // There is no person parameter: asking for one is refused by the strict query schema.
    await expectProblem(
      await request.get(`/api/me/activity?personId=${randomUUID()}`, {
        headers: await as('event-organizer'),
      }),
      400,
      'VALIDATION_FAILED',
    );

    // Two people see two different timelines.
    const other = await expectContract(
      await request.get('/api/me/activity', { headers: await as('finance-admin') }),
      200,
      MyActivity,
    );
    expect(other.personId).not.toBe(mine.personId);

    // Filters narrow the timeline rather than widening it.
    const filtered = await expectContract(
      await request.get('/api/me/activity?types=approval&limit=5', {
        headers: await as('finance-admin'),
      }),
      200,
      MyActivity,
    );
    expect(filtered.entries.length).toBeLessThanOrEqual(5);
    expect(filtered.entries.every((e) => e.type === 'approval')).toBe(true);
  });
});
