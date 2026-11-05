// Phase 10 scheduled delivery (screen 091): a schedule runs with its owner's access, every mutation
// is idempotent and leaves exactly one hash-chained audit entry, recipients who cannot see the same
// data are marked and skipped, and channels are limited to the ones the chat installation allows.
import { expect, test } from '@playwright/test';
import {
  AuditEventList,
  ReportExport,
  ReportSchedule,
  ReportScheduleList,
  SavedReportView,
  SavedReportViewList,
  ScheduleRun,
  ScheduleRunList,
} from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { createRoot } from '../support/factory';

const person = (id: Parameters<typeof userById>[0]) => userById(id).personId!;

test.describe('saved views and scheduled report delivery', () => {
  test('a saved view stores filters only and can be listed and deleted', async ({ request }) => {
    const name = `Scenario view ${randomUUID().slice(0, 8)}`;
    const view = await expectContract(
      await request.post('/api/reports/views', {
        headers: await mutate('finance-admin'),
        data: {
          reportId: 'utilization',
          name,
          filters: { rootBudgetId: SEED.budgets.india, groupBy: 'budget' },
          favourite: true,
        },
      }),
      201,
      SavedReportView,
    );
    expect(view.filters).toEqual({ rootBudgetId: SEED.budgets.india, groupBy: 'budget' });
    expect(view.favourite).toBe(true);

    const list = await expectContract(
      await request.get('/api/reports/views', { headers: await as('finance-admin') }),
      200,
      SavedReportViewList,
    );
    expect(list.items.map((v) => v.id)).toContain(view.id);

    const after = await expectContract(
      await request.delete(`/api/reports/views/${view.id}`, {
        headers: await mutate('finance-admin'),
      }),
      200,
      SavedReportViewList,
    );
    expect(after.items.map((v) => v.id)).not.toContain(view.id);
  });

  test('creating a schedule is idempotent and writes exactly one audit entry', async ({
    request,
  }) => {
    const key = randomUUID();
    const data = {
      name: `Scenario schedule ${key.slice(0, 8)}`,
      reportId: 'utilization',
      filters: {},
      formats: ['pdf'],
      frequency: 'weekly',
      weekday: 1,
      sendTime: '08:00',
      timezone: 'Asia/Kolkata',
      recipientPersonIds: [person('finance-controller')],
    };
    const first = await expectContract(
      await request.post('/api/reports/schedules', {
        headers: await mutate('finance-admin', key),
        data,
      }),
      201,
      ReportSchedule,
    );
    const replay = await request.post('/api/reports/schedules', {
      headers: await mutate('finance-admin', key),
      data,
    });
    const second = await expectContract(replay, 201, ReportSchedule);
    expect(second.id).toBe(first.id);
    expect(replay.headers()['idempotent-replayed']).toBe('true');

    expect(first.nextRunAt).not.toBeNull();
    expect(first.recipients[0].hasAccess).toBe(true);
    expect(first.ownerName).toBe(userById('finance-admin').displayName);

    const audit = await expectContract(
      await request.get('/api/audit/events?limit=200', { headers: await as('auditor') }),
      200,
      AuditEventList,
    );
    const entries = audit.items.filter(
      (e) => e.resourceId === first.id && e.action === 'report.schedule_created',
    );
    expect(entries).toHaveLength(1);

    await expectContract(
      await request.delete(`/api/reports/schedules/${first.id}`, {
        headers: await mutate('finance-admin'),
      }),
      200,
      ReportScheduleList,
    );
  });

  test('a recipient who cannot see the scope is marked and never silently included', async ({
    request,
  }) => {
    const root = await createRoot(request, {
      amountMinor: 100_000,
      owner: 'regional-manager',
      name: `Schedule scope root ${randomUUID().slice(0, 6)}`,
    });
    const schedule = await expectContract(
      await request.post('/api/reports/schedules', {
        headers: await mutate('finance-admin'),
        data: {
          name: `Scoped delivery ${randomUUID().slice(0, 8)}`,
          reportId: 'utilization',
          filters: { rootBudgetId: root.id },
          formats: ['pdf'],
          frequency: 'daily_weekdays',
          sendTime: '07:30',
          recipientPersonIds: [person('finance-controller'), person('employee')],
        },
      }),
      201,
      ReportSchedule,
    );
    const byPerson = new Map(schedule.recipients.map((r) => [r.personId, r]));
    expect(byPerson.get(person('finance-controller'))!.hasAccess).toBe(true);
    const outsider = byPerson.get(person('employee'))!;
    expect(outsider.hasAccess).toBe(false);
    expect(outsider.skipReason).toContain('cannot see');

    await expectContract(
      await request.delete(`/api/reports/schedules/${schedule.id}`, {
        headers: await mutate('finance-admin'),
      }),
      200,
      ReportScheduleList,
    );
  });

  test('a schedule needs a recipient or channel, and only allowed channels', async ({
    request,
  }) => {
    const base = {
      reportId: 'utilization',
      filters: {},
      formats: ['pdf'],
      frequency: 'weekly',
      weekday: 1,
      sendTime: '08:00',
    };
    await expectProblem(
      await request.post('/api/reports/schedules', {
        headers: await mutate('finance-admin'),
        data: { ...base, name: 'No delivery' },
      }),
      422,
      'VALIDATION_FAILED',
    );
    await expectProblem(
      await request.post('/api/reports/schedules', {
        headers: await mutate('finance-admin'),
        data: {
          ...base,
          name: 'Channel not allowed',
          channels: [{ provider: 'slack', channel: '#not-allowed' }],
        },
      }),
      422,
      'VALIDATION_FAILED',
    );
    await expectProblem(
      await request.post('/api/reports/schedules', {
        headers: await mutate('finance-admin'),
        data: {
          ...base,
          name: 'Teams not connected',
          channels: [{ provider: 'teams', channel: '#finance-reports' }],
        },
      }),
      422,
      'CHAT_INSTALLATION_NOT_CONNECTED',
    );
  });

  test('an owner schedules their own subtree and nothing wider', async ({ request }) => {
    await expectProblem(
      await request.post('/api/reports/schedules', {
        headers: await mutate('location-manager'),
        data: {
          name: 'Company-wide from an owner',
          reportId: 'utilization',
          filters: {},
          formats: ['csv'],
          frequency: 'weekly',
          weekday: 1,
          sendTime: '08:00',
          recipientPersonIds: [person('location-manager')],
        },
      }),
      422,
      'VALIDATION_FAILED',
    );
    await expectProblem(
      await request.post('/api/reports/schedules', {
        headers: await mutate('employee'),
        data: {
          name: 'Employee schedule',
          reportId: 'utilization',
          filters: {},
          formats: ['csv'],
          frequency: 'weekly',
          weekday: 1,
          sendTime: '08:00',
          recipientPersonIds: [person('employee')],
        },
      }),
      403,
      'FORBIDDEN',
    );
  });

  test('pausing and running a schedule is audited; a run now is queued for the worker', async ({
    request,
  }) => {
    const schedule = await expectContract(
      await request.post('/api/reports/schedules', {
        headers: await mutate('finance-admin'),
        data: {
          name: `Run now ${randomUUID().slice(0, 8)}`,
          reportId: 'unused-expired',
          filters: {},
          formats: ['csv'],
          frequency: 'daily_weekdays',
          sendTime: '07:30',
          recipientPersonIds: [person('finance-controller')],
        },
      }),
      201,
      ReportSchedule,
    );

    const paused = await expectContract(
      await request.patch(`/api/reports/schedules/${schedule.id}`, {
        headers: await mutate('finance-admin'),
        data: { active: false },
      }),
      200,
      ReportSchedule,
    );
    expect(paused.active).toBe(false);
    expect(paused.nextRunAt).toBeNull();

    const resumed = await expectContract(
      await request.patch(`/api/reports/schedules/${schedule.id}`, {
        headers: await mutate('finance-admin'),
        data: { active: true },
      }),
      200,
      ReportSchedule,
    );
    expect(resumed.active).toBe(true);
    expect(resumed.nextRunAt).not.toBeNull();

    const run = await expectContract(
      await request.post(`/api/reports/schedules/${schedule.id}/runs`, {
        headers: await mutate('finance-admin'),
      }),
      202,
      ScheduleRun,
    );
    expect(run.trigger).toBe('manual');

    const runs = await expectContract(
      await request.get(`/api/reports/schedules/${schedule.id}/runs`, {
        headers: await as('finance-admin'),
      }),
      200,
      ScheduleRunList,
    );
    expect(runs.items.map((r) => r.id)).toContain(run.id);

    // The worker delivers asynchronously; the run reaches a terminal state.
    await expect
      .poll(
        async () => {
          const list = await expectContract(
            await request.get(`/api/reports/schedules/${schedule.id}/runs`, {
              headers: await as('finance-admin'),
            }),
            200,
            ScheduleRunList,
          );
          return list.items.find((r) => r.id === run.id)?.status;
        },
        { timeout: 30_000, intervals: [500, 1_000, 2_000] },
      )
      .not.toBe('queued');

    const audit = await expectContract(
      await request.get('/api/audit/events?limit=200', { headers: await as('auditor') }),
      200,
      AuditEventList,
    );
    const actions = audit.items.filter((e) => e.resourceId === schedule.id).map((e) => e.action);
    expect(actions).toContain('report.schedule_paused');
    expect(actions).toContain('report.schedule_resumed');
    expect(actions).toContain('report.schedule_run_requested');
    expect(actions).toContain('report.schedule_delivered');

    await expectContract(
      await request.delete(`/api/reports/schedules/${schedule.id}`, {
        headers: await mutate('finance-admin'),
      }),
      200,
      ReportScheduleList,
    );
  });

  test('an export records what was exported and is audited', async ({ request }) => {
    const exported = await expectContract(
      await request.post('/api/reports/utilization/exports', {
        headers: await mutate('finance-controller'),
        data: { format: 'csv', filters: { rootBudgetId: SEED.budgets.india } },
      }),
      201,
      ReportExport,
    );
    expect(exported.format).toBe('csv');
    expect(exported.status).toBe('ready');
    expect(new Date(exported.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const audit = await expectContract(
      await request.get('/api/audit/events?limit=100', { headers: await as('auditor') }),
      200,
      AuditEventList,
    );
    expect(
      audit.items.filter((e) => e.resourceId === exported.id && e.action === 'report.exported'),
    ).toHaveLength(1);
  });

  test('the seeded schedules of screen 091 are there, with their filters and channels', async ({
    request,
  }) => {
    const list = await expectContract(
      await request.get('/api/reports/schedules', { headers: await as('finance-admin') }),
      200,
      ReportScheduleList,
    );
    const india = list.items.find((s) => s.id === SEED.p10.schedules.indiaUtilizationWeekly)!;
    expect(india.name).toBe('India utilization, weekly');
    expect(india.reportId).toBe('utilization');
    expect(india.filters.rootBudgetId).toBe(SEED.budgets.india);
    expect(india.channels).toEqual([{ provider: 'slack', channel: '#india-leads' }]);
    expect(india.timezone).toBe('Asia/Kolkata');
    expect(india.recipients.every((r) => r.hasAccess)).toBe(true);
  });
});
