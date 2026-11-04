import {
  actuals,
  budgets,
  commitments,
  costCenters,
  events,
  exchangeRates,
  fiscalPeriods,
  fiscalYears,
  glAccounts,
  legalEntities,
  ledgerLines,
  people,
  vendors,
  type Tx,
} from '@bf/api/db';
import { ApiProblem, type RequestActor } from '@bf/api/core';
import {
  convert,
  crossRate,
  exponentOf,
  isCurrencyCode,
  toSafeMinor,
  type AppliedRate,
  type CurrencyCode,
  type FxRate,
  type RateType,
} from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';

export interface CommandContext {
  idempotencyKey: string;
  requestId: string | null;
}

export const todayUtc = (): string => new Date().toISOString().slice(0, 10);

export const tenantOf = (actor: Pick<RequestActor, 'tenantId'>) => ({
  kind: 'tenant' as const,
  tenantId: actor.tenantId,
});

/** Minor units as a plain decimal string for export files ("-1234.50"), without floating point. */
export function decimalOf(minor: number, currency: string): string {
  const exp = isCurrencyCode(currency) ? exponentOf(currency) : 2;
  const abs = Math.abs(minor)
    .toString()
    .padStart(exp + 1, '0');
  const int = abs.slice(0, abs.length - exp);
  return `${minor < 0 ? '-' : ''}${int}${exp ? `.${abs.slice(-exp)}` : ''}`;
}

/** Human reference for a commitment (shown in the UI and accepted in import files). */
export const commitmentRef = (id: string): string => `CMT-${id.slice(-8).toUpperCase()}`;

export type ActualRow = typeof actuals.$inferSelect;
export type CommitmentRow = typeof commitments.$inferSelect;

export interface CommitmentBalance {
  budgetId: string;
  encumberedMinor: number;
  /** Encumbered in the reporting currency at the locked plan rate. */
  encumberedReportingMinor: number;
  accruedMinor: number;
}

/** Read helpers shared by the actuals services: plan and actual rates, ledger balances per commitment, names. */
@Injectable()
export class ActualsReads {
  /** Locked plan rates of the group fiscal year containing `date` (budget control always uses these). */
  async planRatesOn(
    tx: Tx,
    date: string,
  ): Promise<{ fiscalYearId: string; rates: FxRate[] } | null> {
    const rows = await tx
      .select({ rate: exchangeRates, fy: fiscalYears.id })
      .from(exchangeRates)
      .innerJoin(fiscalYears, eq(fiscalYears.id, exchangeRates.fiscalYearId))
      .where(
        and(
          eq(exchangeRates.rateType, 'plan'),
          eq(exchangeRates.locked, true),
          lte(fiscalYears.startDate, date),
          gte(fiscalYears.endDate, date),
        ),
      );
    if (rows.length === 0) return null;
    const fy = rows[0].fy;
    return {
      fiscalYearId: fy,
      rates: rows
        .filter((r) => r.fy === fy)
        .map((r) => ({
          id: r.rate.id,
          type: 'plan' as const,
          base: r.rate.baseCurrency as CurrencyCode,
          quote: r.rate.quoteCurrency as CurrencyCode,
          value: r.rate.rate,
        })),
    };
  }

  /**
   * Rate for the FX view of an actual: the month-end rate of the transaction month, else the latest
   * spot rate on or before the date. Null when neither exists (no FX effect is reported).
   */
  async actualRate(
    tx: Tx,
    currency: CurrencyCode,
    reporting: CurrencyCode,
    date: string,
  ): Promise<{ type: RateType; rate: AppliedRate } | null> {
    if (currency === reporting) return null;
    const monthEnd = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10);
    const pick = async (type: 'month_end' | 'spot') => {
      const [r] = await tx
        .select()
        .from(exchangeRates)
        .where(
          and(
            eq(exchangeRates.rateType, type),
            eq(exchangeRates.baseCurrency, reporting),
            eq(exchangeRates.quoteCurrency, currency),
            type === 'month_end'
              ? eq(exchangeRates.effectiveDate, monthEnd)
              : lte(exchangeRates.effectiveDate, date),
          ),
        )
        .orderBy(desc(exchangeRates.effectiveDate))
        .limit(1);
      return r ?? null;
    };
    const row = (await pick('month_end')) ?? (await pick('spot'));
    if (!row) return null;
    const applied = crossRate(
      currency,
      reporting,
      reporting,
      [
        {
          id: row.id,
          type: row.rateType,
          base: row.baseCurrency as CurrencyCode,
          quote: row.quoteCurrency as CurrencyCode,
          value: row.rate,
        },
      ],
      row.rateType,
    );
    return applied.ok ? { type: row.rateType, rate: applied.value } : null;
  }

  /** Amount converted with an applied rate (half-even at the line). */
  convertWith(amountMinor: number, rate: AppliedRate): number {
    const sign = amountMinor < 0 ? -1 : 1;
    const c = convert({ amountMinor: Math.abs(amountMinor), currency: rate.from }, rate);
    return c.ok ? sign * c.value.amountMinor : 0;
  }

  /** Encumbrance and accruals still on the ledger per commitment (budget currency, natural sign). */
  async commitmentBalances(
    tx: Tx,
    ids: readonly string[],
  ): Promise<Map<string, CommitmentBalance>> {
    const out = new Map<string, CommitmentBalance>();
    if (ids.length === 0) return out;
    const rows = await tx
      .select({
        commitmentId: ledgerLines.commitmentId,
        budgetId: ledgerLines.budgetId,
        account: ledgerLines.account,
        total: sql<string>`sum(${ledgerLines.budgetAmountMinor})`,
        reporting: sql<string>`sum(${ledgerLines.reportingAmountMinor})`,
      })
      .from(ledgerLines)
      .where(
        and(
          inArray(ledgerLines.commitmentId, [...ids]),
          inArray(ledgerLines.account, ['encumbered', 'accrued']),
          isNotNull(ledgerLines.budgetId),
        ),
      )
      .groupBy(ledgerLines.commitmentId, ledgerLines.budgetId, ledgerLines.account);
    for (const r of rows) {
      const id = r.commitmentId!;
      const b = out.get(id) ?? {
        budgetId: r.budgetId!,
        encumberedMinor: 0,
        encumberedReportingMinor: 0,
        accruedMinor: 0,
      };
      if (r.account === 'encumbered') {
        b.encumberedMinor += toSafeMinor(r.total);
        b.encumberedReportingMinor += toSafeMinor(r.reporting);
      } else b.accruedMinor += toSafeMinor(r.total);
      out.set(id, b);
    }
    return out;
  }

  /** Earmarks still held per contribution (giver budget currency). */
  async heldByContribution(
    tx: Tx,
    ids: readonly string[],
  ): Promise<Map<string, { budgetId: string; heldMinor: number }>> {
    const out = new Map<string, { budgetId: string; heldMinor: number }>();
    if (ids.length === 0) return out;
    const rows = await tx
      .select({
        contributionId: ledgerLines.contributionId,
        budgetId: ledgerLines.budgetId,
        total: sql<string>`sum(${ledgerLines.budgetAmountMinor})`,
      })
      .from(ledgerLines)
      .where(and(inArray(ledgerLines.contributionId, [...ids]), eq(ledgerLines.account, 'held')))
      .groupBy(ledgerLines.contributionId, ledgerLines.budgetId);
    for (const r of rows)
      out.set(r.contributionId!, { budgetId: r.budgetId!, heldMinor: toSafeMinor(r.total) });
    return out;
  }

  async budgetNames(tx: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (list.length === 0) return new Map();
    const rows = await tx
      .select({ id: budgets.id, name: budgets.name })
      .from(budgets)
      .where(inArray(budgets.id, list));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async personNames(tx: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (list.length === 0) return new Map();
    const rows = await tx
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(inArray(people.id, list));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  async lookups(tx: Tx) {
    const [entities, ccs, gls, vs, evs] = await Promise.all([
      tx.select().from(legalEntities),
      tx
        .select({ id: costCenters.id, code: costCenters.code, name: costCenters.name })
        .from(costCenters),
      tx
        .select({
          id: glAccounts.id,
          code: glAccounts.code,
          name: glAccounts.name,
          legalEntityId: glAccounts.legalEntityId,
        })
        .from(glAccounts),
      tx.select({ id: vendors.id, name: vendors.name }).from(vendors),
      tx.select({ id: events.id, code: events.eventCode }).from(events),
    ]);
    return {
      entities: new Map(entities.map((e) => [e.id, e])),
      costCenters: new Map(ccs.map((c) => [c.id, c])),
      glAccounts: new Map(gls.map((g) => [g.id, g])),
      vendors: new Map(vs.map((v) => [v.id, v.name])),
      events: new Map(evs.map((e) => [e.id, e.code])),
    };
  }

  /** The legal entity's fiscal period containing a date. */
  async periodOn(tx: Tx, legalEntityId: string, date: string) {
    const [p] = await tx
      .select({
        id: fiscalPeriods.id,
        label: fiscalPeriods.label,
        startDate: fiscalPeriods.startDate,
        endDate: fiscalPeriods.endDate,
        status: fiscalPeriods.status,
        calendarId: fiscalPeriods.fiscalCalendarId,
      })
      .from(fiscalPeriods)
      .innerJoin(legalEntities, eq(legalEntities.fiscalCalendarId, fiscalPeriods.fiscalCalendarId))
      .where(
        and(
          eq(legalEntities.id, legalEntityId),
          lte(fiscalPeriods.startDate, date),
          gte(fiscalPeriods.endDate, date),
        ),
      );
    if (!p)
      throw new ApiProblem(
        422,
        'PERIOD_NOT_FOUND',
        'The legal entity has no fiscal period for that date.',
      );
    return p;
  }

  /** The period after `periodId` in the same calendar. */
  async nextPeriod(tx: Tx, periodId: string) {
    const [p] = await tx.select().from(fiscalPeriods).where(eq(fiscalPeriods.id, periodId));
    if (!p) return null;
    const [n] = await tx
      .select()
      .from(fiscalPeriods)
      .where(
        and(
          eq(fiscalPeriods.fiscalCalendarId, p.fiscalCalendarId),
          sql`${fiscalPeriods.startDate} > ${p.endDate}`,
        ),
      )
      .orderBy(asc(fiscalPeriods.startDate))
      .limit(1);
    return n ?? null;
  }
}
