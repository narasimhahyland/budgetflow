import { DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import { withTenant, type Db, type Tx } from '@bf/api/db';
import {
  CLOSE_BUDGET_POLICIES,
  CLOSE_REASON_CODES,
  CLOSE_ROLLOVER_POLICIES,
  CLOSE_YEAR_END_RUN,
  FISCAL_YEARS,
  FORECAST_CYCLES,
  FORECAST_SHARES,
  TENANTS,
  userById,
} from '@bf/seed';
import type { INestApplicationContext } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

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

    await seedPeriodCloseSnapshots(tx, financeAdmin.personId);
    await seedForecastCycles(tx, financeAdmin.personId);
  });
}

/**
 * As-of snapshots for the periods the seed leaves closed, so the board and FP&A pack has an
 * immutable source to read. Computed from the ledger with the same aggregation the close takes, so
 * the pack's reconciliation ties on a freshly seeded stack and would report a difference if the
 * two ever drifted apart.
 */
async function seedPeriodCloseSnapshots(tx: Tx, takenBy: string | null): Promise<void> {
  const periods = await tx.execute<{ id: string; end_date: string }>(sql`
    select p.id, p.end_date::text as end_date
    from fiscal_periods p
    join fiscal_years y on y.id = p.fiscal_year_id
    where y.id = ${FISCAL_YEARS.acmeFy2026}::uuid and p.status = 'closed'
    order by p.end_date desc, p.id
    limit 1`);
  const period = periods.rows[0];
  if (!period) return;
  const existing = await tx.execute<{ n: string }>(
    sql`select count(*)::text as n from period_close_snapshots where fiscal_period_id = ${period.id}::uuid`,
  );
  if (Number(existing.rows[0]?.n ?? 0) > 0) return;
  // One row per legal entity, cumulative to the period end, in the reporting currency. Summed over
  // the fiscal year's live budgets, which is the population the board pack reads, so a freshly
  // seeded pack ties and any later drift between the two is reported rather than absorbed.
  await tx.execute(sql`
    insert into period_close_snapshots
      (tenant_id, fiscal_period_id, legal_entity_id, balances, taken_by, version, currency, budget_count)
    select ${T}::uuid, ${period.id}::uuid, l.legal_entity_id,
           jsonb_build_object(
             'authorizedMinor', abs(coalesce(sum(case when l.account = 'authorized' then l.reporting_amount_minor end), 0)),
             'allocatedOutMinor', abs(coalesce(sum(case when l.account = 'allocated_out' then l.reporting_amount_minor end), 0)),
             'heldMinor', abs(coalesce(sum(case when l.account = 'held' then l.reporting_amount_minor end), 0)),
             'preEncumberedMinor', abs(coalesce(sum(case when l.account = 'pre_encumbered' then l.reporting_amount_minor end), 0)),
             'encumberedMinor', abs(coalesce(sum(case when l.account = 'encumbered' then l.reporting_amount_minor end), 0)),
             'actualMinor', abs(coalesce(sum(case when l.account = 'actual' then l.reporting_amount_minor end), 0)),
             'accruedMinor', abs(coalesce(sum(case when l.account = 'accrued' then l.reporting_amount_minor end), 0))
           ),
           ${takenBy}::uuid, 1, 'USD', count(distinct l.budget_id)
    from ledger_lines l
    join fiscal_periods fp on fp.id = l.fiscal_period_id
    join budgets b on b.id = l.budget_id
    where fp.end_date <= ${period.end_date}::date
      and b.fiscal_year_id = ${FISCAL_YEARS.acmeFy2026}::uuid
      and b.status <> 'cancelled'
      and l.account in ('authorized', 'allocated_out', 'held', 'pre_encumbered', 'encumbered', 'actual', 'accrued')
    group by l.legal_entity_id`);
}

/**
 * A closed September reforecast and an open October one. The forecast amount of each line is a
 * share of that budget's net authorized amount read from the ledger, so the figures always sit
 * beside real money without ever becoming any: nothing here writes a journal or a bucket.
 */
async function seedForecastCycles(tx: Tx, financeAdminId: string | null): Promise<void> {
  for (const cycle of Object.values(FORECAST_CYCLES))
    await tx
      .insert(s.forecastCycles)
      .values({
        id: cycle.id,
        tenantId: T,
        name: cycle.name,
        asOfDate: cycle.asOfDate,
        dueDate: cycle.dueDate,
        fiscalYearId: cycle.fiscalYearId,
        status: cycle.status,
        currency: 'USD',
        varianceThresholdBps: 1_000,
        varianceThresholdMinor: 100_000,
        createdBy: financeAdminId,
        closedAt: cycle.closedAt ? new Date(cycle.closedAt) : null,
        closedBy: cycle.closedAt ? financeAdminId : null,
      })
      .onConflictDoNothing();

  const budgetIds = [...new Set(FORECAST_SHARES.map((f) => f.budgetId))];
  const facts = await tx.execute<{
    budget_id: string;
    authorized: string;
    actual: string;
    committed: string;
    pending: string;
    owner_person_id: string | null;
  }>(sql`
    -- authorized is credit-normal in the ledger, allocated_out debit-normal, so the budget's own
    -- room is -(authorized) - allocated_out: exactly what the report nets so money counts once.
    select b.id as budget_id, b.owner_person_id,
           (-coalesce(sum(case when lb.bucket = 'authorized' then lb.reporting_amount_minor end), 0)
            - coalesce(sum(case when lb.bucket = 'allocated_out' then lb.reporting_amount_minor end), 0))::text as authorized,
           coalesce(sum(case when lb.bucket = 'actual' then lb.reporting_amount_minor end), 0)::text as actual,
           coalesce(sum(case when lb.bucket in ('held', 'pre_encumbered', 'encumbered') then lb.reporting_amount_minor end), 0)::text as committed,
           coalesce(sum(case when lb.bucket = 'pre_encumbered' then lb.reporting_amount_minor end), 0)::text as pending
    from budgets b
    left join ledger_balances lb on lb.budget_id = b.id
    where b.id in (${sql.join(
      budgetIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
    group by b.id, b.owner_person_id`);
  const byBudget = new Map(facts.rows.map((r) => [r.budget_id, r]));

  for (const line of FORECAST_SHARES) {
    const f = byBudget.get(line.budgetId);
    if (!f) continue;
    const cycle = FORECAST_CYCLES[line.cycle];
    const authorizedMinor = Number(f.authorized);
    const amountMinor = Math.round((authorizedMinor * line.forecastBps) / 10_000);
    const varianceMinor = authorizedMinor - amountMinor;
    const varianceBps =
      authorizedMinor > 0 ? Math.round((varianceMinor * 10_000) / authorizedMinor) : 0;
    const commentaryRequired = Math.abs(varianceMinor) >= 100_000 && Math.abs(varianceBps) >= 1_000;
    await tx
      .insert(s.forecastSnapshots)
      .values({
        tenantId: T,
        cycleId: cycle.id,
        budgetId: line.budgetId,
        method: line.method,
        asOfDate: cycle.asOfDate,
        amountMinor,
        currency: 'USD',
        varianceBps,
        varianceMinor,
        commentary: line.commentary,
        commentaryRequired,
        commentaryNote: line.commentaryNote ?? null,
        status: line.status,
        authorizedMinor,
        actualMinor: Number(f.actual),
        committedMinor: Number(f.committed),
        pendingMinor: Number(f.pending),
        systemGenerated: false,
        createdBy: f.owner_person_id,
        submittedAt: line.status === 'draft' ? null : new Date(`${cycle.dueDate}T09:00:00.000Z`),
        acceptedAt: line.status === 'accepted' ? new Date(`${cycle.dueDate}T12:00:00.000Z`) : null,
        acceptedBy: line.status === 'accepted' ? financeAdminId : null,
      })
      .onConflictDoNothing();
  }
}
