// Invariant 14 (P6): an event cannot close while actuals with its event code are unmatched, a cross-entity
// contribution lacks its recharge, or a commitment is open without an accrual. Closing returns the surplus
// to each contributor (what is still earmarked on their budget) and settles the contribution.
import { expect, test } from '@playwright/test';
import { ActualDetail, CommitmentHygieneItem, EventReconciliation } from '@bf/contracts';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import {
  actualByRef,
  addRecharge,
  buckets,
  CC,
  createCommitment,
  createEarmark,
  createEvent,
  csv,
  importAndPost,
  INDIA,
  spendBudget,
  uniq,
  US,
} from './support';

test.describe('event reconciliation and close', () => {
  test('close is blocked by unmatched actuals, a missing recharge and open commitments; closing returns the surplus per contributor', async ({
    request,
  }) => {
    const eventBudget = await spendBudget(request);
    const giver = await spendBudget(request, { legalEntityId: US });
    const event = await createEvent({
      budgetId: eventBudget.id,
      status: 'completed',
      costCenterId: CC.bengaluru,
    });
    const c = await createCommitment({
      budgetId: eventBudget.id,
      amountMinor: 100_000,
      eventId: event.id,
      costCenterId: CC.bengaluru,
      description: 'Event venue',
    });
    const contribution = await createEarmark({
      eventId: event.id,
      giverBudgetId: giver.id,
      amountMinor: 40_000,
    });
    const p = `E${uniq()}`;
    await importAndPost(
      request,
      csv([
        `${p}-1,2026-11-03,900.00,USD,HYL-IN,CC-IN-BLR-200,6100,${event.eventCode},,Venue invoice,,,charge`,
        `${p}-2,2026-11-04,50.00,USD,HYL-IN,CC-IN-HYD-210,6100,${event.eventCode},,Taxi for a Hyderabad guest,,,charge`,
      ]),
    );
    const recon = async () =>
      expectContract(
        await request.get(`/api/actuals/events/${event.id}/reconciliation`, {
          headers: await as('finance-controller'),
        }),
        200,
        EventReconciliation,
      );
    const close = async () =>
      request.post(`/api/actuals/events/${event.id}/close`, {
        headers: await mutate('finance-controller'),
        data: { reason: 'Event reconciled with finance' },
      });

    const r1 = await recon();
    expect(r1.canClose).toBe(false);
    expect(Object.fromEntries(r1.blockers.map((b) => [b.code, b.count]))).toEqual({
      EVENT_HAS_UNMATCHED_ACTUALS: 1,
      EVENT_MISSING_RECHARGE: 1,
      EVENT_HAS_OPEN_COMMITMENTS: 1,
    });
    expect(r1.actuals).toMatchObject({
      matched: 1,
      unmatched: 1,
      matchedReporting: { amountMinor: 90_000 },
    });
    expect(r1.contributions).toEqual([
      expect.objectContaining({
        id: contribution.id,
        crossEntity: true,
        held: { amountMinor: 40_000, currency: 'USD' },
        surplusShare: { amountMinor: 40_000, currency: 'USD' },
      }),
    ]);
    await expectProblem(await close(), 409, 'EVENT_HAS_UNMATCHED_ACTUALS');

    const taxi = await actualByRef(request, `${p}-2`);
    await expectContract(
      await request.post(`/api/actuals/${taxi.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: { parts: [{ budgetId: eventBudget.id }] },
      }),
      201,
      ActualDetail,
    );
    await expectProblem(await close(), 409, 'EVENT_MISSING_RECHARGE');
    await addRecharge({
      contributionId: contribution.id,
      eventId: event.id,
      from: US,
      to: INDIA,
      amountMinor: 40_000,
    });
    await expectProblem(await close(), 409, 'EVENT_HAS_OPEN_COMMITMENTS');
    await expectContract(
      await request.post(`/api/actuals/commitments/${c.id}/release`, {
        headers: await mutate('finance-controller'),
        data: { reasonCode: 'FINAL-INVOICE', reason: 'Venue invoice was final' },
      }),
      200,
      CommitmentHygieneItem,
    );
    expect((await recon()).canClose).toBe(true);

    const giverBefore = await buckets(request, giver.id);
    const closed = await expectContract(await close(), 200, EventReconciliation);
    expect(closed.event.status).toBe('closed');
    expect(closed.blockers).toEqual([]);
    expect(closed.surplusReturns).toEqual([
      expect.objectContaining({
        contributionId: contribution.id,
        budgetId: giver.id,
        amount: { amountMinor: 40_000, currency: 'USD' },
      }),
    ]);
    expect(closed.contributions[0]).toMatchObject({ status: 'settled', held: { amountMinor: 0 } });
    const giverAfter = await buckets(request, giver.id);
    expect(giverAfter.balances.budgetCurrency.held.amountMinor).toBe(0);
    expect(giverAfter.balances.available.amountMinor).toBe(
      giverBefore.balances.available.amountMinor + 40_000,
    );
    await expectProblem(await close(), 409, 'INVALID_TRANSITION');
  });

  test('an event still in progress cannot close', async ({ request }) => {
    const event = await createEvent({ status: 'in_progress' });
    const r = await expectContract(
      await request.get(`/api/actuals/events/${event.id}/reconciliation`, {
        headers: await as('auditor'),
      }),
      200,
      EventReconciliation,
    );
    expect(r.blockers.map((b) => b.code)).toEqual(['INVALID_TRANSITION']);
    await expectProblem(
      await request.post(`/api/actuals/events/${event.id}/close`, {
        headers: await mutate('finance-controller'),
        data: { reason: 'Trying too early' },
      }),
      409,
      'INVALID_TRANSITION',
    );
  });
});
