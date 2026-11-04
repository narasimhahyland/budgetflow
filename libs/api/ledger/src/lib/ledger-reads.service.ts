import {
  budgets,
  exchangeRates,
  fiscalPeriods,
  ledgerBalances,
  legalEntities,
  type Tx,
} from '@bf/api/db';
import { ApiProblem, unwrap } from '@bf/api/core';
import {
  BUDGET_BUCKETS,
  CONSUMING_BUCKETS,
  emptyBalances,
  NORMAL_SIGN,
  resolvePostingPeriod,
  type BucketBalances,
  type BudgetBucket,
  type BudgetRef,
  type BudgetStatus,
  type ConsumingBucket,
  type ControlSettings,
  type CurrencyCode,
  type FxRate,
  type PeriodRef,
  type PostingPeriod,
} from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

export interface PostingBudget extends BudgetRef {
  parentId: string | null;
  path: string;
  depth: number;
  status: BudgetStatus;
  fiscalYearId: string;
  control: ControlSettings;
}

export interface BalancePair {
  budget: BucketBalances;
  reporting: BucketBalances;
}

type BudgetRow = typeof budgets.$inferSelect;

export function toPostingBudget(row: BudgetRow): PostingBudget {
  return {
    id: row.id,
    parentId: row.parentId,
    path: row.path,
    depth: row.depth,
    status: row.status,
    currency: row.currency as CurrencyCode,
    legalEntityId: row.legalEntityId,
    costCenterId: row.costCenterId,
    fiscalYearId: row.fiscalYearId,
    control: {
      basis: row.controlBasis.filter((b): b is ConsumingBucket =>
        (CONSUMING_BUCKETS as readonly string[]).includes(b),
      ),
      mode: row.controlMode,
      toleranceBps: row.toleranceBps,
    },
  };
}

/** Read side the ledger needs for postings: budget posting attributes, periods, locked plan rates, cached balances. */
@Injectable()
export class LedgerReads {
  async budgetRows(tx: Tx, ids: readonly string[]): Promise<Map<string, BudgetRow>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select()
      .from(budgets)
      .where(inArray(budgets.id, [...ids]));
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** Row locks in a fixed order: parent before children (depth), then by id. */
  async lockBudgets(tx: Tx, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.execute(
      sql`select id from ${budgets} where id in (${sql.join(
        [...new Set(ids)].map((id) => sql`${id}::uuid`),
        sql`, `,
      )}) order by depth, id for update`,
    );
  }

  async planRates(tx: Tx, fiscalYearId: string): Promise<FxRate[]> {
    const rows = await tx
      .select()
      .from(exchangeRates)
      .where(
        and(
          eq(exchangeRates.rateType, 'plan'),
          eq(exchangeRates.fiscalYearId, fiscalYearId),
          eq(exchangeRates.locked, true),
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      type: 'plan',
      base: r.baseCurrency as CurrencyCode,
      quote: r.quoteCurrency as CurrencyCode,
      value: r.rate,
    }));
  }

  /** Period for each legal entity's calendar; late items land in the next open period, flagged. */
  async postingPeriods(
    tx: Tx,
    legalEntityIds: readonly string[],
    accountingDate: string,
    allowSoftClosed: boolean,
  ): Promise<Map<string, PostingPeriod & { label: string }>> {
    const rows = await tx
      .select({
        legalEntityId: legalEntities.id,
        id: fiscalPeriods.id,
        startDate: fiscalPeriods.startDate,
        endDate: fiscalPeriods.endDate,
        status: fiscalPeriods.status,
        label: fiscalPeriods.label,
      })
      .from(legalEntities)
      .innerJoin(fiscalPeriods, eq(fiscalPeriods.fiscalCalendarId, legalEntities.fiscalCalendarId))
      .where(inArray(legalEntities.id, [...new Set(legalEntityIds)]));
    const out = new Map<string, PostingPeriod & { label: string }>();
    for (const le of new Set(legalEntityIds)) {
      const periods = rows.filter((r) => r.legalEntityId === le);
      if (periods.length === 0)
        throw new ApiProblem(
          422,
          'PERIOD_NOT_FOUND',
          'The legal entity has no fiscal calendar periods.',
        );
      const resolved = unwrap(
        resolvePostingPeriod(periods as PeriodRef[], accountingDate, { allowSoftClosed }),
      );
      out.set(le, { ...resolved, label: periods.find((p) => p.id === resolved.period.id)!.label });
    }
    return out;
  }

  /** Cached balances (natural sign) per budget in budget and reporting currency. */
  async balances(tx: Tx, budgetIds: readonly string[]): Promise<Map<string, BalancePair>> {
    const out = new Map<string, BalancePair>(
      budgetIds.map((id) => [id, { budget: emptyBalances(), reporting: emptyBalances() }]),
    );
    if (budgetIds.length === 0) return out;
    const rows = await tx
      .select({
        budgetId: ledgerBalances.budgetId,
        bucket: ledgerBalances.bucket,
        b: sql<string>`sum(${ledgerBalances.budgetAmountMinor})`,
        r: sql<string>`sum(${ledgerBalances.reportingAmountMinor})`,
      })
      .from(ledgerBalances)
      .where(inArray(ledgerBalances.budgetId, [...budgetIds]))
      .groupBy(ledgerBalances.budgetId, ledgerBalances.bucket);
    for (const row of rows) {
      if (!(BUDGET_BUCKETS as readonly string[]).includes(row.bucket)) continue;
      const pair = out.get(row.budgetId)!;
      const bucket = row.bucket as BudgetBucket;
      pair.budget[bucket] = NORMAL_SIGN[bucket] * Number(row.b);
      pair.reporting[bucket] = NORMAL_SIGN[bucket] * Number(row.r);
    }
    return out;
  }
}
