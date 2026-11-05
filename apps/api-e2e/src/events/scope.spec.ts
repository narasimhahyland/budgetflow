// Scope for Phase 5 (invariants 17 and 18): people see events they organize, attend or fund, and requests
// they raised or may read through budget scope; an employee requests only from their own location's
// budget and never sees its totals; Director A does not see Director B's requests; other tenants see
// nothing even with a forged X-Tenant-Id.
import { expect, test } from '@playwright/test';
import {
  CofundingBoard,
  EventDetail,
  RequestableBudgetList,
  RequestDetail,
  RoutePreview,
} from '@bf/contracts';
import { P5_IDS, SEED } from '@bf/seed';
import { as } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { createEvent, directorTree, fundedChild, spendingRequest, usd } from '../support/p5';

test.describe('Phase 5 scope', () => {
  test('an employee requests only from their own location’s budget and never sees its totals', async ({
    request,
  }) => {
    const list = await expectContract(
      await request.get('/api/requests/requestable-budgets', { headers: await as('employee') }),
      200,
      RequestableBudgetList,
    );
    // Their location's budget (scenarios may add more at the same location), nothing elsewhere, no totals.
    const ids = list.items.map((b) => b.budgetId);
    expect(ids).toContain(SEED.budgets.hyderabad);
    for (const elsewhere of [
      SEED.budgets.bengaluru,
      SEED.budgets.india,
      SEED.budgets.europe,
      SEED.budgets.employeeExperience,
    ])
      expect(ids).not.toContain(elsewhere);
    expect(list.items.every((b) => b.available === null)).toBe(true);
    const { team } = await directorTree(request);
    // Outside their scope: not found. Inside it, the (side-effect free) route preview is allowed.
    await expectProblem(
      await spendingRequest(request, 'employee', team.id, usd(1_000)),
      404,
      'NOT_FOUND',
    );
    const q = (budgetId: string) =>
      `/api/requests/route-preview?budgetId=${budgetId}&amountMinor=50000&currency=INR&spendType=team_lunch`;
    const preview = await expectContract(
      await request.get(q(SEED.budgets.hyderabad), { headers: await as('employee') }),
      200,
      RoutePreview,
    );
    expect(preview.impact.budgetId).toBe(SEED.budgets.hyderabad);
    expect((await request.get(q(team.id), { headers: await as('employee') })).status()).toBe(404);
  });

  test('events are visible to organizers, participants, funders and finance only', async ({
    request,
  }) => {
    const seeded = P5_IDS.event;
    expect(
      (await request.get(`/api/events/${seeded}`, { headers: await as('employee') })).status(),
    ).toBe(200);
    expect(
      (await request.get(`/api/events/${seeded}`, { headers: await as('analyst') })).status(),
    ).toBe(200);
    expect(
      (
        await request.get(`/api/events/${seeded}`, { headers: await as('integration-admin') })
      ).status(),
    ).toBe(404);
    expect(
      (await request.get(`/api/events/${seeded}`, { headers: await as('budget-owner') })).status(),
    ).toBe(404);
    expect(
      (await request.get(`/api/events/${seeded}`, { headers: await as('globex-admin') })).status(),
    ).toBe(404);
    const forged = await request.get('/api/events', {
      headers: await as('budget-owner', {}, SEED.tenants.globex),
    });
    expect(forged.status()).toBe(403);

    const { team } = await directorTree(request);
    const e = await createEvent(request, 'budget-owner', {
      homeBudgetId: team.id,
      ownFunds: usd(100_000),
    });
    expect(
      (await request.get(`/api/events/${e.id}`, { headers: await as('employee') })).status(),
    ).toBe(404);
    // Lena owns the department above the event's home budget: she may read it.
    expect(
      (await request.get(`/api/events/${e.id}`, { headers: await as('department-head') })).status(),
    ).toBe(200);
  });

  test('the co-funding board shows contributors’ amounts, never their balances', async ({
    request,
  }) => {
    const board = await expectContract(
      await request.get('/api/events/cofunding-board', { headers: await as('regional-manager') }),
      200,
      CofundingBoard,
    );
    const diwali = board.events.find((e) => e.id === P5_IDS.event)!;
    expect(diwali.contributions.map((c) => c.status).sort()).toEqual([
      'earmarked',
      'earmarked',
      'pending_approval',
    ]);
    expect(Object.keys(diwali.contributions[0]).sort()).toEqual(
      [
        'approved',
        'giverBudgetName',
        'giverOwnerName',
        'id',
        'mode',
        'ref',
        'requested',
        'status',
        'updatedAt',
      ].sort(),
    );
    const outsider = await expectContract(
      await request.get('/api/events/cofunding-board', { headers: await as('budget-owner') }),
      200,
      CofundingBoard,
    );
    expect(outsider.events.find((e) => e.id === P5_IDS.event)).toBeUndefined();
  });

  test('Director A does not see Director B’s requests; the seeded event detail stays consistent', async ({
    request,
  }) => {
    const { root } = await directorTree(request);
    const jordans = await fundedChild(request, root.id, {
      owner: 'budget-owner',
      amountMinor: 1_000_000,
    });
    const r = await expectContract(
      await spendingRequest(request, 'budget-owner', jordans.id, usd(10_000)),
      201,
      RequestDetail,
    );
    expect(
      (
        await request.get(`/api/requests/${r.id}`, { headers: await as('department-head') })
      ).status(),
    ).toBe(404);
    expect(
      (await request.get(`/api/requests/${r.id}`, { headers: await as('ceo') })).status(),
    ).toBe(200);

    const seeded = await expectContract(
      await request.get(`/api/events/${P5_IDS.event}`, { headers: await as('event-organizer') }),
      200,
      EventDetail,
    );
    expect(seeded.sources.map((s) => s.kind)).toEqual(['own', 'contribution', 'contribution']);
    const funded = seeded.sources.reduce((a, s) => a + s.funded.amountMinor, 0);
    expect(seeded.funding.cap.amountMinor).toBe(funded);
    expect(seeded.allowedActions).toContain('commit');
  });
});
