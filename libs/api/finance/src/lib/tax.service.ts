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
  budgetCategories,
  legalEntities,
  people,
  taxRules,
  taxRuleSets,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  TaxBreakdown,
  TaxRuleInput,
  TaxRuleSetView,
  TaxRulesView,
  TaxRuleView,
} from '@bf/contracts';
import {
  ANY_CATEGORY,
  attendeeTypeOf,
  budgetEffectOf,
  selectTaxRule,
  splitGross,
  splitTax,
  taxRuleSetMachine,
  validateTaxRules,
  type Attendance,
  type AttendeeType,
  type CurrencyCode,
  type Money,
  type TaxRule,
  type TaxRuleSetStatus,
  type TaxSplit,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lte, max } from 'drizzle-orm';
import { tenantOf, type CommandContext } from './finance-base';
import { RatesService } from './rates.service';

type SetRow = typeof taxRuleSets.$inferSelect;
type RuleRow = typeof taxRules.$inferSelect;

const OPEN: TaxRuleSetStatus[] = ['draft', 'pending_approval', 'returned'];

export interface TaxSplitResult {
  split: TaxSplit;
  attendeeType: AttendeeType;
  ruleVersion: number | null;
}

const toDomain = (r: RuleRow): TaxRule => ({
  id: r.id,
  legalEntityId: r.legalEntityId,
  categoryCode: r.categoryCode,
  attendeeType: r.attendeeType as AttendeeType,
  taxCode: r.taxCode,
  recoverableBps: r.recoverableBps,
  proportional: r.proportional,
});

const ruleKey = (r: { legalEntityId: string; categoryCode: string; attendeeType: string }) =>
  `${r.legalEntityId}|${r.categoryCode}|${r.attendeeType}`;

/**
 * Tax recoverability (gap B3, screen 080g): the rule sets finance drafts and the tax approver
 * publishes, and the split every taxed commitment and actual takes from the rules in force on its
 * accounting date. The split decides what posts to the budget buckets (net plus non-recoverable
 * tax); recoverable tax is recorded on the tax lines for reporting and never uses budget.
 */
@Injectable()
export class TaxService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly commands: CommandRunner,
    private readonly rates: RatesService,
  ) {}

  // Splits used by postings -----------------------------------------------------------------------

  /** The published version in force on a date (the latest effective date on or before it). */
  async setInForce(tx: Tx, date: string): Promise<SetRow | undefined> {
    const [s] = await tx
      .select()
      .from(taxRuleSets)
      .where(
        and(
          inArray(taxRuleSets.status, ['published', 'superseded']),
          lte(taxRuleSets.effectiveFrom, date),
        ),
      )
      .orderBy(desc(taxRuleSets.effectiveFrom), desc(taxRuleSets.version))
      .limit(1);
    return s;
  }

  private rulesOf(tx: Tx, setId: string): Promise<RuleRow[]> {
    return tx
      .select()
      .from(taxRules)
      .where(eq(taxRules.ruleSetId, setId))
      .orderBy(asc(taxRules.id));
  }

  private async ruleFor(
    tx: Tx,
    q: { legalEntityId: string; categoryCode: string; attendance: Attendance | null; date: string },
    setId?: string,
  ) {
    const set = setId
      ? (await tx.select().from(taxRuleSets).where(eq(taxRuleSets.id, setId)))[0]
      : await this.setInForce(tx, q.date);
    const attendeeType = attendeeTypeOf(q.attendance);
    if (!set) return { rule: null, attendeeType, ruleVersion: null };
    const rule = selectTaxRule((await this.rulesOf(tx, set.id)).map(toDomain), {
      legalEntityId: q.legalEntityId,
      categoryCode: q.categoryCode,
      attendeeType,
    });
    return { rule, attendeeType, ruleVersion: rule ? set.version : null };
  }

  /** Split for an amount entered without tax (requests): the budget uses net + non-recoverable tax. */
  async splitNet(
    tx: Tx,
    q: {
      legalEntityId: string;
      categoryCode: string;
      attendance: Attendance | null;
      netMinor: number;
      taxMinor: number;
      date: string;
    },
    setId?: string,
  ): Promise<TaxSplitResult> {
    const { rule, attendeeType, ruleVersion } = await this.ruleFor(tx, q, setId);
    const split = unwrap(
      splitTax({ netMinor: q.netMinor, taxMinor: q.taxMinor, rule, attendance: q.attendance }),
    );
    return { split, attendeeType, ruleVersion };
  }

  /** Split for a line charged with tax included (actuals): the budget uses gross − recoverable tax. */
  async splitGross(
    tx: Tx,
    q: {
      legalEntityId: string;
      categoryCode: string;
      attendance: Attendance | null;
      grossMinor: number;
      taxMinor: number;
      date: string;
    },
  ): Promise<TaxSplitResult> {
    const { rule, attendeeType, ruleVersion } = await this.ruleFor(tx, q);
    const split = unwrap(
      splitGross({
        grossMinor: q.grossMinor,
        taxMinor: q.taxMinor,
        rule,
        attendance: q.attendance,
      }),
    );
    return { split, attendeeType, ruleVersion };
  }

  /** An amount in the reporting currency at the locked plan rate of its date. */
  async toReporting(tx: Tx, actor: RequestActor, m: Money, date: string): Promise<Money> {
    if (m.currency === actor.reportingCurrency || m.amountMinor === 0)
      return { amountMinor: m.amountMinor, currency: actor.reportingCurrency };
    const r = await this.rates.lookupTx(tx, actor, {
      from: m.currency,
      to: actor.reportingCurrency,
      date,
      type: 'plan',
      amountMinor: m.amountMinor,
    });
    return r.converted as Money;
  }

  async breakdown(
    tx: Tx,
    actor: RequestActor,
    s: TaxSplitResult,
    currency: string,
    date: string,
    posted: boolean,
  ): Promise<TaxBreakdown> {
    const m = (amountMinor: number) => ({ amountMinor, currency: currency as CurrencyCode });
    return {
      taxCode: s.split.taxCode,
      ruleId: s.split.ruleId,
      ruleVersion: s.ruleVersion,
      attendeeType: s.attendeeType,
      recoverableShareBps: s.split.shareBps,
      net: m(s.split.netMinor),
      tax: m(s.split.taxMinor),
      recoverable: m(s.split.recoverableMinor),
      nonRecoverable: m(s.split.nonRecoverableMinor),
      usesBudget: m(s.split.consumptionMinor),
      usesBudgetReporting: await this.toReporting(tx, actor, m(s.split.consumptionMinor), date),
      recoverableReporting: await this.toReporting(tx, actor, m(s.split.recoverableMinor), date),
      posted,
    };
  }

  // Screen 080g -----------------------------------------------------------------------------------

  view(actor: RequestActor): Promise<TaxRulesView> {
    this.policy.assert(actor, 'tax.read', tenantOf(actor), 'tax rules');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.viewTx(tx, actor),
    );
  }

  private async viewTx(tx: Tx, actor: RequestActor): Promise<TaxRulesView> {
    const asOf = todayUtc();
    const sets = await tx.select().from(taxRuleSets).orderBy(desc(taxRuleSets.version));
    const current = await this.setInForce(tx, asOf);
    const upcoming =
      sets
        .filter((s) => s.status === 'published' && (s.effectiveFrom ?? '') > asOf)
        .sort((a, b) => (a.effectiveFrom! < b.effectiveFrom! ? -1 : 1))[0] ?? null;
    const draft = sets.find((s) => OPEN.includes(s.status as TaxRuleSetStatus)) ?? null;
    const labels = await this.labels(tx);
    const currentRules = current ? await this.rulesOf(tx, current.id) : [];
    const toView = async (s: SetRow | null) =>
      s ? this.setView(tx, s, labels, s.id === current?.id ? null : currentRules) : null;
    return {
      asOf,
      current: await toView(current ?? null),
      upcoming: await toView(upcoming),
      draft: await toView(draft),
      categories: [...labels.categories.entries()].map(([code, name]) => ({ code, name })),
      entities: labels.entities.map((e) => ({
        id: e.id,
        code: e.code,
        name: e.name,
        currency: e.functionalCurrency,
        taxJurisdiction: e.taxJurisdiction,
      })),
      reportingCurrency: actor.reportingCurrency,
      canEdit: this.policy.can(actor, 'master_data.manage', tenantOf(actor)).allowed,
      canPublish: this.policy.can(actor, 'tax.publish', tenantOf(actor)).allowed,
    };
  }

  private async labels(tx: Tx) {
    const entities = await tx.select().from(legalEntities).orderBy(asc(legalEntities.code));
    const cats = await tx
      .select({ code: budgetCategories.code, name: budgetCategories.name })
      .from(budgetCategories)
      .orderBy(asc(budgetCategories.name));
    return {
      entities,
      categories: new Map(cats.map((c) => [c.code, c.name])),
    };
  }

  private async names(tx: Tx, ids: (string | null)[]): Promise<Map<string, string>> {
    const want = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (!want.length) return new Map();
    const rows = await tx
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(inArray(people.id, want));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async setView(
    tx: Tx,
    s: SetRow,
    labels: Awaited<ReturnType<TaxService['labels']>>,
    compareWith: RuleRow[] | null,
  ): Promise<TaxRuleSetView> {
    const rules = await this.rulesOf(tx, s.id);
    const names = await this.names(tx, [s.submittedByPersonId, s.decidedByPersonId]);
    const prior = new Map((compareWith ?? []).map((r) => [ruleKey(r), r]));
    const entity = new Map(labels.entities.map((e) => [e.id, e]));
    const view = (r: RuleRow): TaxRuleView => {
      const p = prior.get(ruleKey(r));
      return {
        id: r.id,
        legalEntityId: r.legalEntityId,
        legalEntityCode: entity.get(r.legalEntityId)?.code ?? '',
        taxJurisdiction: entity.get(r.legalEntityId)?.taxJurisdiction ?? null,
        categoryCode: r.categoryCode,
        categoryName:
          r.categoryCode === ANY_CATEGORY
            ? 'All categories'
            : (labels.categories.get(r.categoryCode) ?? r.categoryCode),
        attendeeType: r.attendeeType as AttendeeType,
        taxCode: r.taxCode,
        recoverableBps: r.recoverableBps,
        proportional: r.proportional,
        notes: r.notes,
        effect: budgetEffectOf(r),
        changeMarker:
          compareWith === null
            ? 'unchanged'
            : !p
              ? 'added'
              : p.recoverableBps !== r.recoverableBps ||
                  p.proportional !== r.proportional ||
                  p.taxCode !== r.taxCode
                ? 'changed'
                : 'unchanged',
      };
    };
    const order = (r: TaxRuleView) =>
      `${r.legalEntityCode}|${r.categoryCode === ANY_CATEGORY ? '~' : r.categoryName}|${r.attendeeType}`;
    return {
      id: s.id,
      version: s.version,
      status: s.status as TaxRuleSetView['status'],
      effectiveFrom: s.effectiveFrom,
      comment: s.comment,
      submittedByName: s.submittedByPersonId ? (names.get(s.submittedByPersonId) ?? null) : null,
      submittedAt: s.submittedAt?.toISOString() ?? null,
      decidedByName: s.decidedByPersonId ? (names.get(s.decidedByPersonId) ?? null) : null,
      decidedAt: s.decidedAt?.toISOString() ?? null,
      rules: rules.map(view).sort((a, b) => order(a).localeCompare(order(b))),
    };
  }

  preview(
    actor: RequestActor,
    q: {
      legalEntityId: string;
      categoryCode: string;
      employees: number;
      others: number;
      amountMinor: number;
      taxMinor: number;
      currency: string;
      date?: string;
      ruleSetId?: string;
    },
  ): Promise<TaxBreakdown> {
    this.policy.assert(actor, 'tax.read', tenantOf(actor), 'tax rules');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const [le] = await tx
        .select({ id: legalEntities.id })
        .from(legalEntities)
        .where(eq(legalEntities.id, q.legalEntityId));
      if (!le) throw ApiProblem.notFound('legal entity');
      const date = q.date ?? todayUtc();
      const s = await this.splitNet(
        tx,
        {
          legalEntityId: q.legalEntityId,
          categoryCode: q.categoryCode,
          attendance: { employees: q.employees, others: q.others },
          netMinor: q.amountMinor,
          taxMinor: q.taxMinor,
          date,
        },
        q.ruleSetId,
      );
      return this.breakdown(tx, actor, s, q.currency, date, false);
    });
  }

  // Draft, submit, publish, return ----------------------------------------------------------------

  private async lockSet(tx: Tx, id: string): Promise<SetRow> {
    const [s] = await tx.select().from(taxRuleSets).where(eq(taxRuleSets.id, id)).for('update');
    if (!s) throw ApiProblem.notFound('tax rule set');
    return s;
  }

  private ruleSnapshot(rows: RuleRow[]) {
    return rows.map((r) => ({
      legalEntityId: r.legalEntityId,
      categoryCode: r.categoryCode,
      attendeeType: r.attendeeType,
      taxCode: r.taxCode,
      recoverableBps: r.recoverableBps,
      proportional: r.proportional,
    }));
  }

  private async afterView(tx: Tx, id: string): Promise<TaxRuleSetView> {
    const s = (await tx.select().from(taxRuleSets).where(eq(taxRuleSets.id, id)))[0];
    const current = await this.setInForce(tx, todayUtc());
    const compare = current && current.id !== s.id ? await this.rulesOf(tx, current.id) : null;
    return this.setView(tx, s, await this.labels(tx), compare);
  }

  createDraft(actor: RequestActor, ctx: CommandContext): Promise<CommandResult<TaxRuleSetView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'tax.draft.create',
        request: {},
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'master_data.manage', tenantOf(actor), 'tax rules');
        // Serialize drafting per tenant: one open version at a time.
        await tx.select().from(taxRuleSets).for('update');
        const open = await tx
          .select({ id: taxRuleSets.id })
          .from(taxRuleSets)
          .where(inArray(taxRuleSets.status, OPEN));
        if (open.length)
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'A draft already exists; finish or return it before starting another.',
            { ruleSetId: open[0].id },
          );
        const [{ v }] = await tx.select({ v: max(taxRuleSets.version) }).from(taxRuleSets);
        const [latest] = await tx
          .select()
          .from(taxRuleSets)
          .where(inArray(taxRuleSets.status, ['published', 'superseded']))
          .orderBy(desc(taxRuleSets.version))
          .limit(1);
        const [created] = await tx
          .insert(taxRuleSets)
          .values({
            tenantId: actor.tenantId,
            version: (v ?? 0) + 1,
            status: 'draft',
            createdByPersonId: actor.personId,
          })
          .returning();
        if (latest) {
          const copy = await this.rulesOf(tx, latest.id);
          if (copy.length)
            await tx.insert(taxRules).values(
              copy.map((r) => ({
                tenantId: actor.tenantId,
                ruleSetId: created.id,
                legalEntityId: r.legalEntityId,
                categoryCode: r.categoryCode,
                attendeeType: r.attendeeType,
                taxCode: r.taxCode,
                recoverableBps: r.recoverableBps,
                proportional: r.proportional,
                notes: r.notes,
              })),
            );
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'tax_rules.draft_created',
          resourceType: 'tax_rule_set',
          resourceId: created.id,
          requestId: ctx.requestId,
          changes: {
            version: { from: null, to: created.version },
            copiedFromVersion: { from: null, to: latest?.version ?? null },
          },
        });
        return this.afterView(tx, created.id);
      },
    );
  }

  saveDraft(
    actor: RequestActor,
    id: string,
    body: { rules: TaxRuleInput[] },
    ctx: CommandContext,
  ): Promise<CommandResult<TaxRuleSetView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `tax.draft.save:${id}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'master_data.manage', tenantOf(actor), 'tax rules');
        const s = await this.lockSet(tx, id);
        if (s.status !== 'draft' && s.status !== 'returned')
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            s.status === 'pending_approval'
              ? 'The draft is waiting for the tax approver; edits are locked.'
              : 'A published version cannot change; start a new draft.',
          );
        const labels = await this.labels(tx);
        const entity = new Map(labels.entities.map((e) => [e.id, e.code]));
        for (const [i, r] of body.rules.entries()) {
          if (!entity.has(r.legalEntityId))
            throw new ApiProblem(422, 'VALIDATION_FAILED', 'The legal entity does not exist.', {
              field: `rules.${i}.legalEntityId`,
            });
          if (r.categoryCode !== ANY_CATEGORY && !labels.categories.has(r.categoryCode))
            throw new ApiProblem(422, 'VALIDATION_FAILED', `Unknown category ${r.categoryCode}.`, {
              field: `rules.${i}.categoryCode`,
            });
        }
        unwrap(
          validateTaxRules(
            body.rules.map((r) => ({ ...r, notes: undefined })),
            {
              entityCode: (eid) => entity.get(eid) ?? eid,
              categoryName: (c) => labels.categories.get(c) ?? c,
            },
          ),
        );
        const before = this.ruleSnapshot(await this.rulesOf(tx, s.id));
        await tx.delete(taxRules).where(eq(taxRules.ruleSetId, s.id));
        if (body.rules.length)
          await tx.insert(taxRules).values(
            body.rules.map((r) => ({
              tenantId: actor.tenantId,
              ruleSetId: s.id,
              legalEntityId: r.legalEntityId,
              categoryCode: r.categoryCode,
              attendeeType: r.attendeeType,
              taxCode: r.taxCode,
              recoverableBps: r.proportional ? null : r.recoverableBps,
              proportional: r.proportional,
              notes: r.notes ?? null,
            })),
          );
        await tx.update(taxRuleSets).set({ updatedAt: new Date() }).where(eq(taxRuleSets.id, s.id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'tax_rules.draft_saved',
          resourceType: 'tax_rule_set',
          resourceId: s.id,
          requestId: ctx.requestId,
          changes: {
            rules: { from: before, to: this.ruleSnapshot(await this.rulesOf(tx, s.id)) },
          },
        });
        return this.afterView(tx, s.id);
      },
    );
  }

  submit(actor: RequestActor, id: string, ctx: CommandContext) {
    return this.decide(actor, id, 'submit', {}, ctx);
  }

  publish(actor: RequestActor, id: string, effectiveFrom: string, ctx: CommandContext) {
    return this.decide(actor, id, 'publish', { effectiveFrom }, ctx);
  }

  returnDraft(actor: RequestActor, id: string, comment: string, ctx: CommandContext) {
    return this.decide(actor, id, 'return', { comment }, ctx);
  }

  private decide(
    actor: RequestActor,
    id: string,
    event: 'submit' | 'publish' | 'return',
    body: { effectiveFrom?: string; comment?: string },
    ctx: CommandContext,
  ): Promise<CommandResult<TaxRuleSetView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `tax.${event}:${id}`,
        request: body,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(
          actor,
          event === 'submit' ? 'master_data.manage' : 'tax.publish',
          tenantOf(actor),
          'tax rules',
        );
        const s = await this.lockSet(tx, id);
        const next = unwrap(taxRuleSetMachine.next(s.status as TaxRuleSetStatus, event));
        if (event !== 'submit' && s.submittedByPersonId && s.submittedByPersonId === actor.personId)
          throw new ApiProblem(
            403,
            'SELF_APPROVAL',
            'The tax approver cannot decide a version they submitted.',
          );
        const today = todayUtc();
        if (event === 'publish' && body.effectiveFrom! < today)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Rules apply from their effective date forward; choose today or a later date.',
            { field: 'effectiveFrom' },
          );
        const rules = await this.rulesOf(tx, s.id);
        if (event === 'submit' && rules.length === 0)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Add at least one rule before submitting.',
          );
        const patch: Partial<typeof taxRuleSets.$inferInsert> = {
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
        await tx.update(taxRuleSets).set(patch).where(eq(taxRuleSets.id, s.id));
        const current = await this.setInForce(tx, today);
        const prior =
          current && current.id !== s.id
            ? this.ruleSnapshot(await this.rulesOf(tx, current.id))
            : [];
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: `tax_rules.${event === 'submit' ? 'submitted' : event === 'publish' ? 'published' : 'returned'}`,
          resourceType: 'tax_rule_set',
          resourceId: s.id,
          requestId: ctx.requestId,
          reason: body.comment ?? null,
          changes: {
            status: { from: s.status, to: next },
            ...(event === 'publish'
              ? { effectiveFrom: { from: null, to: body.effectiveFrom } }
              : {}),
            ...(event !== 'return' ? { rules: { from: prior, to: this.ruleSnapshot(rules) } } : {}),
          },
        });
        return this.afterView(tx, s.id);
      },
    );
  }
}
