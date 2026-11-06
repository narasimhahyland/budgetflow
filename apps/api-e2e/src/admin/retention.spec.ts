// Data retention and legal holds (screen 111). The invariants this file exists for:
//   * a legal hold beats retention - a held record is never deleted, and the run records which hold
//     kept it;
//   * deleting is irreversible, so it needs a preview, a typed confirmation and `retention.confirm`,
//     and an apply run can never cover more than its preview did;
//   * accounting records and the audit trail are never deleted, whatever the settings say.
// Destructive runs happen in the Initech Sandbox tenant, on analytics events the scenario records
// itself, and the scenario restores the periods and releases its hold afterwards.
import { expect, test } from '@playwright/test';
import { LegalHoldList, RetentionRunList, UpdateRetentionPolicyResult } from '@bf/contracts';
import { userById } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { asAppRole } from '../support/db';
import { expectContract, expectProblem } from '../support/contract';
import {
  activeHold,
  HYLAND,
  recordAnalytics,
  releaseHold,
  reason,
  retentionPolicies,
  retentionPolicy,
  runItem,
  SANDBOX,
  SCENARIO_ROUTE,
  setRetentionPeriod,
  setRetentionPeriodOk,
  startRun,
  startRunOk,
} from './support';

test.describe.configure({ mode: 'serial' });

const ANALYTICS = 'product_analytics';
const DEFAULT_ANALYTICS_DAYS = 25 * 30;

/** How many of this scenario's analytics events are still stored for the given person. */
async function analyticsRemaining(tenantId: string, personId: string): Promise<number> {
  return asAppRole(tenantId, async (c) => {
    const res = await c.query<{ n: string }>(
      `select count(*) as n from product_analytics_events
       where actor_person_id = $1 and properties->>'route' = $2`,
      [personId, SCENARIO_ROUTE],
    );
    return Number(res.rows[0].n);
  });
}

test.describe('retention settings', () => {
  test('accounting records and the audit trail can never be given a period', async ({
    request,
  }) => {
    const policies = await retentionPolicies(request, 'org-admin');
    const ledger = policies.find((p) => p.category === 'ledger_journals');
    const audit = policies.find((p) => p.category === 'audit_log');
    expect(ledger).toMatchObject({ action: 'never', locked: true, periodDays: null });
    expect(audit).toMatchObject({ action: 'never', locked: true, periodDays: null });

    await expectProblem(
      await setRetentionPeriod(request, {
        user: 'org-admin',
        category: 'ledger_journals',
        periodDays: 365,
        reason: reason('try to put a period on the ledger'),
      }),
      409,
      'RETENTION_CATEGORY_LOCKED',
    );
    await expectProblem(
      await setRetentionPeriod(request, {
        user: 'org-admin',
        category: 'audit_log',
        periodDays: 365,
        reason: reason('try to put a period on the audit log'),
      }),
      409,
      'RETENTION_CATEGORY_LOCKED',
    );
  });

  test('every period ships as a provisional default pending finance and legal sign-off', async ({
    request,
  }) => {
    const policies = await retentionPolicies(request, 'auditor');
    expect(policies.length).toBeGreaterThan(5);
    expect(
      policies.every((p) => p.signoffStatus === 'provisional'),
      'no period claims to be an approved legal position',
    ).toBe(true);
    const labels = policies.map((p) => `${p.label}|${p.category}`);
    expect(labels, 'categories are ordered by label then category').toEqual([...labels].sort());
    const evidence = policies.find((p) => p.category === 'financial_evidence');
    expect(evidence?.minimumLabel).toBe('7 years');
    expect(evidence?.periodLabel).toContain('8 years');
  });

  test('a period below the statutory minimum is refused', async ({ request }) => {
    await expectProblem(
      await setRetentionPeriod(request, {
        user: 'sandbox-admin',
        category: 'financial_evidence',
        periodDays: 365,
        reason: reason('one year of receipts'),
        tenant: SANDBOX,
      }),
      422,
      'RETENTION_BELOW_MINIMUM',
    );
  });

  test('shortening a financial category waits for a Finance Controller', async ({ request }) => {
    const before = await retentionPolicy(request, 'financial_records', 'sandbox-admin', SANDBOX);
    const shorter = before.periodDays! - 180;

    const requested = await setRetentionPeriodOk(request, {
      user: 'sandbox-admin',
      category: 'financial_records',
      periodDays: shorter,
      reason: reason('shorten the spending record period'),
      tenant: SANDBOX,
    });
    expect(requested.applied, 'shortening a financial category is not applied on the spot').toBe(
      false,
    );
    expect(requested.periodDays, 'the old period stays in force').toBe(before.periodDays);
    const changeId = requested.pendingChange?.id;
    expect(changeId).toBeTruthy();

    // The requester cannot confirm their own change.
    await expectProblem(
      await request.post(`/api/admin/retention/changes/${changeId}/decision`, {
        headers: await mutate('sandbox-admin', randomUUID(), SANDBOX),
        data: { decision: 'confirm', reason: reason('the requester tries to confirm') },
      }),
      403,
      'FORBIDDEN',
    );

    const confirmed = await expectContract(
      await request.post(`/api/admin/retention/changes/${changeId}/decision`, {
        headers: await mutate('sandbox-controller', randomUUID(), SANDBOX),
        data: { decision: 'confirm', reason: reason('the Finance Controller confirms') },
      }),
      201,
      UpdateRetentionPolicyResult,
    );
    expect(confirmed.applied).toBe(true);
    expect(confirmed.periodDays).toBe(shorter);
    expect(
      (await retentionPolicy(request, 'financial_records', 'sandbox-admin', SANDBOX)).periodDays,
    ).toBe(shorter);

    // Put it back: lengthening needs nobody.
    const restored = await setRetentionPeriodOk(request, {
      user: 'sandbox-admin',
      category: 'financial_records',
      periodDays: before.periodDays,
      reason: reason('restore the default period'),
      tenant: SANDBOX,
    });
    expect(restored.applied, 'a longer period applies straight away').toBe(true);
    expect(restored.periodDays).toBe(before.periodDays);
  });
});

test.describe('legal holds beat retention', () => {
  test('a run that would purge a held record leaves it untouched and records why', async ({
    request,
  }) => {
    const heldPerson = userById('sandbox-controller').personId!;
    // Records this scenario owns: two for the person the hold will cover, two for someone else.
    const freePerson = userById('sandbox-auditor').personId!;
    // A re-run of this scenario may find rows left behind by an earlier failure, so count from where
    // the tenant actually is rather than from zero.
    const heldBefore = await analyticsRemaining(SANDBOX, heldPerson);
    const freeBefore = await analyticsRemaining(SANDBOX, freePerson);
    const held = await recordAnalytics(request, 'sandbox-controller', 2, SANDBOX);
    const free = await recordAnalytics(request, 'sandbox-auditor', 2, SANDBOX);
    const heldTotal = heldBefore + held.count;
    const freeTotal = freeBefore + free.count;
    expect(await analyticsRemaining(SANDBOX, heldPerson)).toBe(heldTotal);
    expect(await analyticsRemaining(SANDBOX, freePerson)).toBe(freeTotal);

    const holdId = await activeHold(request, {
      placedBy: 'sandbox-auditor',
      confirmedBy: 'sandbox-controller',
      scopeKind: 'person',
      scopeRefId: heldPerson,
      reason: reason('employment dispute: keep everything about this person'),
      tenant: SANDBOX,
    });

    try {
      // Everything older than now is in scope, so both sets qualify on the policy alone.
      const zeroed = await setRetentionPeriodOk(request, {
        user: 'sandbox-admin',
        category: ANALYTICS,
        periodDays: 0,
        reason: reason('shorten analytics retention so the scenario has candidates'),
        tenant: SANDBOX,
      });
      expect(zeroed.applied).toBe(true);
      expect(zeroed.periodDays).toBe(0);

      // The preview shows what would go and what a hold keeps; it deletes nothing.
      const preview = await startRunOk(request, {
        user: 'sandbox-admin',
        mode: 'dry_run',
        categories: [ANALYTICS],
        reason: reason('preview the analytics clear-out'),
        tenant: SANDBOX,
      });
      const previewItem = runItem(preview, ANALYTICS);
      expect(previewItem.appliedCount, 'a preview never removes anything').toBe(0);
      expect(previewItem.candidateCount).toBeGreaterThanOrEqual(freeTotal);
      expect(previewItem.skippedHoldCount).toBeGreaterThanOrEqual(heldTotal);
      expect(previewItem.holdIds).toContain(holdId);
      expect(previewItem.note).toContain('hold always beats retention');
      expect(await analyticsRemaining(SANDBOX, heldPerson)).toBe(heldTotal);
      expect(await analyticsRemaining(SANDBOX, freePerson)).toBe(freeTotal);

      // Applying is fenced: no preview, wrong confirmation word, or no `retention.confirm`.
      await expectProblem(
        await startRun(request, {
          user: 'sandbox-controller',
          mode: 'apply',
          categories: [ANALYTICS],
          confirmation: 'DELETE',
          reason: reason('apply without a preview'),
          tenant: SANDBOX,
        }),
        409,
        'RETENTION_DRY_RUN_REQUIRED',
      );
      await expectProblem(
        await startRun(request, {
          user: 'sandbox-controller',
          mode: 'apply',
          categories: [ANALYTICS],
          dryRunId: preview.id,
          confirmation: 'delete please',
          reason: reason('apply with the wrong confirmation'),
          tenant: SANDBOX,
        }),
        422,
        'CONFIRMATION_MISMATCH',
      );
      await expectProblem(
        await startRun(request, {
          user: 'sandbox-admin',
          mode: 'apply',
          categories: [ANALYTICS],
          dryRunId: preview.id,
          confirmation: 'DELETE',
          reason: reason('apply without retention.confirm'),
          tenant: SANDBOX,
        }),
        403,
        'FORBIDDEN',
      );
      // Nothing was deleted by any of the refusals.
      expect(await analyticsRemaining(SANDBOX, heldPerson)).toBe(heldTotal);
      expect(await analyticsRemaining(SANDBOX, freePerson)).toBe(freeTotal);

      // A run can never cover more than its preview did.
      await expectProblem(
        await startRun(request, {
          user: 'sandbox-controller',
          mode: 'apply',
          categories: [ANALYTICS, 'notifications'],
          dryRunId: preview.id,
          confirmation: 'DELETE',
          reason: reason('widen the scope beyond the preview'),
          tenant: SANDBOX,
        }),
        409,
        'RETENTION_SCOPE_WIDENED',
      );

      // The real run: the free records go, the held ones stay, and the report says which hold kept them.
      const applied = await startRunOk(request, {
        user: 'sandbox-controller',
        mode: 'apply',
        categories: [ANALYTICS],
        dryRunId: preview.id,
        confirmation: 'DELETE',
        reason: reason('apply the previewed analytics clear-out'),
        tenant: SANDBOX,
      });
      const appliedItem = runItem(applied, ANALYTICS);
      expect(applied.dryRunId).toBe(preview.id);
      expect(appliedItem.appliedCount).toBeGreaterThanOrEqual(freeTotal);
      expect(appliedItem.skippedHoldCount).toBeGreaterThanOrEqual(heldTotal);
      expect(appliedItem.holdIds).toContain(holdId);

      expect(
        await analyticsRemaining(SANDBOX, freePerson),
        'records with no hold over them are gone',
      ).toBe(0);
      expect(
        await analyticsRemaining(SANDBOX, heldPerson),
        'every held record survived a run that would otherwise have purged it',
      ).toBe(heldTotal);

      // Releasing the hold is what makes them removable - nothing else changed.
      await releaseHold(request, holdId, 'sandbox-auditor', SANDBOX);
      const afterRelease = await startRunOk(request, {
        user: 'sandbox-admin',
        mode: 'dry_run',
        categories: [ANALYTICS],
        reason: reason('preview again once the hold is released'),
        tenant: SANDBOX,
      });
      const releasedItem = runItem(afterRelease, ANALYTICS);
      expect(releasedItem.skippedHoldCount, 'no hold keeps anything now').toBe(0);
      expect(releasedItem.candidateCount).toBeGreaterThanOrEqual(heldTotal);

      const cleanup = await startRunOk(request, {
        user: 'sandbox-controller',
        mode: 'apply',
        categories: [ANALYTICS],
        dryRunId: afterRelease.id,
        confirmation: 'DELETE',
        reason: reason('clear the records the scenario created'),
        tenant: SANDBOX,
      });
      expect(runItem(cleanup, ANALYTICS).appliedCount).toBeGreaterThanOrEqual(heldTotal);
      expect(await analyticsRemaining(SANDBOX, heldPerson)).toBe(0);
    } finally {
      await setRetentionPeriod(request, {
        user: 'sandbox-admin',
        category: ANALYTICS,
        periodDays: DEFAULT_ANALYTICS_DAYS,
        reason: reason('restore the default analytics period'),
        tenant: SANDBOX,
      });
      const holds = await expectContract(
        await request.get('/api/admin/retention/holds?status=active', {
          headers: await as('sandbox-auditor', {}, SANDBOX),
        }),
        200,
        LegalHoldList,
      );
      for (const hold of holds.items)
        await releaseHold(request, hold.id, 'sandbox-auditor', SANDBOX);
    }
  });

  test('a hold needs two different people before it holds anything', async ({ request }) => {
    const placed = await request.post('/api/admin/retention/holds', {
      headers: await mutate('sandbox-auditor', randomUUID(), SANDBOX),
      data: {
        scopeKind: 'date_range',
        scopeRefId: null,
        scopeFrom: '2026-01-01',
        scopeTo: '2026-01-31',
        reason: reason('a hold waiting for its second person'),
      },
    });
    expect(placed.status(), await placed.text()).toBe(201);
    const hold = (await placed.json()) as { id: string; status: string };
    expect(hold.status).toBe('pending_confirmation');

    // The person who placed it cannot confirm it.
    await expectProblem(
      await request.post(`/api/admin/retention/holds/${hold.id}/decision`, {
        headers: await mutate('sandbox-auditor', randomUUID(), SANDBOX),
        data: { decision: 'confirm', reason: reason('the same person confirms') },
      }),
      409,
      'SAME_PERSON_APPROVAL',
    );
    // Nor can someone without `legal_hold.manage`.
    await expectProblem(
      await request.post(`/api/admin/retention/holds/${hold.id}/decision`, {
        headers: await mutate('sandbox-admin', randomUUID(), SANDBOX),
        data: { decision: 'confirm', reason: reason('a finance admin confirms') },
      }),
      403,
      'FORBIDDEN',
    );
    // A hold that is not active cannot be released.
    await expectProblem(
      await request.post(`/api/admin/retention/holds/${hold.id}/decision`, {
        headers: await mutate('sandbox-controller', randomUUID(), SANDBOX),
        data: { decision: 'release', reason: reason('release before confirming') },
      }),
      409,
      'LEGAL_HOLD_NOT_ACTIVE',
    );

    const declined = await request.post(`/api/admin/retention/holds/${hold.id}/decision`, {
      headers: await mutate('sandbox-controller', randomUUID(), SANDBOX),
      data: { decision: 'decline', reason: reason('the controller declines the hold') },
    });
    expect(declined.status(), await declined.text()).toBe(201);
    expect(((await declined.json()) as { status: string }).status).toBe('declined');
  });

  test('a hold scope has to say what it covers', async ({ request }) => {
    await expectProblem(
      await request.post('/api/admin/retention/holds', {
        headers: await mutate('auditor'),
        data: {
          scopeKind: 'person',
          scopeRefId: null,
          scopeFrom: null,
          scopeTo: null,
          reason: reason('a person hold with no person'),
        },
      }),
      422,
      'LEGAL_HOLD_SCOPE_INVALID',
    );
    await expectProblem(
      await request.post('/api/admin/retention/holds', {
        headers: await mutate('auditor'),
        data: {
          scopeKind: 'date_range',
          scopeRefId: null,
          scopeFrom: null,
          scopeTo: null,
          reason: reason('a date-range hold with no dates'),
        },
      }),
      422,
      'LEGAL_HOLD_SCOPE_INVALID',
    );
  });

  test('run reports are append-only and listed newest first', async ({ request }) => {
    const runs = await expectContract(
      await request.get('/api/admin/retention/runs', {
        headers: await as('sandbox-admin', {}, SANDBOX),
      }),
      200,
      RetentionRunList,
    );
    expect(runs.items.length).toBeGreaterThan(0);
    const stamps = runs.items.map((r) => r.startedAt);
    expect(stamps).toEqual([...stamps].sort().reverse());

    const target = runs.items[0];
    const rewrite = await asAppRole(SANDBOX, (c) =>
      c
        .query(`update retention_runs set status = 'failed' where id = $1`, [target.id])
        .then(() => null)
        .catch((e: { message: string }) => e.message),
    );
    // The application role has no UPDATE grant and the table carries the append-only trigger; either
    // answer proves the report cannot be rewritten.
    expect(rewrite, 'a run report cannot be rewritten').toMatch(/append-only|permission denied/);
  });

  test("the seeded hold over Hyland's event is active and visible to the auditor", async ({
    request,
  }) => {
    const holds = await expectContract(
      await request.get('/api/admin/retention/holds', { headers: await as('auditor', {}, HYLAND) }),
      200,
      LegalHoldList,
    );
    const active = holds.items.filter((h) => h.status === 'active');
    expect(active.length).toBeGreaterThan(0);
    expect(active[0].placedByName).toBeTruthy();
    expect(active[0].confirmedByName).toBeTruthy();
    expect(
      active[0].placedByName === active[0].confirmedByName,
      'a hold is never placed and confirmed by the same person',
    ).toBe(false);
  });
});
