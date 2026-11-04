// Invariant 7: nothing posts to a Closed or Locked period; late items post to the next open period with a
// flag and the original period referenced. Seed calendar: Jan-Jun 2026 locked, Jul-Sep closed, Oct soft-closed, Nov+ open.
import { expect, test } from '@playwright/test';
import { Journal } from '@bf/contracts';
import { periodId, SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { asAppRole, pgError } from '../support/db';
import { allocateOk, createChild, createRoot } from '../support/factory';

test.describe('accounting periods', () => {
  test('an allocation dated in a closed period lands in the next open period, flagged late', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const child = await createChild(request, root.id, { currency: 'INR' });
    const r = await allocateOk(
      request,
      root.id,
      child.id,
      { amountMinor: 1_000, currency: 'USD' },
      { accountingDate: SEED.dates.closed },
    );
    expect(r.journal.accountingDate).toBe(SEED.dates.closed);
    expect(r.journal.late).toBe(true);
    expect(r.journal.originalPeriodId).toBe(periodId(1, 2026, 8));
    expect(r.journal.periodId).toBe(periodId(1, 2026, 11));
    expect(r.journal.periodLabel).toBe('Nov 2026');
    // The India line follows Acme India's April-March calendar: Aug 2026 is FY2027 period 5, Nov 2026 is period 8.
    const india = r.journal.lines.find((l) => l.budgetId === child.id)!;
    expect(india.periodId).toBe(periodId(2, 2027, 8));
  });

  test('locked and soft-closed dates also move to the next open period for ordinary postings', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const locked = await allocateOk(
      request,
      root.id,
      child.id,
      { amountMinor: 100, currency: 'USD' },
      { accountingDate: SEED.dates.locked },
    );
    expect([
      locked.journal.late,
      locked.journal.periodLabel,
      locked.journal.originalPeriodId,
    ]).toEqual([true, 'Nov 2026', periodId(1, 2026, 3)]);
    const soft = await allocateOk(
      request,
      root.id,
      child.id,
      { amountMinor: 100, currency: 'USD' },
      { accountingDate: SEED.dates.softClosed },
    );
    expect([soft.journal.late, soft.journal.periodLabel]).toEqual([true, 'Nov 2026']);
    const open = await allocateOk(
      request,
      root.id,
      child.id,
      { amountMinor: 100, currency: 'USD' },
      { accountingDate: SEED.dates.open },
    );
    expect([open.journal.late, open.journal.periodLabel, open.journal.originalPeriodId]).toEqual([
      false,
      'Nov 2026',
      null,
    ]);
  });

  test('finance reversals may post into a soft-closed period', async ({ request }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const child = await createChild(request, root.id, { currency: 'USD' });
    const alloc = await allocateOk(request, root.id, child.id, {
      amountMinor: 100,
      currency: 'USD',
    });
    const rev = await expectContract(
      await request.post(`/api/ledger/journals/${alloc.journal.id}/reversals`, {
        headers: await mutate('finance-controller'),
        data: {
          reasonCode: 'REV-ERROR',
          reason: 'October correction',
          accountingDate: SEED.dates.softClosed,
        },
      }),
      201,
      Journal,
    );
    expect([rev.late, rev.periodLabel]).toEqual([false, 'Oct 2026']);
  });

  test('the database refuses a ledger insert into a closed period', async () => {
    const tenant = SEED.tenants.acme;
    const e = await pgError(
      asAppRole(tenant, (c) =>
        c.query(
          `insert into ledger_journals (id, tenant_id, journal_type, transaction_currency, reporting_currency, accounting_date, fiscal_period_id, command)
           values ($1, $2, 'manual', 'USD', 'USD', '2026-08-14', $3, 'scenario')`,
          [randomUUID(), tenant, periodId(1, 2026, 8)],
        ),
      ),
    );
    expect(e?.code).toBe('BF002');
  });
});
