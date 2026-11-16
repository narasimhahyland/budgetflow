import { DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import { withTenant, type Db } from '@bf/api/db';
import { LedgerReads } from '@bf/api/ledger';
import { reclaimCandidate, validateReclaimResponse } from '@bf/domain';
import {
  RECLAIM_CAMPAIGN,
  RECLAIM_NOTICES,
  RECLAIM_REASON_CODE,
  TENANTS,
  userById,
} from '@bf/seed';
import type { INestApplicationContext } from '@nestjs/common';

const T = TENANTS.acme;
const DAY = 86_400_000;
const dayNo = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);

/**
 * Gap B4: the "Year-end reclaim" reason code and the Q4 FY2026 reclaim campaign (086a). Each
 * notice's forecast and proposal are worked out from the ledger as of the campaign start with the
 * same domain rule the API applies, and each answer passes the same validation, so the fixture can
 * never propose or release more than a budget's floor allows. Idempotent: fixed ids, ON CONFLICT
 * DO NOTHING. Writes no journals and no notifications.
 */
export async function seedReclaim(app: INestApplicationContext): Promise<void> {
  const db = app.get<Db>(DB);
  const reads = app.get(LedgerReads);
  const finance = userById('finance-admin');
  await withTenant(db, { tenantId: T, subject: 'seed' }, async (tx) => {
    await tx.insert(s.reasonCodes).values(RECLAIM_REASON_CODE).onConflictDoNothing();
    const fy = await reads.fiscalYear(tx, RECLAIM_CAMPAIGN.fiscalYearId);
    const start = RECLAIM_CAMPAIGN.startedOn;
    const total = dayNo(fy.endDate) - dayNo(fy.startDate) + 1;
    const elapsedBps = Math.round(((dayNo(start) - dayNo(fy.startDate) + 1) * 10_000) / total);
    const daysLeft = dayNo(fy.endDate) - dayNo(start);
    await tx
      .insert(s.reclaimCampaigns)
      .values({
        id: RECLAIM_CAMPAIGN.id,
        tenantId: T,
        name: RECLAIM_CAMPAIGN.name,
        fiscalYearId: RECLAIM_CAMPAIGN.fiscalYearId,
        status: 'collecting',
        criteria: { ...RECLAIM_CAMPAIGN.criteria, reportingCurrency: 'USD' },
        startedOn: start,
        respondBy: RECLAIM_CAMPAIGN.respondBy,
        createdBy: finance.personId,
        createdAt: new Date(`${start}T09:00:00Z`),
        updatedAt: new Date(`${start}T09:00:00Z`),
      })
      .onConflictDoNothing();
    const ids = RECLAIM_NOTICES.map((n) => n.budgetId);
    const rows = await reads.budgetRows(tx, ids);
    const balances = await reads.balances(tx, ids);
    // The same rule as ReclaimService.decider: the nearest ancestor owner who is not the owner.
    const decider = async (row: typeof s.budgets.$inferSelect) => {
      const ancestors = row.path
        .split('/')
        .filter((x) => x && x !== row.id)
        .reverse();
      const found = await reads.budgetRows(tx, ancestors);
      for (const id of ancestors) {
        const owner = found.get(id)?.ownerPersonId;
        if (owner && owner !== row.ownerPersonId) return owner;
      }
      return null;
    };
    let i = 0;
    for (const n of RECLAIM_NOTICES) {
      const row = rows.get(n.budgetId);
      if (!row) continue;
      const pair = balances.get(n.budgetId)!;
      const c = reclaimCandidate(
        {
          status: row.status,
          balances: pair.budget,
          authorizedReportingMinor: pair.reporting.authorized,
          elapsedBps,
          daysLeft,
          pendingCarry: false,
        },
        {
          minUnusedBps: RECLAIM_CAMPAIGN.criteria.minUnusedBps,
          minUnusedReportingMinor: RECLAIM_CAMPAIGN.criteria.minUnusedReportingMinor,
          maxDaysLeft: RECLAIM_CAMPAIGN.criteria.maxDaysLeft,
        },
      );
      const a = n.answer;
      const outcome = a
        ? validateReclaimResponse(c.proposedMinor, pair.budget, {
            choice: a.choice,
            amountMinor: a.releasedMinor,
            reason: a.reason ?? 'Seeded answer',
            plan: a.plan,
          })
        : null;
      if (outcome && !outcome.ok)
        throw new Error(`reclaim seed: ${row.name}: ${outcome.error.message}`);
      const answered = outcome?.ok ? outcome.value : null;
      await tx
        .insert(s.reclaimNotices)
        .values({
          id: n.id,
          tenantId: T,
          campaignId: RECLAIM_CAMPAIGN.id,
          budgetId: row.id,
          legalEntityId: row.legalEntityId,
          currency: row.currency,
          ownerPersonId: row.ownerPersonId,
          parentOwnerPersonId: await decider(row),
          forecastUnusedMinor: c.forecastUnusedMinor,
          proposedMinor: c.proposedMinor,
          floorMinor: c.floorMinor,
          maxReclaimableMinor: c.maxReclaimableMinor,
          status: answered?.status ?? 'sent',
          choice: a?.choice ?? null,
          releasedMinor: answered?.releasedMinor ?? 0,
          keptMinor: answered?.keptMinor ?? 0,
          reason: a?.reason ?? null,
          plan: a?.plan ?? null,
          respondedAs: a ? 'owner' : null,
          respondedBy: a ? row.ownerPersonId : null,
          respondedAt: a ? new Date(a.respondedAt) : null,
          createdAt: new Date(Date.parse(`${start}T09:00:00Z`) + i++ * 1000),
        })
        .onConflictDoNothing();
    }
  });
}
