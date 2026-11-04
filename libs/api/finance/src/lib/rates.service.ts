import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type RequestActor,
} from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import { currencies, exchangeRates, fiscalYears, withTenant, type Db, type Tx } from '@bf/api/db';
import type { ExchangeRate, RateLookupResponse } from '@bf/contracts';
import {
  checkPlanRateWritable,
  formatRate,
  lookupRate,
  parseRate,
  type CurrencyCode,
  type RateType,
  type StoredRate,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, or, type SQL } from 'drizzle-orm';
import { assertTenant, invalid, type CommandContext } from './finance-base';

type Row = typeof exchangeRates.$inferSelect;

const monthEnd = (date: string) => {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

@Injectable()
export class RatesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  currencies(actor: RequestActor) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const items = await tx.select().from(currencies).orderBy(asc(currencies.code));
      return { reportingCurrency: actor.reportingCurrency, items };
    });
  }

  list(
    actor: RequestActor,
    q: {
      rateType?: RateType;
      quoteCurrency?: string;
      fiscalYearId?: string;
      cursor?: string;
      limit?: number;
    },
  ) {
    const limit = q.limit ?? 100;
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const filters: SQL[] = [];
      if (q.rateType) filters.push(eq(exchangeRates.rateType, q.rateType));
      if (q.quoteCurrency) filters.push(eq(exchangeRates.quoteCurrency, q.quoteCurrency));
      if (q.fiscalYearId) filters.push(eq(exchangeRates.fiscalYearId, q.fiscalYearId));
      if (q.cursor) {
        const [date, id] = Buffer.from(q.cursor, 'base64url').toString('utf8').split('|');
        filters.push(
          or(
            lt(exchangeRates.effectiveDate, date ?? ''),
            and(eq(exchangeRates.effectiveDate, date ?? ''), lt(exchangeRates.id, id ?? '')),
          )!,
        );
      }
      const rows = await tx
        .select()
        .from(exchangeRates)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(exchangeRates.effectiveDate), desc(exchangeRates.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        reportingCurrency: actor.reportingCurrency,
        items: await this.toDtos(tx, page),
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(`${last.effectiveDate}|${last.id}`, 'utf8').toString('base64url')
            : null,
      };
    });
  }

  create(
    actor: RequestActor,
    req: {
      rateType: RateType;
      quoteCurrency: string;
      rate: string;
      effectiveDate: string;
      fiscalYearId?: string;
      source: string;
    },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'finance.rates.create',
        request: req,
        status: 201,
      },
      async (tx): Promise<ExchangeRate> => {
        assertTenant(this.policy, actor, 'fx.manage');
        const base = actor.reportingCurrency;
        if (req.quoteCurrency === base)
          throw invalid(
            'quoteCurrency',
            `Rates are quoted against ${base}; pick another currency.`,
          );
        const [ccy] = await tx
          .select()
          .from(currencies)
          .where(eq(currencies.code, req.quoteCurrency));
        if (!ccy) throw invalid('quoteCurrency', `Unknown currency ${req.quoteCurrency}.`);
        const scaled = unwrap(parseRate(req.rate));
        let fiscalYearId: string | null = null;
        if (req.rateType === 'plan') {
          if (!req.fiscalYearId)
            throw invalid('fiscalYearId', 'Plan rates belong to a fiscal year.');
          const [fy] = await tx
            .select()
            .from(fiscalYears)
            .where(eq(fiscalYears.id, req.fiscalYearId))
            .for('update');
          if (!fy) throw invalid('fiscalYearId', 'The fiscal year does not exist.');
          unwrap(checkPlanRateWritable(fy.planRatesLockedAt !== null, fy.label));
          if (req.effectiveDate < fy.startDate || req.effectiveDate > fy.endDate)
            throw invalid(
              'effectiveDate',
              `A ${fy.label} plan rate is dated within ${fy.startDate} to ${fy.endDate}.`,
            );
          fiscalYearId = fy.id;
        } else if (req.fiscalYearId) {
          throw invalid('fiscalYearId', 'Only plan rates belong to a fiscal year.');
        }
        if (req.rateType === 'month_end' && req.effectiveDate !== monthEnd(req.effectiveDate))
          throw invalid('effectiveDate', 'Month-end rates are dated the last day of the month.');
        const [dup] = await tx
          .select({ id: exchangeRates.id })
          .from(exchangeRates)
          .where(
            and(
              eq(exchangeRates.rateType, req.rateType),
              eq(exchangeRates.baseCurrency, base),
              eq(exchangeRates.quoteCurrency, req.quoteCurrency),
              eq(exchangeRates.effectiveDate, req.effectiveDate),
            ),
          );
        if (dup)
          throw new ApiProblem(
            409,
            'DUPLICATE_CODE',
            `A ${req.rateType.replace('_', '-')} rate for ${req.quoteCurrency} on ${req.effectiveDate} already exists.`,
          );
        const [row] = await tx
          .insert(exchangeRates)
          .values({
            tenantId: actor.tenantId,
            rateType: req.rateType,
            baseCurrency: base,
            quoteCurrency: req.quoteCurrency,
            rate: formatRate(scaled),
            effectiveDate: req.effectiveDate,
            fiscalYearId,
            source: req.source,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'exchange_rate.created',
          resourceType: 'exchange_rate',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            rateType: { from: null, to: row.rateType },
            pair: { from: null, to: `${base}/${row.quoteCurrency}` },
            rate: { from: null, to: row.rate },
            effectiveDate: { from: null, to: row.effectiveDate },
          },
        });
        return (await this.toDtos(tx, [row]))[0];
      },
    );
  }

  lookup(
    actor: RequestActor,
    q: { from: string; to: string; date: string; type: RateType; amountMinor?: number },
  ): Promise<RateLookupResponse> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      return this.lookupTx(tx, actor, q);
    });
  }

  /** Rate lookup inside an existing transaction (also used by the DoA lookup to convert at the plan rate). */
  async lookupTx(
    tx: Tx,
    actor: RequestActor,
    q: { from: string; to: string; date: string; type: RateType; amountMinor?: number },
  ): Promise<RateLookupResponse> {
    const base = actor.reportingCurrency;
    const known = new Set(
      (await tx.select({ code: currencies.code }).from(currencies)).map((c) => c.code),
    );
    for (const [field, code] of [
      ['from', q.from],
      ['to', q.to],
    ] as const)
      if (!known.has(code))
        throw new ApiProblem(422, 'UNKNOWN_CURRENCY', `Unknown currency ${code}.`, { field });
    const quotes = [q.from, q.to].filter((c) => c !== base);
    const rows = quotes.length
      ? await tx
          .select()
          .from(exchangeRates)
          .where(
            and(
              eq(exchangeRates.rateType, q.type),
              eq(exchangeRates.baseCurrency, base),
              inArray(exchangeRates.quoteCurrency, quotes),
            ),
          )
      : [];
    const fyIds = [
      ...new Set(rows.map((r) => r.fiscalYearId).filter((f): f is string => Boolean(f))),
    ];
    const years = fyIds.length
      ? await tx.select().from(fiscalYears).where(inArray(fiscalYears.id, fyIds))
      : [];
    const stored: StoredRate[] = rows.map((r) => ({
      id: r.id,
      type: r.rateType,
      base: r.baseCurrency as CurrencyCode,
      quote: r.quoteCurrency as CurrencyCode,
      value: r.rate,
      effectiveDate: r.effectiveDate,
      fiscalYearId: r.fiscalYearId,
      locked: r.locked,
    }));
    const amount =
      q.amountMinor !== undefined
        ? { amountMinor: q.amountMinor, currency: q.from as CurrencyCode }
        : undefined;
    const result = unwrap(
      lookupRate(stored, {
        type: q.type,
        base,
        from: q.from as CurrencyCode,
        to: q.to as CurrencyCode,
        date: q.date,
        fiscalYears: years,
        amount,
      }),
    );
    return {
      type: q.type,
      date: q.date,
      applied: result.applied,
      sources: result.sources.map((s) => ({
        rateId: s.rate.id,
        quoteCurrency: s.rate.quote,
        rate: s.rate.value,
        effectiveDate: s.rate.effectiveDate,
        fiscalYearLabel: s.fiscalYear?.label ?? null,
        locked: s.rate.locked,
      })),
      amount: amount ?? null,
      converted: result.converted,
    };
  }

  private async toDtos(tx: Tx, rows: Row[]): Promise<ExchangeRate[]> {
    const ids = [
      ...new Set(rows.map((r) => r.fiscalYearId).filter((f): f is string => Boolean(f))),
    ];
    const labels = new Map(
      (ids.length
        ? await tx
            .select({ id: fiscalYears.id, label: fiscalYears.label })
            .from(fiscalYears)
            .where(inArray(fiscalYears.id, ids))
        : []
      ).map((y) => [y.id, y.label]),
    );
    return rows.map((r) => ({
      id: r.id,
      rateType: r.rateType,
      baseCurrency: r.baseCurrency,
      quoteCurrency: r.quoteCurrency,
      rate: r.rate,
      effectiveDate: r.effectiveDate,
      fiscalYearId: r.fiscalYearId,
      fiscalYearLabel: r.fiscalYearId ? (labels.get(r.fiscalYearId) ?? null) : null,
      source: r.source,
      locked: r.locked,
      lockedAt: r.lockedAt?.toISOString() ?? null,
    }));
  }
}
