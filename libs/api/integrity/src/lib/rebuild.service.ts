import { AuditService } from '@bf/api/audit';
import { DB } from '@bf/api/core';
import {
  integrityCheckRuns,
  integrityFlags,
  tenants,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import {
  checkHierarchy,
  checkPlanTie,
  compareBalances,
  type BalanceDrift,
  type HierarchyMismatch,
  type PlanTieMismatch,
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
  planTieMismatches: PlanTieMismatch[];
  auditChain: { valid: boolean; checked: number; firstBrokenSeq: number | null };
}

const SYSTEM = 'system:worker';
const n = (v: unknown) => Number(v ?? 0);

/**
 * The ledger rebuild check: recomputes every bucket balance from ledger lines, compares it with the
 * cached balances, verifies that journals balance, parents' allocated out equals children's authorized,
 * roots tie to their plan version, and the audit hash chain is intact. Drift raises integrity flags;
 * nothing is ever repaired automatically. Idempotent per check run.
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
        (tx) => this.compute(tx),
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
      s.planTieMismatches.length === 0 &&
      s.auditChain.valid
    );
  }

  private async compute(tx: Tx): Promise<RebuildSummary> {
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
      ao: string;
      au: string;
    }>(
      sql`with l as (
            select l.budget_id, l.account, l.reporting_amount_minor from ledger_lines l
            join ledger_journals j on j.id = l.journal_id where j.journal_type not in ('transfer', 'contribution')
          )
          select b.id, b.parent_id,
                 coalesce(sum(case when l.account = 'allocated_out' then l.reporting_amount_minor end), 0)::text as ao,
                 coalesce(-sum(case when l.account = 'authorized' then l.reporting_amount_minor end), 0)::text as au
          from budgets b left join l on l.budget_id = b.id group by b.id, b.parent_id`,
    );
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
    return {
      budgetsChecked: n(counts.rows[0].budgets),
      journalsChecked: n(counts.rows[0].journals),
      linesChecked: n(counts.rows[0].lines),
      unbalancedJournals: unbalanced.rows.map((r) => r.id),
      balanceDrifts: compareBalances(toRows(rebuilt.rows), toRows(cached.rows)),
      hierarchyMismatches: checkHierarchy(
        totals.rows.map((r) => ({ id: r.id, parentId: r.parent_id })),
        new Map(
          totals.rows.map((r) => [
            r.id,
            { allocatedOutReportingMinor: n(r.ao), authorizedReportingMinor: n(r.au) },
          ]),
        ),
      ),
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
