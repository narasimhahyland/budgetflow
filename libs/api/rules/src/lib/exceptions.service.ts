import { personNames } from '@bf/api/approvals';
import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
  nowUtc,
} from '@bf/api/core';
import {
  actualMatches,
  actuals,
  budgets,
  commitments,
  costCenters,
  postSpendExceptions,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  ExceptionListQuery,
  PostSpendExceptionItem,
  PostSpendExceptionList,
  ResolveExceptionRequest,
} from '@bf/contracts';
import { LedgerCommands, LedgerReads, toPostingBudget } from '@bf/api/ledger';
import { availableOf, buildTriplet, type CurrencyCode } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';

interface Ctx {
  idempotencyKey: string;
  requestId: string | null;
}

const TENANT = (actor: RequestActor) => ({ kind: 'tenant' as const, tenantId: actor.tenantId });

const TYPE_LABELS: Record<string, string> = {
  alcohol_over_cap: 'Alcohol over the cap',
  blocked_vendor: 'Blocked vendor',
  missing_receipt: 'Missing receipt',
  gifts_over_cap: 'Gift over the cap',
  split_purchase: 'Possible split purchase',
  duplicate_spend: 'Possible duplicate',
  over_budget: 'Spend above the remaining budget',
};

type ExceptionRow = typeof postSpendExceptions.$inferSelect;

/**
 * Screen 074a: the post-spend exception queue. Spend that already happened cannot be un-spent, so
 * resolutions explain, ask for repayment or reclassify; a reclassification posts a ledger reversal
 * rather than editing the original journal.
 */
@Injectable()
export class ExceptionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly commands: CommandRunner,
    private readonly ledger: LedgerCommands,
    private readonly ledgerReads: LedgerReads,
  ) {}

  private canResolve(actor: RequestActor): boolean {
    return this.policy.can(actor, 'exception.resolve', TENANT(actor)).allowed;
  }

  private toItem(
    row: ExceptionRow,
    budgetName: string,
    names: Map<string, string>,
    canResolve: boolean,
  ): PostSpendExceptionItem {
    const ageDays = Math.max(
      0,
      Math.floor((nowUtc().getTime() - row.raisedAt.getTime()) / 86_400_000),
    );
    const allowedActions: PostSpendExceptionItem['allowedActions'] = [];
    if (row.status !== 'resolved' && canResolve) allowedActions.push('resolve');
    if (row.status === 'open') allowedActions.push('explain');
    return {
      id: row.id,
      raisedAt: row.raisedAt.toISOString(),
      type: row.type as PostSpendExceptionItem['type'],
      typeLabel: TYPE_LABELS[row.type] ?? row.type,
      status: row.status as PostSpendExceptionItem['status'],
      sourceKind: row.sourceKind as PostSpendExceptionItem['sourceKind'],
      sourceRef: row.sourceRef,
      sourceId: row.sourceId,
      budgetId: row.budgetId,
      budgetName,
      location: row.location,
      personName: row.personName,
      transactionAmount: {
        amountMinor: row.transactionAmountMinor,
        currency: row.transactionCurrency,
      },
      reportingAmount: {
        amountMinor: row.reportingAmountMinor,
        currency: row.reportingCurrency,
      },
      ruleCode: row.ruleCode,
      ruleVersion: row.ruleVersion,
      ageDays,
      summary: row.summary,
      facts: (row.facts as Record<string, unknown>) ?? {},
      relatedItems: (row.relatedItems as PostSpendExceptionItem['relatedItems']) ?? [],
      ownerExplanation: row.ownerExplanation,
      resolution: row.resolution as PostSpendExceptionItem['resolution'],
      resolutionReasonCode: row.resolutionReasonCode,
      resolutionReason: row.resolutionReason,
      repaymentAmount:
        row.repaymentMinor !== null
          ? { amountMinor: row.repaymentMinor, currency: row.transactionCurrency }
          : null,
      reclassifiedToGlCode: row.reclassifiedToGlCode,
      reversalJournalId: row.reversalJournalId,
      resolvedByName: row.resolvedBy ? (names.get(row.resolvedBy) ?? null) : null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      allowedActions,
    };
  }

  async list(actor: RequestActor, q: ExceptionListQuery): Promise<PostSpendExceptionList> {
    this.policy.assert(actor, 'rules.read', TENANT(actor), 'post-spend exceptions');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const rows = await tx
        .select({ exception: postSpendExceptions, budgetName: budgets.name })
        .from(postSpendExceptions)
        .leftJoin(budgets, eq(budgets.id, postSpendExceptions.budgetId))
        .where(eq(postSpendExceptions.tenantId, actor.tenantId))
        .orderBy(desc(postSpendExceptions.raisedAt));
      const names = await personNames(
        tx,
        rows.map((r) => r.exception.resolvedBy),
      );
      const canResolve = this.canResolve(actor);
      const all = rows.map((r) =>
        this.toItem(r.exception, r.budgetName ?? 'Unassigned', names, canResolve),
      );
      const items = all.filter((i) => {
        if (q.type && i.type !== q.type) return false;
        if (q.status && i.status !== q.status) return false;
        if (q.budgetId && i.budgetId !== q.budgetId) return false;
        if (q.location && i.location.toLowerCase() !== q.location.toLowerCase()) return false;
        return true;
      });
      return {
        items,
        counts: {
          open: all.filter((i) => i.status === 'open').length,
          explained: all.filter((i) => i.status === 'explained').length,
          resolved: all.filter((i) => i.status === 'resolved').length,
        },
      };
    });
  }

  /**
   * Spend that already happened at an expense provider (Navan, 16a) cannot be refused, so a line that
   * needs more than its budget has left becomes an `over_budget` exception for Finance to explain or
   * resolve. Room is what the line's commitment still holds plus the budget's available amount, in
   * the budget currency at the locked plan rate. One exception per actual: a repeat run raises none,
   * and each raised exception is audited. Raises nothing for refunds, duplicates or unproposed lines.
   */
  async raiseOverBudget(
    actor: RequestActor,
    input: {
      actualIds: readonly string[];
      sourceLabel: string;
      people?: ReadonlyMap<string, { personId: string | null; name: string }>;
    },
    ctx: { requestId: string | null },
  ): Promise<{ raised: number; exceptionIds: string[] }> {
    if (input.actualIds.length === 0) return { raised: 0, exceptionIds: [] };
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const lines = await tx
        .select()
        .from(actuals)
        .where(inArray(actuals.id, [...input.actualIds]));
      const candidates = lines.filter(
        (l) =>
          l.transactionAmountMinor > 0 &&
          !l.duplicateOfActualId &&
          (l.proposedBudgetId || l.proposedCommitmentId),
      );
      if (candidates.length === 0) return { raised: 0, exceptionIds: [] };
      const already = new Set(
        (
          await tx
            .select({ sourceId: postSpendExceptions.sourceId })
            .from(postSpendExceptions)
            .where(
              and(
                eq(postSpendExceptions.type, 'over_budget'),
                eq(postSpendExceptions.sourceKind, 'actual'),
                inArray(
                  postSpendExceptions.sourceId,
                  candidates.map((c) => c.id),
                ),
              ),
            )
        ).map((r) => r.sourceId),
      );
      const commitmentIds = candidates
        .map((c) => c.proposedCommitmentId)
        .filter((x): x is string => Boolean(x));
      const cRows = commitmentIds.length
        ? await tx.select().from(commitments).where(inArray(commitments.id, commitmentIds))
        : [];
      const commitmentById = new Map(cRows.map((c) => [c.id, c]));
      const budgetIdOf = (l: (typeof candidates)[number]) =>
        l.proposedBudgetId ?? commitmentById.get(l.proposedCommitmentId ?? '')?.budgetId ?? null;
      const budgetIds = [...new Set(candidates.map(budgetIdOf).filter((x): x is string => !!x))];
      const bRows = await this.ledgerReads.budgetRows(tx, budgetIds);
      const balances = await this.ledgerReads.balances(tx, budgetIds);
      const ccRows = await tx
        .select({ id: costCenters.id, code: costCenters.code })
        .from(costCenters);
      const ccCode = new Map(ccRows.map((c) => [c.id, c.code]));
      // What earlier lines in this same call already used, so two lines cannot share the same room.
      const used = new Map<string, number>();
      const raisedIds: string[] = [];
      for (const l of candidates) {
        if (already.has(l.id)) continue;
        const budgetId = budgetIdOf(l);
        const row = budgetId ? bRows.get(budgetId) : undefined;
        if (!budgetId || !row) continue;
        const budget = toPostingBudget(row);
        const rates = await this.ledgerReads.planRates(tx, budget.fiscalYearId);
        const inBudget = (amountMinor: number, currency: string) => {
          const t = buildTriplet(
            { amountMinor, currency: currency as CurrencyCode },
            {
              budgetCurrency: budget.currency,
              reportingCurrency: l.reportingCurrency as CurrencyCode,
              rates,
            },
          );
          return t.ok ? t.value.budget.amountMinor : null;
        };
        const amount = inBudget(l.transactionAmountMinor, l.transactionCurrency);
        if (amount === null) continue;
        const c = l.proposedCommitmentId ? commitmentById.get(l.proposedCommitmentId) : undefined;
        const commitmentRoom = c
          ? (inBudget(Math.max(c.amountMinor - c.consumedMinor - c.releasedMinor, 0), c.currency) ??
            0)
          : 0;
        const available = Math.max(
          availableOf(balances.get(budgetId)!.budget, budget.control.basis),
          0,
        );
        const room = Math.max(available + commitmentRoom - (used.get(budgetId) ?? 0), 0);
        used.set(budgetId, (used.get(budgetId) ?? 0) + amount);
        if (amount <= room) continue;
        const excess = amount - room;
        const person = input.people?.get(l.id);
        const [created] = await tx
          .insert(postSpendExceptions)
          .values({
            tenantId: actor.tenantId,
            type: 'over_budget',
            status: 'open',
            sourceKind: 'actual',
            sourceRef: l.sourceRef.slice(0, 60),
            sourceId: l.id,
            budgetId,
            location: (l.costCenterId ? ccCode.get(l.costCenterId) : null) ?? input.sourceLabel,
            personId: person?.personId ?? null,
            personName: person?.name ?? input.sourceLabel,
            transactionAmountMinor: l.transactionAmountMinor,
            transactionCurrency: l.transactionCurrency,
            reportingAmountMinor: l.reportingAmountMinor,
            reportingCurrency: l.reportingCurrency,
            ruleCode: 'over_budget',
            ruleVersion: 1,
            summary: `${input.sourceLabel} spend ${l.sourceRef} needs ${amount} ${budget.currency} minor units; the budget had ${room} left. It was approved in ${input.sourceLabel} under its own policy, so Finance decides here.`,
            facts: {
              source: input.sourceLabel,
              budgetCurrency: budget.currency,
              amountBudgetMinor: amount,
              availableMinor: available,
              commitmentRemainingMinor: commitmentRoom,
              roomMinor: room,
              excessMinor: excess,
              commitmentId: c?.id ?? null,
              eventCode: l.eventCode,
            },
          })
          .returning({ id: postSpendExceptions.id });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'exception.raised',
          resourceType: 'post_spend_exception',
          resourceId: created.id,
          requestId: ctx.requestId,
          changes: {
            type: { from: null, to: 'over_budget' },
            actualId: { from: null, to: l.id },
            excessMinor: { from: null, to: excess },
          },
        });
        raisedIds.push(created.id);
      }
      return { raised: raisedIds.length, exceptionIds: raisedIds };
    });
  }

  async resolve(
    actor: RequestActor,
    exceptionId: string,
    body: ResolveExceptionRequest,
    ctx: Ctx,
  ): Promise<CommandResult<PostSpendExceptionItem>> {
    if (body.action === 'resolve') {
      this.policy.assert(actor, 'exception.resolve', TENANT(actor), 'post-spend exception');
      if (!body.resolution) {
        throw new ApiProblem(422, 'VALIDATION_FAILED', 'Choose how this exception is resolved.', {
          field: 'resolution',
        });
      }
    } else {
      this.policy.assert(actor, 'rules.read', TENANT(actor), 'post-spend exception');
    }

    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'rules.resolve_exception',
        request: { exceptionId, ...body },
        status: 200,
      },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(postSpendExceptions)
          .where(
            and(
              eq(postSpendExceptions.tenantId, actor.tenantId),
              eq(postSpendExceptions.id, exceptionId),
            ),
          )
          .for('update');
        if (!row) throw ApiProblem.notFound('post-spend exception');
        if (row.status === 'resolved') {
          throw new ApiProblem(
            409,
            'EXCEPTION_ALREADY_RESOLVED',
            'This exception was already resolved.',
          );
        }

        if (body.action === 'explain') {
          await tx
            .update(postSpendExceptions)
            .set({ status: 'explained', ownerExplanation: body.reason })
            .where(eq(postSpendExceptions.id, row.id));
          await this.audit.append(tx, {
            tenantId: actor.tenantId,
            actorPersonId: actor.personId,
            actorSubject: actor.subject,
            action: 'exception.explained',
            resourceType: 'post_spend_exception',
            resourceId: row.id,
            requestId: ctx.requestId,
            reason: body.reason,
            changes: { status: { from: row.status, to: 'explained' } },
          });
          return this.itemTx(tx, actor, row.id);
        }

        let reversalJournalId: string | null = null;
        if (body.resolution === 'reclassify') {
          if (!body.reclassifyGlCode) {
            throw new ApiProblem(
              422,
              'VALIDATION_FAILED',
              'Choose the GL account to reclassify the spend to.',
              { field: 'reclassifyGlCode' },
            );
          }
          // Corrections are reversals in an open period, never edits of the original journal.
          this.policy.assert(actor, 'ledger.reverse', TENANT(actor), 'journal');
          const journalId = await this.sourceJournalId(tx, actor.tenantId, row);
          if (!journalId) {
            throw new ApiProblem(
              409,
              'VALIDATION_FAILED',
              'This exception has no posted journal to reclassify.',
            );
          }
          reversalJournalId = await this.ledger.reverseInTx(
            tx,
            actor,
            journalId,
            {
              reasonCode: body.reasonCode ?? 'EXC-RECLASS',
              reason: `Post-spend exception ${row.sourceRef} reclassified to GL ${body.reclassifyGlCode}: ${body.reason}`,
            },
            ctx,
          );
        }

        await tx
          .update(postSpendExceptions)
          .set({
            status: 'resolved',
            resolution: body.resolution,
            resolutionReasonCode: body.reasonCode ?? null,
            resolutionReason: body.reason,
            repaymentMinor: body.repaymentMinor ?? null,
            reclassifiedToGlCode: body.reclassifyGlCode ?? null,
            reversalJournalId,
            resolvedBy: actor.personId,
            resolvedAt: new Date(),
          })
          .where(eq(postSpendExceptions.id, row.id));

        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'exception.resolved',
          resourceType: 'post_spend_exception',
          resourceId: row.id,
          requestId: ctx.requestId,
          reason: `${body.resolution}: ${body.reason}`,
          changes: {
            status: { from: row.status, to: 'resolved' },
            resolution: { from: null, to: body.resolution ?? null },
            reversalJournalId: { from: null, to: reversalJournalId },
            repaymentMinor: { from: null, to: body.repaymentMinor ?? null },
          },
        });

        return this.itemTx(tx, actor, row.id);
      },
    );
  }

  /** The journal that posted the spend behind this exception, used for the reclassification reversal. */
  private async sourceJournalId(
    tx: Tx,
    tenantId: string,
    row: ExceptionRow,
  ): Promise<string | null> {
    if (row.sourceKind !== 'actual' || !row.sourceId) return null;
    const [match] = await tx
      .select({ journalIds: actualMatches.journalIds })
      .from(actualMatches)
      .where(and(eq(actualMatches.tenantId, tenantId), eq(actualMatches.actualId, row.sourceId)))
      .orderBy(desc(actualMatches.createdAt));
    return match?.journalIds?.[0] ?? null;
  }

  private async itemTx(tx: Tx, actor: RequestActor, id: string): Promise<PostSpendExceptionItem> {
    const [row] = await tx
      .select({ exception: postSpendExceptions, budgetName: budgets.name })
      .from(postSpendExceptions)
      .leftJoin(budgets, eq(budgets.id, postSpendExceptions.budgetId))
      .where(and(eq(postSpendExceptions.tenantId, actor.tenantId), eq(postSpendExceptions.id, id)));
    if (!row) throw ApiProblem.notFound('post-spend exception');
    const names = await personNames(tx, [row.exception.resolvedBy]);
    return this.toItem(
      row.exception,
      row.budgetName ?? 'Unassigned',
      names,
      this.canResolve(actor),
    );
  }
}
