// Invariant 137: on a pinned stack (FIXED_NOW, scripts/stack.sh), rows the running API and worker write
// carry the pinned day, on both clocks, and in the order they were written.
//
// The API's "now" is pinned, but its database sessions used not to be: column defaults (app_now(),
// migration 0020) and JavaScript `new Date()` stamps gave the real date, so a reclaim notice could be
// answered "on 12 Nov" while the app reasoned as of 16 Nov. Pinning only the database was tried once
// and broke the other way: a JavaScript stamp then looked days older than a database-stamped row
// written before it. So this checks both clocks and their order:
//   - API, database default: the budget's created_at.
//   - API, JavaScript: the audit entry's occurredAt (read through the audit API), never before it.
//   - Worker: the outbox message the freeze wrote, published by the worker (published_at), never
//     before the API created it.
// Each stamp must lie within an hour after the pinned instant, not merely on its calendar day, so the
// check fails on a real-clock stamp even when the real date happens to be the pinned one. On a stack
// started with BF_FIXED_NOW=real only the day and the order are checked.
import { expect, test } from '@playwright/test';
import { AuditEventList } from '@bf/contracts';
import { as } from '../support/auth';
import { clockIsPinned, nowUtc, todayUtc } from '../support/clock';
import { expectContract } from '../support/contract';
import { asOwner } from '../support/db';
import { createRoot } from '../support/factory';
import { freeze } from '../budgets/p4';

const day = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/**
 * On a pinned stack a stamp is the pinned instant moved on by the shared database tick (a millisecond
 * per database stamp, seconds over a whole run), so it lies within an hour after it. A real-clock
 * stamp almost never does, even on the pinned calendar day, which is what makes this check bite.
 */
function expectPinned(at: Date | string, what: string) {
  expect(day(at), what).toBe(todayUtc());
  if (!clockIsPinned()) return;
  const offset = new Date(at).getTime() - nowUtc().getTime();
  expect(offset, `${what}: ms after the pinned instant`).toBeGreaterThanOrEqual(0);
  expect(offset, `${what}: ms after the pinned instant`).toBeLessThan(60 * 60_000);
}

test.describe('the API and the worker write on the pinned clock', () => {
  test.beforeAll(async () => {
    await as('finance-admin');
  });

  test('a budget, its audit entry and the worker publication carry the API day, in order', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 500_000, owner: 'regional-manager' });
    await freeze(request, root.id);

    const [row] = await asOwner(
      async (c) =>
        (
          await c.query<{ created_at: Date }>('select created_at from budgets where id = $1', [
            root.id,
          ])
        ).rows,
    );
    expectPinned(row.created_at, 'budget created_at (database default, API session)');

    const audits = await expectContract(
      await request.get('/api/audit/events', {
        headers: await as('finance-admin'),
        params: { resourceId: root.id, order: 'asc', limit: 50 },
      }),
      200,
      AuditEventList,
    );
    const frozen = audits.items.find((a) => a.action === 'budget.frozen');
    expect(frozen, `audit actions: ${audits.items.map((a) => a.action).join(', ')}`).toBeTruthy();
    expectPinned(frozen!.occurredAt, 'audit occurredAt (JavaScript, API)');
    expect(
      new Date(frozen!.occurredAt).getTime(),
      'the freeze is audited no earlier than the budget it froze was created',
    ).toBeGreaterThanOrEqual(row.created_at.getTime());
    for (const a of audits.items) expectPinned(a.occurredAt, a.action);

    // The worker drains the outbox; poll until it has published the freeze's message.
    let published: { created_at: Date; published_at: Date | null } | undefined;
    await expect
      .poll(
        async () => {
          [published] = await asOwner(
            async (c) =>
              (
                await c.query<{ created_at: Date; published_at: Date | null }>(
                  `select created_at, published_at from outbox_messages
                    where topic = 'budget.control_changed' and payload->>'budgetId' = $1
                    order by created_at limit 1`,
                  [root.id],
                )
              ).rows,
          );
          return published?.published_at ?? null;
        },
        { timeout: 30_000, message: 'the worker publishes the freeze outbox message' },
      )
      .not.toBeNull();
    expectPinned(published!.created_at, 'outbox created_at (database default, API)');
    expectPinned(published!.published_at!, 'outbox published_at (JavaScript, worker)');
    expect(
      published!.published_at!.getTime(),
      'the worker publishes no earlier than the API wrote the message',
    ).toBeGreaterThanOrEqual(published!.created_at.getTime());
  });
});
