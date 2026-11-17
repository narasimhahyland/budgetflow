// Gap B7: connector imports that are applied, not only read and reported. Each goes through the
// same application service, policy check and audit as a person would: the Adaptive Planning plan
// becomes a Draft plan version (posting only once approved and applied), ERP suppliers enter the
// vendor master for review, and calendar responses become RSVPs. Each proves exactly the expected
// records with audit, an idempotent replay, bad rows refused with a reason, and the closed case
// (a closed accounting period for the plan, closed RSVPs for the calendar).
import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  AdaptivePlanImportResult,
  AdaptivePlanPreview,
  ApplyPlanVersionResult,
  EventInvitationView,
  IntegrationMessageList,
  PlanVersionDetail,
  SyncRunList,
  SyncRunView,
  VendorList,
} from '@bf/contracts';
import { SEED, userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { bal } from '../budgets/p4';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { approvedEvent, auditFor, budget, directorTree, usd } from '../support/p5';
import { CONNECTIONS, mockApi, resetMock } from '../support/p12';

const ADAPTIVE = CONNECTIONS.adaptivePlanning;
const FY2026 = SEED.fiscalYears.acmeFy2026;
const FY2027 = SEED.fiscalYears.acmeFy2027;
/** EX-2026 (Employee Experience) and EX-RESERVE (Central Contingency Reserve), the seeded roots. */
const ROOTS = { programs: SEED.budgets.employeeExperience, reserve: SEED.budgets.contingency };

test.beforeEach(async () => {
  await resetMock();
});

async function setPlan(plan: Record<string, unknown>) {
  const mock = await mockApi();
  expect((await mock.post('/_control/adaptive-plan', { data: plan })).ok()).toBe(true);
}

/** A working credential and the two levels mapped onto the seeded roots. */
async function prepareAdaptive(request: APIRequestContext) {
  expect(
    (
      await request.post(`/api/integrations/connections/${ADAPTIVE}/credential`, {
        headers: await mutate('integration-admin'),
        data: { credential: 'mock-adaptive-dev-only-0002' },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await request.put(`/api/integrations/connections/${ADAPTIVE}/mappings`, {
        headers: await mutate('integration-admin'),
        data: {
          entries: [
            {
              kind: 'plan_level',
              externalValue: 'Employee programs',
              internalValue: ROOTS.programs,
            },
            { kind: 'plan_level', externalValue: 'Reserve', internalValue: ROOTS.reserve },
          ],
        },
      })
    ).ok(),
  ).toBe(true);
}

const importPlan = async (
  request: APIRequestContext,
  data: { externalVersion: string; fiscalYearLabel: string },
  key = randomUUID(),
) =>
  request.post(`/api/integrations/connections/${ADAPTIVE}/plan-import`, {
    headers: await mutate('finance-admin', key),
    data,
  });

const planVersions = async (request: APIRequestContext, fiscalYearId: string) =>
  (
    (await (
      await request.get('/api/plan-versions', {
        headers: await as('finance-admin'),
        params: { fiscalYearId },
      })
    ).json()) as { items: { id: string; label: string }[] }
  ).items;

test.describe('Adaptive Planning import, applied through a plan version (094a)', () => {
  test('rows the import cannot apply are refused with their reasons, nothing is created, and the run records why', async ({
    request,
  }) => {
    await prepareAdaptive(request);
    const version = `FY2027 Budget ${randomUUID().slice(0, 6)}`;
    await setPlan({
      version,
      fiscalYear: 'FY2027',
      currency: 'USD',
      levels: [
        { level: 'Employee programs', amount: '120000.00' },
        { level: 'Reserve', amount: '12.345' },
        { level: 'Innovation lab', amount: '15000.00' },
        { level: 'Employee programs', amount: '1.00' },
      ],
    });
    const before = await planVersions(request, FY2027);

    const refused = await expectProblem(
      await importPlan(request, { externalVersion: version, fiscalYearLabel: 'FY2027' }),
      422,
      'PLAN_IMPORT_BLOCKED',
    );
    const paths = (refused.errors ?? []).map((e) => `${e.path}: ${e.message}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^level Reserve: .*not an amount/),
        expect.stringMatching(/^level Innovation lab: .*not mapped/),
        expect.stringMatching(/^level Employee programs: .*appears twice/),
      ]),
    );
    // Nothing was imported: no plan version, and a failed run with the counts.
    expect((await planVersions(request, FY2027)).map((v) => v.id)).toEqual(before.map((v) => v.id));
    const runs = await expectContract(
      await request.get('/api/integrations/sync-runs', {
        headers: await as('integration-admin'),
        params: { connectionId: ADAPTIVE, object: 'plan' },
      }),
      200,
      SyncRunList,
    );
    expect(runs.items[0]).toMatchObject({ status: 'failed', recordsApplied: 0, recordsFailed: 3 });
    expect(runs.items[0].errorSummary).toContain('refused');

    // A plan in another currency, or for a year BudgetFlow does not have, is refused as a whole.
    await setPlan({
      version,
      fiscalYear: 'FY2027',
      currency: 'EUR',
      levels: [{ level: 'Reserve', amount: '1.00' }],
    });
    const eur = await expectProblem(
      await importPlan(request, { externalVersion: version, fiscalYearLabel: 'FY2027' }),
      422,
      'PLAN_IMPORT_BLOCKED',
    );
    expect(eur.detail).toContain('in EUR');
    await setPlan({
      version,
      fiscalYear: 'FY2031',
      currency: 'USD',
      levels: [{ level: 'Reserve', amount: '1.00' }],
    });
    const fy = await expectProblem(
      await importPlan(request, { externalVersion: version, fiscalYearLabel: 'FY2031' }),
      422,
      'PLAN_IMPORT_BLOCKED',
    );
    expect(fy.detail).toContain('FY2031 is not a fiscal year');
  });

  test('a plan for a new year becomes one Draft version, replays post once, and approving and applying it creates exactly those roots', async ({
    request,
  }) => {
    await prepareAdaptive(request);
    const tag = randomUUID().slice(0, 6);
    const version = `FY2027 Budget ${tag}`;
    // Distinct cents per run, so the amounts this scenario asserts are its own.
    const cents = (parseInt(tag, 16) % 90) + 10;
    const programs = 11_000_000 + cents;
    const reserve = 500_000 + cents;
    await setPlan({
      version,
      fiscalYear: 'FY2027',
      currency: 'USD',
      levels: [
        { level: 'Employee programs', amount: `${Math.trunc(programs / 100)}.${cents}` },
        { level: 'Reserve', amount: `${Math.trunc(reserve / 100)}.${cents}` },
      ],
    });
    const preview = await expectContract(
      await request.post(`/api/integrations/connections/${ADAPTIVE}/plan-import/preview`, {
        headers: await mutate('finance-admin'),
        data: { externalVersion: version, fiscalYearLabel: 'FY2027' },
      }),
      200,
      AdaptivePlanPreview,
    );
    expect(preview).toMatchObject({ blocked: false, fiscalYearId: FY2027, refusedRows: [] });
    expect(preview.period).toMatchObject({ late: false, periodStatus: 'open' });
    // Roots of another year are the template for a new year's roots: no floor applies to them.
    expect(preview.lines.map((l) => l.floorAmount)).toEqual([null, null]);

    const key = randomUUID();
    const first = await importPlan(
      request,
      { externalVersion: version, fiscalYearLabel: 'FY2027' },
      key,
    );
    const result = await expectContract(first, 201, AdaptivePlanImportResult);
    expect(result.planVersionStatus).toBe('draft');
    expect(result.planVersionLabel).toBe(`${version} (Adaptive Planning)`);

    // Replaying the same key returns the first result and creates nothing more.
    const replay = await importPlan(
      request,
      { externalVersion: version, fiscalYearLabel: 'FY2027' },
      key,
    );
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    expect((await expectContract(replay, 201, AdaptivePlanImportResult)).planVersionId).toBe(
      result.planVersionId,
    );
    // The same planning version under a new key is refused, so a plan is never doubled.
    await expectProblem(
      await importPlan(request, { externalVersion: version, fiscalYearLabel: 'FY2027' }),
      409,
      'IMPORT_ALREADY_UPLOADED',
    );
    expect(
      (await planVersions(request, FY2027)).filter((v) => v.label === result.planVersionLabel),
    ).toHaveLength(1);

    const draft = await expectContract(
      await request.get(`/api/plan-versions/${result.planVersionId}`, {
        headers: await as('finance-admin'),
      }),
      200,
      PlanVersionDetail,
    );
    const byCode = new Map(draft.lines.map((l) => [l.code, l.amountMinor]));
    expect(byCode.get('EX-2027')).toBe(programs);
    expect(byCode.get('EX-RESERVE-2027')).toBe(reserve);
    // Roots of the year that the plan does not mention are carried over unchanged.
    const audit = await auditFor(request, result.planVersionId);
    // Exactly one audit entry for the import, naming where the plan came from.
    expect(audit.map((a) => a.action)).toEqual(['plan_version.imported']);
    expect(audit[0].changes['externalVersion']?.to).toBe(version);
    expect(audit[0].changes['syncRunId']?.to).toBe(result.syncRunId);
    const run = await expectContract(
      await request.get(`/api/integrations/sync-runs/${result.syncRunId}`, {
        headers: await as('integration-admin'),
      }),
      200,
      SyncRunView,
    );
    expect(run).toMatchObject({
      status: 'succeeded',
      object: 'plan',
      recordsRead: 2,
      recordsApplied: 2,
    });

    // Nothing posts until the version is approved and applied (new money: Finance Admin and CEO,
    // neither the drafter) through the P4 commands.
    await expectProblem(
      await request.post(`/api/plan-versions/${result.planVersionId}/apply`, {
        headers: await mutate('finance-admin'),
      }),
      409,
      'PLAN_VERSION_NOT_EDITABLE',
    );
    // A second Finance Admin approves; when the year already has a controlling version the plan is
    // new money and also needs the CEO.
    let approval = await expectContract(
      await request.post(`/api/plan-versions/${result.planVersionId}/approve`, {
        headers: await mutate('finance-admin-2'),
      }),
      200,
      PlanVersionDetail,
    );
    if (approval.status === 'draft')
      approval = await expectContract(
        await request.post(`/api/plan-versions/${result.planVersionId}/approve`, {
          headers: await mutate('ceo'),
        }),
        200,
        PlanVersionDetail,
      );
    expect(approval.status).toBe('approved');
    const applied = await expectContract(
      await request.post(`/api/plan-versions/${result.planVersionId}/apply`, {
        headers: await mutate('finance-admin'),
      }),
      200,
      ApplyPlanVersionResult,
    );
    const touched = [...applied.createdBudgetIds, ...applied.adjustedBudgetIds];
    const roots = await Promise.all(touched.map((id) => budget(request, id)));
    const programsRoot = roots.find((r) => r.code === 'EX-2027')!;
    const reserveRoot = roots.find((r) => r.code === 'EX-RESERVE-2027')!;
    expect(programsRoot).toMatchObject({
      parentId: null,
      planVersionId: result.planVersionId,
      currency: 'USD',
    });
    expect(reserveRoot).toMatchObject({ parentId: null, planVersionId: result.planVersionId });
    expect(bal(programsRoot).authorized).toBe(programs);
    expect(bal(reserveRoot).authorized).toBe(reserve);
  });

  test('a plan effective in a closed period is flagged late and posts in the open period, never the closed one', async ({
    request,
  }) => {
    await prepareAdaptive(request);
    const version = `FY2026 Reforecast ${randomUUID().slice(0, 6)}`;
    const current = await budget(request, ROOTS.programs);
    const reserve = await budget(request, ROOTS.reserve);
    await setPlan({
      version,
      fiscalYear: 'FY2026',
      currency: 'USD',
      // September 2026 is closed in the seed calendar; November is open.
      effectiveDate: '2026-09-15',
      levels: [
        { level: 'Employee programs', amount: (bal(current).authorized / 100).toFixed(2) },
        { level: 'Reserve', amount: (bal(reserve).authorized / 100).toFixed(2) },
      ],
    });
    const result = await expectContract(
      await importPlan(request, { externalVersion: version, fiscalYearLabel: 'FY2026' }),
      201,
      AdaptivePlanImportResult,
    );
    expect(result.preview.fiscalYearId).toBe(FY2026);
    expect(result.preview.period).toMatchObject({
      effectiveDate: '2026-09-15',
      periodStatus: 'closed',
      late: true,
    });
    expect(result.preview.period!.postsInPeriodLabel).not.toBe(result.preview.period!.periodLabel);
    const run = await expectContract(
      await request.get(`/api/integrations/sync-runs/${result.syncRunId}`, {
        headers: await as('integration-admin'),
      }),
      200,
      SyncRunView,
    );
    expect(run.errorSummary).toContain(`posts in ${result.preview.period!.postsInPeriodLabel}`);
    const audit = await auditFor(request, result.planVersionId);
    const imported = audit.find((a) => a.action === 'plan_version.imported')!;
    expect(imported.changes['postsInPeriod']?.to).toBe(result.preview.period!.postsInPeriodLabel);
    // The draft posts nothing: the roots are unchanged.
    expect(bal(await budget(request, ROOTS.programs)).authorized).toBe(bal(current).authorized);

    // A decrease below what a root already allocated is refused at the floor.
    await setPlan({
      version: `${version} cut`,
      fiscalYear: 'FY2026',
      currency: 'USD',
      levels: [
        { level: 'Employee programs', amount: '1.00' },
        { level: 'Reserve', amount: (bal(reserve).authorized / 100).toFixed(2) },
      ],
    });
    const floor = await expectProblem(
      await importPlan(request, { externalVersion: `${version} cut`, fiscalYearLabel: 'FY2026' }),
      422,
      'PLAN_IMPORT_BLOCKED',
    );
    expect(floor.detail).toContain('cannot drop below');
  });

  test('importing needs root budget authority: the Integration Admin alone is refused', async ({
    request,
  }) => {
    await expectProblem(
      await request.post(`/api/integrations/connections/${ADAPTIVE}/plan-import`, {
        headers: await mutate('integration-admin'),
        data: { externalVersion: 'FY2027 Budget, Approved', fiscalYearLabel: 'FY2027' },
      }),
      403,
      'FORBIDDEN',
    );
  });
});

test.describe('ERP suppliers applied to the vendor master (094, 106c)', () => {
  test('new suppliers wait for review, known ones are linked or skipped, bad rows are refused, and a repeat applies nothing', async ({
    request,
  }) => {
    const sync = async () =>
      expectContract(
        await request.post(`/api/integrations/connections/${CONNECTIONS.erpnext}/sync`, {
          headers: await mutate('integration-admin'),
          data: { object: 'suppliers', direction: 'inbound' },
        }),
        201,
        SyncRunView,
      );
    const first = await sync();
    // Lotus Lane Florists is new; Harbor View Hotel Group is linked by name; Deccan Event Studio is
    // already known by its ERP id; three rows are refused.
    expect(first).toMatchObject({
      status: 'partly_succeeded',
      recordsRead: 6,
      recordsApplied: 2,
      recordsSkippedDuplicate: 1,
      recordsFailed: 3,
    });
    const vendors = async (q: string) =>
      (
        await expectContract(
          await request.get('/api/finance/vendors', {
            headers: await as('finance-admin'),
            params: { q },
          }),
          200,
          VendorList,
        )
      ).items;
    const [lotus] = await vendors('Lotus Lane');
    expect(lotus).toMatchObject({ status: 'unknown', erpVendorId: 'V-20088', country: 'IN' });
    const [harbor] = await vendors('Harbor View');
    expect(harbor).toMatchObject({ erpVendorId: 'V-10155', status: 'unknown' });
    expect(await vendors('Rhine Sound')).toHaveLength(0);
    // Each vendor created or linked has its audit entry, written by the connector.
    expect((await auditFor(request, lotus.id)).map((a) => a.action)).toEqual(['vendor.imported']);
    expect((await auditFor(request, harbor.id)).map((a) => a.action)).toContain('vendor.linked');
    // Refused rows wait in the retry queue with their reasons.
    const queue = await expectContract(
      await request.get('/api/integrations/messages', {
        headers: await as('integration-admin'),
        params: { connectionId: CONNECTIONS.erpnext },
      }),
      200,
      IntegrationMessageList,
    );
    const reasons = queue.items
      .filter((m) => m.item.startsWith('supplier '))
      .map((m) => m.lastError);
    expect(reasons).toEqual(
      expect.arrayContaining([
        'The supplier has no name.',
        'Country "Germany" is not a two-letter ISO 3166 code.',
        'Spice Route Caterers is already linked to ERP id V-20011.',
      ]),
    );

    const second = await sync();
    expect(second).toMatchObject({
      recordsApplied: 0,
      recordsSkippedDuplicate: 3,
      recordsFailed: 3,
    });
    expect(await vendors('Lotus Lane')).toHaveLength(1);
  });
});

test.describe('calendar responses applied to event attendance (097)', () => {
  test('Accepted, Declined and Tentative become RSVPs by the event rules, the last answer wins, and a repeat changes nothing', async ({
    request,
  }) => {
    const employee = userById('employee');
    const analyst = userById('analyst');
    const { team } = await directorTree(request);
    const event = await approvedEvent(request, 'budget-owner', 'department-head', {
      homeBudgetId: team.id,
      estimate: usd(400_000),
      ownFunds: usd(400_000),
      participantPersonIds: [employee.personId!, analyst.personId!],
    });
    await expectContract(
      await request.post(`/api/events/${event.id}/invitations/send`, {
        headers: await mutate('budget-owner'),
        data: {
          message: 'Please answer from your calendar.',
          deadline: '2026-12-01T18:00:00.000Z',
          capacity: 1,
          waitlistEnabled: true,
          autoPromoteWaitlist: true,
        },
      }),
      200,
      EventInvitationView,
    );
    const code = event.eventCode;
    const mock = await mockApi();
    await mock.post('/_control/calendar-responses', {
      data: {
        provider: 'outlook',
        items: [
          {
            id: `${code}-1`,
            eventCode: code,
            attendee: employee.username,
            response: 'accepted',
            at: '2026-11-10T10:00:00Z',
          },
          {
            id: `${code}-2`,
            eventCode: code,
            attendee: analyst.username,
            response: 'accepted',
            at: '2026-11-10T11:00:00Z',
          },
          {
            id: `${code}-3`,
            eventCode: code,
            attendee: employee.username,
            response: 'declined',
            at: '2026-11-11T09:00:00Z',
          },
          // Older than the analyst's Accepted: the last answer wins, so this changes nothing.
          {
            id: `${code}-4`,
            eventCode: code,
            attendee: analyst.username,
            response: 'tentative',
            at: '2026-11-09T08:00:00Z',
          },
          {
            id: `${code}-5`,
            eventCode: code,
            attendee: 'nobody@example.test',
            response: 'accepted',
            at: '2026-11-10T12:00:00Z',
          },
          {
            id: `${code}-6`,
            eventCode: 'EV-0000-NONE',
            attendee: employee.username,
            response: 'accepted',
            at: '2026-11-10T12:00:00Z',
          },
        ],
      },
    });
    const sync = async () =>
      expectContract(
        await request.post(`/api/integrations/connections/${CONNECTIONS.outlook}/sync`, {
          headers: await mutate('integration-admin'),
          data: { object: 'calendar_responses', direction: 'inbound' },
        }),
        201,
        SyncRunView,
      );
    const first = await sync();
    // Employee Going then Can't go; analyst Waitlisted, then promoted to Going when the place freed up.
    expect(first).toMatchObject({
      recordsRead: 6,
      recordsApplied: 3,
      recordsSkippedDuplicate: 1,
      recordsFailed: 2,
    });
    const view = await expectContract(
      await request.get(`/api/events/${event.id}/invitations`, {
        headers: await as('budget-owner'),
      }),
      200,
      EventInvitationView,
    );
    const status = (personId: string) =>
      view.participants.find((p) => p.personId === personId)?.rsvpStatus;
    expect(status(employee.personId!)).toBe('cant_go');
    expect(status(analyst.personId!)).toBe('going');
    expect(view.counts).toMatchObject({ going: 1, cantGo: 1, waitlisted: 0 });
    const rsvps = (await auditFor(request, event.id)).filter(
      (a) => a.action === 'event.rsvp_recorded',
    );
    expect(rsvps).toHaveLength(3);
    expect(rsvps.every((a) => a.changes['channel']?.to === 'outlook')).toBe(true);
    expect(rsvps.some((a) => a.changes['waitlistPromoted'])).toBe(true);

    // The same responses again: nothing is applied twice.
    const second = await sync();
    expect(second).toMatchObject({
      recordsApplied: 0,
      recordsSkippedDuplicate: 4,
      recordsFailed: 2,
    });
    expect(
      (await auditFor(request, event.id)).filter((a) => a.action === 'event.rsvp_recorded'),
    ).toHaveLength(3);

    // Once RSVPs close, a newer calendar answer is refused with the reason, not recorded.
    expect(
      (
        await request.post(`/api/events/${event.id}/invitations/status`, {
          headers: await mutate('budget-owner'),
          data: { status: 'closed' },
        })
      ).status(),
    ).toBe(200);
    await mock.post('/_control/calendar-responses', {
      data: {
        provider: 'outlook',
        items: [
          {
            id: `${code}-7`,
            eventCode: code,
            attendee: employee.username,
            response: 'accepted',
            at: '2026-11-12T09:00:00Z',
          },
        ],
      },
    });
    const closed = await sync();
    expect(closed).toMatchObject({ status: 'failed', recordsApplied: 0, recordsFailed: 1 });
    const queue = await expectContract(
      await request.get('/api/integrations/messages', {
        headers: await as('integration-admin'),
        params: { connectionId: CONNECTIONS.outlook },
      }),
      200,
      IntegrationMessageList,
    );
    expect(queue.items.map((m) => m.lastError)).toContain(
      `RSVPs for ${code} are closed; the answer was not recorded.`,
    );
  });
});
