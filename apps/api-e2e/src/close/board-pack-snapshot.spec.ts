// The board and FP&A pack (16a) read from the snapshot a period close takes. It lives beside the
// other close scenarios rather than in `reports/` for a reason: closing a period needs the tenant's
// latest ledger rebuild check to be clean with no open integrity flags, and the integrity scenarios
// that run later in the suite deliberately leave flags behind. Closing here, before them, keeps the
// precondition the scenario needs under its own control.
import { expect, test } from '@playwright/test';
import { BoardPack, ClosePeriodDetail } from '@bf/contracts';
import { as, mutate } from '../support/auth';
import { expectContract } from '../support/contract';
import { closeDetail, ledgerCheck, sandboxCalendar, signOffTieOut } from './support';

test.describe('board pack from a close snapshot (16a)', () => {
  test('a pack of a period the product closed reads that close snapshot and ties to it', async ({
    request,
  }) => {
    // The snapshot the close itself took, on a calendar this scenario owns, so the pack is proved
    // against the product's own snapshot rather than one a fixture wrote.
    const { calendar, entity } = await sandboxCalendar(request, { years: [2026] });
    const january = calendar.fiscalYears[0].periods[0];
    await signOffTieOut(request, {
      month: january.startDate.slice(0, 7),
      legalEntityId: entity!.id,
    });
    // The `ledger_check_clean` and `audit_chain_verified` checks read the tenant's latest check run,
    // which another scenario in the same suite can replace between the check and the close. Run it
    // until the checklist is clear, then assert outright: if it never clears, this fails.
    let detail = await closeDetail(request, january.id);
    for (let attempt = 0; attempt < 5 && detail.blockingReasons.length > 0; attempt += 1) {
      const ledger = await ledgerCheck(request, 'sandbox-admin');
      expect(ledger.status, JSON.stringify(ledger.summary)).toBe('clean');
      detail = await closeDetail(request, january.id);
    }
    expect(detail.blockingReasons).toEqual([]);
    const closed = await expectContract(
      await request.post(`/api/close/periods/${january.id}/close`, {
        headers: await mutate('sandbox-admin'),
        data: { confirmation: detail.closeConfirmation },
      }),
      201,
      ClosePeriodDetail,
    );
    expect(closed.period.status).toBe('closed');
    expect(closed.snapshots.length).toBeGreaterThan(0);
    const version = closed.snapshots[0].version;

    const built = await expectContract(
      await request.get(`/api/reports/board-pack?fiscalPeriodId=${january.id}`, {
        headers: await as('sandbox-admin'),
      }),
      200,
      BoardPack,
    );
    expect(built.source.kind).toBe('close_snapshot');
    expect(built.source.snapshotVersion).toBe(version);
    expect(built.source.takenAt).not.toBeNull();
    expect(built.source.statement).toContain('close snapshot');
    expect(built.source.draft).toBe(false);

    // Every entity row names the snapshot version it was rendered from, and the stored snapshot
    // totals agree with the as-of ledger, so `ties` is true with no differences to report.
    const entities = built.pages.find((p) => p.page === 'legal_entity')!;
    expect(entities.rows.length).toBeGreaterThan(0);
    for (const row of entities.rows) expect(row.cells['snapshot'].text).toBe(`v${version}`);
    expect(built.reconciliation.differences).toEqual([]);
    expect(built.reconciliation.ties).toBe(true);
  });
});
