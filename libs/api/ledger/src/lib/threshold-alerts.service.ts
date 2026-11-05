import { outboxMessages, type Tx } from '@bf/api/db';
import { rollupUtilizationBps, thresholdsReached, type SubtreeTotals } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { LedgerReads } from './ledger-reads.service';

/**
 * Owner alert thresholds on roll-up utilization. Read `utilizations` before a posting and call `emit`
 * after it: every budget touched and each of its ancestors publishes `budget.threshold_crossed` for a
 * threshold it newly reaches, so a parent's owner is alerted by spend in its children.
 */
@Injectable()
export class ThresholdAlerts {
  constructor(private readonly reads: LedgerReads) {}

  /** Held, pre-encumbered, encumbered and actual of each budget and everything below it (reporting currency). */
  async subtreeTotals(tx: Tx, ids: readonly string[]): Promise<Map<string, SubtreeTotals>> {
    const out = new Map<string, SubtreeTotals>(
      ids.map((id) => [
        id,
        { heldMinor: 0, preEncumberedMinor: 0, encumberedMinor: 0, actualMinor: 0 },
      ]),
    );
    if (!ids.length) return out;
    const res = await tx.execute<{
      id: string;
      held: string;
      pre: string;
      enc: string;
      act: string;
    }>(sql`
      select b.id,
        coalesce(sum(lb.reporting_amount_minor) filter (where lb.bucket = 'held'), 0)::text as held,
        coalesce(sum(lb.reporting_amount_minor) filter (where lb.bucket = 'pre_encumbered'), 0)::text as pre,
        coalesce(sum(lb.reporting_amount_minor) filter (where lb.bucket = 'encumbered'), 0)::text as enc,
        coalesce(sum(lb.reporting_amount_minor) filter (where lb.bucket = 'actual'), 0)::text as act
      from budgets b
      join budgets d on d.tenant_id = b.tenant_id and left(d.path, length(b.path)) = b.path
      join ledger_balances lb on lb.budget_id = d.id and lb.bucket in ('held', 'pre_encumbered', 'encumbered', 'actual')
      where b.id in (${sql.join(
        [...new Set(ids)].map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      group by b.id`);
    for (const r of res.rows)
      out.set(r.id, {
        heldMinor: Number(r.held),
        preEncumberedMinor: Number(r.pre),
        encumberedMinor: Number(r.enc),
        actualMinor: Number(r.act),
      });
    return out;
  }

  /** Roll-up utilization (basis points) of the budgets and all their ancestors. */
  async utilizations(tx: Tx, budgetIds: readonly string[]): Promise<Map<string, number>> {
    const rows = await this.reads.budgetRows(tx, budgetIds);
    const ids = new Set<string>();
    for (const r of rows.values()) for (const id of r.path.split('/').filter(Boolean)) ids.add(id);
    const all = [...ids];
    const [balances, subtree] = await Promise.all([
      this.reads.balances(tx, all),
      this.subtreeTotals(tx, all),
    ]);
    return new Map(
      all.map((id) => [
        id,
        rollupUtilizationBps(balances.get(id)!.reporting.authorized, subtree.get(id)!),
      ]),
    );
  }

  async emit(
    tx: Tx,
    tenantId: string,
    before: Map<string, number>,
    budgetIds: readonly string[],
  ): Promise<void> {
    const after = await this.utilizations(tx, budgetIds);
    const rows = await this.reads.budgetRows(tx, [...after.keys()]);
    for (const [id, util] of after) {
      const r = rows.get(id)!;
      for (const t of thresholdsReached(before.get(id) ?? 0, util, r.alertThresholdsPct))
        await tx.insert(outboxMessages).values({
          tenantId,
          topic: 'budget.threshold_crossed',
          payload: {
            tenantId,
            budgetId: r.id,
            ownerPersonId: r.ownerPersonId,
            thresholdPct: t,
            utilizationBps: util,
            occurredAt: new Date().toISOString(),
          },
        });
    }
  }
}
