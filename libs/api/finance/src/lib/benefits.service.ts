import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  todayUtc,
  unwrap,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import {
  benefitThresholds,
  employeeBenefitLedger,
  events,
  fiscalYears,
  legalEntities,
  orgUnits,
  people,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  BenefitEntry,
  BenefitLedgerRow,
  BenefitLedgerView,
  BenefitPersonView,
  BenefitThresholdInput,
  BenefitThresholdView,
} from '@bf/contracts';
import {
  countsToward,
  evaluateThreshold,
  isCurrencyCode,
  taxRuleSetMachine,
  taxYearWindow,
  validateThreshold,
  type BenefitStatus,
  type BenefitThreshold,
  type CurrencyCode,
  type ExceededBehaviour,
  type Money,
  type TaxRuleSetStatus,
  type ThresholdBasis,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, max } from 'drizzle-orm';
import { tenantOf, type CommandContext } from './finance-base';
import { RatesService } from './rates.service';

type EntryRow = typeof employeeBenefitLedger.$inferSelect;
type ThresholdRow = typeof benefitThresholds.$inferSelect;

export interface BenefitInput {
  personId: string;
  /** Defaults to the person's employing entity. */
  legalEntityId?: string | null;
  eventId?: string | null;
  entryDate: string;
  benefitType: string;
  amount: LooseMoney;
  sourceType: 'event' | 'request' | 'manual';
  sourceId: string | null;
  description: string;
}

type LooseMoney = { amountMinor: number; currency: string };

const OPEN: TaxRuleSetStatus[] = ['draft', 'pending_approval', 'returned'];

const toDomain = (t: ThresholdRow): BenefitThreshold => ({
  id: t.id,
  legalEntityIds: t.legalEntityIds,
  benefitTypes: t.benefitTypes,
  limitMinor: t.limitMinor,
  currency: t.currency,
  basis: t.basis as ThresholdBasis,
  maxOccasions: t.maxOccasions,
  periodStartMonth: t.periodStartMonth,
  periodStartDay: t.periodStartDay,
  exceeded: t.exceeded as ExceededBehaviour,
});

const occasionKey = (e: EntryRow) => e.eventId ?? e.sourceId ?? e.reversalOfId ?? e.id;

/**
 * Employee benefit ledger (gap B3, screen 080h). Entries record each person's share of costs already
 * posted (an event's final cost per attendee at close, an approved gift, or a benefit finance records)
 * and never move budget money. Entries are append-only: a reversal is a negating entry. Thresholds are
 * versioned like the tax rules and published by the tax approver; each evaluates on its own tax year.
 */
@Injectable()
export class BenefitsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly commands: CommandRunner,
    private readonly rates: RatesService,
  ) {}

  // Writing entries (used by event close, request approval and finance) -------------------------

  /** An amount in another currency at the locked plan rate of its date (half-even, once). */
  async convertAtPlan(
    tx: Tx,
    actor: RequestActor,
    m: { amountMinor: number; currency: string },
    to: string,
    date: string,
  ): Promise<number> {
    return this.convert(tx, actor, m as Money, to, date);
  }

  private async convert(
    tx: Tx,
    actor: RequestActor,
    m: Money,
    to: string,
    date: string,
    cache?: Map<string, number>,
  ): Promise<number> {
    if (m.currency === to || m.amountMinor === 0) return m.amountMinor;
    const k = `${m.currency}|${to}|${date}|${m.amountMinor}`;
    const hit = cache?.get(k);
    if (hit !== undefined) return hit;
    const r = await this.rates.lookupTx(tx, actor, {
      from: m.currency,
      to,
      date,
      type: 'plan',
      amountMinor: m.amountMinor,
    });
    cache?.set(k, r.converted!.amountMinor);
    return r.converted!.amountMinor;
  }

  /**
   * Writes one entry in the caller's transaction. Idempotent per source and person: a second write
   * for the same event or request returns the first entry. With `audit: false` the caller's own
   * audit event lists the entries (one audit event per command, such as an event close).
   */
  async record(
    tx: Tx,
    actor: RequestActor,
    input: BenefitInput,
    opts: { audit?: boolean; lenient?: boolean } = {},
  ): Promise<EntryRow | null> {
    if (!Number.isSafeInteger(input.amount.amountMinor) || input.amount.amountMinor <= 0)
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'A benefit is a positive amount.', {
        field: 'amount',
      });
    if (!isCurrencyCode(input.amount.currency))
      throw new ApiProblem(422, 'UNKNOWN_CURRENCY', `Unknown currency ${input.amount.currency}.`, {
        field: 'amount.currency',
      });
    const [p] = await tx.select().from(people).where(eq(people.id, input.personId));
    if (!p) throw ApiProblem.notFound('person');
    const entityId = input.legalEntityId ?? p.employingEntityId;
    if (!entityId && opts.lenient) return null;
    if (!entityId)
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'The person has no employing legal entity.', {
        field: 'personId',
      });
    if (input.sourceId) {
      const [prior] = await tx
        .select()
        .from(employeeBenefitLedger)
        .where(
          and(
            eq(employeeBenefitLedger.sourceType, input.sourceType),
            eq(employeeBenefitLedger.sourceId, input.sourceId),
            eq(employeeBenefitLedger.personId, input.personId),
          ),
        );
      if (prior) return prior;
    }
    const [le] = await tx.select().from(legalEntities).where(eq(legalEntities.id, entityId));
    const [fy] = await tx
      .select()
      .from(fiscalYears)
      .where(
        and(
          eq(fiscalYears.fiscalCalendarId, le.fiscalCalendarId!),
          lte(fiscalYears.startDate, input.entryDate),
          gte(fiscalYears.endDate, input.entryDate),
        ),
      );
    if (!fy && opts.lenient) return null;
    if (!fy)
      throw new ApiProblem(
        422,
        'ACCOUNTING_DATE_OUTSIDE_FISCAL_YEAR',
        'The date is outside the fiscal years of the legal entity.',
        { field: 'entryDate' },
      );
    // A missing plan rate (no SQL error: the lookup fails in the domain) leaves the reporting view
    // empty for a lenient write, such as an event close, instead of blocking it.
    let reporting: number | null;
    try {
      reporting = await this.convert(
        tx,
        actor,
        input.amount as Money,
        actor.reportingCurrency,
        input.entryDate,
      );
    } catch (e) {
      if (!opts.lenient) throw e;
      reporting = null;
    }
    const [row] = await tx
      .insert(employeeBenefitLedger)
      .values({
        tenantId: actor.tenantId,
        personId: input.personId,
        eventId: input.eventId ?? null,
        fiscalYearId: fy.id,
        benefitType: input.benefitType,
        amountMinor: input.amount.amountMinor,
        currency: input.amount.currency,
        taxable: false,
        legalEntityId: entityId,
        entryDate: input.entryDate,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        description: input.description,
        reportingCurrency: reporting === null ? null : actor.reportingCurrency,
        reportingAmountMinor: reporting,
        createdByPersonId: actor.personId,
      })
      .returning();
    if (opts.audit === false) return row;
    await this.audit.append(tx, {
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      actorSubject: actor.subject,
      action: 'benefit.recorded',
      resourceType: 'employee_benefit',
      resourceId: row.id,
      legalEntityId: entityId,
      changes: {
        personId: { from: null, to: input.personId },
        benefitType: { from: null, to: input.benefitType },
        amount: { from: null, to: input.amount },
        source: { from: null, to: { type: input.sourceType, id: input.sourceId } },
        entryDate: { from: null, to: input.entryDate },
      },
    });
    return row;
  }

  /** Reverses an entry with a negating one (append-only). An entry is reversed at most once. */
  async reverseTx(
    tx: Tx,
    actor: RequestActor,
    entryId: string,
    reason: string,
    opts: { audit?: boolean } = {},
  ): Promise<EntryRow> {
    const [e] = await tx
      .select()
      .from(employeeBenefitLedger)
      .where(eq(employeeBenefitLedger.id, entryId))
      .for('update');
    if (!e) throw ApiProblem.notFound('benefit entry');
    if (e.reversalOfId)
      throw new ApiProblem(409, 'CANNOT_REVERSE_REVERSAL', 'A reversal cannot be reversed.');
    const [already] = await tx
      .select({ id: employeeBenefitLedger.id })
      .from(employeeBenefitLedger)
      .where(eq(employeeBenefitLedger.reversalOfId, e.id));
    if (already)
      throw new ApiProblem(409, 'ALREADY_REVERSED', 'This entry is already reversed.', {
        reversalId: already.id,
      });
    const [row] = await tx
      .insert(employeeBenefitLedger)
      .values({
        tenantId: actor.tenantId,
        personId: e.personId,
        eventId: e.eventId,
        fiscalYearId: e.fiscalYearId,
        benefitType: e.benefitType,
        amountMinor: -e.amountMinor,
        currency: e.currency,
        taxable: e.taxable,
        legalEntityId: e.legalEntityId,
        // A reversal counts in the same tax year as the entry it takes back.
        entryDate: e.entryDate ?? todayUtc(),
        sourceType: e.sourceType,
        sourceId: e.sourceId,
        description: `Reversal: ${reason}`,
        reportingCurrency: e.reportingCurrency,
        reportingAmountMinor: e.reportingAmountMinor === null ? null : -e.reportingAmountMinor,
        reversalOfId: e.id,
        createdByPersonId: actor.personId,
      })
      .returning();
    if (opts.audit === false) return row;
    await this.audit.append(tx, {
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      actorSubject: actor.subject,
      action: 'benefit.reversed',
      resourceType: 'employee_benefit',
      resourceId: row.id,
      legalEntityId: e.legalEntityId,
      reason,
      changes: {
        reversalOf: { from: null, to: e.id },
        amount: { from: null, to: { amountMinor: -e.amountMinor, currency: e.currency } },
      },
    });
    return row;
  }

  /**
   * Reverses every live entry of a source (a released gift request, for example), inside the
   * caller's command: its audit event carries the returned reversal ids.
   */
  async reverseSource(
    tx: Tx,
    actor: RequestActor,
    sourceType: 'event' | 'request',
    sourceId: string,
    reason: string,
  ): Promise<string[]> {
    const rows = await tx
      .select()
      .from(employeeBenefitLedger)
      .where(
        and(
          eq(employeeBenefitLedger.sourceType, sourceType),
          eq(employeeBenefitLedger.sourceId, sourceId),
        ),
      );
    const reversed = new Set(rows.map((r) => r.reversalOfId).filter(Boolean));
    const ids: string[] = [];
    for (const r of rows.filter((x) => !x.reversalOfId && !reversed.has(x.id)))
      ids.push((await this.reverseTx(tx, actor, r.id, reason, { audit: false })).id);
    return ids;
  }

  // API commands ----------------------------------------------------------------------------------

  recordManual(
    actor: RequestActor,
    body: {
      personId: string;
      entryDate: string;
      benefitType: string;
      amount: LooseMoney;
      description: string;
      eventId?: string;
    },
    ctx: CommandContext,
  ): Promise<CommandResult<BenefitEntry>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'benefits.record',
        request: body,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'benefits.manage', tenantOf(actor), 'employee benefits');
        if (body.eventId) {
          const [e] = await tx
            .select({ id: events.id })
            .from(events)
            .where(eq(events.id, body.eventId));
          if (!e) throw ApiProblem.notFound('event');
        }
        const row = await this.record(tx, actor, {
          personId: body.personId,
          eventId: body.eventId ?? null,
          entryDate: body.entryDate,
          benefitType: body.benefitType,
          amount: body.amount,
          sourceType: 'manual',
          sourceId: null,
          description: body.description,
        });
        return (
          await this.entryDtos(tx, [row!], await this.thresholdsInForce(tx, todayUtc()), new Map())
        )[0];
      },
    );
  }

  reverse(
    actor: RequestActor,
    entryId: string,
    reason: string,
    ctx: CommandContext,
  ): Promise<CommandResult<BenefitEntry>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `benefits.reverse:${entryId}`,
        request: { reason },
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'benefits.manage', tenantOf(actor), 'employee benefits');
        const row = await this.reverseTx(tx, actor, entryId, reason);
        return (
          await this.entryDtos(tx, [row], await this.thresholdsInForce(tx, todayUtc()), new Map())
        )[0];
      },
    );
  }

  // Reads -----------------------------------------------------------------------------------------

  /** Published thresholds in force on a date: per code, the latest effective version. */
  async thresholdsInForce(tx: Tx, asOf: string): Promise<ThresholdRow[]> {
    const rows = await tx
      .select()
      .from(benefitThresholds)
      .where(
        and(
          inArray(benefitThresholds.status, ['published', 'superseded']),
          lte(benefitThresholds.effectiveFrom, asOf),
        ),
      )
      .orderBy(desc(benefitThresholds.effectiveFrom), desc(benefitThresholds.version));
    const byCode = new Map<string, ThresholdRow>();
    for (const r of rows) if (!byCode.has(r.code)) byCode.set(r.code, r);
    return [...byCode.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private async rowsFor(
    tx: Tx,
    actor: RequestActor,
    thresholds: ThresholdRow[],
    entries: EntryRow[],
    asOf: string,
  ): Promise<BenefitLedgerRow[]> {
    const personIds = [...new Set(entries.map((e) => e.personId))];
    const ppl = personIds.length
      ? await tx
          .select({
            id: people.id,
            name: people.displayName,
            location: orgUnits.name,
          })
          .from(people)
          .leftJoin(orgUnits, eq(orgUnits.id, people.locationOrgUnitId))
          .where(inArray(people.id, personIds))
      : [];
    const pById = new Map(ppl.map((p) => [p.id, p]));
    const codes = new Map(
      (await tx.select({ id: legalEntities.id, code: legalEntities.code }).from(legalEntities)).map(
        (l) => [l.id, l.code],
      ),
    );
    const cache = new Map<string, number>();
    const out: BenefitLedgerRow[] = [];
    for (const t of thresholds) {
      const dt = toDomain(t);
      const window = taxYearWindow(dt, asOf);
      const groups = new Map<string, { entity: string; items: EntryRow[] }>();
      for (const e of entries) {
        if (!e.entryDate || !e.legalEntityId) continue;
        if (
          !countsToward(
            dt,
            { legalEntityId: e.legalEntityId, benefitType: e.benefitType, entryDate: e.entryDate },
            window,
          )
        )
          continue;
        const g = groups.get(e.personId) ?? { entity: e.legalEntityId, items: [] };
        g.items.push(e);
        groups.set(e.personId, g);
      }
      for (const [personId, g] of groups) {
        const converted = [];
        for (const e of g.items)
          converted.push({
            occasionKey: occasionKey(e),
            entryDate: e.entryDate!,
            amountMinor: await this.convert(
              tx,
              actor,
              { amountMinor: e.amountMinor, currency: e.currency as CurrencyCode },
              t.currency,
              e.entryDate!,
              cache,
            ),
          });
        const ev = unwrap(evaluateThreshold(dt, converted));
        const m = (amountMinor: number) => ({ amountMinor, currency: t.currency });
        const p = pById.get(personId);
        out.push({
          personId,
          personName: p?.name ?? '',
          legalEntityId: g.entity,
          legalEntityCode: codes.get(g.entity) ?? '',
          locationName: p?.location ?? null,
          thresholdId: t.id,
          thresholdName: t.name,
          window,
          basis: dt.basis,
          counted: m(ev.countedMinor),
          limit: m(ev.limitMinor),
          occasions: ev.occasions,
          maxOccasions: t.maxOccasions,
          status: ev.status,
          exceeded: dt.exceeded,
          reportable: dt.exceeded === 'not_reportable' ? null : m(ev.reportableMinor),
          exported: false,
        });
      }
    }
    return out.sort((a, b) =>
      a.legalEntityCode === b.legalEntityCode
        ? a.personName.localeCompare(b.personName) || a.thresholdName.localeCompare(b.thresholdName)
        : a.legalEntityCode.localeCompare(b.legalEntityCode),
    );
  }

  ledger(
    actor: RequestActor,
    q: { legalEntityId?: string; status?: BenefitStatus; benefitType?: string; asOf?: string },
  ): Promise<BenefitLedgerView> {
    this.policy.assert(actor, 'benefits.read', tenantOf(actor), 'employee benefits');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const asOf = q.asOf ?? todayUtc();
      const all = await this.thresholdsInForce(tx, asOf);
      const templates = all.filter((t) => t.legalEntityIds.length === 0);
      const live = all.filter(
        (t) =>
          t.legalEntityIds.length > 0 && (!q.benefitType || t.benefitTypes.includes(q.benefitType)),
      );
      const entries = await tx
        .select()
        .from(employeeBenefitLedger)
        .where(isNotNull(employeeBenefitLedger.entryDate))
        .orderBy(asc(employeeBenefitLedger.entryDate), asc(employeeBenefitLedger.id));
      let rows = await this.rowsFor(
        tx,
        actor,
        live,
        entries.filter((e) => !q.benefitType || e.benefitType === q.benefitType),
        asOf,
      );
      if (q.legalEntityId) rows = rows.filter((r) => r.legalEntityId === q.legalEntityId);
      if (q.status) rows = rows.filter((r) => r.status === q.status);
      const fmt = (t: ThresholdRow) =>
        `${t.currency} ${(t.limitMinor / 100).toFixed(2)} per employee ${t.basis === 'per_event' ? 'per event' : 'per year'}${t.maxOccasions ? `, ${t.maxOccasions} events a year` : ''}`;
      return {
        asOf,
        items: rows,
        templates: templates.map((t) => ({
          thresholdId: t.id,
          name: t.name,
          note: `${t.name} (${fmt(t)}): template, no legal entity in scope yet.`,
        })),
        benefitTypes: [
          ...new Set([...all.flatMap((t) => t.benefitTypes), ...entries.map((e) => e.benefitType)]),
        ].sort(),
        reportingCurrency: actor.reportingCurrency,
      };
    });
  }

  person(actor: RequestActor, personId: string, asOf?: string): Promise<BenefitPersonView> {
    this.policy.assert(actor, 'benefits.read', tenantOf(actor), 'employee benefits');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const day = asOf ?? todayUtc();
      const [p] = await tx.select().from(people).where(eq(people.id, personId));
      if (!p) throw ApiProblem.notFound('person');
      const entries = await tx
        .select()
        .from(employeeBenefitLedger)
        .where(eq(employeeBenefitLedger.personId, personId))
        .orderBy(desc(employeeBenefitLedger.entryDate), desc(employeeBenefitLedger.createdAt));
      const thresholds = (await this.thresholdsInForce(tx, day)).filter(
        (t) => t.legalEntityIds.length > 0,
      );
      const totals = await this.rowsFor(tx, actor, thresholds, entries, day);
      const [le] = p.employingEntityId
        ? await tx.select().from(legalEntities).where(eq(legalEntities.id, p.employingEntityId))
        : [];
      return {
        personId,
        personName: p.displayName,
        legalEntityCode: le?.code ?? null,
        asOf: day,
        entries: await this.entryDtos(tx, entries, thresholds, new Map(), day),
        totals,
      };
    });
  }

  private async entryDtos(
    tx: Tx,
    rows: EntryRow[],
    thresholds: ThresholdRow[],
    _cache: Map<string, number>,
    asOf = todayUtc(),
  ): Promise<BenefitEntry[]> {
    if (!rows.length) return [];
    const reversals = await tx
      .select({ id: employeeBenefitLedger.id, of: employeeBenefitLedger.reversalOfId })
      .from(employeeBenefitLedger)
      .where(
        inArray(
          employeeBenefitLedger.reversalOfId,
          rows.map((r) => r.id),
        ),
      );
    const reversedBy = new Map(reversals.map((r) => [r.of!, r.id]));
    const eventIds = [
      ...new Set(rows.map((r) => r.eventId).filter((x): x is string => Boolean(x))),
    ];
    const eventNames = new Map(
      (eventIds.length
        ? await tx
            .select({ id: events.id, name: events.name })
            .from(events)
            .where(inArray(events.id, eventIds))
        : []
      ).map((e) => [e.id, e.name]),
    );
    return rows.map((r) => {
      const type = (r.sourceType ?? 'manual') as BenefitEntry['source']['type'];
      const label =
        type === 'event'
          ? (eventNames.get(r.eventId ?? '') ?? 'Event')
          : type === 'request'
            ? 'Approved request'
            : r.eventId
              ? `Recorded by finance (${eventNames.get(r.eventId) ?? 'event'})`
              : 'Recorded by finance';
      const counted = thresholds
        .filter((t) => {
          if (!r.entryDate || !r.legalEntityId) return false;
          const dt = toDomain(t);
          return countsToward(
            dt,
            { legalEntityId: r.legalEntityId, benefitType: r.benefitType, entryDate: r.entryDate },
            taxYearWindow(dt, asOf),
          );
        })
        .map((t) => t.name);
      return {
        id: r.id,
        personId: r.personId,
        entryDate: r.entryDate ?? r.createdAt.toISOString().slice(0, 10),
        benefitType: r.benefitType,
        description: r.description,
        source: { type, id: type === 'manual' ? null : r.sourceId, label },
        amount: { amountMinor: r.amountMinor, currency: r.currency },
        reporting: {
          amountMinor: r.reportingAmountMinor ?? r.amountMinor,
          currency: r.reportingCurrency ?? r.currency,
        },
        reversalOfId: r.reversalOfId,
        reversedById: reversedBy.get(r.id) ?? null,
        countedToward: counted,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  // Thresholds ------------------------------------------------------------------------------------

  private async names(tx: Tx, ids: (string | null)[]): Promise<Map<string, string>> {
    const want = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (!want.length) return new Map();
    const rows = await tx
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(inArray(people.id, want));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async thresholdViews(tx: Tx, rows: ThresholdRow[]): Promise<BenefitThresholdView[]> {
    const codes = new Map(
      (await tx.select({ id: legalEntities.id, code: legalEntities.code }).from(legalEntities)).map(
        (l) => [l.id, l.code],
      ),
    );
    const names = await this.names(
      tx,
      rows.flatMap((r) => [r.submittedByPersonId, r.decidedByPersonId]),
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      version: r.version,
      name: r.name,
      jurisdiction: r.jurisdiction,
      legalEntityIds: r.legalEntityIds,
      legalEntityCodes: r.legalEntityIds.map((id) => codes.get(id) ?? id),
      benefitTypes: r.benefitTypes,
      limit: { amountMinor: r.limitMinor, currency: r.currency },
      basis: r.basis as ThresholdBasis,
      maxOccasions: r.maxOccasions,
      periodStartMonth: r.periodStartMonth,
      periodStartDay: r.periodStartDay,
      exceeded: r.exceeded as ExceededBehaviour,
      status: r.status as BenefitThresholdView['status'],
      template: r.legalEntityIds.length === 0,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      comment: r.comment,
      submittedByName: r.submittedByPersonId ? (names.get(r.submittedByPersonId) ?? null) : null,
      decidedByName: r.decidedByPersonId ? (names.get(r.decidedByPersonId) ?? null) : null,
    }));
  }

  thresholds(actor: RequestActor) {
    this.policy.assert(actor, 'benefits.read', tenantOf(actor), 'benefit thresholds');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const rows = await tx
        .select()
        .from(benefitThresholds)
        .orderBy(
          asc(benefitThresholds.jurisdiction),
          asc(benefitThresholds.code),
          desc(benefitThresholds.version),
        );
      return {
        items: await this.thresholdViews(tx, rows),
        canEdit: this.policy.can(actor, 'benefits.manage', tenantOf(actor)).allowed,
        canPublish: this.policy.can(actor, 'tax.publish', tenantOf(actor)).allowed,
      };
    });
  }

  private async checkInput(tx: Tx, body: BenefitThresholdInput) {
    unwrap(
      validateThreshold({
        legalEntityIds: body.legalEntityIds,
        benefitTypes: body.benefitTypes,
        limitMinor: body.limit.amountMinor,
        currency: body.limit.currency,
        basis: body.basis,
        maxOccasions: body.maxOccasions,
        periodStartMonth: body.periodStartMonth,
        periodStartDay: body.periodStartDay,
        exceeded: body.exceeded,
      }),
    );
    if (body.legalEntityIds.length) {
      const found = await tx
        .select({ id: legalEntities.id })
        .from(legalEntities)
        .where(inArray(legalEntities.id, body.legalEntityIds));
      if (found.length !== new Set(body.legalEntityIds).size)
        throw new ApiProblem(422, 'VALIDATION_FAILED', 'A legal entity does not exist.', {
          field: 'legalEntityIds',
        });
    }
  }

  private values(body: BenefitThresholdInput) {
    return {
      name: body.name,
      jurisdiction: body.jurisdiction,
      legalEntityIds: [...new Set(body.legalEntityIds)],
      benefitTypes: [...new Set(body.benefitTypes)],
      limitMinor: body.limit.amountMinor,
      currency: body.limit.currency,
      basis: body.basis,
      maxOccasions: body.maxOccasions,
      periodStartMonth: body.periodStartMonth,
      periodStartDay: body.periodStartDay,
      exceeded: body.exceeded,
    };
  }

  createThreshold(
    actor: RequestActor,
    body: BenefitThresholdInput,
    ctx: CommandContext,
  ): Promise<CommandResult<BenefitThresholdView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'benefits.threshold.create',
        request: body,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'benefits.manage', tenantOf(actor), 'benefit thresholds');
        await this.checkInput(tx, body);
        const existing = await tx
          .select()
          .from(benefitThresholds)
          .where(eq(benefitThresholds.code, body.code))
          .for('update');
        if (existing.some((t) => OPEN.includes(t.status as TaxRuleSetStatus)))
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            `${body.code} already has a draft; edit that one.`,
          );
        const [{ v }] = await tx
          .select({ v: max(benefitThresholds.version) })
          .from(benefitThresholds)
          .where(eq(benefitThresholds.code, body.code));
        const [row] = await tx
          .insert(benefitThresholds)
          .values({
            tenantId: actor.tenantId,
            code: body.code,
            version: (v ?? 0) + 1,
            status: 'draft',
            createdByPersonId: actor.personId,
            ...this.values(body),
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'benefit_threshold.draft_created',
          resourceType: 'benefit_threshold',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            threshold: {
              from: null,
              to: { code: body.code, version: row.version, ...this.values(body) },
            },
          },
        });
        return (await this.thresholdViews(tx, [row]))[0];
      },
    );
  }

  private async lockThreshold(tx: Tx, id: string): Promise<ThresholdRow> {
    const [t] = await tx
      .select()
      .from(benefitThresholds)
      .where(eq(benefitThresholds.id, id))
      .for('update');
    if (!t) throw ApiProblem.notFound('benefit threshold');
    return t;
  }

  updateThreshold(
    actor: RequestActor,
    id: string,
    body: BenefitThresholdInput,
    ctx: CommandContext,
  ): Promise<CommandResult<BenefitThresholdView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `benefits.threshold.update:${id}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'benefits.manage', tenantOf(actor), 'benefit thresholds');
        const t = await this.lockThreshold(tx, id);
        if (t.status !== 'draft' && t.status !== 'returned')
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            t.status === 'pending_approval'
              ? 'The threshold is waiting for the tax approver; edits are locked.'
              : 'A published threshold cannot change; draft a new version.',
          );
        if (body.code !== t.code)
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'The code of a threshold cannot change.', {
            field: 'code',
          });
        await this.checkInput(tx, body);
        const [row] = await tx
          .update(benefitThresholds)
          .set({ ...this.values(body), updatedAt: new Date() })
          .where(eq(benefitThresholds.id, id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'benefit_threshold.draft_saved',
          resourceType: 'benefit_threshold',
          resourceId: id,
          requestId: ctx.requestId,
          changes: {
            limit: { from: { amountMinor: t.limitMinor, currency: t.currency }, to: body.limit },
            legalEntityIds: { from: t.legalEntityIds, to: row.legalEntityIds },
            benefitTypes: { from: t.benefitTypes, to: row.benefitTypes },
            basis: { from: t.basis, to: row.basis },
            exceeded: { from: t.exceeded, to: row.exceeded },
          },
        });
        return (await this.thresholdViews(tx, [row]))[0];
      },
    );
  }

  decideThreshold(
    actor: RequestActor,
    id: string,
    event: 'submit' | 'publish' | 'return',
    body: { effectiveFrom?: string; comment?: string },
    ctx: CommandContext,
  ): Promise<CommandResult<BenefitThresholdView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `benefits.threshold.${event}:${id}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(
          actor,
          event === 'submit' ? 'benefits.manage' : 'tax.publish',
          tenantOf(actor),
          'benefit thresholds',
        );
        const t = await this.lockThreshold(tx, id);
        const next = unwrap(taxRuleSetMachine.next(t.status as TaxRuleSetStatus, event));
        if (event !== 'submit' && t.submittedByPersonId && t.submittedByPersonId === actor.personId)
          throw new ApiProblem(
            403,
            'SELF_APPROVAL',
            'The tax approver cannot decide a threshold they submitted.',
          );
        if (event === 'publish' && body.effectiveFrom! < todayUtc())
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Thresholds apply from their effective date forward; choose today or a later date.',
            { field: 'effectiveFrom' },
          );
        const patch: Partial<typeof benefitThresholds.$inferInsert> = {
          status: next,
          updatedAt: new Date(),
        };
        if (event === 'submit') {
          patch.submittedByPersonId = actor.personId;
          patch.submittedAt = new Date();
          patch.comment = null;
        } else {
          patch.decidedByPersonId = actor.personId;
          patch.decidedAt = new Date();
          if (event === 'publish') patch.effectiveFrom = body.effectiveFrom!;
          if (event === 'return') patch.comment = body.comment!;
        }
        const [row] = await tx
          .update(benefitThresholds)
          .set(patch)
          .where(eq(benefitThresholds.id, id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: `benefit_threshold.${event === 'submit' ? 'submitted' : event === 'publish' ? 'published' : 'returned'}`,
          resourceType: 'benefit_threshold',
          resourceId: id,
          requestId: ctx.requestId,
          reason: body.comment ?? null,
          changes: {
            status: { from: t.status, to: next },
            ...(event === 'publish'
              ? { effectiveFrom: { from: null, to: body.effectiveFrom } }
              : {}),
          },
        });
        return (await this.thresholdViews(tx, [row]))[0];
      },
    );
  }
}
