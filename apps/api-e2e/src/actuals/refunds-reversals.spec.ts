// Invariants 3 and 15 (P6): refunds and credit notes post negative actuals on the budget the original
// consumed; a reversal from the source undoes the original match with linked reversal journals (exact
// negation, never an edit) and both lines leave the queue.
import { expect, test } from '@playwright/test';
import { Journal } from '@bf/contracts';
import { as } from '../support/auth';
import { expectContract } from '../support/contract';
import {
  actualByRef,
  buckets,
  commitmentState,
  createCommitment,
  csv,
  importAndPost,
  spendBudget,
  uniq,
} from './support';

test.describe('refunds, credit notes and reversals', () => {
  test('credit notes and refunds reduce the actual on the original budget; the commitment stays consumed', async ({
    request,
  }) => {
    const budget = await spendBudget(request);
    const c = await createCommitment(request, {
      budgetId: budget.id,
      amountMinor: 50_000,
      description: 'Catering',
    });
    const p = `R${uniq()}`;
    const batch = await importAndPost(
      request,
      csv([
        `${p}-1,2026-11-03,500.00,USD,HYL-IN,,6100,,,Catering invoice,${c.reference},,charge`,
        `${p}-2,2026-11-04,-50.00,USD,HYL-IN,,6100,,,Credit note: unused desserts,,${p}-1,credit_note`,
        `${p}-3,2026-11-04,20.00,USD,HYL-IN,,6100,,,Refund: returned decorations,,${p}-1,refund`,
      ]),
    );
    expect(batch.summary).toMatchObject({ autoMatched: 3, unmatched: 0 });
    expect(batch.summary.posted).toMatchObject({ matched: 3, toQueue: 0 });
    const credit = await actualByRef(request, `${p}-2`);
    expect(credit.actual).toMatchObject({
      kind: 'credit_note',
      status: 'matched',
      transaction: { amountMinor: -5_000 },
    });
    expect(credit.matches[0]).toMatchObject({
      fit: 'refund',
      rule: 'original_reference',
      budgetId: budget.id,
      relief: { amountMinor: 0 },
    });
    const refund = await actualByRef(request, `${p}-3`);
    expect(refund.actual).toMatchObject({ kind: 'refund', transaction: { amountMinor: -2_000 } });
    const b = await buckets(request, budget.id);
    expect(b.balances.budgetCurrency).toMatchObject({
      actual: { amountMinor: 43_000 },
      encumbered: { amountMinor: 0 },
    });
    expect(await commitmentState(request, budget.id, c.id)).toMatchObject({ status: 'consumed' });
  });

  test('a source reversal reverses the original match with linked journals and restores the commitment', async ({
    request,
  }) => {
    const budget = await spendBudget(request);
    const c = await createCommitment(request, {
      budgetId: budget.id,
      amountMinor: 20_000,
      description: 'Transport',
    });
    const p = `V${uniq()}`;
    await importAndPost(
      request,
      csv([`${p}-1,2026-11-03,200.00,USD,HYL-IN,,6140,,,Coach hire,${c.reference},,charge`]),
    );
    const original = await actualByRef(request, `${p}-1`);
    expect((await buckets(request, budget.id)).balances.budgetCurrency.actual.amountMinor).toBe(
      20_000,
    );

    const batch = await importAndPost(
      request,
      csv([`${p}-2,2026-11-04,-200.00,USD,HYL-IN,,6140,,,Reversal of coach hire,,${p}-1,reversal`]),
    );
    expect(batch.summary.posted).toMatchObject({ matched: 1, toQueue: 0 });
    const reversed = await actualByRef(request, `${p}-1`);
    expect(reversed.actual).toMatchObject({
      status: 'excluded',
      excludedReason: `Reversed by ${p}-2`,
    });
    expect(reversed.matches[0].reversedAt).not.toBeNull();
    expect((await actualByRef(request, `${p}-2`)).actual).toMatchObject({
      status: 'matched',
      kind: 'reversal',
    });

    for (const id of original.matches[0].journalIds) {
      const j = await expectContract(
        await request.get(`/api/ledger/journals/${id}`, {
          headers: await as('finance-controller'),
        }),
        200,
        Journal,
      );
      expect(j.reversedByJournalId, `journal ${id} reversed`).not.toBeNull();
      const r = await expectContract(
        await request.get(`/api/ledger/journals/${j.reversedByJournalId}`, {
          headers: await as('finance-controller'),
        }),
        200,
        Journal,
      );
      expect(r.reversalOfJournalId).toBe(id);
      expect(r.lines.map((l) => l.reporting.amountMinor)).toEqual(
        j.lines.map((l) => -l.reporting.amountMinor),
      );
    }
    const b = await buckets(request, budget.id);
    expect(b.balances.budgetCurrency).toMatchObject({
      actual: { amountMinor: 0 },
      encumbered: { amountMinor: 20_000 },
    });
    expect(await commitmentState(request, budget.id, c.id)).toMatchObject({
      status: 'encumbered',
      encumbered: { amountMinor: 20_000 },
    });
  });
});
