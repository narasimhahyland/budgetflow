import {
  actuals,
  costCenters,
  fiscalPeriods,
  glAccounts,
  glTieoutLines,
  glTieoutRuns,
  ledgerLines,
  legalEntities,
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
import { AnalyticsService } from '@bf/api/tenancy';
import type { TieOut, TieOutLineDetail, TieOutList } from '@bf/contracts';
import {
  buildTriplet,
  checkTieOutSignOff,
  compareTieOut,
  isCurrencyCode,
  parseCsv,
  parseDecimalAmount,
  type CurrencyCode,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { ActualsReads, decimalOf, tenantOf, todayUtc, type CommandContext } from './actuals-reads';
import { ActualsDtos } from './dto';
import { csvCell } from './csv';

type RunRow = typeof glTieoutRuns.$inferSelect;

/** BudgetFlow-to-GL tie-out by entity, cost center, account and period, with explanations and monthly sign-off. */
@Injectable()
export class TieOutService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: ActualsReads,
    private readonly dtos: ActualsDtos,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  list(actor: RequestActor, q: { month?: string; legalEntityId?: string }): Promise<TieOutList> {
    const month = q.month ?? todayUtc().slice(0, 7);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      const entities = await tx
        .select()
        .from(legalEntities)
        .where(q.legalEntityId ? eq(legalEntities.id, q.legalEntityId) : undefined)
        .orderBy(asc(legalEntities.code));
      const items: TieOut[] = [];
      for (const e of entities) {
        const period = await this.reads.periodOn(tx, e.id, `${month}-15`).catch(() => null);
        if (!period) continue;
        const [run] = await tx
          .select()
          .from(glTieoutRuns)
          .where(
            and(eq(glTieoutRuns.legalEntityId, e.id), eq(glTieoutRuns.fiscalPeriodId, period.id)),
          )
          .orderBy(desc(glTieoutRuns.createdAt))
          .limit(1);
        if (run) items.push(await this.dto(tx, actor, run));
      }
      return { month, items };
    });
  }

  get(actor: RequestActor, id: string): Promise<TieOut> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      return this.dto(tx, actor, await this.run(tx, id));
    });
  }

  create(
    actor: RequestActor,
    req: {
      legalEntityId: string;
      month: string;
      toleranceMinor: number;
      fileName: string;
      content: string;
    },
    ctx: CommandContext,
  ): Promise<CommandResult<TieOut>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'actuals.tieout.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const [entity] = await tx
          .select()
          .from(legalEntities)
          .where(eq(legalEntities.id, req.legalEntityId));
        if (!entity) throw ApiProblem.notFound('legal entity');
        const period = await this.reads.periodOn(tx, entity.id, `${req.month}-15`);
        const [signed] = await tx
          .select({ id: glTieoutRuns.id })
          .from(glTieoutRuns)
          .where(
            and(
              eq(glTieoutRuns.legalEntityId, entity.id),
              eq(glTieoutRuns.fiscalPeriodId, period.id),
              eq(glTieoutRuns.status, 'signed_off'),
            ),
          );
        if (signed)
          throw new ApiProblem(
            409,
            'TIEOUT_SIGNED_OFF',
            `${entity.code} ${period.label} is already signed off and locked.`,
            { tieOutId: signed.id },
          );
        const parsed = unwrap(parseCsv(req.content));
        for (const col of ['cost_center', 'gl_account', 'amount'])
          if (!parsed.headers.includes(col))
            throw new ApiProblem(422, 'IMPORT_INVALID', `The file needs a ${col} column.`);
        const ccs = new Map(
          (await tx.select({ id: costCenters.id, code: costCenters.code }).from(costCenters)).map(
            (c) => [c.code.toLowerCase(), c.id],
          ),
        );
        const gls = new Map(
          (
            await tx
              .select({ id: glAccounts.id, code: glAccounts.code })
              .from(glAccounts)
              .where(eq(glAccounts.legalEntityId, entity.id))
          ).map((g) => [g.code.toLowerCase(), g.id]),
        );
        const plan = await this.reads.planRatesOn(tx, period.startDate);
        if (!plan)
          throw new ApiProblem(422, 'RATE_MISSING', 'No locked plan rates cover this period.');
        const reporting = actor.reportingCurrency;
        const problems: string[] = [];
        const gl: {
          costCenterId: string | null;
          glAccountId: string | null;
          amountMinor: number;
        }[] = [];
        for (const r of parsed.rows) {
          const cc = r.values['cost_center']
            ? ccs.get(r.values['cost_center'].toLowerCase())
            : null;
          const acct = gls.get((r.values['gl_account'] ?? '').toLowerCase());
          const ccy = (r.values['currency'] || entity.functionalCurrency).toUpperCase();
          if (cc === undefined)
            problems.push(`line ${r.line}: cost center ${r.values['cost_center']} is not known`);
          if (!acct)
            problems.push(
              `line ${r.line}: GL account ${r.values['gl_account']} does not exist for ${entity.code}`,
            );
          if (!isCurrencyCode(ccy)) problems.push(`line ${r.line}: ${ccy} is not a currency`);
          if (cc === undefined || !acct || !isCurrencyCode(ccy)) continue;
          const amt = parseDecimalAmount(r.values['amount'] ?? '', ccy);
          if (!amt.ok) {
            problems.push(`line ${r.line}: ${amt.error.message}`);
            continue;
          }
          const t = unwrap(
            buildTriplet(
              { amountMinor: Math.abs(amt.value), currency: ccy },
              { budgetCurrency: reporting, reportingCurrency: reporting, rates: plan.rates },
            ),
          );
          gl.push({
            costCenterId: cc,
            glAccountId: acct,
            amountMinor: Math.sign(amt.value) * t.reporting.amountMinor,
          });
        }
        if (problems.length)
          throw new ApiProblem(
            422,
            'IMPORT_INVALID',
            `The general ledger file has problems: ${problems.slice(0, 5).join('; ')}.`,
          );
        const bf = (
          await tx
            .select({
              costCenterId: ledgerLines.costCenterId,
              glAccountId: ledgerLines.glAccountId,
              total: sql<string>`sum(${ledgerLines.reportingAmountMinor})`,
            })
            .from(ledgerLines)
            .where(
              and(
                eq(ledgerLines.legalEntityId, entity.id),
                eq(ledgerLines.fiscalPeriodId, period.id),
                eq(ledgerLines.account, 'actual'),
              ),
            )
            .groupBy(ledgerLines.costCenterId, ledgerLines.glAccountId)
        ).map((r) => ({
          costCenterId: r.costCenterId,
          glAccountId: r.glAccountId,
          amountMinor: Number(r.total),
        }));
        const cmp = compareTieOut(gl, bf, req.toleranceMinor);
        const [run] = await tx
          .insert(glTieoutRuns)
          .values({
            tenantId: actor.tenantId,
            fiscalPeriodId: period.id,
            legalEntityId: entity.id,
            status: cmp.exceptions > 0 ? 'exceptions' : 'reconciled',
            totals: {
              glTotalMinor: cmp.glTotalMinor,
              budgetflowTotalMinor: cmp.budgetflowTotalMinor,
              exceptions: cmp.exceptions,
            },
            toleranceMinor: req.toleranceMinor,
            currency: reporting,
            preparedBy: actor.personId,
            sourceFileName: req.fileName,
          })
          .returning();
        if (cmp.rows.length)
          await tx.insert(glTieoutLines).values(
            cmp.rows.map((r) => ({
              tenantId: actor.tenantId,
              runId: run.id,
              costCenterId: r.costCenterId,
              glAccountId: r.glAccountId,
              glMinor: r.glMinor,
              budgetflowMinor: r.budgetflowMinor,
              differenceMinor: r.differenceMinor,
              withinTolerance: r.withinTolerance,
            })),
          );
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'gl_tieout.prepared',
          resourceType: 'gl_tieout',
          resourceId: run.id,
          legalEntityId: entity.id,
          requestId: ctx.requestId,
          changes: {
            period: { from: null, to: period.label },
            status: { from: null, to: run.status },
            glTotalMinor: { from: null, to: cmp.glTotalMinor },
            budgetflowTotalMinor: { from: null, to: cmp.budgetflowTotalMinor },
            exceptions: { from: null, to: cmp.exceptions },
          },
        });
        return this.dto(tx, actor, run);
      },
    );
  }

  line(actor: RequestActor, id: string, lineId: string): Promise<TieOutLineDetail> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      const run = await this.run(tx, id);
      const dto = await this.dto(tx, actor, run);
      const line = dto.lines.find((l) => l.id === lineId);
      if (!line) throw ApiProblem.notFound('tie-out line');
      const eqOrNull = <T>(col: T, v: string | null) =>
        v ? eq(col as never, v) : isNull(col as never);
      const ledger = await tx
        .select({ l: ledgerLines, sourceRef: actuals.sourceRef, merchant: actuals.merchant })
        .from(ledgerLines)
        .leftJoin(actuals, eq(actuals.id, ledgerLines.actualId))
        .where(
          and(
            eq(ledgerLines.legalEntityId, run.legalEntityId),
            eq(ledgerLines.fiscalPeriodId, run.fiscalPeriodId),
            eq(ledgerLines.account, 'actual'),
            eqOrNull(ledgerLines.costCenterId, line.costCenterId),
            eqOrNull(ledgerLines.glAccountId, line.glAccountId),
          ),
        )
        .orderBy(asc(ledgerLines.accountingDate), asc(ledgerLines.createdAt))
        .limit(500);
      const unmatched = await this.unmatchedRows(tx, run, line.costCenterId, line.glAccountId);
      return {
        line,
        ledgerLines: ledger.map(({ l, sourceRef, merchant }) => ({
          journalId: l.journalId,
          lineId: l.id,
          accountingDate: l.accountingDate,
          actualId: l.actualId,
          sourceRef: sourceRef ?? null,
          merchant: merchant ?? null,
          transaction: { amountMinor: l.transactionAmountMinor, currency: l.transactionCurrency },
          reporting: { amountMinor: l.reportingAmountMinor, currency: l.reportingCurrency },
        })),
        unmatchedActuals: await this.dtos.lines(tx, unmatched, actor.reportingCurrency),
      };
    });
  }

  explain(
    actor: RequestActor,
    id: string,
    lineId: string,
    req: { explanation: string },
    ctx: CommandContext,
  ): Promise<CommandResult<TieOut>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `actuals.tieout.explain:${lineId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const run = await this.run(tx, id, true);
        if (run.status === 'signed_off')
          throw new ApiProblem(409, 'TIEOUT_SIGNED_OFF', 'This tie-out is signed off and locked.');
        const [l] = await tx
          .select()
          .from(glTieoutLines)
          .where(and(eq(glTieoutLines.id, lineId), eq(glTieoutLines.runId, id)));
        if (!l) throw ApiProblem.notFound('tie-out line');
        await tx
          .update(glTieoutLines)
          .set({
            explanation: req.explanation,
            explainedBy: actor.personId,
            explainedAt: new Date(),
          })
          .where(eq(glTieoutLines.id, lineId));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'gl_tieout.difference_explained',
          resourceType: 'gl_tieout',
          resourceId: id,
          legalEntityId: run.legalEntityId,
          requestId: ctx.requestId,
          reason: req.explanation,
          changes: {
            lineId: { from: null, to: lineId },
            explanation: { from: l.explanation, to: req.explanation },
          },
        });
        return this.dto(tx, actor, run);
      },
    );
  }

  signOff(
    actor: RequestActor,
    id: string,
    req: { comment?: string },
    ctx: CommandContext,
  ): Promise<CommandResult<TieOut>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `actuals.tieout.sign_off:${id}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const run = await this.run(tx, id, true);
        this.policy.assert(actor, 'gl.sign_off', tenantOf(actor), 'tie-out');
        const lines = await tx.select().from(glTieoutLines).where(eq(glTieoutLines.runId, id));
        unwrap(
          checkTieOutSignOff({
            status: run.status,
            preparedBy: run.preparedBy,
            signerId: actor.personId ?? actor.subject,
            unexplainedExceptions: lines.filter((l) => !l.withinTolerance && !l.explanation).length,
          }),
        );
        const [after] = await tx
          .update(glTieoutRuns)
          .set({
            status: 'signed_off',
            signedOffBy: actor.personId,
            signedOffAt: new Date(),
            signOffComment: req.comment ?? null,
          })
          .where(eq(glTieoutRuns.id, id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'gl_tieout.signed_off',
          resourceType: 'gl_tieout',
          resourceId: id,
          legalEntityId: run.legalEntityId,
          requestId: ctx.requestId,
          reason: req.comment ?? null,
          changes: { status: { from: run.status, to: 'signed_off' } },
        });
        await this.analytics.track(tx, actor, 'tieout.signed_off', {
          exceptions: lines.filter((l) => !l.withinTolerance).length,
          withExplanations: lines.some((l) => !l.withinTolerance),
        });
        return this.dto(tx, actor, after);
      },
    );
  }

  export(actor: RequestActor, id: string) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      const t = await this.dto(tx, actor, await this.run(tx, id));
      const rows = t.lines.map((l) =>
        [
          t.legalEntityCode,
          t.period.label,
          l.glAccountCode,
          l.costCenterCode,
          decimalOf(l.gl.amountMinor, t.currency),
          decimalOf(l.budgetflow.amountMinor, t.currency),
          decimalOf(l.difference.amountMinor, t.currency),
          t.currency,
          l.withinTolerance ? 'tied' : 'difference',
          l.explanation,
        ]
          .map(csvCell)
          .join(','),
      );
      return {
        fileName: `gl-tie-out-${t.legalEntityCode}-${t.period.label.replace(/\s+/g, '-')}.csv`,
        contentType: 'text/csv' as const,
        content:
          [
            'legal_entity,period,gl_account,cost_center,general_ledger,budgetflow_actuals,difference,currency,status,explanation',
            ...rows,
          ].join('\n') + '\n',
        rows: rows.length,
      };
    });
  }

  private async run(tx: Tx, id: string, lock = false): Promise<RunRow> {
    const q = tx.select().from(glTieoutRuns).where(eq(glTieoutRuns.id, id));
    const [r] = lock ? await q.for('update') : await q;
    if (!r) throw ApiProblem.notFound('tie-out');
    return r;
  }

  private async unmatchedRows(
    tx: Tx,
    run: RunRow,
    costCenterId: string | null | undefined,
    glAccountId: string | null | undefined,
  ) {
    const [p] = await tx
      .select()
      .from(fiscalPeriods)
      .where(eq(fiscalPeriods.id, run.fiscalPeriodId));
    const conds = [
      eq(actuals.legalEntityId, run.legalEntityId),
      inArray(actuals.matchStatus, ['unmatched', 'partially_matched']),
      gte(actuals.accountingDate, p.startDate),
      lte(actuals.accountingDate, p.endDate),
      or(
        isNull(actuals.importBatchId),
        sql`${actuals.importBatchId} in (select id from import_batches where status = 'posted')`,
      )!,
    ];
    if (costCenterId !== undefined)
      conds.push(
        costCenterId ? eq(actuals.costCenterId, costCenterId) : isNull(actuals.costCenterId),
      );
    if (glAccountId !== undefined)
      conds.push(glAccountId ? eq(actuals.glAccountId, glAccountId) : isNull(actuals.glAccountId));
    return tx
      .select()
      .from(actuals)
      .where(and(...conds))
      .limit(500);
  }

  private async dto(tx: Tx, actor: RequestActor, run: RunRow): Promise<TieOut> {
    const [e] = await tx
      .select()
      .from(legalEntities)
      .where(eq(legalEntities.id, run.legalEntityId));
    const [p] = await tx
      .select()
      .from(fiscalPeriods)
      .where(eq(fiscalPeriods.id, run.fiscalPeriodId));
    const lines = await tx.select().from(glTieoutLines).where(eq(glTieoutLines.runId, run.id));
    const lk = await this.reads.lookups(tx);
    const names = await this.reads.personNames(tx, [
      run.preparedBy,
      run.signedOffBy,
      ...lines.map((l) => l.explainedBy),
    ]);
    const unmatched = await this.unmatchedRows(tx, run, undefined, undefined);
    const ccy = (run.currency ?? actor.reportingCurrency) as CurrencyCode;
    const money = (amountMinor: number) => ({ amountMinor, currency: ccy });
    const totals = run.totals as { glTotalMinor?: number; budgetflowTotalMinor?: number };
    const sortKey = (l: (typeof lines)[number]) =>
      `${lk.glAccounts.get(l.glAccountId ?? '')?.code ?? '~'}|${lk.costCenters.get(l.costCenterId ?? '')?.code ?? '~'}`;
    return {
      id: run.id,
      legalEntityId: run.legalEntityId,
      legalEntityCode: e.code,
      legalEntityName: e.name,
      functionalCurrency: e.functionalCurrency,
      period: { id: p.id, label: p.label, startDate: p.startDate, endDate: p.endDate },
      status: run.status,
      currency: ccy,
      tolerance: money(run.toleranceMinor),
      glTotal: money(totals.glTotalMinor ?? 0),
      budgetflowTotal: money(totals.budgetflowTotalMinor ?? 0),
      difference: money((totals.glTotalMinor ?? 0) - (totals.budgetflowTotalMinor ?? 0)),
      exceptions: lines.filter((l) => !l.withinTolerance).length,
      unexplainedExceptions: lines.filter((l) => !l.withinTolerance && !l.explanation).length,
      unmatchedActuals: unmatched.length,
      sourceFileName: run.sourceFileName,
      preparedByPersonId: run.preparedBy,
      preparedByName: run.preparedBy ? (names.get(run.preparedBy) ?? null) : null,
      signedOffByPersonId: run.signedOffBy,
      signedOffByName: run.signedOffBy ? (names.get(run.signedOffBy) ?? null) : null,
      signedOffAt: run.signedOffAt ? run.signedOffAt.toISOString() : null,
      signOffComment: run.signOffComment,
      createdAt: run.createdAt.toISOString(),
      lines: [...lines]
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
        .map((l) => ({
          id: l.id,
          costCenterId: l.costCenterId,
          costCenterCode: l.costCenterId
            ? (lk.costCenters.get(l.costCenterId)?.code ?? null)
            : null,
          costCenterName: l.costCenterId
            ? (lk.costCenters.get(l.costCenterId)?.name ?? null)
            : null,
          glAccountId: l.glAccountId,
          glAccountCode: l.glAccountId ? (lk.glAccounts.get(l.glAccountId)?.code ?? null) : null,
          glAccountName: l.glAccountId ? (lk.glAccounts.get(l.glAccountId)?.name ?? null) : null,
          gl: money(l.glMinor),
          budgetflow: money(l.budgetflowMinor),
          difference: money(l.differenceMinor),
          withinTolerance: l.withinTolerance,
          explanation: l.explanation,
          explainedByName: l.explainedBy ? (names.get(l.explainedBy) ?? null) : null,
          explainedAt: l.explainedAt ? l.explainedAt.toISOString() : null,
          unmatchedActuals: unmatched.filter(
            (u) => u.costCenterId === l.costCenterId && u.glAccountId === l.glAccountId,
          ).length,
        })),
    };
  }
}
