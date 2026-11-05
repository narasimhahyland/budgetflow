import { DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import { withTenant, type Db } from '@bf/api/db';
import {
  CLOSE_BUDGET_POLICIES,
  CLOSE_REASON_CODES,
  CLOSE_ROLLOVER_POLICIES,
  CLOSE_YEAR_END_RUN,
  TENANTS,
  userById,
} from '@bf/seed';
import type { INestApplicationContext } from '@nestjs/common';
import { eq } from 'drizzle-orm';

const T = TENANTS.acme;

/**
 * Phase 11 fixtures: the rollover policies and close reason codes finance picks from, a policy on
 * every demo budget so a year-end dry run shows each outcome, and a draft FY2026 year-end run.
 * Idempotent: fixed ids with ON CONFLICT DO NOTHING.
 */
export async function seedClose(app: INestApplicationContext): Promise<void> {
  const db = app.get<Db>(DB);
  const financeAdmin = userById('finance-admin');
  await withTenant(db, { tenantId: T, subject: 'seed' }, async (tx) => {
    await tx.insert(s.rolloverPolicies).values(CLOSE_ROLLOVER_POLICIES).onConflictDoNothing();
    await tx
      .insert(s.reasonCodes)
      .values(
        CLOSE_REASON_CODES.map((r) => ({
          id: r.id,
          tenantId: T,
          code: r.code,
          category: 'period_close',
          label: r.label,
        })),
      )
      .onConflictDoNothing();

    const policies = await tx.select().from(s.rolloverPolicies);
    const byCode = new Map(policies.map((p) => [p.code, p.id]));
    for (const assignment of CLOSE_BUDGET_POLICIES) {
      const policyId = byCode.get(assignment.policyCode);
      if (!policyId) continue;
      await tx
        .update(s.budgets)
        .set({ rolloverPolicyId: policyId })
        .where(eq(s.budgets.id, assignment.budgetId));
    }

    await tx
      .insert(s.yearEndRuns)
      .values({
        id: CLOSE_YEAR_END_RUN.id,
        tenantId: T,
        fiscalYearId: CLOSE_YEAR_END_RUN.fiscalYearId,
        targetFiscalYearId: CLOSE_YEAR_END_RUN.targetFiscalYearId,
        rootBudgetId: CLOSE_YEAR_END_RUN.rootBudgetId,
        commitmentFreezeDate: CLOSE_YEAR_END_RUN.commitmentFreezeDate,
        status: 'draft',
        dryRun: true,
        createdBy: financeAdmin.personId,
      })
      .onConflictDoNothing();
  });
}
