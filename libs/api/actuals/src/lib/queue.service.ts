import {
  actualMatches,
  actualTaxLines,
  actuals,
  budgets,
  commitments,
  doaLimits,
  doaMatrixVersions,
  events,
  requests,
  vendors,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { AuditService } from '@bf/api/audit';
import {
  ActorResolver,
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { LedgerReads, toPostingBudget } from '@bf/api/ledger';
import { AnalyticsService } from '@bf/api/tenancy';
import type { ActualDetail, ActualList, OverBudgetRequest } from '@bf/contracts';
import {
  availableOf,
  buildTriplet,
  checkApprovalHygiene,
  checkAuthority,
  classifyFit,
  DEFAULT_MATCH_TOLERANCE_BPS,
  toleranceOf,
  type CurrencyCode,
  type DoaLimit,
  type RoleId,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  ActualsReads,
  commitmentRef,
  tenantOf,
  todayUtc,
  type ActualRow,
  type CommandContext,
} from './actuals-reads';
import { ActualsDtos } from './dto';
import { MatchEngine, type MatchPartInput } from './match-engine';

type ListQuery = {
  status?: 'queue' | 'unmatched' | 'partially_matched' | 'matched' | 'excluded' | 'all';
  batchId?: string;
  legalEntityId?: string;
  currency?: string;
  eventCode?: string;
  q?: string;
  cursor?: string;
  limit?: number;
};

/** The unmatched queue and manual matching: match, split, exclude, undo, and over-budget requests. */
@Injectable()
export class QueueService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly actors: ActorResolver,
    private readonly reads: ActualsReads,
    private readonly ledgerReads: LedgerReads,
    private readonly engine: MatchEngine,
    private readonly dtos: ActualsDtos,
    private readonly audit: AuditService,
    private readonly analytics: AnalyticsService,
  ) {}

  private readonly postedOrNoBatch = or(
    isNull(actuals.importBatchId),
    sql`${actuals.importBatchId} in (select id from import_batches where status = 'posted')`,
  )!;

  list(actor: RequestActor, q: ListQuery): Promise<ActualList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      const status = q.status ?? 'queue';
      const where: SQL[] = [];
      if (status === 'queue') {
        where.push(
          inArray(actuals.matchStatus, ['unmatched', 'partially_matched']),
          this.postedOrNoBatch,
        );
      } else if (status !== 'all') where.push(eq(actuals.matchStatus, status));
      if (q.batchId) where.push(eq(actuals.importBatchId, q.batchId));
      if (q.legalEntityId) where.push(eq(actuals.legalEntityId, q.legalEntityId));
      if (q.currency) where.push(eq(actuals.transactionCurrency, q.currency));
      if (q.eventCode) where.push(eq(actuals.eventCode, q.eventCode));
      if (q.q) {
        const like = `%${q.q.replace(/[%_]/g, '')}%`;
        where.push(
          or(
            ilike(actuals.merchant, like),
            ilike(actuals.memo, like),
            ilike(actuals.sourceRef, like),
            ilike(actuals.reference, like),
          )!,
        );
      }
      const limit = q.limit ?? 50;
      const offset = Number(q.cursor ?? 0) || 0;
      const rows = await tx
        .select()
        .from(actuals)
        .where(and(...where))
        .orderBy(desc(actuals.transactionDate), asc(actuals.lineNo), asc(actuals.id))
        .limit(limit + 1)
        .offset(offset);
      const [counts] = await tx
        .select({
          queue: sql<number>`count(*) filter (where ${actuals.matchStatus} in ('unmatched','partially_matched') and (${actuals.importBatchId} is null or ${actuals.importBatchId} in (select id from import_batches where status = 'posted')))`,
          matched: sql<number>`count(*) filter (where ${actuals.matchStatus} = 'matched')`,
          excluded: sql<number>`count(*) filter (where ${actuals.matchStatus} = 'excluded')`,
          review: sql<number>`count(*) filter (where ${actuals.importBatchId} in (select id from import_batches where status = 'review'))`,
        })
        .from(actuals);
      return {
        items: await this.dtos.lines(tx, rows.slice(0, limit), actor.reportingCurrency),
        nextCursor: rows.length > limit ? String(offset + limit) : null,
        counts: {
          queue: Number(counts.queue),
          matched: Number(counts.matched),
          excluded: Number(counts.excluded),
          review: Number(counts.review),
        },
      };
    });
  }

  get(actor: RequestActor, actualId: string): Promise<ActualDetail> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      return this.detail(tx, actor, actualId);
    });
  }

  async detail(tx: Tx, actor: RequestActor, actualId: string): Promise<ActualDetail> {
    const [a] = await tx.select().from(actuals).where(eq(actuals.id, actualId));
    if (!a) throw ApiProblem.notFound('actual');
    const [line] = await this.dtos.lines(tx, [a], actor.reportingCurrency);
    const parts = await tx
      .select()
      .from(actualMatches)
      .where(eq(actualMatches.actualId, a.id))
      .orderBy(asc(actualMatches.createdAt));
    return {
      actual: line,
      matches: await this.dtos.matchParts(tx, parts),
      candidates:
        a.matchStatus === 'matched' || a.matchStatus === 'excluded'
          ? []
          : await this.candidates(tx, actor, a),
      tax: await this.taxView(tx, a),
    };
  }

  /** Gap B3 (080g): the line's tax split; the actual's amount is already gross less recoverable tax. */
  private async taxView(tx: Tx, a: typeof actuals.$inferSelect): Promise<ActualDetail['tax']> {
    const lines = await tx
      .select()
      .from(actualTaxLines)
      .where(eq(actualTaxLines.actualId, a.id))
      .orderBy(asc(actualTaxLines.id));
    if (!lines.length) return null;
    const m = (amountMinor: number) => ({ amountMinor, currency: a.transactionCurrency });
    const rec = lines.filter((l) => l.recoverable).reduce((s, l) => s + l.amountMinor, 0);
    const non = lines.filter((l) => !l.recoverable).reduce((s, l) => s + l.amountMinor, 0);
    return {
      gross: m(a.transactionAmountMinor + rec),
      lines: lines.map((l) => ({
        taxCode: l.taxCode,
        amount: m(l.amountMinor),
        recoverable: l.recoverable,
        shareBps: l.shareBps,
        ruleId: l.ruleId,
      })),
      recoverable: m(rec),
      nonRecoverable: m(non),
      usesBudget: m(a.transactionAmountMinor),
    };
  }

  /** Open commitments in the actual's entity, proposed first, then same event code, vendor and closest amount. */
  private async candidates(
    tx: Tx,
    actor: RequestActor,
    a: ActualRow,
  ): Promise<ActualDetail['candidates']> {
    const rows = await tx
      .select({
        c: commitments,
        budgetName: budgets.name,
        budgetCurrency: budgets.currency,
        fy: budgets.fiscalYearId,
        vendorName: vendors.name,
        eventCode: events.eventCode,
      })
      .from(commitments)
      .innerJoin(budgets, eq(budgets.id, commitments.budgetId))
      .leftJoin(vendors, eq(vendors.id, commitments.vendorId))
      .leftJoin(events, eq(events.id, commitments.eventId))
      .where(
        and(
          eq(commitments.legalEntityId, a.legalEntityId),
          inArray(commitments.status, ['encumbered', 'partially_consumed']),
        ),
      );
    if (rows.length === 0) return [];
    const bal = await this.reads.commitmentBalances(
      tx,
      rows.map((r) => r.c.id),
    );
    const pre = await this.engine.prepaidOutstanding(
      tx,
      rows.map((r) => r.c.id),
    );
    const left = Math.abs(a.transactionAmountMinor) - Math.abs(a.matchedMinor);
    const ratesByFy = new Map<string, Awaited<ReturnType<LedgerReads['planRates']>>>();
    const out: ActualDetail['candidates'] = [];
    for (const r of rows) {
      if (!ratesByFy.has(r.fy)) ratesByFy.set(r.fy, await this.ledgerReads.planRates(tx, r.fy));
      const rates = ratesByFy.get(r.fy)!;
      const ccy = r.budgetCurrency as CurrencyCode;
      const conv = (minor: number, currency: string) => {
        const t = buildTriplet(
          { amountMinor: minor, currency: currency as CurrencyCode },
          { budgetCurrency: ccy, reportingCurrency: actor.reportingCurrency, rates },
        );
        return t.ok ? t.value.budget.amountMinor : 0;
      };
      const remaining = (bal.get(r.c.id)?.encumberedMinor ?? 0) - (pre.get(r.c.id) ?? 0);
      if (remaining <= 0) continue;
      const total = conv(r.c.amountMinor, r.c.currency);
      const actualInBudget = left > 0 ? conv(left, a.transactionCurrency) : 0;
      const f = classifyFit({
        actualMinor: actualInBudget,
        remainingMinor: remaining,
        commitmentTotalMinor: total,
        toleranceBps: DEFAULT_MATCH_TOLERANCE_BPS,
      });
      const proposed = a.proposedCommitmentId === r.c.id;
      out.push({
        commitmentId: r.c.id,
        reference: commitmentRef(r.c.id),
        description: r.c.description,
        budgetId: r.c.budgetId,
        budgetName: r.budgetName,
        eventCode: r.eventCode,
        vendorName: r.vendorName,
        total: { amountMinor: total, currency: ccy },
        remaining: { amountMinor: remaining, currency: ccy },
        actualInBudget: { amountMinor: actualInBudget, currency: ccy },
        differenceMinor: f.differenceMinor,
        toleranceMinor: toleranceOf(total, DEFAULT_MATCH_TOLERANCE_BPS),
        fit: a.transactionAmountMinor < 0 ? 'refund' : f.fit,
        confidence: proposed ? a.matchConfidence : null,
        rule: proposed ? (a.matchRule as 'manual') : null,
      });
    }
    const score = (c: ActualDetail['candidates'][number]) =>
      (c.confidence !== null ? 1000 : 0) +
      (a.eventCode && c.eventCode === a.eventCode ? 100 : 0) +
      (a.vendorId && rows.find((r) => r.c.id === c.commitmentId)?.c.vendorId === a.vendorId
        ? 50
        : 0);
    return out
      .sort(
        (x, y) =>
          score(y) - score(x) ||
          Math.abs(x.differenceMinor) - Math.abs(y.differenceMinor) ||
          x.reference.localeCompare(y.reference),
      )
      .slice(0, 8);
  }

  match(
    actor: RequestActor,
    actualId: string,
    req: {
      parts: MatchPartInput[];
      prepaid?: { serviceStart: string; serviceEnd: string; nonRefundable?: boolean };
      confirmNotDuplicate?: boolean;
      note?: string;
    },
    ctx: CommandContext,
  ): Promise<CommandResult<ActualDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `actuals.match:${actualId}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        if (req.prepaid && req.prepaid.serviceEnd < req.prepaid.serviceStart)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'The service period ends before it starts.',
          );
        if (req.prepaid && req.parts.some((p) => !p.commitmentId))
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'A deposit is matched to a commitment.');
        const res = await this.engine.match(tx, actor, actualId, req.parts, {
          rule: 'manual',
          prepaid: req.prepaid,
          confirmNotDuplicate: req.confirmNotDuplicate,
          command: 'actuals.match',
          idempotencyKey: ctx.idempotencyKey,
          requestId: ctx.requestId,
        });
        const [a] = await tx.select().from(actuals).where(eq(actuals.id, actualId));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: req.parts.length > 1 ? 'actuals.actual.split' : 'actuals.actual.matched',
          resourceType: 'actual',
          resourceId: actualId,
          legalEntityId: a.legalEntityId,
          requestId: ctx.requestId,
          reason: req.note ?? null,
          changes: {
            matchStatus: { from: null, to: a.matchStatus },
            parts: {
              from: null,
              to: req.parts.map((p) => ({
                commitmentId: p.commitmentId ?? null,
                budgetId: p.budgetId ?? null,
                amountMinor: p.amountMinor ?? null,
              })),
            },
            prepaid: { from: null, to: Boolean(req.prepaid) },
            journals: { from: null, to: res.journalIds },
          },
        });
        await this.analytics.track(tx, actor, 'actual.matched', {
          count: 1,
          auto: false,
          parts: req.parts.length,
        });
        return this.detail(tx, actor, actualId);
      },
    );
  }

  exclude(
    actor: RequestActor,
    actualId: string,
    req: { reason: string },
    ctx: CommandContext,
  ): Promise<CommandResult<ActualDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `actuals.exclude:${actualId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const a = await this.engine.lockActual(tx, actualId);
        if (a.matchStatus !== 'unmatched' || a.matchedMinor !== 0)
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'Only an unmatched line can be marked not budget-relevant; undo its match first.',
          );
        await tx
          .update(actuals)
          .set({ matchStatus: 'excluded', excludedReason: req.reason, matchNote: null })
          .where(eq(actuals.id, actualId));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'actuals.actual.excluded',
          resourceType: 'actual',
          resourceId: actualId,
          legalEntityId: a.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: { matchStatus: { from: a.matchStatus, to: 'excluded' } },
        });
        return this.detail(tx, actor, actualId);
      },
    );
  }

  unmatch(
    actor: RequestActor,
    actualId: string,
    req: { reasonCode: string; reason: string },
    ctx: CommandContext,
  ): Promise<CommandResult<ActualDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `actuals.unmatch:${actualId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const res = await this.engine.unmatch(tx, actor, actualId, {
          ...req,
          command: 'actuals.unmatch',
          idempotencyKey: ctx.idempotencyKey,
          requestId: ctx.requestId,
          accountingDate: todayUtc(),
        });
        const [a] = await tx.select().from(actuals).where(eq(actuals.id, actualId));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'actuals.actual.unmatched',
          resourceType: 'actual',
          resourceId: actualId,
          legalEntityId: a.legalEntityId,
          requestId: ctx.requestId,
          reason: `${req.reasonCode}: ${req.reason}`,
          changes: {
            matchStatus: { from: 'matched', to: 'unmatched' },
            reversals: { from: null, to: res.journalIds },
          },
        });
        return this.detail(tx, actor, actualId);
      },
    );
  }

  requestOverBudget(
    actor: RequestActor,
    actualId: string,
    req: { commitmentId?: string; budgetId?: string; purpose: string },
    ctx: CommandContext,
  ): Promise<CommandResult<OverBudgetRequest>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `actuals.over_budget:${actualId}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        if (!actor.personId)
          throw ApiProblem.forbidden('Only people in the directory can raise requests.');
        const a = await this.engine.lockActual(tx, actualId);
        if (
          a.matchStatus === 'matched' ||
          a.matchStatus === 'excluded' ||
          a.transactionAmountMinor < 0
        )
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            'Over-budget approval is only for unmatched charges.',
          );
        const c = req.commitmentId
          ? (await tx.select().from(commitments).where(eq(commitments.id, req.commitmentId)))[0]
          : undefined;
        if (req.commitmentId && !c) throw ApiProblem.notFound('commitment');
        const budgetId = c?.budgetId ?? req.budgetId!;
        const row = (await this.ledgerReads.budgetRows(tx, [budgetId])).get(budgetId);
        if (!row) throw ApiProblem.notFound('budget');
        const budget = toPostingBudget(row);
        const rates = await this.ledgerReads.planRates(tx, budget.fiscalYearId);
        const left = Math.abs(a.transactionAmountMinor) - Math.abs(a.matchedMinor);
        const t = unwrap(
          buildTriplet(
            { amountMinor: left, currency: a.transactionCurrency as CurrencyCode },
            { budgetCurrency: budget.currency, reportingCurrency: actor.reportingCurrency, rates },
          ),
        );
        let excess: number;
        if (c) {
          const remaining =
            (await this.reads.commitmentBalances(tx, [c.id])).get(c.id)?.encumberedMinor ?? 0;
          const total = this.engine.commitmentTotal(c, budget, {
            reportingCurrency: actor.reportingCurrency,
            rates,
          });
          const f = classifyFit({
            actualMinor: t.budget.amountMinor,
            remainingMinor: remaining,
            commitmentTotalMinor: total,
            toleranceBps: DEFAULT_MATCH_TOLERANCE_BPS,
          });
          if (f.fit !== 'over_tolerance')
            throw new ApiProblem(
              409,
              'INVALID_TRANSITION',
              'The actual fits the commitment and its tolerance; match it directly.',
            );
          excess = f.excessMinor;
        } else {
          const bal = (await this.ledgerReads.balances(tx, [budgetId])).get(budgetId)!.budget;
          excess = Math.max(
            1,
            t.budget.amountMinor - Math.max(availableOf(bal, budget.control.basis), 0),
          );
        }
        const [r] = await tx
          .insert(requests)
          .values({
            tenantId: actor.tenantId,
            kind: 'over_budget',
            status: 'pending_approval',
            requesterPersonId: actor.personId,
            budgetId,
            eventId: c?.eventId ?? null,
            amountMinor: excess,
            currency: budget.currency,
            spendType: 'over_budget',
            purpose: req.purpose,
          })
          .returning();
        await tx
          .update(actuals)
          .set({
            overBudgetRequestId: r.id,
            proposedCommitmentId: c?.id ?? null,
            proposedBudgetId: c ? null : budgetId,
            matchRule: a.matchRule ?? 'manual',
            matchConfidence: a.matchConfidence ?? 0,
          })
          .where(eq(actuals.id, a.id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'request.over_budget.submitted',
          resourceType: 'request',
          resourceId: r.id,
          legalEntityId: budget.legalEntityId,
          requestId: ctx.requestId,
          reason: req.purpose,
          changes: {
            status: { from: null, to: 'pending_approval' },
            amountMinor: { from: null, to: excess },
            actualId: { from: null, to: a.id },
          },
        });
        await this.analytics.track(tx, actor, 'request.submitted', { kind: 'over_budget' });
        return this.dtos.overBudget(r, a.id, row.name, c?.id ?? null);
      },
    );
  }

  decideOverBudget(
    actor: RequestActor,
    requestId: string,
    req: { decision: 'approve' | 'reject'; reason?: string },
    ctx: CommandContext,
  ): Promise<CommandResult<OverBudgetRequest>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `actuals.over_budget.decide:${requestId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const [r] = await tx
          .select()
          .from(requests)
          .where(and(eq(requests.id, requestId), eq(requests.kind, 'over_budget')))
          .for('update');
        if (!r || !r.budgetId) throw ApiProblem.notFound('request');
        const row = (await this.ledgerReads.budgetRows(tx, [r.budgetId])).get(r.budgetId)!;
        this.policy.assert(
          actor,
          'request.approve',
          { kind: 'budget', tenantId: actor.tenantId, id: row.id, path: row.path },
          'request',
        );
        if (r.status !== 'pending_approval')
          throw new ApiProblem(
            409,
            'INVALID_TRANSITION',
            `This request is already ${r.status.replace(/_/g, ' ')}.`,
          );
        if (req.decision === 'reject' && !req.reason?.trim())
          throw new ApiProblem(422, 'REASON_REQUIRED', 'Give a reason so the requester knows why.');
        unwrap(
          checkApprovalHygiene({
            approverId: actor.personId ?? actor.subject,
            requesterId: r.requesterPersonId,
          }),
        );
        if (req.decision === 'approve')
          await this.assertAuthority(
            tx,
            actor,
            r.amountMinor,
            r.currency,
            row.legalEntityId,
            row.fiscalYearId,
          );
        const status = req.decision === 'approve' ? 'approved' : 'rejected';
        const [after] = await tx
          .update(requests)
          .set({
            status,
            approvedMinor: req.decision === 'approve' ? r.amountMinor : null,
            updatedAt: new Date(),
          })
          .where(eq(requests.id, r.id))
          .returning();
        const [a] = await tx.select().from(actuals).where(eq(actuals.overBudgetRequestId, r.id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: `request.over_budget.${status}`,
          resourceType: 'request',
          resourceId: r.id,
          legalEntityId: row.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason ?? null,
          changes: { status: { from: r.status, to: status } },
        });
        await this.analytics.track(tx, actor, 'approval.decided', {
          kind: 'over_budget',
          approved: status === 'approved',
        });
        const dto = this.dtos.overBudget(
          after,
          a?.id ?? r.id,
          row.name,
          a?.proposedCommitmentId ?? null,
        );
        return { ...dto, decidedByPersonId: actor.personId, decisionReason: req.reason ?? null };
      },
    );
  }

  /** The approver acts within their delegation-of-authority limit (limit currency at the locked plan rate). */
  private async assertAuthority(
    tx: Tx,
    actor: RequestActor,
    amountMinor: number,
    currency: string,
    legalEntityId: string,
    fiscalYearId: string,
  ) {
    const date = todayUtc();
    const [v] = await tx
      .select()
      .from(doaMatrixVersions)
      .where(
        and(
          eq(doaMatrixVersions.status, 'active'),
          lte(doaMatrixVersions.validFrom, date),
          or(isNull(doaMatrixVersions.validTo), gte(doaMatrixVersions.validTo, date)),
        ),
      )
      .orderBy(desc(doaMatrixVersions.version))
      .limit(1);
    const rows = v
      ? await tx
          .select()
          .from(doaLimits)
          .where(
            and(
              eq(doaLimits.matrixVersionId, v.id),
              lte(doaLimits.validFrom, date),
              or(isNull(doaLimits.validTo), gte(doaLimits.validTo, date)),
            ),
          )
      : [];
    const limitCurrency = (rows[0]?.currency ?? actor.reportingCurrency) as CurrencyCode;
    const rates = await this.ledgerReads.planRates(tx, fiscalYearId);
    const converted =
      currency === limitCurrency
        ? amountMinor
        : unwrap(
            buildTriplet(
              { amountMinor, currency: currency as CurrencyCode },
              { budgetCurrency: limitCurrency, reportingCurrency: actor.reportingCurrency, rates },
            ),
          ).budget.amountMinor;
    const limits: DoaLimit[] = rows.map((l) => ({
      id: l.id,
      personId: l.personId,
      role: l.role,
      spendType: l.spendType,
      legalEntityId: l.legalEntityId ?? '*',
      limitMinor: l.limitMinor,
      currency: l.currency,
      validFrom: l.validFrom,
      validTo: l.validTo,
    }));
    const roles: RoleId[] = actor.personId
      ? await this.actors.rolesForPerson(tx, actor.personId, date)
      : [...actor.roles];
    unwrap(
      checkAuthority(
        limits,
        { personId: actor.personId ?? '', roles },
        {
          spendType: 'over_budget',
          legalEntityId,
          amountMinor: converted,
          currency: limitCurrency,
          date,
        },
      ),
    );
  }
}
