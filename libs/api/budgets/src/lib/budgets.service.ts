import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import {
  budgetCategories,
  budgets,
  costCenters,
  fiscalYears,
  legalEntities,
  orgUnits,
  people,
  planVersionLines,
  planVersions,
  programTemplates,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import { LedgerReads, LedgerService, toPostingBudget } from '@bf/api/ledger';
import { AnalyticsService } from '@bf/api/tenancy';
import type {
  BudgetDetail,
  BudgetListQuery,
  BudgetSettingsRequest,
  BudgetSummary,
  CreateBudgetRequest,
  Journal,
  ProgramTemplateDefaults,
} from '@bf/contracts';
import {
  acceptsNewActivity,
  budgetMachine,
  DEFAULT_CONTROL,
  postAllocation,
  postOriginalBudget,
  rollupUtilizationBps,
  utilizationBps,
  type CurrencyCode,
  type SubtreeTotals,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, ilike, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  budgetResource,
  BudgetViews,
  tenantBudgetResource,
  type BudgetRow,
  type CommandContext,
} from './budget-views';

export { budgetResource, type CommandContext } from './budget-views';

type ListQuery = z.infer<typeof BudgetListQuery>;

/** Budget commands and queries. Money changes post balanced journals through LedgerService. */
@Injectable()
export class BudgetsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: LedgerReads,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly views: BudgetViews,
    private readonly analytics: AnalyticsService,
  ) {}

  private tx<T>(actor: RequestActor, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, fn);
  }

  async get(actor: RequestActor, id: string): Promise<BudgetDetail> {
    return this.tx(actor, async (tx) => {
      const row = await this.views.row(tx, id);
      this.policy.assert(actor, 'budget.read', budgetResource(row), 'budget');
      return this.views.detail(tx, actor, row);
    });
  }

  async ledgerLines(actor: RequestActor, id: string): Promise<Journal['lines']> {
    return this.tx(actor, async (tx) => {
      const row = await this.views.row(tx, id);
      this.policy.assert(actor, 'ledger.read', budgetResource(row), 'budget');
      return this.ledger.budgetLines(tx, id);
    });
  }

  /** Path filters for the budgets the actor may read (null: tenant-wide). */
  private scopeFilter(actor: RequestActor): SQL | null | 'none' {
    if (this.policy.can(actor, 'budget.read', tenantBudgetResource(actor.tenantId)).allowed)
      return null;
    if (actor.ownedBudgetPaths.length === 0) return 'none';
    return or(...actor.ownedBudgetPaths.map((p) => like(budgets.path, `${p}%`)))!;
  }

  async list(
    actor: RequestActor,
    q: Partial<ListQuery>,
  ): Promise<{ items: BudgetDetail[]; nextCursor: string | null }> {
    return this.tx(actor, async (tx) => {
      const scope = this.scopeFilter(actor);
      if (scope === 'none') return { items: [], nextCursor: null };
      const limit = q.limit ?? 50;
      const filters: SQL[] = scope ? [scope] : [];
      if (q.fiscalYearId) filters.push(eq(budgets.fiscalYearId, q.fiscalYearId));
      if (q.status) filters.push(eq(budgets.status, q.status));
      if (q.budgetType) filters.push(eq(budgets.budgetType, q.budgetType));
      if (q.parentId) filters.push(eq(budgets.parentId, q.parentId));
      if (q.topLevel === 'true') {
        if (scope === null) filters.push(isNull(budgets.parentId));
        else {
          const tops = actor.ownedBudgetPaths.filter(
            (p) => !actor.ownedBudgetPaths.some((o) => o !== p && p.startsWith(o)),
          );
          filters.push(inArray(budgets.path, tops));
        }
      }
      if (q.rootId) {
        const root = await this.views.row(tx, q.rootId);
        this.policy.assert(actor, 'budget.read', budgetResource(root), 'budget');
        filters.push(like(budgets.path, `${root.path}%`));
      }
      if (q.q) {
        const term = `%${q.q.replace(/[%_]/g, '')}%`;
        filters.push(or(ilike(budgets.name, term), ilike(budgets.code, term))!);
      }
      const after = q.cursor ? Buffer.from(q.cursor, 'base64url').toString('utf8') : null;
      if (after) filters.push(gt(budgets.path, after));
      const rows = await tx
        .select()
        .from(budgets)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(budgets.path))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      return {
        items: await this.views.details(tx, actor, page),
        nextCursor:
          rows.length > limit
            ? Buffer.from(page[page.length - 1].path, 'utf8').toString('base64url')
            : null,
      };
    });
  }

  /**
   * Company-wide roll-up: authorized of the top budgets in scope minus held, pre-encumbered, encumbered
   * and actual of every budget below them, so money allocated to children is counted once.
   */
  async summary(
    actor: RequestActor,
    q: { fiscalYearId?: string; rootId?: string },
  ): Promise<BudgetSummary> {
    return this.tx(actor, async (tx) => {
      let tops: BudgetRow[];
      let scope: BudgetSummary['scope'];
      if (q.rootId) {
        const root = await this.views.row(tx, q.rootId);
        this.policy.assert(actor, 'budget.read', budgetResource(root), 'budget');
        tops = [root];
        scope = 'budget';
      } else {
        const filter = this.scopeFilter(actor);
        const fy = q.fiscalYearId ? [eq(budgets.fiscalYearId, q.fiscalYearId)] : [];
        if (filter === 'none') tops = [];
        else if (filter === null)
          tops = await tx
            .select()
            .from(budgets)
            .where(and(isNull(budgets.parentId), ...fy));
        else {
          const owned = await tx
            .select()
            .from(budgets)
            .where(and(filter, ...fy));
          tops = owned.filter(
            (b) => !owned.some((o) => o.id !== b.id && b.path.startsWith(o.path)),
          );
        }
        scope = filter === null ? 'tenant' : 'owned';
      }
      const rep = actor.reportingCurrency;
      const m = (amountMinor: number) => ({ amountMinor, currency: rep });
      const balances = await this.reads.balances(
        tx,
        tops.map((t) => t.id),
      );
      const subtree = await this.views.subtreeTotals(tx, tops);
      const authorized = tops.reduce((s, t) => s + balances.get(t.id)!.reporting.authorized, 0);
      const sum = (k: keyof SubtreeTotals) => tops.reduce((s, t) => s + subtree.get(t.id)![k], 0);
      const held = sum('heldMinor');
      const pre = sum('preEncumberedMinor');
      const enc = sum('encumberedMinor');
      const act = sum('actualMinor');
      const paths = tops.map((t) => t.path);
      const all = paths.length
        ? await tx
            .select()
            .from(budgets)
            .where(or(...paths.map((p) => like(budgets.path, `${p}%`))))
        : [];
      const allBalances = await this.reads.balances(
        tx,
        all.map((b) => b.id),
      );
      const allSubtrees = await this.views.subtreeTotals(tx, all);
      const byStatus: Record<string, number> = {};
      let over = 0;
      for (const b of all) {
        byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
        const util = rollupUtilizationBps(
          allBalances.get(b.id)!.reporting.authorized,
          allSubtrees.get(b.id)!,
        );
        if (b.alertThresholdsPct.some((t) => util >= t * 100)) over++;
      }
      return {
        scope,
        fiscalYearId: q.fiscalYearId ?? null,
        rootId: q.rootId ?? null,
        currency: rep,
        authorized: m(authorized),
        held: m(held),
        preEncumbered: m(pre),
        encumbered: m(enc),
        actual: m(act),
        available: m(authorized - held - pre - enc - act),
        utilizationBps: utilizationBps({ authorized, encumbered: enc, actual: act }),
        budgetCount: all.length,
        byStatus,
        frozenCount: byStatus['frozen'] ?? 0,
        setToZeroCount: byStatus['set_to_zero'] ?? 0,
        overThresholdCount: over,
      };
    });
  }

  create(
    actor: RequestActor,
    req: CreateBudgetRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<BudgetDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'budgets.create',
        request: req,
        status: 201,
      },
      async (tx) => this.views.detailById(tx, actor, await this.createInTx(tx, actor, req, ctx)),
    );
  }

  /**
   * Creates a budget inside a running command and returns its id. A root posts its original budget
   * journal and, unless the caller records the plan line itself, is added to its plan version.
   */
  async createInTx(
    tx: Tx,
    actor: RequestActor,
    req: CreateBudgetRequest,
    ctx: CommandContext,
    options: {
      recordPlanLine?: boolean;
      skipPolicy?: boolean;
      reason?: string;
      /** `false` when the calling command writes the one audit entry itself. */
      audit?: boolean;
    } = {},
  ): Promise<string> {
    const id = ctx.fixedId ?? randomUUID();
    let parent: BudgetRow | undefined;
    if (req.parentId) {
      parent = (await this.reads.budgetRows(tx, [req.parentId])).get(req.parentId);
      if (!parent) throw ApiProblem.notFound('parent budget');
      if (!options.skipPolicy)
        this.policy.assert(actor, 'budget.create_child', budgetResource(parent), 'parent budget');
    } else if (!options.skipPolicy) {
      this.policy.assert(actor, 'budget.create_root', {
        kind: 'tenant',
        tenantId: actor.tenantId,
      });
    }
    await this.assertTenantReferences(tx, req);
    const [entity] = await tx
      .select()
      .from(legalEntities)
      .where(eq(legalEntities.id, req.legalEntityId));
    if (!entity)
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'The legal entity does not exist.', {
        field: 'legalEntityId',
      });
    const [fy] = await tx.select().from(fiscalYears).where(eq(fiscalYears.id, req.fiscalYearId));
    if (!fy)
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'The fiscal year does not exist.', {
        field: 'fiscalYearId',
      });
    const rates = await this.reads.planRates(tx, fy.id);
    const currency = (req.currency ?? actor.reportingCurrency) as CurrencyCode;
    if (currency !== actor.reportingCurrency && !rates.some((r) => r.quote === currency)) {
      throw new ApiProblem(
        422,
        'RATE_MISSING',
        `No locked plan rate for ${currency} in ${fy.label}.`,
        { currency },
      );
    }
    const template = req.programTemplateId
      ? (
          await tx
            .select()
            .from(programTemplates)
            .where(eq(programTemplates.id, req.programTemplateId))
        )[0]
      : undefined;
    if (req.programTemplateId && !template)
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'Unknown program template.', {
        field: 'programTemplateId',
      });
    const defaults = (template?.defaults ?? {}) as ProgramTemplateDefaults;
    const categoryCode = req.categoryCode ?? defaults.categoryCode;
    const categoryId = categoryCode
      ? ((
          await tx
            .select({ id: budgetCategories.id })
            .from(budgetCategories)
            .where(eq(budgetCategories.code, categoryCode))
        )[0]?.id ??
        (() => {
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'Unknown budget category.', {
            field: 'categoryCode',
          });
        })())
      : null;
    const control = req.control ??
      defaults.control ?? {
        basis: [...DEFAULT_CONTROL.basis],
        mode: DEFAULT_CONTROL.mode,
        toleranceBps: DEFAULT_CONTROL.toleranceBps,
      };
    const accountingDate = await this.views.accountingDate(tx, fy.id, req.accountingDate);
    if (req.draft && !parent)
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        'Only child budgets can be saved as drafts; a root budget is funded by its plan version.',
        { field: 'draft' },
      );
    if (parent) {
      unwrap(acceptsNewActivity(parent.status));
      if (req.originalAmount || req.planVersionId) {
        throw new ApiProblem(
          422,
          'VALIDATION_FAILED',
          'Child budgets start empty and receive money through allocations.',
          { field: 'originalAmount' },
        );
      }
      if (parent.fiscalYearId !== fy.id)
        throw new ApiProblem(
          422,
          'VALIDATION_FAILED',
          "A child budget belongs to its parent's fiscal year.",
          { field: 'fiscalYearId' },
        );
      await this.reads.lockBudgets(tx, [parent.id]);
    } else {
      if (!req.planVersionId || !req.originalAmount) {
        throw new ApiProblem(
          422,
          'ROOT_REQUIRES_PLAN_VERSION',
          'A root budget needs an approved plan version and an original amount.',
        );
      }
      // Locked before the journal references it, so concurrent roots of one plan version queue here
      // instead of deadlocking on the line-number lock.
      const [pv] = await tx
        .select()
        .from(planVersions)
        .where(eq(planVersions.id, req.planVersionId))
        .for('update');
      if (!pv || pv.status !== 'approved' || pv.fiscalYearId !== fy.id) {
        throw new ApiProblem(
          422,
          'ROOT_REQUIRES_PLAN_VERSION',
          'The plan version must be approved and belong to the same fiscal year.',
        );
      }
      if (req.originalAmount.currency !== currency) {
        throw new ApiProblem(
          422,
          'CURRENCY_MISMATCH',
          `Enter the original amount in the budget currency (${currency}).`,
        );
      }
    }
    const [row] = await tx
      .insert(budgets)
      .values({
        id,
        tenantId: actor.tenantId,
        parentId: parent?.id ?? null,
        path: `${parent?.path ?? '/'}${id}/`,
        depth: parent ? parent.depth + 1 : 0,
        name: req.name,
        code: req.code ?? null,
        status: req.draft ? 'draft' : 'active',
        // The creation snapshot below makes this version 1.
        version: 0,
        budgetType: req.budgetType ?? defaults.budgetType ?? 'operating',
        categoryId,
        legalEntityId: entity.id,
        costCenterId: req.costCenterId ?? null,
        orgUnitId: req.orgUnitId ?? null,
        ownerPersonId: req.ownerPersonId ?? actor.personId,
        currency,
        fiscalYearId: fy.id,
        planVersionId: parent ? null : req.planVersionId!,
        controlBasis: control.basis,
        controlMode: control.mode,
        toleranceBps: control.toleranceBps,
        alertThresholdsPct: req.alertThresholdsPct ?? defaults.alertThresholdsPct ?? [50, 80, 100],
        programTemplateId: template?.id ?? null,
        createdBy: actor.personId,
      })
      .returning();
    let journalId: string | null = null;
    if (!parent) {
      const draft = unwrap(
        postOriginalBudget(
          {
            budget: toPostingBudget(row),
            planVersionId: req.planVersionId!,
            amount: { amountMinor: req.originalAmount!.amountMinor, currency },
          },
          { reportingCurrency: actor.reportingCurrency, rates, accountingDate },
        ),
      );
      journalId = await this.ledger.post(tx, draft, {
        actor,
        command: 'budgets.create',
        fiscalYearId: fy.id,
        requestId: ctx.requestId,
        idempotencyKey: ctx.idempotencyKey,
      });
      if (options.recordPlanLine !== false)
        await this.recordPlanLine(tx, actor, row, req, journalId);
    }
    if (options.audit !== false)
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: actor.personId,
        actorSubject: actor.subject,
        action: 'budget.created',
        resourceType: 'budget',
        resourceId: id,
        legalEntityId: entity.id,
        requestId: ctx.requestId,
        changes: {
          name: { from: null, to: req.name },
          parentId: { from: null, to: parent?.id ?? null },
          currency: { from: null, to: currency },
          status: { from: null, to: row.status },
          ...(req.originalAmount ? { originalAmount: { from: null, to: req.originalAmount } } : {}),
          ...(journalId ? { journalId: { from: null, to: journalId } } : {}),
        },
      });
    await this.views.snapshot(tx, actor, id, options.reason ?? 'Created');
    return id;
  }

  /** A root funded from an approved plan version is recorded as a line of that version, so the root ties out. */
  private async recordPlanLine(
    tx: Tx,
    actor: RequestActor,
    row: BudgetRow,
    req: CreateBudgetRequest,
    journalId: string,
  ): Promise<void> {
    const lines = await this.ledger.linesOf(tx, journalId);
    const rootLine = lines.find((l) => l.account === 'authorized')!;
    // Serialize line numbers per plan version (roots may be created concurrently).
    await tx
      .select({ id: planVersions.id })
      .from(planVersions)
      .where(eq(planVersions.id, row.planVersionId!))
      .for('update');
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${planVersionLines.lineNo}), 0) + 1` })
      .from(planVersionLines)
      .where(eq(planVersionLines.planVersionId, row.planVersionId!));
    await tx.insert(planVersionLines).values({
      tenantId: actor.tenantId,
      planVersionId: row.planVersionId!,
      lineNo: Number(next),
      budgetId: row.id,
      code: row.code ?? row.id.slice(0, 8).toUpperCase(),
      name: row.name,
      legalEntityId: row.legalEntityId,
      costCenterId: row.costCenterId,
      ownerPersonId: row.ownerPersonId,
      categoryCode: req.categoryCode ?? null,
      amountMinor: -rootLine.reportingAmountMinor,
      currency: actor.reportingCurrency,
    });
  }

  allocate(
    actor: RequestActor,
    parentId: string,
    req: {
      childBudgetId: string;
      amount: { amountMinor: number; currency: string };
      accountingDate?: string;
      memo?: string;
    },
    ctx: CommandContext,
  ): Promise<CommandResult<{ journal: Journal; parent: BudgetDetail; child: BudgetDetail }>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.allocate:${parentId}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const journalId = await this.allocateInTx(
          tx,
          actor,
          parentId,
          req,
          ctx,
          'budget.allocated',
        );
        return {
          journal: await this.ledger.journalDto(tx, journalId),
          parent: await this.views.detailById(tx, actor, parentId),
          child: await this.views.detailById(tx, actor, req.childBudgetId),
        };
      },
    );
  }

  /**
   * One allocation inside a running command: locks parent then child, checks the parent's available
   * at the locked plan rate, posts, audits, snapshots the child and records the product KPI.
   */
  async allocateInTx(
    tx: Tx,
    actor: RequestActor,
    parentId: string,
    req: {
      childBudgetId: string;
      amount: { amountMinor: number; currency: string };
      accountingDate?: string;
      memo?: string;
    },
    ctx: CommandContext,
    auditAction: string,
    /** `audit: false` when the calling command writes the one audit entry itself. */
    options: { skipPolicy?: boolean; audit?: boolean } = {},
  ): Promise<string> {
    const found = await this.reads.budgetRows(tx, [parentId, req.childBudgetId]);
    const parentRow = found.get(parentId);
    if (!parentRow) throw ApiProblem.notFound('budget');
    if (!options.skipPolicy)
      this.policy.assert(actor, 'budget.allocate', budgetResource(parentRow), 'budget');
    if (!found.get(req.childBudgetId)) throw ApiProblem.notFound('child budget');
    await this.reads.lockBudgets(tx, [parentId, req.childBudgetId]);
    const locked = await this.reads.budgetRows(tx, [parentId, req.childBudgetId]);
    const parent = toPostingBudget(locked.get(parentId)!);
    const child = toPostingBudget(locked.get(req.childBudgetId)!);
    unwrap(acceptsNewActivity(parent.status));
    if (child.parentId === parent.id) unwrap(acceptsNewActivity(child.status));
    const balances = await this.reads.balances(tx, [parentId]);
    const result = unwrap(
      postAllocation(
        {
          parent: { ...parent, balances: balances.get(parentId)!.budget },
          child,
          amount: {
            amountMinor: req.amount.amountMinor,
            currency: req.amount.currency as CurrencyCode,
          },
        },
        {
          reportingCurrency: actor.reportingCurrency,
          rates: await this.reads.planRates(tx, parent.fiscalYearId),
          accountingDate: await this.views.accountingDate(
            tx,
            parent.fiscalYearId,
            req.accountingDate,
          ),
        },
      ),
    );
    const journalId = await this.ledger.post(tx, result.journal, {
      actor,
      command: 'budgets.allocate',
      fiscalYearId: parent.fiscalYearId,
      requestId: ctx.requestId,
      idempotencyKey: ctx.idempotencyKey,
    });
    if (options.audit !== false)
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: actor.personId,
        actorSubject: actor.subject,
        action: auditAction,
        resourceType: 'budget',
        resourceId: parentId,
        legalEntityId: parent.legalEntityId,
        requestId: ctx.requestId,
        reason: req.memo ?? null,
        changes: {
          childBudgetId: { from: null, to: child.id },
          allocatedOut: {
            from: balances.get(parentId)!.budget.allocated_out,
            to: balances.get(parentId)!.budget.allocated_out + result.parentAmount.amountMinor,
          },
          childAuthorizedDelta: { from: null, to: result.childAmount },
          journalId: { from: null, to: journalId },
        },
      });
    await this.views.snapshot(tx, actor, child.id, req.memo ?? 'Allocation received');
    await this.analytics.track(tx, actor, 'allocation.created', {
      depth: locked.get(req.childBudgetId)!.depth,
      crossCurrency: parent.currency !== child.currency,
      driver: locked.get(req.childBudgetId)!.allocationDriver,
    });
    return journalId;
  }

  activate(actor: RequestActor, id: string, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.activate:${id}`,
        request: {},
        status: 200,
      },
      async (tx) => {
        const row = await this.views.row(tx, id);
        const parent = row.parentId ? await this.views.row(tx, row.parentId) : undefined;
        if (!parent) throw ApiProblem.notFound('parent budget');
        this.policy.assert(actor, 'budget.create_child', budgetResource(parent), 'budget');
        await this.reads.lockBudgets(tx, [id]);
        const next = unwrap(budgetMachine.next(row.status, 'activate'));
        await tx.update(budgets).set({ status: next }).where(eq(budgets.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'budget.activated',
          resourceType: 'budget',
          resourceId: id,
          legalEntityId: row.legalEntityId,
          requestId: ctx.requestId,
          changes: { status: { from: row.status, to: next } },
        });
        await this.views.snapshot(tx, actor, id, 'Activated');
        return this.views.detailById(tx, actor, id);
      },
    );
  }

  /**
   * Settings with optimistic concurrency (expectedVersion). Control basis, mode and tolerance are
   * governed by the parent's owner (or finance); name, owner, category and alert thresholds by the
   * budget's own owner.
   */
  updateSettings(actor: RequestActor, id: string, req: BudgetSettingsRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `budgets.settings:${id}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        await this.reads.lockBudgets(tx, [id]);
        const row = await this.views.row(tx, id);
        const parent = row.parentId ? await this.views.row(tx, row.parentId) : undefined;
        this.policy.assert(actor, 'budget.read', budgetResource(row), 'budget');
        if (req.control) this.views.assertControl(actor, row, parent);
        else if (!this.policy.can(actor, 'budget.control', budgetResource(row)).allowed)
          throw ApiProblem.forbidden();
        if (row.version !== req.expectedVersion)
          throw new ApiProblem(
            409,
            'VERSION_CONFLICT',
            'Someone changed this budget after you opened it. Reload to see the latest version.',
            { currentVersion: row.version, expectedVersion: req.expectedVersion },
          );
        await this.assertTenantReferences(tx, {
          ownerPersonId: req.ownerPersonId,
          costCenterId: req.costCenterId,
        } as CreateBudgetRequest);
        const set: Partial<typeof budgets.$inferInsert> = {};
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const change = <K extends keyof typeof budgets.$inferInsert>(
          key: K,
          value: (typeof budgets.$inferInsert)[K] | undefined,
          current: unknown,
        ) => {
          if (value === undefined || JSON.stringify(value) === JSON.stringify(current)) return;
          set[key] = value;
          changes[key] = { from: current, to: value };
        };
        change('name', req.name, row.name);
        change('ownerPersonId', req.ownerPersonId, row.ownerPersonId);
        change('costCenterId', req.costCenterId, row.costCenterId);
        if (req.categoryCode !== undefined) {
          const catId = req.categoryCode
            ? (
                await tx
                  .select({ id: budgetCategories.id })
                  .from(budgetCategories)
                  .where(eq(budgetCategories.code, req.categoryCode))
              )[0]?.id
            : null;
          if (req.categoryCode && !catId)
            throw new ApiProblem(422, 'VALIDATION_FAILED', 'Unknown budget category.', {
              field: 'categoryCode',
            });
          change('categoryId', catId ?? null, row.categoryId);
        }
        if (req.control) {
          change('controlBasis', req.control.basis, row.controlBasis);
          change('controlMode', req.control.mode, row.controlMode);
          change('toleranceBps', req.control.toleranceBps, row.toleranceBps);
        }
        if (req.alertThresholdsPct)
          change(
            'alertThresholdsPct',
            [...new Set(req.alertThresholdsPct)].sort((a, b) => a - b),
            row.alertThresholdsPct,
          );
        if (Object.keys(set).length === 0) return this.views.detail(tx, actor, row);
        await tx.update(budgets).set(set).where(eq(budgets.id, id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'budget.settings_changed',
          resourceType: 'budget',
          resourceId: id,
          legalEntityId: row.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason ?? null,
          changes,
        });
        await this.views.snapshot(tx, actor, id, req.reason?.trim() || 'Settings changed');
        return this.views.detailById(tx, actor, id);
      },
    );
  }

  /** Referenced master data must exist in the actor's tenant; lookups run under RLS, so other tenants' ids are not found. */
  async assertTenantReferences(
    tx: Tx,
    req: Pick<CreateBudgetRequest, 'costCenterId' | 'orgUnitId' | 'ownerPersonId'>,
  ): Promise<void> {
    const refs = [
      { field: 'costCenterId', id: req.costCenterId, table: costCenters, what: 'cost center' },
      { field: 'orgUnitId', id: req.orgUnitId, table: orgUnits, what: 'org unit' },
      { field: 'ownerPersonId', id: req.ownerPersonId, table: people, what: 'owner' },
    ] as const;
    for (const ref of refs) {
      if (!ref.id) continue;
      const [found] = await tx
        .select({ id: ref.table.id })
        .from(ref.table)
        .where(eq(ref.table.id, ref.id));
      if (!found)
        throw new ApiProblem(422, 'VALIDATION_FAILED', `The ${ref.what} does not exist.`, {
          field: ref.field,
        });
    }
  }

  async rowsByIds(tx: Tx, ids: string[]): Promise<BudgetRow[]> {
    if (!ids.length) return [];
    return tx.select().from(budgets).where(inArray(budgets.id, ids));
  }
}
