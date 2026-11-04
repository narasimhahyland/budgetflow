// Invariant 8 (Phase 1 part): every line carries the currency triplet, converted once at the locked plan
// rate stored on the line; spot rates never drive budget control. FX on actuals lands in Phase 6.
// Invariant 22 (Phase 1 part): integer minor units with ISO 4217 exponents (JPY 0, USD 2, KWD 3), half-even.
import { expect, test } from '@playwright/test';
import { allocateOk, createChild, createRoot, expectMoney } from '../support/factory';

test.describe('currency triplet at the locked plan rate', () => {
  test('USD 300.00 to an INR child: INR 24,975.00 at 83.25, reporting USD 300.00, rate stored on each line', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const india = await createChild(request, root.id, { currency: 'INR' });
    const r = await allocateOk(request, root.id, india.id, {
      amountMinor: 30_000,
      currency: 'USD',
    });
    const parentLine = r.journal.lines.find((l) => l.account === 'allocated_out')!;
    const childLine = r.journal.lines.find((l) => l.account === 'authorized')!;
    expect(parentLine).toMatchObject({
      transaction: { amountMinor: 30_000, currency: 'USD' },
      budget: { amountMinor: 30_000, currency: 'USD' },
      reporting: { amountMinor: 30_000, currency: 'USD' },
    });
    expect(childLine).toMatchObject({
      transaction: { amountMinor: -30_000, currency: 'USD' },
      budget: { amountMinor: -2_497_500, currency: 'INR' },
      reporting: { amountMinor: -30_000, currency: 'USD' },
    });
    expect(childLine.budgetRate).toMatchObject({
      type: 'plan',
      from: 'USD',
      to: 'INR',
      value: '83.250000000000',
    });
    expect(childLine.budgetRate?.rateIds).toHaveLength(1);
    // The spot rate (84.07) exists in the seed but never drives budget control.
    expectMoney(r.child.balances.budgetCurrency.authorized, 2_497_500, 'INR');
  });

  test('half-even rounding at the line for JPY (0 decimals) and KWD (3 decimals)', async ({
    request,
  }) => {
    const root = await createRoot(request, { amountMinor: 100_000 });
    const yen = await createChild(request, root.id, { currency: 'JPY' });
    const dinar = await createChild(request, root.id, { currency: 'KWD' });
    // USD 10.01 × 150 = JPY 1,501.5 → 1,502 (half to even); USD 10.01 × 0.307 = KWD 3.07307 → 3.073 (3,073 fils).
    const j = await allocateOk(request, root.id, yen.id, { amountMinor: 1_001, currency: 'USD' });
    expectMoney(j.child.balances.budgetCurrency.authorized, 1_502, 'JPY');
    const k = await allocateOk(request, root.id, dinar.id, { amountMinor: 1_001, currency: 'USD' });
    expectMoney(k.child.balances.budgetCurrency.authorized, 3_073, 'KWD');
    // USD 10.01 → INR 833.3325 → 833.33 (83,333 paise).
    const india = await createChild(request, root.id, { currency: 'INR' });
    const i = await allocateOk(request, root.id, india.id, { amountMinor: 1_001, currency: 'USD' });
    expectMoney(i.child.balances.budgetCurrency.authorized, 83_333, 'INR');
    expectMoney(i.parent.balances.budgetCurrency.allocatedOut, 3_003, 'USD');
  });
});
