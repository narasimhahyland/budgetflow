import {
  accruals,
  actuals,
  budgets,
  commitments,
  costCenters,
  fiscalPeriods,
  glAccounts,
  legalEntities,
  prepaids,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { LedgerReads, LedgerService, toPostingBudget } from '@bf/api/ledger';
import type { Accrual, AccrualList } from '@bf/contracts';
import {
  commitmentMachine,
  needsAccrual,
  postCommitmentMovement,
  recognizedToDate,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import {
  ActualsReads,
  commitmentRef,
  decimalOf,
  tenantOf,
  type CommandContext,
} from './actuals-reads';
import { MatchEngine } from './match-engine';

type AccrualRow = typeof accruals.$inferSelect;
type PrepaidRow = typeof prepaids.$inferSelect;

/** Accrual proposals from commitments past their service end (approve, export, auto-reverse) and prepaids. */
@Injectable()
export class AccrualsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: ActualsReads,
    private readonly ledgerReads: LedgerReads,
    private readonly ledger: LedgerService,
    private readonly engine: MatchEngine,
    private readonly audit: AuditService,
  ) {}

  list(actor: RequestActor, q: { status?: Accrual['status'] }): Promise<AccrualList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      const rows = await tx
        .select()
        .from(accruals)
        .where(q.status ? eq(accruals.status, q.status) : undefined)
        .orderBy(desc(accruals.createdAt))
        .limit(500);
      return { items: await this.dtos(tx, rows) };
    });
  }

  propose(
    actor: RequestActor,
    req: { asOfDate: string; budgetId?: string },
    ctx: CommandContext,
  ): Promise<CommandResult<{ count: number; items: Accrual[] }>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'actuals.accruals.propose',
        request: req,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const open = await tx
          .select()
          .from(commitments)
          .where(
            and(
              inArray(commitments.status, ['encumbered', 'partially_consumed']),
              lte(commitments.serviceEnd, req.asOfDate),
              req.budgetId ? eq(commitments.budgetId, req.budgetId) : undefined,
            ),
          );
        const ids = open.map((c) => c.id);
        const live = ids.length
          ? await tx
              .select({ id: accruals.commitmentId })
              .from(accruals)
              .where(
                and(
                  inArray(accruals.commitmentId, ids),
                  inArray(accruals.status, ['proposed', 'approved', 'posted']),
                ),
              )
          : [];
        const liveSet = new Set(live.map((l) => l.id));
        const bal = await this.reads.commitmentBalances(tx, ids);
        const pre = await this.engine.prepaidOutstanding(tx, ids);
        const created: AccrualRow[] = [];
        for (const c of open) {
          const remaining = (bal.get(c.id)?.encumberedMinor ?? 0) - (pre.get(c.id) ?? 0);
          if (
            !needsAccrual({
              serviceEnd: c.serviceEnd,
              remainingMinor: remaining,
              hasLiveAccrual: liveSet.has(c.id),
              asOf: req.asOfDate,
            })
          )
            continue;
          const [b] = await tx.select().from(budgets).where(eq(budgets.id, c.budgetId));
          const period = await this.reads.periodOn(tx, b.legalEntityId, req.asOfDate);
          const next = await this.reads.nextPeriod(tx, period.id);
          const [row] = await tx
            .insert(accruals)
            .values({
              tenantId: actor.tenantId,
              commitmentId: c.id,
              budgetId: c.budgetId,
              amountMinor: remaining,
              currency: b.currency,
              accountingPeriodId: period.id,
              autoReversePeriodId: next?.id ?? null,
              accrualDate: req.asOfDate,
            })
            .returning();
          created.push(row);
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'accruals.proposed',
          resourceType: 'accrual_run',
          resourceId: req.asOfDate,
          requestId: ctx.requestId,
          changes: { proposed: { from: null, to: created.map((c) => c.id) } },
        });
        return { count: created.length, items: await this.dtos(tx, created) };
      },
    );
  }

  approve(actor: RequestActor, id: string, ctx: CommandContext): Promise<CommandResult<Accrual>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `actuals.accrual.approve:${id}`,
        request: {},
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const acc = await this.lock(tx, id);
        if (acc.status !== 'proposed')
          throw new ApiProblem(409, 'INVALID_TRANSITION', `This accrual is already ${acc.status}.`);
        await this.ledgerReads.lockBudgets(tx, [acc.budgetId]);
        const row = (await this.ledgerReads.budgetRows(tx, [acc.budgetId])).get(acc.budgetId)!;
        const budget = toPostingBudget(row);
        const balances = (await this.ledgerReads.balances(tx, [budget.id])).get(budget.id)!.budget;
        const draft = unwrap(
          postCommitmentMovement(
            {
              kind: 'accrue',
              budget: { ...budget, balances },
              amount: { amountMinor: acc.amountMinor, currency: budget.currency },
              provenance: { commitmentId: acc.commitmentId },
            },
            {
              reportingCurrency: actor.reportingCurrency,
              rates: await this.ledgerReads.planRates(tx, budget.fiscalYearId),
              accountingDate: acc.accrualDate ?? new Date().toISOString().slice(0, 10),
            },
          ),
        );
        const journalId = await this.ledger.post(tx, draft, {
          actor,
          command: 'actuals.accrual.approve',
          fiscalYearId: budget.fiscalYearId,
          requestId: ctx.requestId,
          idempotencyKey: ctx.idempotencyKey,
        });
        const [after] = await tx
          .update(accruals)
          .set({ status: 'posted', journalId, decidedBy: actor.personId, decidedAt: new Date() })
          .where(eq(accruals.id, id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'accrual.posted',
          resourceType: 'accrual',
          resourceId: id,
          legalEntityId: budget.legalEntityId,
          requestId: ctx.requestId,
          changes: {
            status: { from: 'proposed', to: 'posted' },
            journalId: { from: null, to: journalId },
          },
        });
        return (await this.dtos(tx, [after]))[0];
      },
    );
  }

  reject(
    actor: RequestActor,
    id: string,
    req: { reason: string },
    ctx: CommandContext,
  ): Promise<CommandResult<Accrual>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `actuals.accrual.reject:${id}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const acc = await this.lock(tx, id);
        if (acc.status !== 'proposed')
          throw new ApiProblem(409, 'INVALID_TRANSITION', `This accrual is already ${acc.status}.`);
        const [after] = await tx
          .update(accruals)
          .set({
            status: 'rejected',
            decidedBy: actor.personId,
            decidedAt: new Date(),
            decisionReason: req.reason,
          })
          .where(eq(accruals.id, id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'accrual.rejected',
          resourceType: 'accrual',
          resourceId: id,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: { status: { from: 'proposed', to: 'rejected' } },
        });
        return (await this.dtos(tx, [after]))[0];
      },
    );
  }

  /** Posted accruals reverse on the first day of their reversal period (if the actual has not reversed them already). */
  reverseDue(
    actor: RequestActor,
    req: { asOfDate: string; budgetId?: string },
    ctx: CommandContext,
  ): Promise<CommandResult<{ count: number; items: Accrual[] }>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'actuals.accruals.auto_reverse',
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const due = await tx
          .select({ a: accruals, start: fiscalPeriods.startDate })
          .from(accruals)
          .innerJoin(fiscalPeriods, eq(fiscalPeriods.id, accruals.autoReversePeriodId))
          .where(
            and(
              eq(accruals.status, 'posted'),
              lte(fiscalPeriods.startDate, req.asOfDate),
              req.budgetId ? eq(accruals.budgetId, req.budgetId) : undefined,
            ),
          )
          .orderBy(asc(accruals.createdAt));
        const done: AccrualRow[] = [];
        for (const { a, start } of due) {
          const rid = await this.engine.reverseJournalTx(tx, actor, a.journalId!, {
            reasonCode: 'ACCRUAL-AUTO-REVERSE',
            reason: 'Reversal period started',
            accountingDate: start > req.asOfDate ? req.asOfDate : start,
            command: 'actuals.accruals.auto_reverse',
            idempotencyKey: ctx.idempotencyKey,
            requestId: ctx.requestId,
          });
          const [after] = await tx
            .update(accruals)
            .set({ status: 'reversed', reversalJournalId: rid, reversalTrigger: 'period' })
            .where(eq(accruals.id, a.id))
            .returning();
          done.push(after);
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'accruals.auto_reversed',
          resourceType: 'accrual_run',
          resourceId: req.asOfDate,
          requestId: ctx.requestId,
          changes: { reversed: { from: null, to: done.map((d) => d.id) } },
        });
        return { count: done.length, items: await this.dtos(tx, done) };
      },
    );
  }

  /** ERP journal file for posted accruals not exported yet: Dr expense account / Cr accrued expenses (2100). */
  export(
    actor: RequestActor,
    ctx: CommandContext,
  ): Promise<
    CommandResult<{ fileName: string; contentType: 'text/csv'; content: string; rows: number }>
  > {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'actuals.accruals.export',
        request: {},
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const rows = await tx
          .select({
            a: accruals,
            c: commitments,
            b: budgets,
            le: legalEntities.code,
            cc: costCenters.code,
            gl: glAccounts.code,
            period: fiscalPeriods.label,
          })
          .from(accruals)
          .innerJoin(commitments, eq(commitments.id, accruals.commitmentId))
          .innerJoin(budgets, eq(budgets.id, accruals.budgetId))
          .innerJoin(legalEntities, eq(legalEntities.id, budgets.legalEntityId))
          .innerJoin(fiscalPeriods, eq(fiscalPeriods.id, accruals.accountingPeriodId))
          .leftJoin(costCenters, eq(costCenters.id, commitments.costCenterId))
          .leftJoin(glAccounts, eq(glAccounts.id, commitments.glAccountId))
          .where(and(eq(accruals.status, 'posted'), isNull(accruals.exportedAt)))
          .orderBy(asc(accruals.createdAt));
        const esc = (v: string | number | null) => {
          const s = v === null ? '' : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const header =
          'legal_entity,period,accrual_date,reference,description,cost_center,debit_account,credit_account,amount,currency,auto_reverse';
        const lines = rows.map(({ a, c, le, cc, gl, period }) =>
          [
            le,
            period,
            a.accrualDate,
            commitmentRef(c.id),
            c.description,
            cc,
            gl ?? '6900',
            '2100',
            decimalOf(a.amountMinor, a.currency),
            a.currency,
            'yes',
          ]
            .map(esc)
            .join(','),
        );
        if (rows.length)
          await tx
            .update(accruals)
            .set({ exportedAt: new Date() })
            .where(
              inArray(
                accruals.id,
                rows.map((r) => r.a.id),
              ),
            );
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'accruals.exported',
          resourceType: 'accrual_export',
          resourceId: new Date().toISOString().slice(0, 10),
          requestId: ctx.requestId,
          changes: { accruals: { from: null, to: rows.map((r) => r.a.id) } },
        });
        return {
          fileName: `accruals-${new Date().toISOString().slice(0, 10)}.csv`,
          contentType: 'text/csv' as const,
          content: [header, ...lines].join('\n') + '\n',
          rows: rows.length,
        };
      },
    );
  }

  listPrepaids(actor: RequestActor) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      const rows = await tx.select().from(prepaids).orderBy(asc(prepaids.serviceStart)).limit(500);
      return {
        items: await this.prepaidDtos(
          tx,
          rows.filter((p) => p.amountMinor > 0),
        ),
      };
    });
  }

  /** Consumes each prepaid for the elapsed part of its service period: Dr actual / Cr encumbered (budget currency). */
  recognize(
    actor: RequestActor,
    req: { asOfDate: string; budgetId?: string },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'actuals.prepaids.recognize',
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const rows = await tx
          .select()
          .from(prepaids)
          .where(req.budgetId ? eq(prepaids.budgetId, req.budgetId) : undefined)
          .orderBy(asc(prepaids.id))
          .for('update');
        let total = 0;
        const touched: PrepaidRow[] = [];
        let currency = actor.reportingCurrency as string;
        for (const p of rows) {
          const target = recognizedToDate({
            amountMinor: p.amountMinor,
            serviceStart: p.serviceStart,
            serviceEnd: p.serviceEnd,
            asOf: req.asOfDate,
          });
          const delta = target - p.consumedMinor;
          if (delta <= 0 || !p.budgetId) continue;
          await this.ledgerReads.lockBudgets(tx, [p.budgetId]);
          const row = (await this.ledgerReads.budgetRows(tx, [p.budgetId])).get(p.budgetId)!;
          const budget = toPostingBudget(row);
          const balances = (await this.ledgerReads.balances(tx, [budget.id])).get(
            budget.id,
          )!.budget;
          const [a] = p.actualId
            ? await tx.select().from(actuals).where(eq(actuals.id, p.actualId))
            : [];
          const draft = unwrap(
            postCommitmentMovement(
              {
                kind: 'consume',
                budget: { ...budget, balances },
                amount: { amountMinor: delta, currency: budget.currency },
                provenance: { commitmentId: p.commitmentId, actualId: p.actualId },
              },
              {
                reportingCurrency: actor.reportingCurrency,
                rates: await this.ledgerReads.planRates(tx, budget.fiscalYearId),
                accountingDate: req.asOfDate,
              },
            ),
          );
          draft.lines = draft.lines.map((l) => ({
            ...l,
            costCenterId: a?.costCenterId ?? l.costCenterId,
            glAccountId: a?.glAccountId ?? null,
            eventCode: a?.eventCode ?? null,
          }));
          await this.ledger.post(tx, draft, {
            actor,
            command: 'actuals.prepaids.recognize',
            fiscalYearId: budget.fiscalYearId,
            requestId: ctx.requestId,
            idempotencyKey: ctx.idempotencyKey,
          });
          const [after] = await tx
            .update(prepaids)
            .set({ consumedMinor: target, recognizedThrough: req.asOfDate })
            .where(eq(prepaids.id, p.id))
            .returning();
          const [c] = await tx
            .select()
            .from(commitments)
            .where(eq(commitments.id, p.commitmentId))
            .for('update');
          const remaining =
            (await this.reads.commitmentBalances(tx, [c.id])).get(c.id)?.encumberedMinor ?? 0;
          const event = remaining <= 0 ? 'match_full' : 'match_partial';
          const next = commitmentMachine.next(c.status, event);
          await tx
            .update(commitments)
            .set({
              consumedMinor:
                c.consumedMinor + (await this.engine.toCommitmentMinor(tx, actor, c, delta)),
              ...(next.ok ? { status: next.value } : {}),
              updatedAt: new Date(),
            })
            .where(eq(commitments.id, c.id));
          total += delta;
          currency = budget.currency;
          touched.push(after);
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'prepaids.recognized',
          resourceType: 'prepaid_run',
          resourceId: req.asOfDate,
          requestId: ctx.requestId,
          changes: {
            prepaids: { from: null, to: touched.map((t) => t.id) },
            recognizedMinor: { from: 0, to: total },
          },
        });
        return {
          count: touched.length,
          recognizedMinor: total,
          currency,
          items: await this.prepaidDtos(tx, touched),
        };
      },
    );
  }

  private async lock(tx: Tx, id: string): Promise<AccrualRow> {
    const [a] = await tx.select().from(accruals).where(eq(accruals.id, id)).for('update');
    if (!a) throw ApiProblem.notFound('accrual');
    return a;
  }

  private async prepaidDtos(tx: Tx, rows: PrepaidRow[]) {
    const names = await this.reads.budgetNames(
      tx,
      rows.map((p) => p.budgetId),
    );
    return rows.map((p) => ({
      id: p.id,
      commitmentId: p.commitmentId,
      commitmentReference: commitmentRef(p.commitmentId),
      actualId: p.actualId,
      budgetId: p.budgetId,
      budgetName: p.budgetId ? (names.get(p.budgetId) ?? null) : null,
      amount: { amountMinor: p.amountMinor, currency: p.currency },
      recognized: { amountMinor: p.consumedMinor, currency: p.currency },
      remaining: { amountMinor: p.amountMinor - p.consumedMinor, currency: p.currency },
      serviceStart: p.serviceStart,
      serviceEnd: p.serviceEnd,
      nonRefundable: p.nonRefundable,
      recognizedThrough: p.recognizedThrough,
    }));
  }

  private async dtos(tx: Tx, rows: AccrualRow[]): Promise<Accrual[]> {
    if (rows.length === 0) return [];
    const cRows = await tx
      .select()
      .from(commitments)
      .where(
        inArray(
          commitments.id,
          rows.map((r) => r.commitmentId),
        ),
      );
    const cById = new Map(cRows.map((c) => [c.id, c]));
    const names = await this.reads.budgetNames(
      tx,
      rows.map((r) => r.budgetId),
    );
    const periodIds = rows
      .flatMap((r) => [r.accountingPeriodId, r.autoReversePeriodId])
      .filter((x): x is string => Boolean(x));
    const periods = await tx
      .select({ id: fiscalPeriods.id, label: fiscalPeriods.label })
      .from(fiscalPeriods)
      .where(inArray(fiscalPeriods.id, periodIds));
    const pById = new Map(periods.map((p) => [p.id, p]));
    return rows.map((r) => ({
      id: r.id,
      commitmentId: r.commitmentId,
      commitmentReference: commitmentRef(r.commitmentId),
      description: cById.get(r.commitmentId)?.description ?? '',
      budgetId: r.budgetId,
      budgetName: names.get(r.budgetId) ?? '',
      amount: { amountMinor: r.amountMinor, currency: r.currency },
      status: r.status,
      accrualDate: r.accrualDate,
      period: pById.get(r.accountingPeriodId)!,
      autoReversePeriod: r.autoReversePeriodId ? (pById.get(r.autoReversePeriodId) ?? null) : null,
      journalId: r.journalId,
      reversalJournalId: r.reversalJournalId,
      reversalTrigger: (r.reversalTrigger as 'actual' | 'period' | null) ?? null,
      decidedByPersonId: r.decidedBy,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decisionReason: r.decisionReason,
      exportedAt: r.exportedAt ? r.exportedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
