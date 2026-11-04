import { AuditService } from '@bf/api/audit';
import { DB } from '@bf/api/core';
import {
  exchangeRates,
  integrityCheckRuns,
  integrityFlags,
  tenants,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import {
  checkBucketBalances,
  checkHierarchy,
  checkLineTriplet,
  checkPlanTie,
  compareBalances,
  toSafeMinor,
  type BalanceDrift,
  type CurrencyCode,
  type FxRate,
  type HierarchyMismatch,
  type LedgerAccount,
  type NegativeBucket,
  type OverAllocatedBudget,
  type PlanTieMismatch,
  type RateType,
  type TripletMismatch,
} from '@bf/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

export interface RebuildSummary {
  budgetsChecked: number;
  journalsChecked: number;
  linesChecked: number;
  unbalancedJournals: string[];
  balanceDrifts: BalanceDrift[];
  hierarchyMismatches: HierarchyMismatch[];
  negativeBuckets: NegativeBucket[];
  overAllocatedBudgets: OverAllocatedBudget[];
  tripletMismatches: TripletMismatch[];
  planTieMismatches: PlanTieMismatch[];
  auditChain: { valid: boolean; checked: number; firstBrokenSeq: number | null };
}

const SYSTEM = 'system:worker';
const n = toSafeMinor;
const LINE_BATCH = 5000;

/**
 * The ledger rebuild check: recomputes every bucket balance from ledger lines, compares it with the
 * cached balances, verifies that journals balance, no bucket is negative, no budget has allocated out
 * more than it holds, every line's triplet matches its stored rates, parents' allocated out equals
 * children's authorized at the locked plan rate, roots tie to their plan version, and the audit hash
 * chain is intact. Drift raises integrity flags; nothing is ever repaired automatically. Idempotent per
 * check run.
 */
@Injectable()
export class RebuildService {
  private readonly log = new Logger('RebuildService');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async run(tenantId: string, checkRunId: string): Promise<'clean' | 'drift_detected' | 'skipped'> {
    const claimed = await withTenant(this.db, { tenantId, subject: SYSTEM }, (tx) =>
      tx.execute(
        sql`update ${integrityCheckRuns} set status = 'running', started_at = now()
            where id = ${checkRunId} and (status = 'queued' or (status = 'running' and started_at < now() - interval '10 minutes'))
            returning id`,
      ),
    );
    if (claimed.rows.length === 0) return 'skipped';
    try {
      const summary = await withTenant(
        this.db,
        { tenantId, subject: SYSTEM },
        (tx) => this.compute(tx, tenantId),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
      const status = this.isClean(summary) ? 'clean' : 'drift_detected';
      await withTenant(this.db, { tenantId, subject: SYSTEM }, async (tx) => {
        const flags = this.flags(tenantId, checkRunId, summary);
        if (flags.length) await tx.insert(integrityFlags).values(flags);
        await tx
          .update(integrityCheckRuns)
          .set({ status, finishedAt: new Date(), summary, flagsRaised: flags.length })
          .where(
            and(eq(integrityCheckRuns.id, checkRunId), eq(integrityCheckRuns.tenantId, tenantId)),
          );
        await this.audit.append(tx, {
          tenantId,
          actorPersonId: null,
          actorSubject: SYSTEM,
          action: 'integrity.ledger_check.completed',
          resourceType: 'integrity_check_run',
          resourceId: checkRunId,
          changes: {
            status: { from: 'running', to: status },
            flagsRaised: { from: 0, to: flags.length },
          },
        });
      });
      return status;
    } catch (e) {
      this.log.error(`ledger check ${checkRunId} failed: ${(e as Error).message}`);
      await withTenant(this.db, { tenantId, subject: SYSTEM }, (tx) =>
        tx
          .update(integrityCheckRuns)
          .set({ status: 'failed', finishedAt: new Date() })
          .where(eq(integrityCheckRuns.id, checkRunId)),
      );
      throw e;
    }
  }

  /** Nightly: one check run per tenant (tenants iterated explicitly; context set per tenant). */
  async runNightly(): Promise<number> {
    const all = await this.db.transaction(async (tx) =>
      tx.select({ id: tenants.id }).from(tenants),
    );
    for (const t of all) {
      const [created] = await withTenant(this.db, { tenantId: t.id, subject: SYSTEM }, (tx) =>
        tx
          .insert(integrityCheckRuns)
          .values({ tenantId: t.id, trigger: 'nightly', status: 'queued' })
          .returning({ id: integrityCheckRuns.id }),
      );
      await this.run(t.id, created.id);
    }
    return all.length;
  }

  private isClean(s: RebuildSummary): boolean {
    return (
      s.unbalancedJournals.length === 0 &&
      s.balanceDrifts.length === 0 &&
      s.hierarchyMismatches.length === 0 &&
      s.negativeBuckets.length === 0 &&
      s.overAllocatedBudgets.length === 0 &&
      s.tripletMismatches.length === 0 &&
      s.planTieMismatches.length === 0 &&
      s.auditChain.valid
    );
  }

  /**
   * Re-verifies every line's currency triplet against its stored rates (in batches), and every reversal
   * line as the exact negation of the line it reverses.
   */
  private async tripletMismatches(tx: Tx): Promise<TripletMismatch[]> {
    const out: TripletMismatch[] = [];
    let after = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const batch = await tx.execute<{
        id: string;
        journal_id: string;
        account: string;
        budget_id: string | null;
        tc: string;
        ta: string;
        bc: string | null;
        ba: string | null;
        rc: string;
        ra: string;
        brt: string | null;
        br: string | null;
        rrt: string;
        rr: string;
        n: number | null;
      }>(
        sql`select l.id, l.journal_id, l.account::text as account, l.budget_id,
                   l.transaction_currency as tc, l.transaction_amount_minor::text as ta,
                   l.budget_currency as bc, l.budget_amount_minor::text as ba,
                   l.reporting_currency as rc, l.reporting_amount_minor::text as ra,
                   l.budget_rate_type::text as brt, l.budget_rate::text as br,
                   l.reporting_rate_type::text as rrt, l.reporting_rate::text as rr,
                   case when l.account = 'fx_variance' and l.transaction_amount_minor = 0
                        then (select count(*) from ledger_lines x where x.journal_id = l.journal_id)::int end as n
            from ledger_lines l
            where l.reversal_of_line_id is null and l.id > ${after}::uuid
            order by l.id limit ${LINE_BATCH}`,
      );
      for (const r of batch.rows) {
        const tc = r.tc as CurrencyCode;
        const mismatch = checkLineTriplet({
          id: r.id,
          journalId: r.journal_id,
          account: r.account as LedgerAccount,
          budgetId: r.budget_id,
          transaction: { amountMinor: n(r.ta), currency: tc },
          budget:
            r.bc && r.ba !== null ? { amountMinor: n(r.ba), currency: r.bc as CurrencyCode } : null,
          reporting: { amountMinor: n(r.ra), currency: r.rc as CurrencyCode },
          budgetRate:
            r.bc && r.br && r.brt
              ? {
                  type: r.brt as RateType,
                  from: tc,
                  to: r.bc as CurrencyCode,
                  value: r.br,
                  rateIds: [],
                }
              : null,
          reportingRate: {
            type: r.rrt as RateType,
            from: tc,
            to: r.rc as CurrencyCode,
            value: r.rr,
            rateIds: [],
          },
          journalLineCount: r.n ?? 0,
        });
        if (mismatch) out.push(mismatch);
      }
      if (batch.rows.length < LINE_BATCH) break;
      after = batch.rows[batch.rows.length - 1].id;
    }
    const reversals = await tx.execute<{
      line_id: string;
      journal_id: string;
      expected: string | null;
      stored: string | null;
    }>(
      sql`select l.id as line_id, l.journal_id,
                 (case when l.budget_amount_minor is distinct from -o.budget_amount_minor then -o.budget_amount_minor
                       when l.reporting_amount_minor <> -o.reporting_amount_minor then -o.reporting_amount_minor
                       else -o.transaction_amount_minor end)::text as expected,
                 (case when l.budget_amount_minor is distinct from -o.budget_amount_minor then l.budget_amount_minor
                       when l.reporting_amount_minor <> -o.reporting_amount_minor then l.reporting_amount_minor
                       else l.transaction_amount_minor end)::text as stored
          from ledger_lines l join ledger_lines o on o.id = l.reversal_of_line_id
          where l.account <> o.account or l.budget_id is distinct from o.budget_id
             or l.transaction_currency <> o.transaction_currency
             or l.budget_currency is distinct from o.budget_currency
             or l.reporting_currency <> o.reporting_currency
             or l.transaction_amount_minor <> -o.transaction_amount_minor
             or l.budget_amount_minor is distinct from -o.budget_amount_minor
             or l.reporting_amount_minor <> -o.reporting_amount_minor`,
    );
    for (const r of reversals.rows) {
      out.push({
        lineId: r.line_id,
        journalId: r.journal_id,
        view: 'reversal',
        expectedMinor: r.expected === null ? null : n(r.expected),
        storedMinor: n(r.stored),
      });
    }
    return out;
  }

  private async compute(tx: Tx, tenantId: string): Promise<RebuildSummary> {
    const rebuilt = await tx.execute<{
      budget_id: string;
      fiscal_period_id: string;
      bucket: string;
      b: string;
      r: string;
    }>(
      sql`select budget_id, fiscal_period_id, account::text as bucket, sum(budget_amount_minor)::text as b, sum(reporting_amount_minor)::text as r
          from ledger_lines where budget_id is not null group by 1, 2, 3`,
    );
    const cached = await tx.execute<{
      budget_id: string;
      fiscal_period_id: string;
      bucket: string;
      b: string;
      r: string;
    }>(
      sql`select budget_id, fiscal_period_id, bucket::text as bucket, budget_amount_minor::text as b, reporting_amount_minor::text as r from ledger_balances`,
    );
    const toRows = (
      rows: { budget_id: string; fiscal_period_id: string; bucket: string; b: string; r: string }[],
    ) =>
      rows.map((x) => ({
        budgetId: x.budget_id,
        periodId: x.fiscal_period_id,
        bucket: x.bucket,
        budgetMinor: n(x.b),
        reportingMinor: n(x.r),
      }));
    const unbalanced = await tx.execute<{ id: string }>(
      sql`select journal_id as id from ledger_lines group by journal_id
            having sum(transaction_amount_minor) <> 0 or sum(reporting_amount_minor) <> 0 or count(*) < 2
          union
          select j.id from ledger_journals j where not exists (select 1 from ledger_lines l where l.journal_id = j.id)`,
    );
    const totals = await tx.execute<{
      id: string;
      parent_id: string | null;
      currency: string;
      fiscal_year_id: string;
      ao: string;
      au: string;
      au_lines: string;
    }>(
      sql`with l as (
            select l.budget_id, l.account, l.budget_amount_minor from ledger_lines l
            join ledger_journals j on j.id = l.journal_id where j.journal_type not in ('transfer', 'contribution')
          )
          select b.id, b.parent_id, b.currency, b.fiscal_year_id,
                 coalesce(sum(case when l.account = 'allocated_out' then l.budget_amount_minor end), 0)::text as ao,
                 coalesce(-sum(case when l.account = 'authorized' then l.budget_amount_minor end), 0)::text as au,
                 count(*) filter (where l.account = 'authorized')::text as au_lines
          from budgets b left join l on l.budget_id = b.id group by b.id, b.parent_id, b.currency, b.fiscal_year_id`,
    );
    const [tenant] = await tx
      .select({ reportingCurrency: tenants.reportingCurrency })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    const rates = await tx
      .select()
      .from(exchangeRates)
      .where(and(eq(exchangeRates.rateType, 'plan'), eq(exchangeRates.locked, true)));
    const ratesByFiscalYear = new Map<string, FxRate[]>();
    for (const r of rates) {
      if (!r.fiscalYearId) continue;
      ratesByFiscalYear.set(r.fiscalYearId, [
        ...(ratesByFiscalYear.get(r.fiscalYearId) ?? []),
        {
          id: r.id,
          type: 'plan',
          base: r.baseCurrency as CurrencyCode,
          quote: r.quoteCurrency as CurrencyCode,
          value: r.rate,
        },
      ]);
    }
    const hierarchy = checkHierarchy(
      totals.rows.map((r) => ({
        id: r.id,
        parentId: r.parent_id,
        currency: r.currency as CurrencyCode,
        fiscalYearId: r.fiscal_year_id,
      })),
      new Map(
        totals.rows.map((r) => [
          r.id,
          { allocatedOutMinor: n(r.ao), authorizedMinor: n(r.au), authorizedLines: n(r.au_lines) },
        ]),
      ),
      { reportingCurrency: tenant.reportingCurrency as CurrencyCode, ratesByFiscalYear },
    );
    if (!hierarchy.ok) throw new Error(`hierarchy check: ${hierarchy.error.message}`);
    const plan = await tx.execute<{ plan_version_id: string; pf: string; ra: string }>(
      sql`select plan_version_id,
                 coalesce(sum(case when account = 'plan_funding' then reporting_amount_minor end), 0)::text as pf,
                 coalesce(-sum(case when account = 'authorized' then reporting_amount_minor end), 0)::text as ra
          from ledger_lines where plan_version_id is not null group by plan_version_id`,
    );
    const counts = await tx.execute<{ budgets: string; journals: string; lines: string }>(
      sql`select (select count(*) from budgets)::text as budgets, (select count(*) from ledger_journals)::text as journals, (select count(*) from ledger_lines)::text as lines`,
    );
    const chain = await this.audit.verify(tx);
    const rebuiltRows = toRows(rebuilt.rows);
    const buckets = checkBucketBalances(rebuiltRows);
    return {
      budgetsChecked: n(counts.rows[0].budgets),
      journalsChecked: n(counts.rows[0].journals),
      linesChecked: n(counts.rows[0].lines),
      unbalancedJournals: unbalanced.rows.map((r) => r.id),
      balanceDrifts: compareBalances(rebuiltRows, toRows(cached.rows)),
      hierarchyMismatches: hierarchy.value,
      negativeBuckets: buckets.negativeBuckets,
      overAllocatedBudgets: buckets.overAllocatedBudgets,
      tripletMismatches: await this.tripletMismatches(tx),
      planTieMismatches: checkPlanTie(
        plan.rows.map((r) => ({
          planVersionId: r.plan_version_id,
          planFundingReportingMinor: n(r.pf),
          rootAuthorizedReportingMinor: n(r.ra),
        })),
      ),
      auditChain: {
        valid: chain.valid,
        checked: chain.checked,
        firstBrokenSeq: chain.firstBrokenSeq,
      },
    };
  }

  private flags(tenantId: string, checkRunId: string, s: RebuildSummary) {
    const base = { tenantId, checkRunId, severity: 'high' as const };
    return [
      ...s.balanceDrifts.map((d) => ({
        ...base,
        kind: 'ledger_drift' as const,
        resourceType: 'budget',
        resourceId: d.budgetId,
        details: d,
      })),
      ...s.unbalancedJournals.map((id) => ({
        ...base,
        kind: 'journal_unbalanced' as const,
        resourceType: 'journal',
        resourceId: id,
        details: {},
      })),
      ...s.hierarchyMismatches.map((h) => ({
        ...base,
        kind: 'hierarchy_mismatch' as const,
        resourceType: 'budget',
        resourceId: h.parentId,
        details: h,
      })),
      ...s.negativeBuckets.map((b) => ({
        ...base,
        kind: 'negative_bucket' as const,
        resourceType: 'budget',
        resourceId: b.budgetId,
        details: b,
      })),
      ...s.overAllocatedBudgets.map((b) => ({
        ...base,
        kind: 'over_allocated' as const,
        resourceType: 'budget',
        resourceId: b.budgetId,
        details: b,
      })),
      ...s.tripletMismatches.map((t) => ({
        ...base,
        kind: 'triplet_mismatch' as const,
        resourceType: 'ledger_line',
        resourceId: t.lineId,
        details: t,
      })),
      ...s.planTieMismatches.map((p) => ({
        ...base,
        kind: 'plan_tie_mismatch' as const,
        resourceType: 'plan_version',
        resourceId: p.planVersionId,
        details: p,
      })),
      ...(s.auditChain.valid
        ? []
        : [
            {
              ...base,
              kind: 'audit_chain_broken' as const,
              resourceType: 'audit_chain',
              resourceId: String(s.auditChain.firstBrokenSeq),
              details: s.auditChain,
            },
          ]),
    ];
  }
}
