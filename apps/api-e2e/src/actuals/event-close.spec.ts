// Invariant 14 (P6): Phase 5's event close is blocked while actuals with the event's code are unmatched or a
// commitment past its service end has neither an invoice nor an accrual (the checks Phase 6 registers).
// An actual matched to an event commitment lands on every funding budget pro rata; releasing the rest
// returns it to each funding source, and closing returns each source's surplus to its budget.
import { expect, test } from '@playwright/test';
import {
  ActualDetail,
  CloseEventResponse,
  CommitmentHygieneItem,
  EventCommitment,
  EventReconciliation,
} from '@bf/contracts';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';
import { runLedgerCheck } from '../support/p5';
import {
  actualByRef,
  buckets,
  CC,
  contributeTo,
  createEvent,
  csv,
  giverBudget,
  importAndPost,
  spendBudget,
  uniq,
} from './support';

const actualOf = (b: Awaited<ReturnType<typeof buckets>>) =>
  b.balances.budgetCurrency.actual.amountMinor;

test.describe('event reconciliation and close', () => {
  test('close is blocked by unmatched actuals and unaccrued commitments; matching spans the funding budgets and closing returns each source’s surplus', async ({
    request,
  }) => {
    const team = await spendBudget(request);
    const giver = await giverBudget(request, team.id);
    const event = await createEvent(request, {
      budgetId: team.id,
      costCenterId: CC.bengaluru,
      ownFundsMinor: 150_000,
      estimateMinor: 200_000,
    });
    await contributeTo(request, {
      eventId: event.id,
      giverBudgetId: giver.id,
      amountMinor: 50_000,
    });
    // USD 1,000.00 draws 75/25 on own funds and the contribution; the service ended on 3 Nov.
    const c = await expectContract(
      await request.post(`/api/events/${event.id}/commitments`, {
        headers: await mutate('budget-owner'),
        data: {
          description: 'Event venue',
          amount: { amountMinor: 100_000, currency: 'USD' },
          serviceStart: '2026-11-01',
          serviceEnd: '2026-11-03',
        },
      }),
      201,
      EventCommitment,
    );
    expect(c.fundingLines.map((l) => [l.budgetId, l.amount.amountMinor])).toEqual([
      [team.id, 75_000],
      [giver.id, 25_000],
    ]);
    for (const verb of ['start', 'complete'])
      expect(
        (
          await request.post(`/api/events/${event.id}/${verb}`, {
            headers: await mutate('budget-owner'),
            data: {},
          })
        ).status(),
      ).toBe(200);

    const teamBefore = await buckets(request, team.id);
    const giverBefore = await buckets(request, giver.id);
    const p = `E${uniq()}`;
    await importAndPost(
      request,
      csv([
        `${p}-1,2026-11-03,900.00,USD,HYL-IN,CC-IN-BLR-200,6100,${event.eventCode},,Venue invoice,,,charge`,
        `${p}-2,2026-11-04,50.00,USD,HYL-IN,CC-IN-HYD-210,6100,${event.eventCode},,Taxi for a Hyderabad guest,,,charge`,
      ]),
    );
    // The venue invoice matched by event code and cost center: USD 900.00 lands 675/225 on the two budgets.
    expect(actualOf(await buckets(request, team.id)) - actualOf(teamBefore)).toBe(67_500);
    expect(actualOf(await buckets(request, giver.id)) - actualOf(giverBefore)).toBe(22_500);

    const recon = async () =>
      expectContract(
        await request.get(`/api/actuals/events/${event.id}/reconciliation`, {
          headers: await as('finance-controller'),
        }),
        200,
        EventReconciliation,
      );
    const close = async () =>
      request.post(`/api/events/${event.id}/close`, {
        headers: await mutate('budget-owner'),
        data: { reason: 'Event reconciled with finance' },
      });

    const r1 = await recon();
    expect(r1.canClose).toBe(false);
    expect(r1.canManage).toBe(false);
    expect(Object.fromEntries(r1.blockers.map((b) => [b.code, b.count]))).toEqual({
      EVENT_HAS_UNMATCHED_ACTUALS: 1,
      EVENT_HAS_OPEN_COMMITMENTS: 1,
    });
    expect(r1.actuals).toMatchObject({
      matched: 1,
      unmatched: 1,
      matchedReporting: { amountMinor: 90_000 },
    });
    expect(r1.sources.map((s) => [s.kind, s.budgetId, s.funded.amountMinor])).toEqual([
      ['own', team.id, 150_000],
      ['contribution', giver.id, 50_000],
    ]);
    await expectProblem(await close(), 409, 'EVENT_HAS_UNMATCHED_ACTUALS');

    const taxi = await actualByRef(request, `${p}-2`);
    await expectContract(
      await request.post(`/api/actuals/${taxi.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: { parts: [{ budgetId: team.id }] },
      }),
      201,
      ActualDetail,
    );
    await expectProblem(await close(), 409, 'EVENT_HAS_OPEN_COMMITMENTS');

    // Releasing the USD 100.00 left goes back to each funding source (75/25), not to available.
    const giverHeld = (await buckets(request, giver.id)).balances.budgetCurrency.held.amountMinor;
    await expectContract(
      await request.post(`/api/actuals/commitments/${c.id}/release`, {
        headers: await mutate('finance-controller'),
        data: { reasonCode: 'FINAL-INVOICE', reason: 'Venue invoice was final' },
      }),
      200,
      CommitmentHygieneItem,
    );
    expect(
      (await buckets(request, giver.id)).balances.budgetCurrency.held.amountMinor - giverHeld,
    ).toBe(2_500);
    expect((await recon()).canClose).toBe(true);

    const giverOpen = await buckets(request, giver.id);
    const closed = await expectContract(await close(), 200, CloseEventResponse);
    expect(closed.event.status).toBe('closed');
    expect(closed.surplusReturns.map((s) => [s.budgetId, s.amount.amountMinor])).toEqual([
      [team.id, 82_500],
      [giver.id, 27_500],
    ]);
    const giverAfter = await buckets(request, giver.id);
    expect(giverAfter.balances.budgetCurrency.held.amountMinor).toBe(0);
    expect(giverAfter.balances.available.amountMinor).toBe(
      giverOpen.balances.available.amountMinor + 27_500,
    );
    const r2 = await recon();
    expect(r2.blockers).toEqual([]);
    expect(r2.surplusReturns.map((s) => [s.budgetId, s.amount.amountMinor])).toEqual([
      [team.id, 82_500],
      [giver.id, 27_500],
    ]);
    await expectProblem(await close(), 409, 'INVALID_TRANSITION');
    expect((await runLedgerCheck(request)).status).toBe('clean');
  });

  test('an event still in progress cannot close', async ({ request }) => {
    const team = await spendBudget(request);
    const event = await createEvent(request, { budgetId: team.id, status: 'in_progress' });
    const r = await expectContract(
      await request.get(`/api/actuals/events/${event.id}/reconciliation`, {
        headers: await as('auditor'),
      }),
      200,
      EventReconciliation,
    );
    expect(r.blockers.map((b) => b.code)).toEqual(['INVALID_TRANSITION']);
    await expectProblem(
      await request.post(`/api/events/${event.id}/close`, {
        headers: await mutate('budget-owner'),
        data: { reason: 'Trying too early' },
      }),
      409,
      'INVALID_TRANSITION',
    );
  });

  test('an actual without the event code, matched to the event’s commitment, counts as the event’s spend', async ({
    request,
  }) => {
    const team = await spendBudget(request);
    const event = await createEvent(request, {
      budgetId: team.id,
      costCenterId: CC.bengaluru,
      ownFundsMinor: 150_000,
      estimateMinor: 150_000,
    });
    const c = await expectContract(
      await request.post(`/api/events/${event.id}/commitments`, {
        headers: await mutate('budget-owner'),
        data: {
          description: 'Airport transfers',
          amount: { amountMinor: 100_000, currency: 'USD' },
        },
      }),
      201,
      EventCommitment,
    );
    const p = `T${uniq()}`;
    // INR 8,325.00 at the locked plan rate (83.25) is USD 100.00; the line carries no event code.
    await importAndPost(
      request,
      csv([`${p}-1,2026-11-05,8325.00,INR,HYL-IN,CC-IN-BLR-200,6100,,,Airport transfers,,,charge`]),
    );
    const taxi = await actualByRef(request, `${p}-1`);
    await expectContract(
      await request.post(`/api/actuals/${taxi.actual.id}/matches`, {
        headers: await mutate('finance-controller'),
        data: { parts: [{ commitmentId: c.id }] },
      }),
      201,
      ActualDetail,
    );
    const r = await expectContract(
      await request.get(`/api/actuals/events/${event.id}/reconciliation`, {
        headers: await as('finance-controller'),
      }),
      200,
      EventReconciliation,
    );
    expect(r.actuals).toMatchObject({
      matched: 1,
      unmatched: 0,
      matchedReporting: { amountMinor: 10_000, currency: 'USD' },
    });
  });
});
