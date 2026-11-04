import { ApiProblem, PolicyService, type RequestActor } from '@bf/api/core';
import { budgets, budgetVersions, outboxMessages, type Tx } from '@bf/api/db';
import { LedgerReads, todayUtc, toPostingBudget, type BalancePair } from '@bf/api/ledger';
import type { BudgetDetail, PerHeadDriverConfig } from '@bf/contracts';
import {
  allocationAvailable,
  allocationBadge,
  availableOf,
  explainAvailable,
  thresholdsReached,
  utilizationBps,
  type Action,
  type BucketBalances,
  type Resource,
  type SubtreeTotals,
} from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';

export type BudgetRow = typeof budgets.$inferSelect;

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

export const tenantBudgetResource = (tenantId: string): Resource => ({
  kind: 'budget',
  tenantId,
  id: '',
  path: '/',
});

const BUDGET_ACTIONS: readonly Action[] = [
  'budget.read',
  'budget.create_child',
  'budget.allocate',
  'ledger.read',
  'request.create',
  'contribution.request',
];

/** Ancestor ids of a budget from its materialized path, root first (the budget itself excluded). */
export const ancestorIds = (row: Pick<BudgetRow, 'path' | 'id'>): string[] =>
  row.path
    .split('/')
    .filter(Boolean)
    .filter((id) => id !== row.id);

interface Display {
  ownerName: string | null;
  parentName: string | null;
  legalEntityCode: string | null;
  legalEntityName: string | null;
  costCenterCode: string | null;
  orgUnitName: string | null;
  fiscalYearLabel: string | null;
  categoryName: string | null;
  categoryCode: string | null;
  childCount: number;
}

/** Budget read models (detail with roll-ups and explanations), version snapshots and outbox events. */
@Injectable()
export class BudgetViews {
  constructor(
    private readonly policy: PolicyService,
    private readonly reads: LedgerReads,
  ) {}

  async row(tx: Tx, id: string): Promise<BudgetRow> {
    const row = (await this.reads.budgetRows(tx, [id])).get(id);
    if (!row) throw ApiProblem.notFound('budget');
    return row;
  }

  /**
   * Accounting date for a posting: the requested one, else today when it falls in the budget's fiscal
   * year, else the year's nearest day (next year's budgets post on its first day).
   */
  async accountingDate(tx: Tx, fiscalYearId: string, requested?: string | null): Promise<string> {
    if (requested) return requested;
    const fy = await this.reads.fiscalYear(tx, fiscalYearId);
    const today = todayUtc();
    if (today < fy.startDate) return fy.startDate;
    if (today > fy.endDate) return fy.endDate;
    return today;
  }

  /** The budget's chain from itself up to the root (each row), for hierarchy moves. */
  async chain(tx: Tx, row: BudgetRow): Promise<BudgetRow[]> {
    const ids = ancestorIds(row);
    const found = await this.reads.budgetRows(tx, ids);
    return [row, ...ids.reverse().map((id) => found.get(id)!)];
  }

  /**
   * Who may freeze, reduce or set a budget to zero: whoever controls its parent (for a root, tenant-wide
   * control). Owners never loosen the controls on the budget they own.
   */
  canControl(actor: RequestActor, row: BudgetRow, parent: BudgetRow | undefined): boolean {
    if (row.parentId && parent)
      return this.policy.can(actor, 'budget.control', budgetResource(parent)).allowed;
    return this.policy.can(actor, 'budget.control', tenantBudgetResource(actor.tenantId)).allowed;
  }

  assertControl(actor: RequestActor, row: BudgetRow, parent: BudgetRow | undefined): void {
    this.policy.assert(actor, 'budget.read', budgetResource(row), 'budget');
    if (!this.canControl(actor, row, parent))
      throw ApiProblem.forbidden(
        'Only the owner of the parent budget or finance can change the controls on this budget.',
      );
  }

  async subtreeTotals(tx: Tx, rows: readonly BudgetRow[]): Promise<Map<string, SubtreeTotals>> {
    const out = new Map<string, SubtreeTotals>(
      rows.map((r) => [r.id, { preEncumberedMinor: 0, encumberedMinor: 0, actualMinor: 0 }]),
    );
    if (!rows.length) return out;
    const res = await tx.execute<{ id: string; pre: string; enc: string; act: string }>(sql`
      select b.id,
        coalesce(sum(lb.reporting_amount_minor) filter (where lb.bucket = 'pre_encumbered'), 0)::text as pre,
        coalesce(sum(lb.reporting_amount_minor) filter (where lb.bucket = 'encumbered'), 0)::text as enc,
        coalesce(sum(lb.reporting_amount_minor) filter (where lb.bucket = 'actual'), 0)::text as act
      from budgets b
      join budgets d on d.tenant_id = b.tenant_id and left(d.path, length(b.path)) = b.path
      join ledger_balances lb on lb.budget_id = d.id and lb.bucket in ('pre_encumbered', 'encumbered', 'actual')
      where b.id in (${sql.join(
        rows.map((r) => sql`${r.id}::uuid`),
        sql`, `,
      )})
      group by b.id`);
    for (const r of res.rows) {
      out.set(r.id, {
        preEncumberedMinor: Number(r.pre),
        encumberedMinor: Number(r.enc),
        actualMinor: Number(r.act),
      });
    }
    return out;
  }

  private async displays(tx: Tx, rows: readonly BudgetRow[]): Promise<Map<string, Display>> {
    if (!rows.length) return new Map();
    const res = await tx.execute<{
      id: string;
      owner_name: string | null;
      parent_name: string | null;
      le_code: string | null;
      le_name: string | null;
      cc_code: string | null;
      ou_name: string | null;
      fy_label: string | null;
      cat_name: string | null;
      cat_code: string | null;
      child_count: string;
    }>(sql`
      select b.id, p.display_name as owner_name, pb.name as parent_name, le.code as le_code,
             le.name as le_name, cc.code as cc_code, ou.name as ou_name, fy.label as fy_label,
             cat.name as cat_name, cat.code as cat_code,
             (select count(*) from budgets k where k.parent_id = b.id)::text as child_count
      from budgets b
      left join people p on p.id = b.owner_person_id
      left join budgets pb on pb.id = b.parent_id
      left join legal_entities le on le.id = b.legal_entity_id
      left join cost_centers cc on cc.id = b.cost_center_id
      left join org_units ou on ou.id = b.org_unit_id
      left join fiscal_years fy on fy.id = b.fiscal_year_id
      left join budget_categories cat on cat.id = b.category_id
      where b.id in (${sql.join(
        rows.map((r) => sql`${r.id}::uuid`),
        sql`, `,
      )})`);
    return new Map(
      res.rows.map((r) => [
        r.id,
        {
          ownerName: r.owner_name,
          parentName: r.parent_name,
          legalEntityCode: r.le_code,
          legalEntityName: r.le_name,
          costCenterCode: r.cc_code,
          orgUnitName: r.ou_name,
          fiscalYearLabel: r.fy_label,
          categoryName: r.cat_name,
          categoryCode: r.cat_code,
          childCount: Number(r.child_count),
        },
      ]),
    );
  }

  async detail(tx: Tx, actor: RequestActor, row: BudgetRow): Promise<BudgetDetail> {
    return (await this.details(tx, actor, [row]))[0];
  }

  async detailById(tx: Tx, actor: RequestActor, id: string): Promise<BudgetDetail> {
    return this.detail(tx, actor, await this.row(tx, id));
  }

  async details(tx: Tx, actor: RequestActor, rows: readonly BudgetRow[]): Promise<BudgetDetail[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [balances, subtree, displays] = await Promise.all([
      this.reads.balances(tx, ids),
      this.subtreeTotals(tx, rows),
      this.displays(tx, rows),
    ]);
    const parentIds = [...new Set(rows.map((r) => r.parentId).filter((p): p is string => !!p))];
    const parents = await this.reads.budgetRows(
      tx,
      parentIds.filter((p) => !ids.includes(p)),
    );
    for (const r of rows) parents.set(r.id, r);
    return rows.map((r) =>
      this.toDetail(
        actor,
        r,
        balances.get(r.id)!,
        subtree.get(r.id)!,
        displays.get(r.id)!,
        r.parentId ? parents.get(r.parentId) : undefined,
      ),
    );
  }

  private toDetail(
    actor: RequestActor,
    row: BudgetRow,
    pair: BalancePair,
    subtree: SubtreeTotals,
    display: Display,
    parent: BudgetRow | undefined,
  ): BudgetDetail {
    const posting = toPostingBudget(row);
    const ccy = row.currency;
    const rep = actor.reportingCurrency;
    const m = (amountMinor: number, currency: string) => ({ amountMinor, currency });
    const buckets = (b: BucketBalances, c: string) => ({
      authorized: m(b.authorized, c),
      allocatedOut: m(b.allocated_out, c),
      held: m(b.held, c),
      preEncumbered: m(b.pre_encumbered, c),
      encumbered: m(b.encumbered, c),
      actual: m(b.actual, c),
      accrued: m(b.accrued, c),
    });
    const explanation = explainAvailable(pair.reporting, posting.control, subtree);
    const util = utilizationBps(pair.budget);
    const actions: string[] = this.policy.allowed(actor, budgetResource(row), BUDGET_ACTIONS);
    const controls = this.canControl(actor, row, parent);
    if (controls) actions.push('budget.control');
    if (parent && this.policy.can(actor, 'budget.allocate', budgetResource(parent)).allowed)
      actions.push('budget.transfer');
    if (parent && actions.includes('request.create')) actions.push('budget.request_increase');
    if (this.policy.can(actor, 'budget.control', budgetResource(row)).allowed)
      actions.push('budget.settings');
    return {
      id: row.id,
      parentId: row.parentId,
      path: row.path,
      depth: row.depth,
      name: row.name,
      code: row.code,
      status: row.status,
      allocationBadge: allocationBadge(pair.budget.authorized, pair.budget.allocated_out),
      budgetType: row.budgetType,
      categoryCode: display.categoryCode,
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
      available: {
        companyWide: m(explanation.companyWideMinor, rep),
        underRules: m(explanation.underRulesMinor, rep),
        difference: m(explanation.differenceMinor, rep),
        reasons: explanation.reasons,
      },
      utilizationBps: util,
      thresholdsReachedPct: thresholdsReached(-1, util, row.alertThresholdsPct),
      allocationDriver: row.allocationDriver,
      driver: (row.driverConfig as PerHeadDriverConfig | null) ?? null,
      phasingMethod: (row.phasingMethod as BudgetDetail['phasingMethod']) ?? null,
      childCount: display.childCount,
      display: {
        ownerName: display.ownerName,
        parentName: display.parentName,
        legalEntityCode: display.legalEntityCode,
        legalEntityName: display.legalEntityName,
        costCenterCode: display.costCenterCode,
        orgUnitName: display.orgUnitName,
        fiscalYearLabel: display.fiscalYearLabel,
        categoryName: display.categoryName,
      },
      version: row.version,
      allowedActions: [...new Set(actions)],
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Immutable snapshot with a reason; bumps the budget's version (optimistic concurrency token). */
  async snapshot(tx: Tx, actor: RequestActor, budgetId: string, reason: string): Promise<number> {
    const [row] = await tx
      .update(budgets)
      .set({ version: sql`${budgets.version} + 1`, updatedAt: new Date() })
      .where(eq(budgets.id, budgetId))
      .returning();
    const bal = (await this.reads.balances(tx, [budgetId])).get(budgetId)!.budget;
    await tx.insert(budgetVersions).values({
      tenantId: actor.tenantId,
      budgetId,
      version: row.version,
      reason,
      createdBy: actor.personId,
      snapshot: {
        name: row.name,
        code: row.code,
        status: row.status,
        ownerPersonId: row.ownerPersonId,
        costCenterId: row.costCenterId,
        control: { basis: row.controlBasis, mode: row.controlMode, toleranceBps: row.toleranceBps },
        alertThresholdsPct: row.alertThresholdsPct,
        allocationDriver: row.allocationDriver,
        driverConfig: row.driverConfig,
        phasingMethod: row.phasingMethod,
        planVersionId: row.planVersionId,
        currency: row.currency,
        authorizedMinor: bal.authorized,
        allocatedOutMinor: bal.allocated_out,
        heldMinor: bal.held,
        preEncumberedMinor: bal.pre_encumbered,
        encumberedMinor: bal.encumbered,
        actualMinor: bal.actual,
      },
    });
    return row.version;
  }

  async outbox(tx: Tx, tenantId: string, topic: string, payload: Record<string, unknown>) {
    await tx.insert(outboxMessages).values({ tenantId, topic, payload });
  }

  /** Emits `budget.threshold_crossed` for owner alert thresholds newly reached (utilization rose). */
  async emitThresholds(
    tx: Tx,
    actor: RequestActor,
    before: Map<string, number>,
    ids: readonly string[],
  ): Promise<void> {
    const rows = await tx
      .select()
      .from(budgets)
      .where(inArray(budgets.id, [...ids]));
    const balances = await this.reads.balances(tx, ids);
    for (const r of rows) {
      const after = utilizationBps(balances.get(r.id)!.budget);
      for (const t of thresholdsReached(before.get(r.id) ?? 0, after, r.alertThresholdsPct)) {
        await this.outbox(tx, actor.tenantId, 'budget.threshold_crossed', {
          tenantId: actor.tenantId,
          budgetId: r.id,
          ownerPersonId: r.ownerPersonId,
          thresholdPct: t,
          utilizationBps: after,
          occurredAt: new Date().toISOString(),
        });
      }
    }
  }

  async utilizations(tx: Tx, ids: readonly string[]): Promise<Map<string, number>> {
    const balances = await this.reads.balances(tx, ids);
    return new Map(ids.map((id) => [id, utilizationBps(balances.get(id)!.budget)]));
  }
}
