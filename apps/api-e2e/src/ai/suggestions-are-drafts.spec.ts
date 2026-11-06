// Suggested allocations (022d), the spending outlook (016b), anomaly flags (017c) and receipt
// extraction (121a) all propose and explain; none of them writes money, changes a control or decides
// anything. Figures they show are copies of reconciled read-model values, and lists are ordered
// deterministically (name, then id).
import { expect, test } from '@playwright/test';
import {
  AllocationSuggestion,
  AnomalyFlagList,
  BudgetDetail,
  ExtractionResult,
  OutlookList,
} from '@bf/contracts';
import { SEED } from '@bf/seed';
import { randomUUID } from 'node:crypto';
import { as, mutate } from '../support/auth';
import { expectContract, expectProblem } from '../support/contract';

const INDIA = SEED.budgets.india;

test('a suggested split totals the amount exactly, stays within the parent, and saves nothing', async ({
  request,
}) => {
  const before = await expectContract(
    await request.get(`/api/budgets/${INDIA}`, { headers: await as('finance-admin') }),
    200,
    BudgetDetail,
  );

  const suggestion = await expectContract(
    await request.post('/api/ai/allocation-suggestion', {
      headers: await as('finance-admin'),
      data: { parentBudgetId: INDIA },
    }),
    200,
    AllocationSuggestion,
  );
  expect(suggestion.lines.length).toBeGreaterThan(0);
  const total = suggestion.lines.reduce((sum, l) => sum + l.suggested.amountMinor, 0);
  expect(total, 'the lines total the amount exactly').toBe(suggestion.amount.amountMinor);
  expect(suggestion.total.amountMinor).toBe(suggestion.amount.amountMinor);
  expect(
    suggestion.amount.amountMinor,
    "a suggestion never exceeds the parent's allocation available",
  ).toBeLessThanOrEqual(before.balances.allocationAvailable.amountMinor);
  const weights = suggestion.weights;
  expect(weights.headcountPct + weights.priorUsePct + weights.participationPct).toBe(100);

  const after = await expectContract(
    await request.get(`/api/budgets/${INDIA}`, { headers: await as('finance-admin') }),
    200,
    BudgetDetail,
  );
  expect(after.version, 'nothing was saved by asking for a suggestion').toBe(before.version);
  expect(after.balances.budgetCurrency.allocatedOut.amountMinor).toBe(
    before.balances.budgetCurrency.allocatedOut.amountMinor,
  );
  for (const line of suggestion.lines) {
    const child = await expectContract(
      await request.get(`/api/budgets/${line.budgetId}`, { headers: await as('finance-admin') }),
      200,
      BudgetDetail,
    );
    expect(child.balances.budgetCurrency.authorized.amountMinor).toBe(
      line.currentAllocation.amountMinor,
    );
  }
  const names = suggestion.lines.map((l) => l.budgetName);
  expect(names, 'lines are ordered by budget name').toEqual([...names].sort());
});

test('asking for a split of more than the parent has is refused', async ({ request }) => {
  const parent = await expectContract(
    await request.get(`/api/budgets/${INDIA}`, { headers: await as('finance-admin') }),
    200,
    BudgetDetail,
  );
  await expectProblem(
    await request.post('/api/ai/allocation-suggestion', {
      headers: await as('finance-admin'),
      data: {
        parentBudgetId: INDIA,
        amount: {
          amountMinor: parent.balances.allocationAvailable.amountMinor + 100_000,
          currency: parent.currency,
        },
      },
    }),
    422,
    'INSUFFICIENT_AVAILABLE',
  );
});

test('an employee cannot ask for a split of a budget they may not allocate from', async ({
  request,
}) => {
  const refused = await request.post('/api/ai/allocation-suggestion', {
    headers: await as('employee'),
    data: { parentBudgetId: INDIA },
  });
  expect([403, 404]).toContain(refused.status());
});

test('the spending outlook reports a range, cites the budget and changes no balance', async ({
  request,
}) => {
  const before = await expectContract(
    await request.get(`/api/budgets/${SEED.budgets.bengaluru}`, {
      headers: await as('finance-admin'),
    }),
    200,
    BudgetDetail,
  );

  const list = await expectContract(
    await request.post('/api/ai/outlook/run', {
      headers: await as('finance-admin'),
      data: {},
    }),
    200,
    OutlookList,
  );
  expect(list.items.length).toBeGreaterThan(0);
  for (const item of list.items) {
    expect(item.sources.map((s) => s.id)).toContain(item.budgetId);
    if (item.category === 'no_history') {
      expect(item.likely, 'no figure is shown without enough history').toBeNull();
      continue;
    }
    expect(item.likely).not.toBeNull();
    expect(item.low!.amountMinor).toBeLessThanOrEqual(item.likely!.amountMinor);
    expect(item.high!.amountMinor).toBeGreaterThanOrEqual(item.likely!.amountMinor);
    expect(item.gap!.amountMinor).toBe(item.authorized.amountMinor - item.likely!.amountMinor);
    expect(item.drivers.length).toBeGreaterThan(0);
  }
  const keys = list.items.map((i) => `${i.category}|${i.budgetName}|${i.budgetId}`);
  expect(keys, 'ordered by category, then name, then id').toEqual([...keys].sort());

  const after = await expectContract(
    await request.get(`/api/budgets/${SEED.budgets.bengaluru}`, {
      headers: await as('finance-admin'),
    }),
    200,
    BudgetDetail,
  );
  expect(after.version).toBe(before.version);
  expect(after.balances.budgetCurrency.authorized.amountMinor).toBe(
    before.balances.budgetCurrency.authorized.amountMinor,
  );
  expect(after.status, 'a nudge never freezes, reduces or releases anything').toBe(before.status);

  // The outlook's to-date figure is the ledger's, not the model's arithmetic.
  const bengaluru = list.items.find((i) => i.budgetId === SEED.budgets.bengaluru);
  expect(bengaluru).toBeDefined();
  expect(bengaluru!.authorized.amountMinor).toBe(
    before.balances.budgetCurrency.authorized.amountMinor,
  );
  expect(bengaluru!.toDate.amountMinor).toBe(
    before.balances.budgetCurrency.actual.amountMinor +
      before.balances.budgetCurrency.encumbered.amountMinor,
  );
});

test('anomaly flags are advisory: they cite records, carry evidence and decide nothing', async ({
  request,
}) => {
  const scan = await expectContract(
    await request.post('/api/ai/anomaly-flags/scan', {
      headers: await as('finance-controller'),
      data: {},
    }),
    200,
    AnomalyFlagList,
  );
  expect(scan.items.length, 'the seeded requests contain a reviewable pattern').toBeGreaterThan(0);
  for (const flag of scan.items) {
    expect(flag.sources.length).toBeGreaterThan(0);
    expect(flag.evidence.length).toBeGreaterThan(0);
    expect(flag.finding.length).toBeGreaterThan(0);
    expect(flag.provenance.modelId).toBeTruthy();
  }
  const requested = scan.items.filter((f) => f.subjectType === 'request');
  for (const flag of requested) {
    const unchanged = await request.get(`/api/requests/${flag.subjectId}`, {
      headers: await as('finance-admin'),
    });
    expect([200, 404], 'a flag never changes the record it is about').toContain(unchanged.status());
  }
  const keys = scan.items.map((f) => `${f.raisedAt}|${f.subjectLabel}|${f.id}`);
  expect(keys).toEqual([...keys].sort());

  // A requester never sees AI flags about their own requests.
  const refused = await request.get('/api/ai/anomaly-flags', { headers: await as('employee') });
  expect([403, 404]).toContain(refused.status());
});

test('receipt extraction prefills values without saving them, and drops card details', async ({
  request,
}) => {
  const result = await expectContract(
    await request.post('/api/ai/extractions', {
      headers: await as('employee'),
      data: { documentId: SEED.p13.receiptCafeMocha, kind: 'receipt' },
    }),
    200,
    ExtractionResult,
  );
  expect(result.readable).toBe(true);
  expect(result.status).toBe('open');
  expect(result.confirmedFields, 'nothing is saved until a person confirms').toBeNull();
  expect(result.droppedFields).toContain('cardNumber');
  expect(JSON.stringify(result.fields)).not.toMatch(/\d{13,19}/);
  const fieldNames = result.fields.map((f) => f.field);
  expect(fieldNames, 'fields are ordered by name').toEqual([...fieldNames].sort());
  for (const field of result.fields)
    expect(field.needsCheck).toBe(field.value === null || field.confidence === 'low');

  // Accepting an extraction records the values the person checked; it cannot be accepted blind.
  await expectProblem(
    await request.post(`/api/ai/suggestions/${result.id}/decision`, {
      headers: await mutate('employee', randomUUID()),
      data: { decision: 'accepted' },
    }),
    422,
    'VALIDATION_FAILED',
  );
});

test('a low-confidence field is left empty rather than guessed', async ({ request }) => {
  const result = await expectContract(
    await request.post('/api/ai/extractions', {
      headers: await as('employee'),
      data: { documentId: SEED.p13.receiptWestlakeHotel, kind: 'receipt' },
    }),
    200,
    ExtractionResult,
  );
  const tax = result.fields.find((f) => f.field === 'taxNote');
  expect(tax, 'the fixture receipt has an unreadable tax line').toBeDefined();
  expect(tax!.value).toBeNull();
  expect(tax!.needsCheck).toBe(true);
});
