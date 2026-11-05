// Invariant 7 (close): a period closes only when every entity's hard checks pass and every failing
// soft check is acknowledged; closing takes an immutable as-of snapshot per entity; reopening is
// break-glass, needs two different people and is audited; re-closing takes the next snapshot version.
// Runs on a fiscal calendar the scenario creates in the Initech Sandbox tenant, so no other
// scenario's postings are affected.
import { expect, test } from '@playwright/test';
import {
  ClosePeriodDetail,
  ClosePeriodList,
  PeriodSnapshotList,
  ReopenRequest,
} from '@bf/contracts';
import { periodId, SEED } from '@bf/seed';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { check, closeDetail, ledgerCheck, sandboxCalendar, signOffTieOut } from './support';

test.describe.configure({ mode: 'serial' });

test.describe('period close checklist and sign-off', () => {
  test('the checklist refuses a close while a hard check fails and takes snapshots when it passes', async ({
    request,
  }) => {
    const { calendar, entity } = await sandboxCalendar(request, { years: [2026] });
    const period = calendar.fiscalYears[0].periods[0];

    // A brand-new entity has no GL tie-out: the hard check fails and names the entity.
    let detail = await closeDetail(request, period.id);
    expect(detail.entities.map((e) => e.legalEntityId)).toEqual([entity!.id]);
    expect(check(detail, 'gl_tieout_signed_off')).toMatchObject({
      kind: 'hard',
      status: 'fail',
      blocking: true,
    });
    expect(detail.allowedActions).not.toContain('close');
    expect(detail.closeConfirmation).toBe(`CLOSE ${period.label.toUpperCase()}`);

    const blocked = await request.post(`/api/close/periods/${period.id}/close`, {
      headers: await mutate('sandbox-admin'),
      data: { confirmation: detail.closeConfirmation },
    });
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).code).toBe('PERIOD_CLOSE_BLOCKED');

    // A hard check can never be waved through.
    const waved = await request.post(`/api/close/periods/${period.id}/acknowledgements`, {
      headers: await mutate('sandbox-controller'),
      data: {
        legalEntityId: entity!.id,
        code: 'gl_tieout_signed_off',
        reasonCode: 'IMMATERIAL',
        reason: 'Trying to wave a hard check through.',
      },
    });
    expect(waved.status()).toBe(409);
    expect((await waved.json()).code).toBe('CHECK_NOT_ACKNOWLEDGEABLE');

    await signOffTieOut(request, {
      month: period.startDate.slice(0, 7),
      legalEntityId: entity!.id,
    });
    const ledger = await ledgerCheck(request, 'sandbox-admin');
    expect(ledger.status, JSON.stringify(ledger.summary)).toBe('clean');

    detail = await closeDetail(request, period.id);
    expect(check(detail, 'gl_tieout_signed_off').status).toBe('pass');
    expect(check(detail, 'ledger_check_clean').status).toBe('pass');
    expect(check(detail, 'audit_chain_verified').status).toBe('pass');
    expect(detail.blockingReasons).toEqual([]);
    expect(detail.allowedActions).toContain('close');

    // The typed confirmation is exact.
    const mistyped = await request.post(`/api/close/periods/${period.id}/close`, {
      headers: await mutate('sandbox-admin'),
      data: { confirmation: 'close it' },
    });
    expect(mistyped.status()).toBe(422);
    expect((await mistyped.json()).code).toBe('CONFIRMATION_MISMATCH');

    const closed = await expectContract(
      await request.post(`/api/close/periods/${period.id}/close`, {
        headers: await mutate('sandbox-admin'),
        data: { confirmation: detail.closeConfirmation },
      }),
      201,
      ClosePeriodDetail,
    );
    expect(closed.period.status).toBe('closed');
    expect(closed.snapshots).toHaveLength(1);
    expect(closed.snapshots[0]).toMatchObject({ legalEntityId: entity!.id, version: 1 });

    const snapshots = await expectContract(
      await request.get(`/api/close/periods/${period.id}/snapshots`, {
        headers: await as('sandbox-admin'),
      }),
      200,
      PeriodSnapshotList,
    );
    expect(snapshots.items.map((s) => s.version)).toEqual([1]);
  });

  test('a soft check is acknowledged with a reason and stops blocking the close', async ({
    request,
  }) => {
    const novemberId = periodId(1, 2026, 11);
    const before = await closeDetail(request, novemberId, 'finance-controller');
    const soft = before.entities
      .flatMap((e) => e.checks.map((c) => ({ entity: e, check: c })))
      .find((x) => x.check.kind === 'soft' && x.check.status === 'warn')!;
    expect(
      soft,
      'the seed leaves unmatched actuals and accrual proposals in November',
    ).toBeDefined();
    expect(
      soft.check.blocking,
      'a soft check that is not passing blocks until it is accepted',
    ).toBe(true);
    const res = await expectContract(
      await request.post(`/api/close/periods/${novemberId}/acknowledgements`, {
        headers: await mutate('finance-controller'),
        data: {
          legalEntityId: soft.entity.legalEntityId,
          code: soft.check.code,
          reasonCode: 'LATE-RECEIPTS',
          reason: 'Two card lines wait for receipts; they post to November flagged as late.',
        },
      }),
      201,
      ClosePeriodDetail,
    );
    const after = res.entities
      .find((e) => e.legalEntityId === soft.entity.legalEntityId)!
      .checks.find((c) => c.code === soft.check.code)!;
    expect(after.acknowledgement?.reasonCode).toBe('LATE-RECEIPTS');
    expect(after.blocking).toBe(false);
  });

  test('reopening is break-glass: two different people, audited, and the re-close takes version 2', async ({
    request,
  }) => {
    const { calendar, entity } = await sandboxCalendar(request, { years: [2026] });
    const period = calendar.fiscalYears[0].periods[0];
    await signOffTieOut(request, {
      month: period.startDate.slice(0, 7),
      legalEntityId: entity!.id,
    });
    await ledgerCheck(request, 'sandbox-admin');
    const ready = await closeDetail(request, period.id);
    await expectContract(
      await request.post(`/api/close/periods/${period.id}/close`, {
        headers: await mutate('sandbox-admin'),
        data: { confirmation: ready.closeConfirmation },
      }),
      201,
      ClosePeriodDetail,
    );

    // The requester may not decide their own request, whatever their role.
    const selfRequest = await expectContract(
      await request.post(`/api/close/periods/${period.id}/reopen-requests`, {
        headers: await mutate('sandbox-admin'),
        data: {
          action: 'reopen',
          reasonCode: 'AUDIT-ADJUSTMENT',
          reason: 'The auditor asked for an adjustment in the original period.',
        },
      }),
      201,
      ReopenRequest,
    );
    const self = await request.post(`/api/close/reopen-requests/${selfRequest.id}/decision`, {
      headers: await mutate('sandbox-admin'),
      data: { decision: 'approve', reason: 'Approving my own request.' },
    });
    expect(self.status()).toBe(409);
    expect((await self.json()).code).toBe('SAME_PERSON_APPROVAL');

    // One request at a time.
    const second = await request.post(`/api/close/periods/${period.id}/reopen-requests`, {
      headers: await mutate('sandbox-controller'),
      data: { action: 'reopen', reasonCode: 'AUDIT-ADJUSTMENT', reason: 'Another request.' },
    });
    expect(second.status()).toBe(409);
    expect((await second.json()).code).toBe('REOPEN_ALREADY_REQUESTED');

    const declined = await expectContract(
      await request.post(`/api/close/reopen-requests/${selfRequest.id}/decision`, {
        headers: await mutate('sandbox-controller'),
        data: { decision: 'decline', reason: 'The adjustment fits in the next open period.' },
      }),
      201,
      ReopenRequest,
    );
    expect(declined.status).toBe('declined');
    expect((await closeDetail(request, period.id)).period.status).toBe('closed');

    const approvedRequest = await expectContract(
      await request.post(`/api/close/periods/${period.id}/reopen-requests`, {
        headers: await mutate('sandbox-controller'),
        data: {
          action: 'reopen',
          reasonCode: 'ERP-RESTATEMENT',
          reason: 'The source system restated the period.',
        },
      }),
      201,
      ReopenRequest,
    );
    const approved = await expectContract(
      await request.post(`/api/close/reopen-requests/${approvedRequest.id}/decision`, {
        headers: await mutate('sandbox-admin'),
        data: { decision: 'approve', reason: 'Agreed: restate in the original period.' },
      }),
      201,
      ReopenRequest,
    );
    expect(approved.status).toBe('approved');
    const reopened = await closeDetail(request, period.id);
    expect(reopened.period.status).toBe('open');

    // The re-close keeps the original snapshot and adds the next version.
    await signOffTieOut(request, {
      month: period.startDate.slice(0, 7),
      legalEntityId: entity!.id,
    });
    await ledgerCheck(request, 'sandbox-admin');
    const second2 = await closeDetail(request, period.id);
    const reclosed = await expectContract(
      await request.post(`/api/close/periods/${period.id}/close`, {
        headers: await mutate('sandbox-admin'),
        data: { confirmation: second2.closeConfirmation },
      }),
      201,
      ClosePeriodDetail,
    );
    expect(reclosed.snapshots.map((s) => s.version)).toEqual([1, 2]);

    // Locking after reporting, then unlocking, also needs two people.
    const locked = await expectContract(
      await request.post(`/api/close/periods/${period.id}/lock`, {
        headers: await mutate('sandbox-admin'),
        data: {},
      }),
      201,
      ClosePeriodDetail,
    );
    expect(locked.period.status).toBe('locked');
    const unlockRequest = await expectContract(
      await request.post(`/api/close/periods/${period.id}/reopen-requests`, {
        headers: await mutate('sandbox-controller'),
        data: {
          action: 'unlock',
          reasonCode: 'AUDIT-ADJUSTMENT',
          reason: 'The auditor found a misclassification after reporting.',
        },
      }),
      201,
      ReopenRequest,
    );
    const unlocked = await expectContract(
      await request.post(`/api/close/reopen-requests/${unlockRequest.id}/decision`, {
        headers: await mutate('sandbox-admin'),
        data: { decision: 'approve', reason: 'Unlock for the reclassification.' },
      }),
      201,
      ReopenRequest,
    );
    expect(unlocked.status).toBe('approved');
    expect((await closeDetail(request, period.id)).period.status).toBe('closed');
  });

  test('every status change and acknowledgement lands in the audit log with its reason', async ({
    request,
  }) => {
    const { calendar, entity } = await sandboxCalendar(request, { years: [2026] });
    const period = calendar.fiscalYears[0].periods[0];
    await signOffTieOut(request, {
      month: period.startDate.slice(0, 7),
      legalEntityId: entity!.id,
    });
    await ledgerCheck(request, 'sandbox-admin');
    const ready = await closeDetail(request, period.id);
    await request.post(`/api/close/periods/${period.id}/close`, {
      headers: await mutate('sandbox-admin'),
      data: { confirmation: ready.closeConfirmation },
    });
    const res = await request.get(
      `/api/audit/events?resourceType=fiscal_period&resourceId=${period.id}`,
      { headers: await as('sandbox-admin') },
    );
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { items: { action: string; changes: unknown }[] };
    const close = body.items.find((e) => e.action === 'period.close');
    expect(close, 'the close writes exactly one audit entry').toBeDefined();
    expect(body.items.filter((e) => e.action === 'period.close')).toHaveLength(1);
    expect(close!.changes).toMatchObject({
      status: { from: 'open', to: 'closed' },
      snapshotVersion: { to: 1 },
    });
  });

  test('a period list is readable by finance and refused to an employee', async ({ request }) => {
    const list = await expectContract(
      await request.get(`/api/close/periods?fiscalYearId=${SEED.fiscalYears.acmeFy2026}`, {
        headers: await as('finance-controller'),
      }),
      200,
      ClosePeriodList,
    );
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items[0].targetCloseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const forbidden = await request.get('/api/close/periods', { headers: await as('employee') });
    expect(forbidden.status()).toBe(403);
  });
});
