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
  planVersions,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import {
  LedgerReads,
  LedgerService,
  todayUtc,
  toPostingBudget,
  type BalancePair,
} from '@bf/api/ledger';
import type { BudgetDetail, CreateBudgetRequest, Journal } from '@bf/contracts';
import {
  acceptsNewActivity,
  allocationAvailable,
  allocationBadge,
  availableOf,
  DEFAULT_CONTROL,
  postAllocation,
  postOriginalBudget,
  type Action,
  type CurrencyCode,
  type Resource,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, like, or, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

type BudgetRow = typeof budgets.$inferSelect;

const BUDGET_ACTIONS: readonly Action[] = [
  'budget.read',
  'budget.create_child',
  'budget.allocate',
  'budget.control',
  'ledger.read',
  'request.create',
  'contribution.request',
];

export interface CommandContext {
  idempotencyKey: string;
  requestId: string | null;
  /** Seed only: deterministic ids for reference data. Never exposed through the API. */
  fixedId?: string;
}

export const budgetResource = (b: Pick<BudgetRow, 'id' | 'path' | 'tenantId'>): Resource => ({
  kind: 'budget',
  tenantId: b.tenantId,
  id: b.id,
  path: b.path,
});

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
  ) {}

  async get(actor: RequestActor, id: string): Promise<BudgetDetail> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const row = (await this.reads.budgetRows(tx, [id])).get(id);
      if (!row) throw ApiProblem.notFound('budget');
      this.policy.assert(actor, 'budget.read', budgetResource(row), 'budget');
      return this.detail(tx, actor, row);
    });
  }

  async ledgerLines(actor: RequestActor, id: string): Promise<Journal['lines']> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const row = (await this.reads.budgetRows(tx, [id])).get(id);
      if (!row) throw ApiProblem.notFound('budget');
      this.policy.assert(actor, 'ledger.read', budgetResource(row), 'budget');
      return this.ledger.budgetLines(tx, id);
    });
  }

  async list(
    actor: RequestActor,
    cursor: string | undefined,
    limit = 50,
  ): Promise<{ items: BudgetDetail[]; nextCursor: string | null }> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const tenantWide = this.policy.can(actor, 'budget.read', {
        kind: 'budget',
        tenantId: actor.tenantId,
        id: '',
        path: '/',
      }).allowed;
      const filters: SQL[] = [];
      if (!tenantWide) {
        if (actor.ownedBudgetPaths.length === 0) return { items: [], nextCursor: null };
        filters.push(or(...actor.ownedBudgetPaths.map((p) => like(budgets.path, `${p}%`)))!);
      }
      const after = cursor ? Buffer.from(cursor, 'base64url').toString('utf8') : null;
      if (after) filters.push(gt(budgets.path, after));
      const rows = await tx
        .select()
        .from(budgets)
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(budgets.path))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const balances = await this.reads.balances(
        tx,
        page.map((r) => r.id),
      );
      const categories = await this.categoryCodes(tx, page);
      return {
        items: page.map((r) => this.toDetail(actor, r, balances.get(r.id)!, categories)),
        nextCursor:
          rows.length > limit
            ? Buffer.from(page[page.length - 1].path, 'utf8').toString('base64url')
            : null,
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
      async (tx) => {
        const id = ctx.fixedId ?? randomUUID();
        let parent: BudgetRow | undefined;
        if (req.parentId) {
          parent = (await this.reads.budgetRows(tx, [req.parentId])).get(req.parentId);
          if (!parent) throw ApiProblem.notFound('parent budget');
          this.policy.assert(actor, 'budget.create_child', budgetResource(parent), 'parent budget');
        } else {
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
        const [fy] = await tx
          .select()
          .from(fiscalYears)
          .where(eq(fiscalYears.id, req.fiscalYearId));
        if (!fy)
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'The fiscal year does not exist.', {
            field: 'fiscalYearId',
          });
        const rates = await this.reads.planRates(tx, fy.id);
        const currency = req.currency as CurrencyCode;
        if (currency !== actor.reportingCurrency && !rates.some((r) => r.quote === currency)) {
          throw new ApiProblem(
            422,
            'RATE_MISSING',
            `No locked plan rate for ${currency} in ${fy.label}.`,
            { currency },
          );
        }
        const categoryId = req.categoryCode
          ? ((
              await tx
                .select({ id: budgetCategories.id })
                .from(budgetCategories)
                .where(eq(budgetCategories.code, req.categoryCode))
            )[0]?.id ??
            (() => {
              throw new ApiProblem(422, 'VALIDATION_FAILED', 'Unknown budget category.', {
                field: 'categoryCode',
              });
            })())
          : null;
        const control = req.control ?? {
          basis: [...DEFAULT_CONTROL.basis],
          mode: DEFAULT_CONTROL.mode,
          toleranceBps: DEFAULT_CONTROL.toleranceBps,
        };
        const accountingDate = req.accountingDate ?? todayUtc();
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
          const [pv] = await tx
            .select()
            .from(planVersions)
            .where(eq(planVersions.id, req.planVersionId));
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
            status: 'active',
            budgetType: req.budgetType ?? 'operating',
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
            alertThresholdsPct: req.alertThresholdsPct ?? [50, 80, 100],
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
        }
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
            ...(req.originalAmount
              ? { originalAmount: { from: null, to: req.originalAmount } }
              : {}),
            ...(journalId ? { journalId: { from: null, to: journalId } } : {}),
          },
        });
        return this.detail(tx, actor, row);
      },
    );
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
        const found = await this.reads.budgetRows(tx, [parentId, req.childBudgetId]);
        const parentRow = found.get(parentId);
        if (!parentRow) throw ApiProblem.notFound('budget');
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
              accountingDate: req.accountingDate ?? todayUtc(),
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
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'budget.allocated',
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
        return {
          journal: await this.ledger.journalDto(tx, journalId),
          parent: await this.detail(tx, actor, locked.get(parentId)!),
          child: await this.detail(tx, actor, locked.get(req.childBudgetId)!),
        };
      },
    );
  }

  /** Referenced master data must exist in the actor's tenant; lookups run under RLS, so other tenants' ids are not found. */
  private async assertTenantReferences(tx: Tx, req: CreateBudgetRequest): Promise<void> {
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

  private async categoryCodes(tx: Tx, rows: BudgetRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.categoryId).filter((c): c is string => Boolean(c)))];
    if (!ids.length) return new Map();
    const cats = await tx
      .select({ id: budgetCategories.id, code: budgetCategories.code })
      .from(budgetCategories)
      .where(inArray(budgetCategories.id, ids));
    return new Map(cats.map((c) => [c.id, c.code]));
  }

  async detail(tx: Tx, actor: RequestActor, row: BudgetRow): Promise<BudgetDetail> {
    const balances = await this.reads.balances(tx, [row.id]);
    return this.toDetail(actor, row, balances.get(row.id)!, await this.categoryCodes(tx, [row]));
  }

  private toDetail(
    actor: RequestActor,
    row: BudgetRow,
    pair: BalancePair,
    categories: Map<string, string>,
  ): BudgetDetail {
    const posting = toPostingBudget(row);
    const ccy = row.currency;
    const rep = actor.reportingCurrency;
    const m = (amountMinor: number, currency: string) => ({ amountMinor, currency });
    const buckets = (b: BalancePair['budget'], c: string) => ({
      authorized: m(b.authorized, c),
      allocatedOut: m(b.allocated_out, c),
      held: m(b.held, c),
      preEncumbered: m(b.pre_encumbered, c),
      encumbered: m(b.encumbered, c),
      actual: m(b.actual, c),
      accrued: m(b.accrued, c),
    });
    return {
      id: row.id,
      parentId: row.parentId,
      path: row.path,
      name: row.name,
      code: row.code,
      status: row.status,
      allocationBadge: allocationBadge(pair.budget.authorized, pair.budget.allocated_out),
      budgetType: row.budgetType,
      categoryCode: row.categoryId ? (categories.get(row.categoryId) ?? null) : null,
      legalEntityId: row.legalEntityId,
      costCenterId: row.costCenterId,
      orgUnitId: row.orgUnitId,
      ownerPersonId: row.ownerPersonId,
      currency: ccy,
      reportingCurrency: rep,
      fiscalYearId: row.fiscalYearId,
      planVersionId: row.planVersionId,
      control: {
        basis: [...posting.control.basis],
        mode: posting.control.mode,
        toleranceBps: posting.control.toleranceBps,
      },
      alertThresholdsPct: row.alertThresholdsPct,
      balances: {
        budgetCurrency: buckets(pair.budget, ccy),
        reporting: buckets(pair.reporting, rep),
        available: m(availableOf(pair.budget, posting.control.basis), ccy),
        availableReporting: m(availableOf(pair.reporting, posting.control.basis), rep),
        allocationAvailable: m(allocationAvailable(pair.budget, posting.control), ccy),
      },
      version: row.version,
      allowedActions: this.policy.allowed(actor, budgetResource(row), BUDGET_ACTIONS),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
