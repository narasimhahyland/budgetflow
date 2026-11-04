import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type RequestActor,
} from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import {
  budgetChangeRequests,
  budgets,
  headcountSnapshots,
  ledgerJournals,
  ledgerLines,
  people,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { LedgerReads, toPostingBudget } from '@bf/api/ledger';
import { AnalyticsService } from '@bf/api/tenancy';
import type {
  AllocationHistoryItem,
  BatchAllocationRequest,
  BatchAllocationResult,
  BudgetChangeRequest,
  CreateIncreaseRequest,
  CreateReleaseRequest,
  DecideChangeRequest,
  PerHeadDriverConfig,
  PerHeadPreview,
  PerHeadRequest,
  PerHeadResult,
} from '@bf/contracts';
import {
  acceptsNewActivity,
  allocationAvailable,
  checkAllocation,
  perHeadAmount,
  type DriverHeadcountLine,
  type EmploymentType,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { todayUtc } from '@bf/api/ledger';
import { budgetResource, BudgetViews, type BudgetRow, type CommandContext } from './budget-views';
import { BudgetsService } from './budgets.service';
import { ControlsService } from './controls.service';

type ChangeRow = typeof budgetChangeRequests.$inferSelect;

/** Allocation grid, per-head driver allocation and true-ups, allocation history, increase and release requests. */
@Injectable()
export class AllocationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: LedgerReads,
    private readonly audit: AuditService,
    private readonly views: BudgetViews,
    private readonly budgetsService: BudgetsService,
    private readonly controls: ControlsService,
    private readonly analytics: AnalyticsService,
  ) {}

  private tx<T>(actor: RequestActor, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, fn);
  }

  // Allocation grid ---------------------------------------------------------------------------

  async batch(
    actor: RequestActor,
    parentId: string,
    req: BatchAllocationRequest,
    ctx: CommandContext,
  ): Promise<BatchAllocationResult> {
    if (req.dryRun) return this.tx(actor, (tx) => this.batchInTx(tx, actor, parentId, req, ctx));
    const r = await this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.batch:${parentId}`,
        request: req,
        status: 200,
      },
      (tx) => this.batchInTx(tx, actor, parentId, req, ctx),
    );
    return r.body;
  }

  private async batchInTx(
    tx: Tx,
    actor: RequestActor,
    parentId: string,
    req: BatchAllocationRequest,
    ctx: CommandContext,
  ): Promise<BatchAllocationResult> {
    const parent = await this.views.row(tx, parentId);
    this.policy.assert(actor, 'budget.allocate', budgetResource(parent), 'budget');
    if (!req.dryRun) await this.reads.lockBudgets(tx, [parentId]);
    const parentStatus = acceptsNewActivity(parent.status);
    const children = await tx.select().from(budgets).where(eq(budgets.parentId, parentId));
    const byId = new Map(children.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const lines: BatchAllocationResult['lines'] = req.lines.map((l, index) => {
      const base = { index, amountMinor: l.amountMinor, code: null, message: null };
      const fail = (name: string, code: string, message: string) => ({
        ...base,
        childBudgetId: l.childBudgetId ?? null,
        name,
        outcome: 'error' as const,
        code,
        message,
      });
      if (!l.childBudgetId && !l.newChild)
        return fail('', 'VALIDATION_FAILED', 'Choose a child budget or name a new one.');
      if (l.childBudgetId) {
        const child = byId.get(l.childBudgetId);
        if (!child)
          return fail('', 'NOT_A_CHILD', 'This budget is not a direct child of the parent.');
        if (seen.has(child.id))
          return fail(child.name, 'VALIDATION_FAILED', 'This child appears twice in the grid.');
        seen.add(child.id);
        const ok = acceptsNewActivity(child.status);
        if (!ok.ok) return fail(child.name, ok.error.code, ok.error.message);
        return { ...base, childBudgetId: child.id, name: child.name, outcome: 'ok' as const };
      }
      return { ...base, childBudgetId: null, name: l.newChild!.name, outcome: 'ok' as const };
    });
    const total = req.lines.reduce((s, l) => s + l.amountMinor, 0);
    const balances = (await this.reads.balances(tx, [parentId])).get(parentId)!.budget;
    const control = toPostingBudget(parent).control;
    const availableBefore = allocationAvailable(balances, control);
    const fits = checkAllocation(balances, control, total, parent.currency);
    const ok = parentStatus.ok && fits.ok && lines.every((l) => l.outcome === 'ok');
    const result: BatchAllocationResult = {
      dryRun: req.dryRun,
      ok,
      currency: parent.currency,
      totalMinor: total,
      availableBeforeMinor: availableBefore,
      availableAfterMinor: availableBefore - total,
      lines,
      journalIds: [],
      parent: null,
    };
    if (req.dryRun) return result;
    if (!parentStatus.ok) unwrap(parentStatus);
    if (!fits.ok) unwrap(fits);
    if (!ok)
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        'Some grid lines cannot be allocated; fix them and submit again.',
        undefined,
        lines
          .filter((l) => l.outcome === 'error')
          .map((l) => ({ path: `lines.${l.index}`, message: l.message ?? '' })),
      );
    for (const [i, l] of req.lines.entries()) {
      let childId = l.childBudgetId;
      if (!childId) {
        childId = await this.budgetsService.createInTx(
          tx,
          actor,
          {
            ...l.newChild!,
            parentId,
            legalEntityId: l.newChild!.legalEntityId ?? parent.legalEntityId,
            currency: parent.currency,
            fiscalYearId: parent.fiscalYearId,
          },
          { ...ctx, fixedId: undefined },
          { reason: 'Created in the allocation grid' },
        );
        lines[i].childBudgetId = childId;
      }
      result.journalIds.push(
        await this.budgetsService.allocateInTx(
          tx,
          actor,
          parentId,
          {
            childBudgetId: childId,
            amount: { amountMinor: l.amountMinor, currency: parent.currency },
            memo: req.memo ?? 'Allocation grid',
          },
          ctx,
          'budget.allocated',
        ),
      );
    }
    result.parent = await this.views.detailById(tx, actor, parentId);
    return result;
  }

  // Per-head driver ---------------------------------------------------------------------------

  private async headcount(
    tx: Tx,
    orgUnitId: string,
    asOf: string,
  ): Promise<{ snapshotId: string; asOfDate: string; lines: DriverHeadcountLine[] }> {
    const [snap] = await tx
      .select()
      .from(headcountSnapshots)
      .where(lte(headcountSnapshots.asOfDate, asOf))
      .orderBy(desc(headcountSnapshots.asOfDate), desc(headcountSnapshots.createdAt))
      .limit(1);
    if (!snap)
      throw new ApiProblem(422, 'HEADCOUNT_MISSING', 'No HR headcount has been imported yet.');
    const res = await tx.execute<{
      employment_type: EmploymentType;
      hc: string;
      milli: string;
    }>(sql`
      with recursive units as (
        select id from org_units where id = ${orgUnitId}::uuid
        union select o.id from org_units o join units u on o.parent_id = u.id
      )
      select l.employment_type, sum(l.headcount)::text as hc, sum(l.prorated_headcount_milli)::text as milli
      from headcount_snapshot_lines l
      where l.snapshot_id = ${snap.id}::uuid and l.org_unit_id in (select id from units)
      group by l.employment_type`);
    return {
      snapshotId: snap.id,
      asOfDate: snap.asOfDate,
      lines: res.rows.map((r) => ({
        employmentType: r.employment_type,
        headcount: Number(r.hc),
        proratedHeadcountMilli: Number(r.milli),
      })),
    };
  }

  private async perHeadPreview(
    tx: Tx,
    parent: BudgetRow,
    child: BudgetRow,
    cfg: {
      rateMinor: number;
      eligibleTypes: EmploymentType[];
      prorate: boolean;
      orgUnitId?: string | null;
      asOf?: string;
    },
  ): Promise<PerHeadPreview> {
    if (child.parentId !== parent.id)
      throw new ApiProblem(
        422,
        'NOT_A_CHILD',
        'Per-head allocation goes to a direct child budget.',
      );
    const orgUnitId = cfg.orgUnitId ?? child.orgUnitId;
    if (!orgUnitId)
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        'Link the child budget to a location or team so its headcount can drive the amount.',
        { field: 'orgUnitId' },
      );
    const hc = await this.headcount(tx, orgUnitId, cfg.asOf ?? todayUtc());
    const r = unwrap(perHeadAmount(hc.lines, cfg));
    const current = (child.driverConfig as PerHeadDriverConfig | null)?.amountMinor ?? 0;
    const delta = r.amountMinor - (child.allocationDriver === 'per_head' ? current : 0);
    const balances = (await this.reads.balances(tx, [parent.id])).get(parent.id)!.budget;
    const parentAvailable = allocationAvailable(balances, toPostingBudget(parent).control);
    const [ou] = (
      await tx.execute<{ name: string }>(
        sql`select name from org_units where id = ${orgUnitId}::uuid`,
      )
    ).rows;
    return {
      parentId: parent.id,
      childBudgetId: child.id,
      childName: child.name,
      orgUnitId,
      orgUnitName: ou?.name ?? null,
      snapshotId: hc.snapshotId,
      asOfDate: hc.asOfDate,
      currency: parent.currency,
      rateMinor: cfg.rateMinor,
      headcount: r.headcount,
      eligibleHeadcount: r.eligibleHeadcount,
      eligibleHeadcountMilli: r.eligibleHeadcountMilli,
      excludedHeadcount: r.excludedHeadcount,
      byType: (Object.keys(r.byType) as EmploymentType[]).map((t) => ({
        employmentType: t,
        ...r.byType[t],
      })),
      amountMinor: r.amountMinor,
      currentDriverAmountMinor: child.allocationDriver === 'per_head' ? current : 0,
      deltaMinor: delta,
      parentAvailableMinor: parentAvailable,
      fits: delta <= parentAvailable,
    };
  }

  async perHead(actor: RequestActor, parentId: string, req: PerHeadRequest, ctx: CommandContext) {
    const run = async (tx: Tx): Promise<PerHeadResult> => {
      const parent = await this.views.row(tx, parentId);
      this.policy.assert(actor, 'budget.allocate', budgetResource(parent), 'budget');
      const child = await this.views.row(tx, req.childBudgetId);
      if (!req.dryRun) await this.reads.lockBudgets(tx, [parentId, child.id]);
      const preview = await this.perHeadPreview(tx, parent, child, req);
      if (req.dryRun) return { preview, journalId: null, child: null };
      return this.applyPerHead(
        tx,
        actor,
        parent,
        child,
        preview,
        req.programTemplateId ?? null,
        ctx,
        {
          eligibleTypes: req.eligibleTypes,
          prorate: req.prorate,
          reason: 'Per-head allocation',
        },
      );
    };
    if (req.dryRun) return this.tx(actor, run);
    return (
      await this.commands.run(
        actor,
        {
          idempotencyKey: ctx.idempotencyKey,
          operation: `budgets.per_head:${parentId}`,
          request: req,
          status: 200,
        },
        run,
      )
    ).body;
  }

  async trueUp(
    actor: RequestActor,
    childId: string,
    req: { dryRun: boolean; asOf?: string },
    ctx: CommandContext,
  ) {
    const run = async (tx: Tx): Promise<PerHeadResult> => {
      const child = await this.views.row(tx, childId);
      const cfg = child.driverConfig as PerHeadDriverConfig | null;
      if (child.allocationDriver !== 'per_head' || !cfg || !child.parentId)
        throw new ApiProblem(
          422,
          'VALIDATION_FAILED',
          'This budget is not allocated by the per-head driver.',
        );
      const parent = await this.views.row(tx, child.parentId);
      this.policy.assert(actor, 'budget.allocate', budgetResource(parent), 'budget');
      if (!req.dryRun) await this.reads.lockBudgets(tx, [parent.id, child.id]);
      const preview = await this.perHeadPreview(tx, parent, child, {
        rateMinor: cfg.rateMinor,
        eligibleTypes: cfg.eligibleTypes,
        prorate: cfg.prorate,
        orgUnitId: cfg.orgUnitId,
        asOf: req.asOf,
      });
      if (req.dryRun) return { preview, journalId: null, child: null };
      return this.applyPerHead(tx, actor, parent, child, preview, cfg.programTemplateId, ctx, {
        eligibleTypes: cfg.eligibleTypes,
        prorate: cfg.prorate,
        reason: 'Per-head true-up after a headcount refresh',
      });
    };
    if (req.dryRun) return this.tx(actor, run);
    return (
      await this.commands.run(
        actor,
        {
          idempotencyKey: ctx.idempotencyKey,
          operation: `budgets.true_up:${childId}`,
          request: req,
          status: 200,
        },
        run,
      )
    ).body;
  }

  private async applyPerHead(
    tx: Tx,
    actor: RequestActor,
    parent: BudgetRow,
    child: BudgetRow,
    preview: PerHeadPreview,
    programTemplateId: string | null,
    ctx: CommandContext,
    opts: { eligibleTypes: EmploymentType[]; prorate: boolean; reason: string },
  ): Promise<PerHeadResult> {
    let journalId: string | null = null;
    if (preview.deltaMinor > 0) {
      journalId = await this.budgetsService.allocateInTx(
        tx,
        actor,
        parent.id,
        {
          childBudgetId: child.id,
          amount: { amountMinor: preview.deltaMinor, currency: parent.currency },
          memo: opts.reason,
        },
        ctx,
        'budget.per_head_allocated',
      );
    } else if (preview.deltaMinor < 0) {
      journalId = await this.controls.returnToParentInTx(
        tx,
        actor,
        child,
        -preview.deltaMinor,
        opts.reason,
        ctx,
      );
    }
    const driver: PerHeadDriverConfig = {
      rateMinor: preview.rateMinor,
      eligibleTypes: opts.eligibleTypes,
      prorate: opts.prorate,
      orgUnitId: preview.orgUnitId,
      snapshotId: preview.snapshotId,
      asOfDate: preview.asOfDate,
      eligibleHeadcountMilli: preview.eligibleHeadcountMilli,
      amountMinor: preview.amountMinor,
      programTemplateId,
    };
    await tx
      .update(budgets)
      .set({
        allocationDriver: 'per_head',
        driverConfig: driver,
        ...(programTemplateId ? { programTemplateId } : {}),
      })
      .where(eq(budgets.id, child.id));
    await this.audit.append(tx, {
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      actorSubject: actor.subject,
      action: preview.currentDriverAmountMinor ? 'budget.per_head_true_up' : 'budget.per_head_set',
      resourceType: 'budget',
      resourceId: child.id,
      legalEntityId: child.legalEntityId,
      requestId: ctx.requestId,
      reason: opts.reason,
      changes: {
        driverAmountMinor: { from: preview.currentDriverAmountMinor, to: preview.amountMinor },
        eligibleHeadcountMilli: {
          from: (child.driverConfig as PerHeadDriverConfig | null)?.eligibleHeadcountMilli ?? null,
          to: preview.eligibleHeadcountMilli,
        },
        snapshotId: { from: null, to: preview.snapshotId },
        journalId: { from: null, to: journalId },
      },
    });
    await this.views.snapshot(tx, actor, child.id, opts.reason);
    return { preview, journalId, child: await this.views.detailById(tx, actor, child.id) };
  }

  // Allocation history ------------------------------------------------------------------------

  async history(actor: RequestActor, id: string): Promise<{ items: AllocationHistoryItem[] }> {
    return this.tx(actor, async (tx) => {
      const row = await this.views.row(tx, id);
      this.policy.assert(actor, 'budget.read', budgetResource(row), 'budget');
      const own = await tx
        .select({
          journalId: ledgerLines.journalId,
          account: ledgerLines.account,
          amount: ledgerLines.budgetAmountMinor,
          currency: ledgerLines.budgetCurrency,
          type: ledgerJournals.journalType,
          accountingDate: ledgerJournals.accountingDate,
          createdAt: ledgerJournals.createdAt,
          reasonCode: ledgerJournals.reasonCode,
          reason: ledgerJournals.reason,
          actor: people.displayName,
        })
        .from(ledgerLines)
        .innerJoin(ledgerJournals, eq(ledgerJournals.id, ledgerLines.journalId))
        .leftJoin(people, eq(people.id, ledgerJournals.actorPersonId))
        .where(
          and(
            eq(ledgerLines.budgetId, id),
            inArray(ledgerLines.account, ['authorized', 'allocated_out']),
          ),
        )
        .orderBy(desc(ledgerJournals.createdAt))
        .limit(200);
      const journalIds = [...new Set(own.map((o) => o.journalId))];
      const others = journalIds.length
        ? await tx
            .select({
              journalId: ledgerLines.journalId,
              budgetId: ledgerLines.budgetId,
              account: ledgerLines.account,
              name: budgets.name,
            })
            .from(ledgerLines)
            .leftJoin(budgets, eq(budgets.id, ledgerLines.budgetId))
            .where(inArray(ledgerLines.journalId, journalIds))
        : [];
      const reversed = journalIds.length
        ? await tx
            .select({ id: ledgerJournals.reversalOfJournalId })
            .from(ledgerJournals)
            .where(inArray(ledgerJournals.reversalOfJournalId, journalIds))
        : [];
      const reversedSet = new Set(reversed.map((r) => r.id));
      const COUNTER: Record<string, string> = {
        plan_funding: 'Plan funding',
        savings: 'Company savings',
      };
      return {
        items: own.map((o) => {
          const signed = o.amount ?? 0;
          // Credits bring money in: authorized received, or allocated out returned by a child.
          const inbound = signed < 0;
          return {
            journalId: o.journalId,
            journalType: o.type,
            accountingDate: o.accountingDate,
            createdAt: o.createdAt.toISOString(),
            direction: inbound ? 'in' : 'out',
            bucket: o.account as 'authorized' | 'allocated_out',
            amount: { amountMinor: Math.abs(signed), currency: o.currency ?? row.currency },
            counterparties: others
              .filter((x) => x.journalId === o.journalId && x.budgetId !== id)
              .filter((x) => x.budgetId || COUNTER[x.account])
              .map((x) => ({
                budgetId: x.budgetId,
                name: x.name ?? COUNTER[x.account] ?? x.account,
              }))
              .filter((x, i, a) => a.findIndex((y) => y.name === x.name) === i),
            reasonCode: o.reasonCode,
            reason: o.reason,
            actorName: o.actor,
            reversed: reversedSet.has(o.journalId),
          };
        }),
      };
    });
  }

  // Increase requests and contingency releases ----------------------------------------------

  async requestIncrease(
    actor: RequestActor,
    budgetId: string,
    req: CreateIncreaseRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.increase:${budgetId}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const row = await this.views.row(tx, budgetId);
        this.policy.assert(actor, 'request.create', budgetResource(row), 'budget');
        if (!row.parentId)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'A root budget grows through a new plan version, not an increase request.',
          );
        unwrap(acceptsNewActivity(row.status));
        return this.insertRequest(tx, actor, {
          kind: 'increase',
          budget: row,
          sourceBudgetId: row.parentId,
          amountMinor: req.amountMinor,
          reason: req.reason,
          ctx,
        });
      },
    );
  }

  async requestRelease(
    actor: RequestActor,
    contingencyId: string,
    req: CreateReleaseRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.release:${contingencyId}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const reserve = await this.views.row(tx, contingencyId);
        this.policy.assert(actor, 'budget.read', budgetResource(reserve), 'budget');
        if (reserve.budgetType !== 'contingency')
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Only a contingency reserve can be released.',
          );
        const target = await this.views.row(tx, req.toBudgetId);
        if (target.path.split('/')[1] !== reserve.path.split('/')[1] || target.id === reserve.id)
          throw new ApiProblem(
            422,
            'TRANSFER_INVALID',
            'Release the reserve to a budget of the same tree.',
          );
        const reserveParent = reserve.parentId
          ? await this.views.row(tx, reserve.parentId)
          : undefined;
        if (
          !this.policy.can(actor, 'request.create', budgetResource(target)).allowed &&
          !this.views.canControl(actor, reserve, reserveParent)
        )
          throw ApiProblem.forbidden();
        unwrap(acceptsNewActivity(target.status));
        return this.insertRequest(tx, actor, {
          kind: 'contingency_release',
          budget: target,
          sourceBudgetId: reserve.id,
          amountMinor: req.amountMinor,
          reason: req.reason,
          ctx,
        });
      },
    );
  }

  private async insertRequest(
    tx: Tx,
    actor: RequestActor,
    r: {
      kind: 'increase' | 'contingency_release';
      budget: BudgetRow;
      sourceBudgetId: string;
      amountMinor: number;
      reason: string;
      ctx: CommandContext;
    },
  ): Promise<BudgetChangeRequest> {
    const [inserted] = await tx
      .insert(budgetChangeRequests)
      .values({
        tenantId: actor.tenantId,
        kind: r.kind,
        budgetId: r.budget.id,
        sourceBudgetId: r.sourceBudgetId,
        amountMinor: r.amountMinor,
        currency: r.budget.currency,
        reason: r.reason,
        requestedBy: actor.personId,
      })
      .returning();
    await this.audit.append(tx, {
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      actorSubject: actor.subject,
      action: r.kind === 'increase' ? 'budget.increase_requested' : 'budget.release_requested',
      resourceType: 'budget_change_request',
      resourceId: inserted.id,
      legalEntityId: r.budget.legalEntityId,
      requestId: r.ctx.requestId,
      reason: r.reason,
      changes: {
        budgetId: { from: null, to: r.budget.id },
        sourceBudgetId: { from: null, to: r.sourceBudgetId },
        amount: { from: null, to: { amountMinor: r.amountMinor, currency: r.budget.currency } },
      },
    });
    await this.views.outbox(tx, actor.tenantId, 'budget.change_requested', {
      tenantId: actor.tenantId,
      requestId: inserted.id,
      kind: r.kind,
      budgetId: r.budget.id,
      sourceBudgetId: r.sourceBudgetId,
      amountMinor: r.amountMinor,
      currency: r.budget.currency,
      requestedBy: actor.personId,
    });
    return (await this.toDtos(tx, actor, [inserted]))[0];
  }

  private canDecide(actor: RequestActor, r: ChangeRow, rows: Map<string, BudgetRow>): boolean {
    const source = rows.get(r.sourceBudgetId);
    if (!source || r.status !== 'pending') return false;
    if (r.kind === 'increase')
      return this.policy.can(actor, 'budget.allocate', budgetResource(source)).allowed;
    return this.views.canControl(
      actor,
      source,
      source.parentId ? rows.get(source.parentId) : undefined,
    );
  }

  private async toDtos(
    tx: Tx,
    actor: RequestActor,
    items: ChangeRow[],
  ): Promise<BudgetChangeRequest[]> {
    const ids = [...new Set(items.flatMap((i) => [i.budgetId, i.sourceBudgetId]))];
    const rows = await this.reads.budgetRows(tx, ids);
    const parentIds = [...rows.values()].map((r) => r.parentId).filter((p): p is string => !!p);
    for (const [k, v] of await this.reads.budgetRows(tx, parentIds)) rows.set(k, v);
    const personIds = [
      ...new Set(
        items.flatMap((i) => [i.requestedBy, i.decidedBy]).filter((p): p is string => !!p),
      ),
    ];
    const names = personIds.length
      ? new Map(
          (
            await tx
              .select({ id: people.id, name: people.displayName })
              .from(people)
              .where(inArray(people.id, personIds))
          ).map((p) => [p.id, p.name]),
        )
      : new Map<string, string>();
    const balances = await this.reads.balances(
      tx,
      items.map((i) => i.sourceBudgetId),
    );
    return items.map((i) => {
      const source = rows.get(i.sourceBudgetId);
      return {
        id: i.id,
        kind: i.kind as BudgetChangeRequest['kind'],
        budgetId: i.budgetId,
        budgetName: rows.get(i.budgetId)?.name ?? '',
        sourceBudgetId: i.sourceBudgetId,
        sourceBudgetName: source?.name ?? '',
        amount: { amountMinor: i.amountMinor, currency: i.currency },
        approvedAmount:
          i.approvedAmountMinor !== null
            ? { amountMinor: i.approvedAmountMinor, currency: i.currency }
            : null,
        reason: i.reason,
        status: i.status as BudgetChangeRequest['status'],
        requestedByName: i.requestedBy ? (names.get(i.requestedBy) ?? null) : null,
        createdAt: i.createdAt.toISOString(),
        decidedAt: i.decidedAt?.toISOString() ?? null,
        decidedByName: i.decidedBy ? (names.get(i.decidedBy) ?? null) : null,
        decisionNote: i.decisionNote,
        journalId: i.journalId,
        canDecide: this.canDecide(actor, i, rows) && i.requestedBy !== actor.personId,
        sourceAvailableMinor:
          source && balances.get(source.id)
            ? allocationAvailable(balances.get(source.id)!.budget, toPostingBudget(source).control)
            : null,
      };
    });
  }

  async listRequests(
    actor: RequestActor,
    q: { status?: string; budgetId?: string; kind?: string },
  ): Promise<{ items: BudgetChangeRequest[] }> {
    return this.tx(actor, async (tx) => {
      const filters: SQL[] = [];
      if (q.status) filters.push(eq(budgetChangeRequests.status, q.status));
      if (q.kind) filters.push(eq(budgetChangeRequests.kind, q.kind));
      if (q.budgetId)
        filters.push(
          or(
            eq(budgetChangeRequests.budgetId, q.budgetId),
            eq(budgetChangeRequests.sourceBudgetId, q.budgetId),
          )!,
        );
      const items = await tx
        .select()
        .from(budgetChangeRequests)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(budgetChangeRequests.createdAt))
        .limit(200);
      const rows = await this.reads.budgetRows(tx, [
        ...new Set(items.flatMap((i) => [i.budgetId, i.sourceBudgetId])),
      ]);
      const visible = items.filter((i) =>
        [i.budgetId, i.sourceBudgetId].some((b) => {
          const r = rows.get(b);
          return r && this.policy.can(actor, 'budget.read', budgetResource(r)).allowed;
        }),
      );
      return { items: await this.toDtos(tx, actor, visible) };
    });
  }

  async decide(
    actor: RequestActor,
    requestId: string,
    req: DecideChangeRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.decide:${requestId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(budgetChangeRequests)
          .where(eq(budgetChangeRequests.id, requestId))
          .for('update');
        if (!row) throw ApiProblem.notFound('request');
        const rows = await this.reads.budgetRows(tx, [row.budgetId, row.sourceBudgetId]);
        const source = rows.get(row.sourceBudgetId)!;
        const target = rows.get(row.budgetId)!;
        if (source.parentId)
          for (const [k, v] of await this.reads.budgetRows(tx, [source.parentId])) rows.set(k, v);
        const visible =
          this.policy.can(actor, 'budget.read', budgetResource(source)).allowed ||
          this.policy.can(actor, 'budget.read', budgetResource(target)).allowed;
        if (!visible) throw ApiProblem.notFound('request');
        if (row.status !== 'pending')
          throw new ApiProblem(
            409,
            'REQUEST_ALREADY_DECIDED',
            `This request was already ${row.status}.`,
          );
        if (!this.canDecide(actor, row, rows)) throw ApiProblem.forbidden();
        if (row.requestedBy && row.requestedBy === actor.personId)
          throw new ApiProblem(409, 'SELF_APPROVAL', 'You cannot decide your own request.');
        const approved =
          req.decision === 'approve' ? (req.approvedAmountMinor ?? row.amountMinor) : null;
        if (approved !== null && approved > row.amountMinor)
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'Approve at most the amount requested.', {
            field: 'approvedAmountMinor',
          });
        let journalId: string | null = null;
        if (approved !== null) {
          if (row.kind === 'increase') {
            journalId = await this.budgetsService.allocateInTx(
              tx,
              actor,
              source.id,
              {
                childBudgetId: target.id,
                amount: { amountMinor: approved, currency: source.currency },
                memo: `Increase approved: ${row.reason}`,
              },
              ctx,
              'budget.increase_approved',
            );
          } else {
            const t = await this.controls.transferInTx(
              tx,
              actor,
              source.id,
              {
                toBudgetId: target.id,
                amountMinor: approved,
                reasonCode: 'CONTINGENCY-RELEASE',
                reason: `Contingency release approved: ${row.reason}`,
              },
              ctx,
              { skipPolicy: true, auditAction: 'budget.contingency_released' },
            );
            journalId = t.journal.id;
          }
        }
        const [updated] = await tx
          .update(budgetChangeRequests)
          .set({
            status: approved !== null ? 'approved' : 'rejected',
            approvedAmountMinor: approved,
            decidedBy: actor.personId,
            decidedAt: new Date(),
            decisionNote: req.note ?? null,
            journalId,
          })
          .where(eq(budgetChangeRequests.id, requestId))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action:
            approved !== null ? 'budget.change_request_approved' : 'budget.change_request_rejected',
          resourceType: 'budget_change_request',
          resourceId: requestId,
          legalEntityId: target.legalEntityId,
          requestId: ctx.requestId,
          reason: req.note ?? null,
          changes: {
            status: { from: 'pending', to: updated.status },
            approvedAmountMinor: { from: null, to: approved },
            journalId: { from: null, to: journalId },
          },
        });
        await this.analytics.track(tx, actor, 'budget.increase_decided', {
          kind: row.kind,
          decision: req.decision,
          partial: approved !== null && approved < row.amountMinor,
        });
        return (await this.toDtos(tx, actor, [updated]))[0];
      },
    );
  }
}
