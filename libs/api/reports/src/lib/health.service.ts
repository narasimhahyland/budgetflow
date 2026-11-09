import { ApiProblem, DB, type RequestActor, todayUtc } from '@bf/api/core';
import { withTenant, type Db, type Tx } from '@bf/api/db';
import type { BudgetHealthOverview, BudgetHealthRow, Money } from '@bf/contracts';
import type { z } from 'zod';
import { HealthMatrixRow as HealthMatrixRowSchema } from '@bf/contracts';
import {
  DEFAULT_HEALTH_THRESHOLDS,
  evaluateHealth,
  HEALTH_CHECKS,
  type HealthInput,
  type HealthLevel,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ReportReads, sumBuckets, type ScopedBudget } from './report-reads.service';

export interface BudgetHealthQuery {
  fiscalYearId?: string;
  rootBudgetId?: string;
  level?: HealthLevel;
  check?: (typeof HEALTH_CHECKS)[number];
  limit?: number;
}

type MatrixRow = z.infer<typeof HealthMatrixRowSchema>;

const RANK: Record<HealthLevel, number> = { healthy: 0, watch: 1, at_risk: 2 };

/**
 * Final tie-break for every ordered list on this screen. Budgets tie on level and pace often (two
 * untouched budgets both pace at zero), and the budget query has no ORDER BY, so without this the
 * order is whatever Postgres returned and two people running the same report see different orders.
 * Name then id is a total order because ids are unique.
 */
const byNameThenId = (a: { name: string; id: string }, b: { name: string; id: string }) =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

interface SubtreeRow {
  held: number;
  preEncumbered: number;
  encumbered: number;
  actual: number;
}

interface HygieneRow {
  agedCommitmentsMinor: number;
  agedCommitmentsCount: number;
  unmatchedActualsMinor: number;
  unmatchedActualsCount: number;
}

/**
 * Budget health overview (screen 013): five written checks evaluated server-side from ledger
 * balances, phasing, controls, commitment ageing and unmatched actuals. Health never blocks
 * anything; it says in one sentence why a budget needs attention.
 */
@Injectable()
export class HealthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly reads: ReportReads,
  ) {}

  overview(actor: RequestActor, q: BudgetHealthQuery): Promise<BudgetHealthOverview> {
    if (!this.reads.tenantWide(actor) && this.reads.scopePaths(actor) === 'none')
      throw ApiProblem.forbidden('Budget health is for finance roles and budget owners.');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const today = todayUtc();
      const dataset = await this.reads.dataset(
        tx,
        actor,
        { fiscalYearId: q.fiscalYearId, rootBudgetId: q.rootBudgetId },
        today,
      );
      const ids = dataset.budgets.map((b) => b.row.id);
      const [subtree, phased, hygiene] = await Promise.all([
        this.subtotals(tx, ids),
        this.phasedToDate(tx, ids, today),
        this.hygiene(tx, ids, DEFAULT_HEALTH_THRESHOLDS.hygieneDays),
      ]);
      const currency = dataset.currency;
      const money = (amountMinor: number): Money => ({ amountMinor, currency });
      const format = (amountMinor: number) =>
        `${currency} ${(amountMinor / 100).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;
      const fy = dataset.fiscalYear;

      const evaluated = dataset.budgets.map((b) => {
        const sub = subtree.get(b.row.id) ?? {
          held: 0,
          preEncumbered: 0,
          encumbered: 0,
          actual: 0,
        };
        const hy = hygiene.get(b.row.id) ?? {
          agedCommitmentsMinor: 0,
          agedCommitmentsCount: 0,
          unmatchedActualsMinor: 0,
          unmatchedActualsCount: 0,
        };
        const input: HealthInput = {
          status: b.row.status,
          authorizedMinor: b.balances.authorized,
          heldMinor: sub.held,
          preEncumberedMinor: sub.preEncumbered,
          encumberedMinor: sub.encumbered,
          actualMinor: sub.actual,
          phasedToDateMinor: phased.get(b.row.id) ?? null,
          elapsedBps: fy?.elapsedBps ?? 0,
          daysLeft: fy?.daysLeft ?? 0,
          monthsLeft: fy?.monthsLeft ?? 0,
          toleranceBps: b.row.toleranceBps,
          openCommitmentsMinor: sub.encumbered + sub.preEncumbered,
          ...hy,
        };
        const outcome = evaluateHealth(input, DEFAULT_HEALTH_THRESHOLDS, format);
        return { budget: b, outcome, input };
      });

      const summary = {
        budgets: evaluated.length,
        healthy: evaluated.filter((e) => e.outcome.level === 'healthy').length,
        watch: evaluated.filter((e) => e.outcome.level === 'watch').length,
        atRisk: evaluated.filter((e) => e.outcome.level === 'at_risk').length,
      };

      const filtered = evaluated
        .filter((e) => (q.level ? e.outcome.level === q.level : e.outcome.level !== 'healthy'))
        .filter((e) => (q.check ? e.outcome.reasons.some((r) => r.check === q.check) : true))
        .sort(
          (a, b) =>
            RANK[b.outcome.level] - RANK[a.outcome.level] ||
            b.outcome.pacedToDateBps - a.outcome.pacedToDateBps ||
            byNameThenId(a.budget.row, b.budget.row),
        )
        .slice(0, q.limit ?? 200);

      const rows: BudgetHealthRow[] = filtered.map(({ budget, outcome }) => ({
        budgetId: budget.row.id,
        name: budget.row.name,
        ownerName: budget.ownerName,
        status: budget.row.status,
        level: outcome.level,
        reasons: outcome.reasons,
        authorized: money(budget.balances.authorized),
        committed: money(outcome.committedMinor),
        actual: money(subtree.get(budget.row.id)?.actual ?? 0),
        available: money(outcome.availableMinor),
        utilizationBps:
          budget.balances.authorized > 0
            ? Math.round(
                (((subtree.get(budget.row.id)?.encumbered ?? 0) +
                  (subtree.get(budget.row.id)?.actual ?? 0)) *
                  10_000) /
                  budget.balances.authorized,
              )
            : 0,
        pacedToDateBps: outcome.pacedToDateBps,
        lastActivityAt: budget.lastActivityAt?.toISOString() ?? null,
      }));

      const totals = sumBuckets(dataset.budgets);
      return {
        generatedAt: dataset.asOf,
        asOf: today,
        currency,
        scope: {
          tenantWide: dataset.tenantWide,
          label: dataset.scopeLabel,
          budgetIds: dataset.budgets.length,
          note: dataset.tenantWide ? null : 'Showing budgets you can see.',
        },
        thresholds: DEFAULT_HEALTH_THRESHOLDS,
        summary,
        matrix: matrixOf(evaluated),
        rows,
        reconciliation: {
          source: 'ledger_balances',
          budgetsCounted: dataset.budgets.length,
          authorized: money(totals.authorized),
          held: money(totals.held),
          preEncumbered: money(totals.preEncumbered),
          encumbered: money(totals.encumbered),
          actual: money(totals.actual),
          accrued: money(totals.accrued),
          available: money(totals.available),
          ties: true,
          differences: [],
        },
      };
    });
  }

  /** Held, pre-encumbered, encumbered and actual of each budget and everything below it. */
  private async subtotals(tx: Tx, ids: readonly string[]): Promise<Map<string, SubtreeRow>> {
    const out = new Map<string, SubtreeRow>();
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
      left join ledger_balances lb on lb.budget_id = d.id
      where b.id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
      group by b.id`);
    for (const r of res.rows)
      out.set(r.id, {
        held: Number(r.held),
        preEncumbered: Number(r.pre),
        encumbered: Number(r.enc),
        actual: Number(r.act),
      });
    return out;
  }

  /** Sum of the budget's period allotments whose period has started, for the pace check. */
  private async phasedToDate(
    tx: Tx,
    ids: readonly string[],
    today: string,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!ids.length) return out;
    const res = await tx.execute<{ budget_id: string; amount: string }>(sql`
      select a.budget_id, sum(a.amount_minor)::text as amount
      from budget_period_allotments a
      join fiscal_periods fp on fp.id = a.fiscal_period_id
      where a.budget_id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}) and fp.start_date <= ${today}
      group by a.budget_id`);
    for (const r of res.rows) out.set(r.budget_id, Number(r.amount));
    return out;
  }

  /** Commitments past their service end and actuals still unmatched, both older than `days`. */
  private async hygiene(
    tx: Tx,
    ids: readonly string[],
    days: number,
  ): Promise<Map<string, HygieneRow>> {
    const out = new Map<string, HygieneRow>();
    if (!ids.length) return out;
    const list = sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const commitments = await tx.execute<{ budget_id: string; amount: string; n: string }>(sql`
      select c.budget_id,
             coalesce(sum(c.amount_minor - c.consumed_minor - c.released_minor), 0)::text as amount,
             count(*)::text as n
      from commitments c
      where c.budget_id in (${list})
        and c.status in ('pre_encumbered', 'encumbered', 'partially_consumed')
        and c.service_end is not null
        and c.service_end < current_date - ${days}::int
      group by c.budget_id`);
    for (const r of commitments.rows)
      out.set(r.budget_id, {
        agedCommitmentsMinor: Math.max(Number(r.amount), 0),
        agedCommitmentsCount: Number(r.n),
        unmatchedActualsMinor: 0,
        unmatchedActualsCount: 0,
      });
    // An unmatched actual has no budget yet; it ages against the budget it was proposed for.
    const actuals = await tx.execute<{ budget_id: string; amount: string; n: string }>(sql`
      select coalesce(a.matched_budget_id, a.proposed_budget_id) as budget_id,
             coalesce(sum(a.reporting_amount_minor), 0)::text as amount,
             count(*)::text as n
      from actuals a
      where coalesce(a.matched_budget_id, a.proposed_budget_id) in (${list})
        and a.match_status in ('unmatched', 'partially_matched')
        and a.transaction_date < current_date - ${days}::int
      group by coalesce(a.matched_budget_id, a.proposed_budget_id)`);
    for (const r of actuals.rows) {
      const cur = out.get(r.budget_id) ?? {
        agedCommitmentsMinor: 0,
        agedCommitmentsCount: 0,
        unmatchedActualsMinor: 0,
        unmatchedActualsCount: 0,
      };
      cur.unmatchedActualsMinor = Math.max(Number(r.amount), 0);
      cur.unmatchedActualsCount = Number(r.n);
      out.set(r.budget_id, cur);
    }
    return out;
  }
}

/** Rows are the top budgets of the viewer's scope; columns are the five checks. */
function matrixOf(
  evaluated: readonly {
    budget: ScopedBudget;
    outcome: { level: HealthLevel; reasons: { check: string; level: HealthLevel }[] };
  }[],
): MatrixRow[] {
  const tops = evaluated
    .filter(
      (e) =>
        !evaluated.some(
          (o) =>
            o.budget.row.id !== e.budget.row.id && e.budget.row.path.startsWith(o.budget.row.path),
        ),
    )
    .sort((a, b) => byNameThenId(a.budget.row, b.budget.row));
  return tops.map((top) => {
    const members = evaluated.filter((e) => e.budget.row.path.startsWith(top.budget.row.path));
    const cells: MatrixRow['cells'] = {};
    for (const check of HEALTH_CHECKS) {
      const hits = members.flatMap((m) => m.outcome.reasons.filter((r) => r.check === check));
      cells[check] = {
        watch: hits.filter((r) => r.level === 'watch').length,
        atRisk: hits.filter((r) => r.level === 'at_risk').length,
      };
    }
    return {
      key: top.budget.row.id,
      label: top.budget.row.name,
      orgUnitId: top.budget.orgUnitId,
      budgetId: top.budget.row.id,
      cells,
    };
  });
}
