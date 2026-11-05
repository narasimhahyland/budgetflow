// Owner alerts: approving a request encumbers it, and when that pushes utilization (encumbered plus
// actual over authorized) past one of the budget's alert thresholds, Phase 4's budget.threshold_crossed
// is published in the same transaction and the worker emails the budget owner.
import { expect, test } from '@playwright/test';
import { RequestDetail } from '@bf/contracts';
import { expectContract } from '../support/contract';
import { asOwner } from '../support/db';
import { decideOk, directorTree, spendingRequest, taskOf, usd, waitForMail } from '../support/p5';

test('approving a request past an alert threshold emails the budget owner once', async ({
  request,
}) => {
  const { team } = await directorTree(request, { teamMinor: 180_000 });
  const r = await expectContract(
    await spendingRequest(request, 'budget-owner', team.id, usd(99_000)),
    201,
    RequestDetail,
  );
  const outbox = () =>
    asOwner(async (c) => {
      const res = await c.query<{ pct: string }>(
        `select payload->>'thresholdPct' as pct from outbox_messages where topic = 'budget.threshold_crossed' and payload->>'budgetId' = $1 order by created_at`,
        [team.id],
      );
      return res.rows.map((x) => Number(x.pct));
    });
  expect(await outbox()).toEqual([]);

  await decideOk(
    request,
    'department-head',
    await taskOf(request, 'department-head', 'request', r.id),
    {
      decision: 'approve',
    },
  );
  expect(await outbox()).toEqual([50]);
  const mail = await waitForMail(
    'budget.owner@example.test',
    `${team.name} has reached 50% of its budget`,
  );
  expect(mail.text).toContain('55.0%');
});
