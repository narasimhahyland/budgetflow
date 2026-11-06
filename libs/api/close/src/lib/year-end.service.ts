import { AuditService } from '@bf/api/audit';
import { BudgetViews } from '@bf/api/budgets';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type RequestActor,
} from '@bf/api/core';
import {
  budgets,
  commitmentFundingLines,
  commitments,
  exchangeRates,
  fiscalPeriods,
  fiscalYears,
  rolloverPolicies,
  withTenant,
  yearEndCommitmentCarries,
  yearEndRunLines,
  yearEndRuns,
  type Db,
  type Tx,
} from '@bf/api/db';
import { LedgerReads, toPostingBudget } from '@bf/api/ledger';
import { PostingSupport, type PostCtx } from '@bf/api/spend';
import type {
  CreateYearEndRunRequest,
  ExecuteYearEndRequest,
  YearEndCarryDecisionRequest,
  YearEndLine,
  YearEndReadinessCheck,
  YearEndRun,
} from '@bf/contracts';
import {
  availableOf,
  decideCarry,
  postCommitmentMovement,
  postHierarchyMove,
  postYearEndCarryIn,
  requireConfirmation,
  rolloverOutcome,
  yearEndConfirmationFor,
  type BudgetRef,
  type CurrencyCode,
  type PostingContext,
  type RolloverPolicyRef,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, like, sql } from 'drizzle-orm';
import { assertTenant, CloseReads, type CommandContext } from './close-reads';

type RunRow = typeof yearEndRuns.$inferSelect;
type LineRow = typeof yearEndRunLines.$inferSelect;
type BudgetRow = typeof budgets.$inferSelect;
type PolicyRow = typeof rolloverPolicies.$inferSelect;
type CommitmentRow = typeof commitments.$inferSelect;

const READINESS_BLOCKS: Record<YearEndReadinessCheck['code'], boolean> = {
  target_year_exists: true,
  target_plan_rates_locked: true,
  target_budgets_exist: true,
  prior_periods_closed: false,
  posting_periods_open: true,
  rollover_policies_assigned: true,
  carry_approvals_decided: true,
};

/**
 * The fiscal year-end run: a dry run that says exactly what every budget carries, lapses and sweeps,
 * the carry approvals a Finance Controller decides, and one execution that posts them.
 *
 * Roll-forward never mints money. For each budget the ending year posts a reduction for everything
 * that leaves it (lapse and sweep to the sweep target, carry out through the root to `savings`), and
 * the target year posts the mirror (`savings` to root `authorized`, then down the hierarchy). Both
 * journals balance on their own, each converts at its own year's locked plan rate, and because the
 * target year's root grows by exactly what its savings gives up, both years still tie out to their
 * plan versions. Carried commitments keep their original rates: the ending year releases the
 * encumbrance and the target year re-posts the same budget amount, so the money that backed the
 * commitment travels with it.
 */
@Injectable()
export class YearEndService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly reads: CloseReads,
    private readonly ledgerReads: LedgerReads,
    private readonly posting: PostingSupport,
    private readonly views: BudgetViews,
  ) {}

  list(actor: RequestActor, query: { fiscalYearId?: string }) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'ledger.read');
      const rows = await tx
        .select()
        .from(yearEndRuns)
        .where(query.fiscalYearId ? eq(yearEndRuns.fiscalYearId, query.fiscalYearId) : sql`true`)
        .orderBy(asc(yearEndRuns.createdAt));
      const items: YearEndRun[] = [];
      for (const r of rows) items.push(await this.dto(tx, r));
      return { items };
    });
  }

  get(actor: RequestActor, runId: string) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'ledger.read');
      return this.dto(tx, await this.run(tx, runId));
    });
  }

  create(actor: RequestActor, req: CreateYearEndRunRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'close.year_end_runs.create',
        request: req,
        status: 201,
      },
      async (tx): Promise<YearEndRun> => {
        assertTenant(this.policy, actor, 'yearend.run');
        const root = await this.views.row(tx, req.rootBudgetId);
        if (root.parentId) {
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'A year-end run starts from a root budget.',
            { field: 'rootBudgetId' },
          );
        }
        if (req.targetFiscalYearId === root.fiscalYearId) {
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Choose the fiscal year the money moves into, not the one that is ending.',
            { field: 'targetFiscalYearId' },
          );
        }
        await this.reads.fiscalYear(tx, req.targetFiscalYearId);
        const [row] = await tx
          .insert(yearEndRuns)
          .values({
            tenantId: actor.tenantId,
            fiscalYearId: root.fiscalYearId,
            targetFiscalYearId: req.targetFiscalYearId,
            targetPlanVersionId: req.targetPlanVersionId ?? null,
            rootBudgetId: root.id,
            commitmentFreezeDate: req.commitmentFreezeDate ?? null,
            status: 'draft',
            dryRun: true,
            createdBy: actor.personId,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'year_end_run.created',
          resourceType: 'year_end_run',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            fiscalYearId: { from: null, to: root.fiscalYearId },
            targetFiscalYearId: { from: null, to: req.targetFiscalYearId },
            rootBudgetId: { from: null, to: root.id },
            commitmentFreezeDate: { from: null, to: req.commitmentFreezeDate ?? null },
          },
        });
        return this.dto(tx, row);
      },
    );
  }

  /** Recomputes every line from the ledger. Posts nothing; decisions already taken are kept. */
  dryRun(actor: RequestActor, runId: string, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `close.year_end_runs.dry_run:${runId}`,
        request: { runId },
        status: 201,
      },
      async (tx): Promise<YearEndRun> => {
        const run = await this.run(tx, runId, true);
        assertTenant(this.policy, actor, 'yearend.run');
        this.assertNotExecuted(run);
        const planned = await this.plan(tx, run);
        const existing = await tx
          .select()
          .from(yearEndRunLines)
          .where(eq(yearEndRunLines.runId, run.id));
        const decided = new Map(
          existing
            .filter((l) => l.status === 'approved' || l.status === 'declined')
            .map((l) => [l.budgetId, l]),
        );
        await tx.delete(yearEndRunLines).where(eq(yearEndRunLines.runId, run.id));
        for (const p of planned) {
          const prior = decided.get(p.budgetId);
          await tx.insert(yearEndRunLines).values({
            tenantId: actor.tenantId,
            runId: run.id,
            budgetId: p.budgetId,
            currency: p.currency,
            availableMinor: p.availableMinor,
            authorizedMinor: p.authorizedMinor,
            rolloverPolicyId: p.rolloverPolicyId,
            carryMinor: p.carryMinor,
            lapseMinor: p.lapseMinor,
            sweepToBudgetId: p.sweepToBudgetId,
            openCommitmentCount: p.openCommitmentCount,
            openCommitmentMinor: p.openCommitmentMinor,
            targetBudgetId: p.targetBudgetId,
            status: prior && p.status === 'awaiting_approval' ? prior.status : p.status,
            blockedReason: p.blockedReason,
            approvedCarryMinor: prior?.approvedCarryMinor ?? null,
            decidedBy: prior?.decidedBy ?? null,
            decidedAt: prior?.decidedAt ?? null,
            decisionReason: prior?.decisionReason ?? null,
          });
        }
        const [updated] = await tx
          .update(yearEndRuns)
          .set({ status: 'dry_run', dryRun: true, error: null })
          .where(eq(yearEndRuns.id, run.id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'year_end_run.dry_run',
          resourceType: 'year_end_run',
          resourceId: run.id,
          requestId: ctx.requestId,
          changes: {
            status: { from: run.status, to: 'dry_run' },
            budgets: { from: null, to: planned.length },
            carryMinor: { from: null, to: planned.reduce((s, p) => s + p.carryMinor, 0) },
            lapseMinor: { from: null, to: planned.reduce((s, p) => s + p.lapseMinor, 0) },
            commitmentsToCarry: {
              from: null,
              to: planned.reduce((s, p) => s + p.openCommitmentCount, 0),
            },
          },
        });
        return this.dto(tx, updated);
      },
    );
  }

  decide(
    actor: RequestActor,
    runId: string,
    lineId: string,
    req: YearEndCarryDecisionRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `close.year_end_runs.decide:${lineId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<YearEndRun> => {
        const run = await this.run(tx, runId, true);
        assertTenant(this.policy, actor, 'yearend.approve');
        this.assertNotExecuted(run);
        const [line] = await tx
          .select()
          .from(yearEndRunLines)
          .where(and(eq(yearEndRunLines.id, lineId), eq(yearEndRunLines.runId, run.id)))
          .for('update');
        if (!line) throw ApiProblem.notFound('year-end line');
        if (line.status !== 'awaiting_approval') {
          throw new ApiProblem(
            409,
            'REQUEST_ALREADY_DECIDED',
            `This line is ${line.status.replace(/_/g, ' ')}; only a carry waiting for approval can be decided.`,
          );
        }
        const outcome = unwrap(
          decideCarry({ carryMinor: line.carryMinor, lapseMinor: line.lapseMinor }, req),
        );
        const [updated] = await tx
          .update(yearEndRunLines)
          .set({
            status: req.decision === 'decline' ? 'declined' : 'approved',
            carryMinor: outcome.carryMinor,
            lapseMinor: outcome.lapseMinor,
            approvedCarryMinor: outcome.carryMinor,
            decidedBy: actor.personId,
            decidedAt: new Date(),
            decisionReason: req.reason,
          })
          .where(eq(yearEndRunLines.id, line.id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'year_end_carry.decided',
          resourceType: 'year_end_run_line',
          resourceId: line.id,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            decision: { from: null, to: req.decision },
            budgetId: { from: null, to: line.budgetId },
            carryMinor: { from: line.carryMinor, to: updated.carryMinor },
            lapseMinor: { from: line.lapseMinor, to: updated.lapseMinor },
          },
        });
        return this.dto(tx, run);
      },
    );
  }

  /**
   * Posts the run. One transaction, children before parents, ordered row locks per budget and one
   * audit entry; a replay with the same idempotency key returns the first result without posting
   * again.
   */
  execute(actor: RequestActor, runId: string, req: ExecuteYearEndRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `close.year_end_runs.execute:${runId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<YearEndRun> => {
        const run = await this.run(tx, runId, true);
        assertTenant(this.policy, actor, 'yearend.run');
        this.assertNotExecuted(run);
        const sourceYear = await this.reads.fiscalYear(tx, run.fiscalYearId);
        const targetYear = await this.reads.fiscalYear(tx, run.targetFiscalYearId!);
        unwrap(requireConfirmation(req.confirmation, yearEndConfirmationFor(sourceYear.label)));
        const readiness = await this.readiness(tx, run);
        const blocked = readiness.filter((r) => r.blocksExecution && !r.passed);
        if (blocked.length) {
          throw new ApiProblem(
            409,
            'YEAR_END_NOT_READY',
            `${blocked.length} readiness check(s) fail: ${blocked.map((b) => b.detail).join(' ')}`,
            { failing: blocked.map((b) => b.code).join(', ') },
          );
        }
        const lines = await tx
          .select()
          .from(yearEndRunLines)
          .where(eq(yearEndRunLines.runId, run.id));
        if (!lines.length) {
          throw new ApiProblem(
            409,
            'YEAR_END_DRY_RUN_REQUIRED',
            'Run a dry run first so every budget has an outcome to post.',
          );
        }
        const rows = await this.ledgerReads.budgetRows(
          tx,
          lines.flatMap((l) => [l.budgetId, ...(l.targetBudgetId ? [l.targetBudgetId] : [])]),
        );
        // Children before parents: a child returns its money to the parent before the parent lapses.
        const ordered = [...lines].sort(
          (a, b) => (rows.get(b.budgetId)?.depth ?? 0) - (rows.get(a.budgetId)?.depth ?? 0),
        );
        const postCtx: PostCtx = {
          actor,
          command: 'close.year_end_runs.execute',
          requestId: ctx.requestId,
          idempotencyKey: ctx.idempotencyKey,
        };
        const sourceDate = req.accountingDate ?? sourceYear.endDate;
        const targetDate = req.targetAccountingDate ?? targetYear.startDate;
        const allJournals: string[] = [];
        let commitmentCount = 0;
        let commitmentMinor = 0;
        for (const line of ordered) {
          if (line.status === 'blocked') continue;
          const journals = await this.executeLine(tx, run, line, postCtx, {
            sourceDate,
            targetDate,
            sourceFiscalYearId: run.fiscalYearId,
            targetFiscalYearId: run.targetFiscalYearId!,
          });
          allJournals.push(...journals.journalIds);
          commitmentCount += journals.commitmentCount;
          commitmentMinor += journals.commitmentMinor;
          await tx
            .update(yearEndRunLines)
            .set({
              status: 'executed',
              journalIds: journals.journalIds,
              executedAt: new Date(),
            })
            .where(eq(yearEndRunLines.id, line.id));
        }
        const [updated] = await tx
          .update(yearEndRuns)
          .set({
            status: 'completed',
            dryRun: false,
            executedAt: new Date(),
            executedBy: actor.personId,
            error: null,
          })
          .where(eq(yearEndRuns.id, run.id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'year_end_run.executed',
          resourceType: 'year_end_run',
          resourceId: run.id,
          requestId: ctx.requestId,
          reason: `Year-end ${sourceYear.label} into ${targetYear.label}`,
          changes: {
            status: { from: run.status, to: 'completed' },
            budgets: { from: null, to: ordered.length },
            journalIds: { from: null, to: allJournals },
            carryMinor: { from: null, to: ordered.reduce((s, l) => s + l.carryMinor, 0) },
            lapseMinor: { from: null, to: ordered.reduce((s, l) => s + l.lapseMinor, 0) },
            commitmentsCarried: { from: null, to: commitmentCount },
            commitmentMinor: { from: null, to: commitmentMinor },
          },
        });
        return this.dto(tx, updated);
      },
    );
  }

  // Internals ------------------------------------------------------------------------------------

  private async run(tx: Tx, id: string, lock = false): Promise<RunRow> {
    const q = tx.select().from(yearEndRuns).where(eq(yearEndRuns.id, id));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw ApiProblem.notFound('year-end run');
    if (!row.targetFiscalYearId || !row.rootBudgetId) {
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        'This year-end run predates the roll-forward fields; create a new run.',
      );
    }
    return row;
  }

  private assertNotExecuted(run: RunRow): void {
    if (run.status === 'completed') {
      throw new ApiProblem(
        409,
        'YEAR_END_ALREADY_EXECUTED',
        'This run already posted; create a new run for another pass.',
      );
    }
  }

  private async tree(tx: Tx, rootId: string): Promise<BudgetRow[]> {
    const root = await this.views.row(tx, rootId);
    const rows = await tx
      .select()
      .from(budgets)
      .where(like(budgets.path, `${root.path}%`));
    return rows
      .filter((b) => b.status !== 'cancelled' && b.status !== 'closed')
      .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  }

  /** Target-year counterpart of a source budget, matched on the code roll-forward copies. */
  private matchTarget(source: BudgetRow, targetTree: readonly BudgetRow[]): BudgetRow | undefined {
    if (source.code) {
      const byCode = targetTree.filter((t) => t.code === source.code);
      if (byCode.length === 1) return byCode[0];
    }
    const byName = targetTree.filter((t) => t.name === source.name && t.depth === source.depth);
    return byName.length === 1 ? byName[0] : undefined;
  }

  private async plan(tx: Tx, run: RunRow) {
    const tree = await this.tree(tx, run.rootBudgetId!);
    const targetRoots = await tx
      .select()
      .from(budgets)
      .where(and(eq(budgets.fiscalYearId, run.targetFiscalYearId!), eq(budgets.depth, 0)));
    const targetTree = targetRoots.length
      ? (await Promise.all(targetRoots.map((r) => this.tree(tx, r.id)))).flat()
      : [];
    const balances = await this.ledgerReads.balances(
      tx,
      tree.map((b) => b.id),
    );
    const policies = new Map(
      (await tx.select().from(rolloverPolicies)).map((p: PolicyRow) => [p.id, p]),
    );
    const openCommitments = await tx
      .select()
      .from(commitments)
      .where(
        and(
          inArray(
            commitments.budgetId,
            tree.map((b) => b.id),
          ),
          inArray(commitments.status, ['encumbered', 'partially_consumed']),
        ),
      );
    const fundingLines = openCommitments.length
      ? await tx
          .select()
          .from(commitmentFundingLines)
          .where(
            inArray(
              commitmentFundingLines.commitmentId,
              openCommitments.map((c) => c.id),
            ),
          )
      : [];
    return tree.map((b) => {
      const bal = balances.get(b.id)!.budget;
      // Everything the budget still has: authorized minus every consuming bucket, allocated out included.
      const available = availableOf(bal);
      const policyRow = b.rolloverPolicyId ? policies.get(b.rolloverPolicyId) : undefined;
      const policy: RolloverPolicyRef | null = policyRow
        ? {
            code: policyRow.code,
            mode: policyRow.mode,
            capBps: policyRow.capBps,
            sweepTo: policyRow.sweepTo,
          }
        : null;
      const outcome = rolloverOutcome(policy, {
        availableMinor: available,
        authorizedMinor: bal.authorized,
      });
      const mine = openCommitments.filter((c) => c.budgetId === b.id);
      const carryable = mine.filter((c) =>
        fundingLines.filter((l) => l.commitmentId === c.id).every((l) => l.budgetId === b.id),
      );
      const commitmentMinor = carryable.reduce((s, c) => s + remainingOf(c), 0);
      const target = this.matchTarget(b, targetTree);
      const carryMinor = outcome.ok ? outcome.value.carryMinor : 0;
      const lapseMinor = outcome.ok ? outcome.value.lapseMinor : 0;
      let status: LineRow['status'] = 'planned';
      let blockedReason: string | null = null;
      if (!outcome.ok) {
        status = 'blocked';
        blockedReason = outcome.error.message;
      } else if ((carryMinor > 0 || commitmentMinor > 0) && !target) {
        status = 'blocked';
        blockedReason = `No budget in the target year matches ${b.name}; roll the tree forward first.`;
      } else if (carryable.length !== mine.length) {
        status = 'blocked';
        blockedReason = `${mine.length - carryable.length} open commitment(s) draw on other budgets; release them before the year-end run.`;
      } else if (outcome.value.needsApproval && carryMinor > 0) {
        status = 'awaiting_approval';
      }
      const parent = b.parentId ? tree.find((t) => t.id === b.parentId) : undefined;
      return {
        budgetId: b.id,
        currency: b.currency,
        availableMinor: available,
        authorizedMinor: bal.authorized,
        rolloverPolicyId: b.rolloverPolicyId,
        carryMinor,
        lapseMinor,
        sweepToBudgetId:
          outcome.ok && outcome.value.sweepTo === 'parent' && parent ? parent.id : null,
        openCommitmentCount: carryable.length,
        openCommitmentMinor: commitmentMinor,
        targetBudgetId: target?.id ?? null,
        status,
        blockedReason,
      };
    });
  }

  private async executeLine(
    tx: Tx,
    run: RunRow,
    line: LineRow,
    postCtx: PostCtx,
    dates: {
      sourceDate: string;
      targetDate: string;
      sourceFiscalYearId: string;
      targetFiscalYearId: string;
    },
  ): Promise<{ journalIds: string[]; commitmentCount: number; commitmentMinor: number }> {
    const journalIds: string[] = [];
    const source = await this.views.row(tx, line.budgetId);
    const sourceChain = await this.views.chain(tx, source);
    const target = line.targetBudgetId ? await this.views.row(tx, line.targetBudgetId) : null;
    const targetChain = target ? await this.views.chain(tx, target) : [];
    await this.posting.lock(tx, [...sourceChain.map((b) => b.id), ...targetChain.map((b) => b.id)]);
    const sourceCtx: PostingContext = {
      reportingCurrency: postCtx.actor.reportingCurrency,
      rates: await this.ledgerReads.planRates(tx, dates.sourceFiscalYearId),
      accountingDate: dates.sourceDate,
    };
    const targetCtx: PostingContext = {
      reportingCurrency: postCtx.actor.reportingCurrency,
      rates: await this.ledgerReads.planRates(tx, dates.targetFiscalYearId),
      accountingDate: dates.targetDate,
    };
    const refs = (rows: readonly BudgetRow[]): BudgetRef[] => rows.map((r) => toPostingBudget(r));
    const currency = source.currency as CurrencyCode;

    // 1. Carried commitments: released in the ending year, re-posted in the target year at the
    //    original budget amount, so the encumbrance travels with its funding and no money is minted.
    const carried = await this.carryCommitments(tx, run, line, {
      source,
      target,
      postCtx,
      sourceCtx,
      targetCtx,
      dates,
    });
    journalIds.push(...carried.journalIds);

    // 2. The money that backed those commitments leaves the ending year with them.
    const carryMinor = line.carryMinor + carried.minor;
    if (line.lapseMinor > 0) {
      const sweepTo = line.sweepToBudgetId ? await this.views.row(tx, line.sweepToBudgetId) : null;
      const destination = sweepTo
        ? { kind: 'budget' as const, chain: refs(await this.views.chain(tx, sweepTo)) }
        : { kind: 'savings' as const, planVersionId: source.planVersionId ?? null };
      const journal = unwrap(
        postHierarchyMove(
          {
            type: 'reduction',
            sourceChain: refs(sourceChain),
            destination,
            amount: { amountMinor: line.lapseMinor, currency },
            reasonCode: 'YEAR-END-LAPSE',
            reason: `Year end: ${sweepTo ? `swept to ${sweepTo.name}` : 'returned to corporate'}`,
          },
          sourceCtx,
        ),
      );
      journalIds.push(
        ...(await this.posting.post(tx, [journal], dates.sourceFiscalYearId, postCtx)),
      );
    }
    if (carryMinor > 0 && target) {
      const out = unwrap(
        postHierarchyMove(
          {
            type: 'reduction',
            sourceChain: refs(sourceChain),
            destination: { kind: 'savings', planVersionId: source.planVersionId ?? null },
            amount: { amountMinor: carryMinor, currency },
            reasonCode: 'YEAR-END-CARRY',
            reason: `Year end: carried forward to ${target.name}`,
          },
          sourceCtx,
        ),
      );
      journalIds.push(...(await this.posting.post(tx, [out], dates.sourceFiscalYearId, postCtx)));
      const into = unwrap(
        postYearEndCarryIn(
          {
            destinationChain: refs(targetChain),
            amount: { amountMinor: carryMinor, currency: target.currency as CurrencyCode },
            planVersionId: run.targetPlanVersionId ?? target.planVersionId ?? null,
            reasonCode: 'YEAR-END-CARRY',
            reason: `Year end: carried forward from ${source.name}`,
          },
          targetCtx,
        ),
      );
      journalIds.push(...(await this.posting.post(tx, [into], dates.targetFiscalYearId, postCtx)));
    }
    return {
      journalIds,
      commitmentCount: carried.count,
      commitmentMinor: carried.minor,
    };
  }

  private async carryCommitments(
    tx: Tx,
    run: RunRow,
    line: LineRow,
    args: {
      source: BudgetRow;
      target: BudgetRow | null;
      postCtx: PostCtx;
      sourceCtx: PostingContext;
      targetCtx: PostingContext;
      dates: {
        sourceDate: string;
        targetDate: string;
        sourceFiscalYearId: string;
        targetFiscalYearId: string;
      };
    },
  ): Promise<{ journalIds: string[]; count: number; minor: number }> {
    const journalIds: string[] = [];
    if (!line.openCommitmentCount || !args.target) return { journalIds, count: 0, minor: 0 };
    const open = await tx
      .select()
      .from(commitments)
      .where(
        and(
          eq(commitments.budgetId, line.budgetId),
          inArray(commitments.status, ['encumbered', 'partially_consumed']),
        ),
      )
      .orderBy(asc(commitments.id))
      .for('update');
    let minor = 0;
    let count = 0;
    for (const c of open) {
      const remaining = remainingOf(c);
      if (remaining <= 0) continue;
      const locked = await this.posting.lock(tx, [args.source.id, args.target.id]);
      const sourceBudget = locked.get(args.source.id)!;
      const targetBudget = locked.get(args.target.id)!;
      const amount = { amountMinor: remaining, currency: c.currency as CurrencyCode };
      const release = unwrap(
        postCommitmentMovement(
          {
            kind: 'release_encumbrance',
            budget: sourceBudget,
            amount,
            provenance: { commitmentId: c.id },
          },
          args.sourceCtx,
        ),
      );
      const releaseIds = await this.posting.post(
        tx,
        [release],
        args.dates.sourceFiscalYearId,
        args.postCtx,
      );
      await tx
        .update(commitments)
        .set({ status: 'carried_forward', updatedAt: new Date() })
        .where(eq(commitments.id, c.id));
      const [twin] = await tx
        .insert(commitments)
        .values({
          tenantId: run.tenantId,
          budgetId: args.target.id,
          requestId: null,
          eventId: c.eventId,
          status: 'encumbered',
          vendorId: c.vendorId,
          legalEntityId: args.target.legalEntityId,
          costCenterId: args.target.costCenterId,
          glAccountId: c.glAccountId,
          description: c.description,
          serviceStart: c.serviceStart,
          serviceEnd: c.serviceEnd,
          amountMinor: remaining,
          currency: c.currency,
          expiresOn: c.expiresOn,
          createdByPersonId: args.postCtx.actor.personId,
          carriedFromCommitmentId: c.id,
        })
        .returning();
      // The original funding line's rates travel with the commitment: a carry is not a revaluation.
      const [funding] = await tx
        .select()
        .from(commitmentFundingLines)
        .where(eq(commitmentFundingLines.commitmentId, c.id))
        .orderBy(asc(commitmentFundingLines.id));
      await tx.insert(commitmentFundingLines).values({
        tenantId: run.tenantId,
        commitmentId: twin.id,
        budgetId: args.target.id,
        amountMinor: remaining,
        currency: c.currency,
        budgetAmountMinor: remaining,
        budgetCurrency: args.target.currency,
        rateType: funding?.rateType ?? null,
        budgetRate: funding?.budgetRate ?? null,
        budgetRateIds: funding?.budgetRateIds ?? null,
        reportingCurrency: funding?.reportingCurrency ?? null,
        reportingRate: funding?.reportingRate ?? null,
        reportingRateIds: funding?.reportingRateIds ?? null,
      });
      const carry = unwrap(
        postCommitmentMovement(
          {
            kind: 'carry_encumbrance',
            budget: targetBudget,
            amount: { amountMinor: remaining, currency: args.target.currency as CurrencyCode },
            provenance: { commitmentId: twin.id },
          },
          args.targetCtx,
        ),
      );
      const carryIds = await this.posting.post(
        tx,
        [carry],
        args.dates.targetFiscalYearId,
        args.postCtx,
      );
      await tx.insert(yearEndCommitmentCarries).values({
        tenantId: run.tenantId,
        runId: run.id,
        sourceCommitmentId: c.id,
        carriedCommitmentId: twin.id,
        amountMinor: remaining,
        currency: c.currency,
        releaseJournalId: releaseIds[0] ?? null,
        carryJournalId: carryIds[0] ?? null,
        accountingDate: args.dates.targetDate,
      });
      journalIds.push(...releaseIds, ...carryIds);
      minor += remaining;
      count += 1;
    }
    return { journalIds, count, minor };
  }

  private async readiness(tx: Tx, run: RunRow): Promise<YearEndReadinessCheck[]> {
    const out: YearEndReadinessCheck[] = [];
    const add = (
      code: YearEndReadinessCheck['code'],
      title: string,
      passed: boolean,
      detail: string,
    ) => out.push({ code, title, passed, detail, blocksExecution: READINESS_BLOCKS[code] });

    const [targetYear] = await tx
      .select()
      .from(fiscalYears)
      .where(eq(fiscalYears.id, run.targetFiscalYearId!));
    add(
      'target_year_exists',
      'Target fiscal year and periods exist',
      Boolean(targetYear),
      targetYear
        ? `${targetYear.label} runs ${targetYear.startDate} to ${targetYear.endDate}.`
        : 'The target fiscal year does not exist; create it in the fiscal calendar.',
    );
    const rates = targetYear
      ? await tx
          .select({ n: sql<string>`count(*)` })
          .from(exchangeRates)
          .where(
            and(
              eq(exchangeRates.fiscalYearId, targetYear.id),
              eq(exchangeRates.rateType, 'plan'),
              eq(exchangeRates.locked, true),
            ),
          )
      : [{ n: '0' }];
    const locked = Boolean(targetYear?.planRatesLockedAt) || Number(rates[0].n) > 0;
    add(
      'target_plan_rates_locked',
      'Target year plan rates locked',
      locked,
      locked
        ? `${Number(rates[0].n)} plan rate(s) locked for the target year.`
        : 'Lock the target year plan rates before carrying money into it.',
    );
    const lines = await tx.select().from(yearEndRunLines).where(eq(yearEndRunLines.runId, run.id));
    const needTarget = lines.filter((l) => l.carryMinor > 0 || l.openCommitmentMinor > 0);
    const missing = needTarget.filter((l) => !l.targetBudgetId);
    add(
      'target_budgets_exist',
      'Target year budgets rolled forward',
      missing.length === 0,
      missing.length
        ? `${missing.length} budget(s) that carry have no counterpart in the target year; roll the tree forward first.`
        : `${needTarget.length} carrying budget(s) have a counterpart in the target year.`,
    );
    const periods = await tx
      .select()
      .from(fiscalPeriods)
      .where(eq(fiscalPeriods.fiscalYearId, run.fiscalYearId))
      .orderBy(asc(fiscalPeriods.startDate));
    const last = periods[periods.length - 1];
    const earlierOpen = periods.slice(0, -1).filter((p) => p.status === 'open');
    add(
      'prior_periods_closed',
      'Earlier periods of the ending year are closed',
      earlierOpen.length === 0,
      earlierOpen.length
        ? `${earlierOpen.length} earlier period(s) are still open (${earlierOpen.map((p) => p.label).join(', ')}). Close them so the year-end figures stop moving.`
        : 'Every period before the final one is closed or locked.',
    );
    const postable = Boolean(last && last.status === 'open');
    add(
      'posting_periods_open',
      'A period is open in each year to receive the postings',
      postable,
      postable
        ? `${last.label} is open and receives the ending year's lapses and carries; close it after the run.`
        : 'The final period of the ending year must be open to receive the year-end postings; reopen it first.',
    );
    const withoutPolicy = lines.filter((l) => !l.rolloverPolicyId);
    add(
      'rollover_policies_assigned',
      'Every budget has a rollover policy',
      lines.length > 0 && withoutPolicy.length === 0,
      lines.length === 0
        ? 'Run a dry run to list the budgets.'
        : withoutPolicy.length
          ? `${withoutPolicy.length} budget(s) have no rollover policy.`
          : `All ${lines.length} budget(s) have a rollover policy.`,
    );
    const waiting = lines.filter((l) => l.status === 'awaiting_approval');
    add(
      'carry_approvals_decided',
      'Carry approvals decided',
      waiting.length === 0,
      waiting.length
        ? `${waiting.length} carry request(s) wait for the Finance Controller.`
        : 'No carry request is waiting.',
    );
    return out;
  }

  private async dto(tx: Tx, run: RunRow): Promise<YearEndRun> {
    const sourceYear = await this.reads.fiscalYear(tx, run.fiscalYearId);
    const targetYear = await this.reads.fiscalYear(tx, run.targetFiscalYearId!);
    const root = await this.views.row(tx, run.rootBudgetId!);
    const lineRows = await tx
      .select()
      .from(yearEndRunLines)
      .where(eq(yearEndRunLines.runId, run.id));
    const budgetRows = await this.ledgerReads.budgetRows(tx, [
      ...lineRows.map((l) => l.budgetId),
      ...lineRows.flatMap((l) => (l.targetBudgetId ? [l.targetBudgetId] : [])),
      ...lineRows.flatMap((l) => (l.sweepToBudgetId ? [l.sweepToBudgetId] : [])),
    ]);
    const policies = new Map(
      (await tx.select().from(rolloverPolicies)).map((p: PolicyRow) => [p.id, p]),
    );
    const names = await this.reads.names(tx, [run.createdBy, run.executedBy]);
    const lines: YearEndLine[] = lineRows
      .map((l) => {
        const b = budgetRows.get(l.budgetId);
        const policy = l.rolloverPolicyId ? policies.get(l.rolloverPolicyId) : undefined;
        return {
          id: l.id,
          budgetId: l.budgetId,
          budgetName: b?.name ?? '',
          budgetPath: b?.path ?? '',
          currency: l.currency,
          availableMinor: l.availableMinor,
          rolloverPolicyId: l.rolloverPolicyId,
          rolloverPolicyCode: policy?.code ?? null,
          mode: policy?.mode ?? null,
          carryMinor: l.carryMinor,
          lapseMinor: l.lapseMinor,
          sweepToBudgetId: l.sweepToBudgetId,
          sweepToName: l.sweepToBudgetId ? (budgetRows.get(l.sweepToBudgetId)?.name ?? null) : null,
          openCommitmentCount: l.openCommitmentCount,
          openCommitmentMinor: l.openCommitmentMinor,
          targetBudgetId: l.targetBudgetId,
          targetBudgetName: l.targetBudgetId
            ? (budgetRows.get(l.targetBudgetId)?.name ?? null)
            : null,
          status: l.status,
          blockedReason: l.blockedReason,
          approvedCarryMinor: l.approvedCarryMinor,
          decisionReason: l.decisionReason,
          journalIds: l.journalIds,
        };
      })
      .sort((a, b) => a.budgetPath.localeCompare(b.budgetPath));
    return {
      id: run.id,
      fiscalYearId: run.fiscalYearId,
      fiscalYearLabel: sourceYear.label,
      targetFiscalYearId: targetYear.id,
      targetFiscalYearLabel: targetYear.label,
      targetPlanVersionId: run.targetPlanVersionId,
      rootBudgetId: root.id,
      rootBudgetName: root.name,
      status: run.status,
      commitmentFreezeDate: run.commitmentFreezeDate,
      createdByName: run.createdBy ? (names.get(run.createdBy) ?? null) : null,
      createdAt: run.createdAt.toISOString(),
      executedAt: run.executedAt?.toISOString() ?? null,
      executedByName: run.executedBy ? (names.get(run.executedBy) ?? null) : null,
      error: run.error,
      readiness: await this.readiness(tx, run),
      totals: {
        currency: root.currency,
        carryMinor: lines.reduce((s, l) => s + l.carryMinor, 0),
        lapseMinor: lines.reduce((s, l) => s + l.lapseMinor, 0),
        commitmentCarryMinor: lines.reduce((s, l) => s + l.openCommitmentMinor, 0),
        commitmentCount: lines.reduce((s, l) => s + l.openCommitmentCount, 0),
        budgetCount: lines.length,
      },
      lines,
      executeConfirmation: yearEndConfirmationFor(sourceYear.label),
      journalIds: lines.flatMap((l) => l.journalIds),
    };
  }
}

const remainingOf = (c: CommitmentRow): number =>
  Math.max(0, c.amountMinor - c.consumedMinor - c.releasedMinor);
