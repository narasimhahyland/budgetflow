import { PolicyService, type RequestActor } from '@bf/api/core';
import { budgets, fiscalYears, type Tx } from '@bf/api/db';
import type { ReportFilters } from '@bf/contracts';
import {
  BUDGET_BUCKETS,
  emptyBalances,
  NORMAL_SIGN,
  toSafeMinor,
  type BucketBalances,
  type BudgetBucket,
} from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, eq, like, or, sql, type SQL } from 'drizzle-orm';

export type BudgetRow = typeof budgets.$inferSelect;

/** A budget the viewer may read, with its own ledger balances in the reporting currency. */
export interface ScopedBudget {
  row: BudgetRow;
  balances: BucketBalances;
  ownerPersonId: string | null;
  ownerName: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  locationId: string | null;
  locationName: string;
  departmentId: string | null;
  departmentName: string;
  legalEntityId: string;
  legalEntityCode: string | null;
  costCenterId: string | null;
  costCenterCode: string | null;
  categoryCode: string | null;
  categoryName: string | null;
  fiscalYearLabel: string | null;
  childCount: number;
  lastActivityAt: Date | null;
}

export interface BucketTotals {
  authorized: number;
  allocatedOut: number;
  held: number;
  preEncumbered: number;
  encumbered: number;
  actual: number;
  accrued: number;
  available: number;
}

export interface FiscalYearWindow {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  elapsedBps: number;
  daysLeft: number;
  monthsLeft: number;
}

export interface ReportDataset {
  budgets: ScopedBudget[];
  tenantWide: boolean;
  scopeLabel: string;
  /** Budgets the viewer may read before the report's own filters narrowed them. */
  visibleCount: number;
  currency: string;
  fiscalYear: FiscalYearWindow | null;
  asOf: string;
}

const LOCATION_KINDS = ['location', 'region', 'company'];
const DEPARTMENT_KINDS = ['team', 'department', 'business_unit'];

/**
 * Sums buckets across budgets with child allocations counted once: authorized is netted against
 * allocated out, so a parent and its children never double-count the same money. Available follows
 * the company-wide definition: Authorized − Held − Pre-encumbered − Encumbered − Actual.
 */
export function sumBuckets(rows: readonly ScopedBudget[]): BucketTotals {
  const t: BucketTotals = {
    authorized: 0,
    allocatedOut: 0,
    held: 0,
    preEncumbered: 0,
    encumbered: 0,
    actual: 0,
    accrued: 0,
    available: 0,
  };
  for (const b of rows) {
    t.authorized += b.balances.authorized - b.balances.allocated_out;
    t.allocatedOut += b.balances.allocated_out;
    t.held += b.balances.held;
    t.preEncumbered += b.balances.pre_encumbered;
    t.encumbered += b.balances.encumbered;
    t.actual += b.balances.actual;
    t.accrued += b.balances.accrued;
  }
  t.available = t.authorized - t.held - t.preEncumbered - t.encumbered - t.actual;
  return t;
}

export const committedOf = (b: ScopedBudget): number =>
  b.balances.held + b.balances.pre_encumbered + b.balances.encumbered;

/** Loads the budgets a viewer may report on, with ledger balances and the display dimensions. */
@Injectable()
export class ReportReads {
  constructor(private readonly policy: PolicyService) {}

  tenantWide(actor: RequestActor): boolean {
    return this.policy.can(actor, 'report.read', { kind: 'tenant', tenantId: actor.tenantId })
      .allowed;
  }

  /** Path prefixes the viewer may report on; null means tenant-wide, 'none' means nothing. */
  scopePaths(actor: RequestActor): string[] | null | 'none' {
    if (this.tenantWide(actor)) return null;
    const owned = actor.ownedBudgetPaths.filter(
      (p) =>
        this.policy.can(actor, 'report.read', {
          kind: 'budget',
          tenantId: actor.tenantId,
          id: '',
          path: p,
        }).allowed,
    );
    return owned.length ? [...owned] : 'none';
  }

  async fiscalYearWindow(
    tx: Tx,
    fiscalYearId: string | undefined,
    today: string,
  ): Promise<FiscalYearWindow | null> {
    const rows = fiscalYearId
      ? await tx.select().from(fiscalYears).where(eq(fiscalYears.id, fiscalYearId))
      : await tx
          .select()
          .from(fiscalYears)
          .where(
            and(sql`${fiscalYears.startDate} <= ${today}`, sql`${fiscalYears.endDate} >= ${today}`),
          )
          .limit(1);
    const fy = rows[0];
    if (!fy) return null;
    const day = 24 * 60 * 60 * 1000;
    const start = Date.parse(`${fy.startDate}T00:00:00Z`);
    const end = Date.parse(`${fy.endDate}T00:00:00Z`);
    const now = Date.parse(`${today}T00:00:00Z`);
    const span = Math.max(end - start, day);
    const elapsed = Math.min(Math.max(now - start, 0), span);
    const daysLeft = Math.max(Math.round((end - now) / day), 0);
    return {
      id: fy.id,
      label: fy.label,
      startDate: fy.startDate,
      endDate: fy.endDate,
      elapsedBps: Math.round((elapsed * 10_000) / span),
      daysLeft,
      monthsLeft: Math.floor(daysLeft / 30),
    };
  }

  /**
   * Balances per budget in the reporting currency. When a period window is given only the fiscal
   * periods inside it are summed, so the report and its reconciliation always use the same source.
   */
  private async balances(
    tx: Tx,
    budgetIds: readonly string[],
    window: { from?: string; to?: string },
  ): Promise<Map<string, BucketBalances>> {
    const out = new Map<string, BucketBalances>(budgetIds.map((id) => [id, emptyBalances()]));
    if (!budgetIds.length) return out;
    const ids = sql.join(
      budgetIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const windowed = window.from || window.to;
    const res = await tx.execute<{ budget_id: string; bucket: string; amount: string }>(
      windowed
        ? sql`select lb.budget_id, lb.bucket, sum(lb.reporting_amount_minor)::text as amount
              from ledger_balances lb
              join fiscal_periods fp on fp.id = lb.fiscal_period_id
              where lb.budget_id in (${ids})
                ${window.from ? sql`and fp.end_date >= ${window.from}` : sql``}
                ${window.to ? sql`and fp.start_date <= ${window.to}` : sql``}
              group by lb.budget_id, lb.bucket`
        : sql`select lb.budget_id, lb.bucket, sum(lb.reporting_amount_minor)::text as amount
              from ledger_balances lb
              where lb.budget_id in (${ids})
              group by lb.budget_id, lb.bucket`,
    );
    for (const r of res.rows) {
      if (!(BUDGET_BUCKETS as readonly string[]).includes(r.bucket)) continue;
      const bucket = r.bucket as BudgetBucket;
      out.get(r.budget_id)![bucket] = NORMAL_SIGN[bucket] * toSafeMinor(r.amount);
    }
    return out;
  }

  /** Nearest location-like and department-like org unit above each unit (itself included). */
  private async dimensions(
    tx: Tx,
    unitIds: readonly string[],
    today: string,
  ): Promise<
    Map<
      string,
      {
        locationId: string | null;
        locationName: string | null;
        departmentId: string | null;
        departmentName: string | null;
      }
    >
  > {
    const out = new Map<
      string,
      {
        locationId: string | null;
        locationName: string | null;
        departmentId: string | null;
        departmentName: string | null;
      }
    >();
    if (!unitIds.length) return out;
    const res = await tx.execute<{
      descendant_id: string;
      ancestor_id: string;
      name: string;
      kind: string;
      depth: number;
    }>(sql`
      select c.descendant_id, c.ancestor_id, u.name, u.kind::text as kind, c.depth
      from org_unit_closure c
      join org_units u on u.id = c.ancestor_id
      where c.descendant_id in (${sql.join(
        [...new Set(unitIds)].map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
        and c.valid_from <= ${today} and (c.valid_to is null or c.valid_to >= ${today})
      order by c.descendant_id, c.depth`);
    for (const r of res.rows) {
      const cur = out.get(r.descendant_id) ?? {
        locationId: null,
        locationName: null,
        departmentId: null,
        departmentName: null,
      };
      if (!cur.locationId && LOCATION_KINDS.includes(r.kind)) {
        cur.locationId = r.ancestor_id;
        cur.locationName = r.name;
      }
      if (!cur.departmentId && DEPARTMENT_KINDS.includes(r.kind)) {
        cur.departmentId = r.ancestor_id;
        cur.departmentName = r.name;
      }
      out.set(r.descendant_id, cur);
    }
    return out;
  }

  /**
   * Every budget the viewer may report on under the filters, with balances and dimensions. The
   * viewer's scope is applied first (path prefixes for owners), then `PolicyService.can` per row,
   * so a budget outside the scope can never reach a figure.
   */
  async dataset(
    tx: Tx,
    actor: RequestActor,
    filters: ReportFilters,
    today: string,
  ): Promise<ReportDataset> {
    const tenantWide = this.tenantWide(actor);
    const paths = this.scopePaths(actor);
    const asOf = new Date().toISOString();
    const fy = await this.fiscalYearWindow(tx, filters.fiscalYearId, today);
    const empty: ReportDataset = {
      budgets: [],
      tenantWide,
      scopeLabel: actor.tenantName,
      visibleCount: 0,
      currency: actor.reportingCurrency,
      fiscalYear: fy,
      asOf,
    };
    if (paths === 'none') return empty;

    const conds: SQL[] = [sql`${budgets.status} <> 'cancelled'`];
    if (paths) conds.push(or(...paths.map((p) => like(budgets.path, `${p}%`)))!);
    if (fy) conds.push(eq(budgets.fiscalYearId, fy.id));
    if (filters.legalEntityId) conds.push(eq(budgets.legalEntityId, filters.legalEntityId));
    if (filters.costCenterId) conds.push(eq(budgets.costCenterId, filters.costCenterId));
    if (filters.budgetType) conds.push(eq(budgets.budgetType, filters.budgetType));
    if (filters.status) conds.push(eq(budgets.status, filters.status));
    if (filters.rootBudgetId) {
      const [root] = await tx.select().from(budgets).where(eq(budgets.id, filters.rootBudgetId));
      if (!root) return empty;
      this.policy.assert(
        actor,
        'report.read',
        { kind: 'budget', tenantId: actor.tenantId, id: root.id, path: root.path },
        'budget',
      );
      conds.push(like(budgets.path, `${root.path}%`));
      empty.scopeLabel = `${root.name} and below`;
    }

    const rows = (
      await tx
        .select()
        .from(budgets)
        .where(and(...conds))
    ).filter(
      (b) =>
        this.policy.can(actor, 'report.read', {
          kind: 'budget',
          tenantId: actor.tenantId,
          id: b.id,
          path: b.path,
        }).allowed,
    );
    if (!rows.length) return { ...empty, visibleCount: 0 };

    const ids = rows.map((r) => r.id);
    const [balances, display] = await Promise.all([
      this.balances(tx, ids, { from: filters.periodFrom, to: filters.periodTo }),
      tx.execute<{
        id: string;
        owner_name: string | null;
        ou_name: string | null;
        le_code: string | null;
        cc_code: string | null;
        cat_code: string | null;
        cat_name: string | null;
        fy_label: string | null;
        child_count: string;
        last_activity: string | null;
      }>(sql`
        select b.id, p.display_name as owner_name, ou.name as ou_name, le.code as le_code,
               cc.code as cc_code, cat.code as cat_code, cat.name as cat_name, fy.label as fy_label,
               (select count(*) from budgets k where k.parent_id = b.id)::text as child_count,
               (select max(j.created_at)::text from ledger_journals j
                  join ledger_lines l on l.journal_id = j.id and l.budget_id = b.id) as last_activity
        from budgets b
        left join people p on p.id = b.owner_person_id
        left join org_units ou on ou.id = b.org_unit_id
        left join legal_entities le on le.id = b.legal_entity_id
        left join cost_centers cc on cc.id = b.cost_center_id
        left join budget_categories cat on cat.id = b.category_id
        left join fiscal_years fy on fy.id = b.fiscal_year_id
        where b.id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`),
    ]);
    const byId = new Map(display.rows.map((r) => [r.id, r]));
    const dims = await this.dimensions(
      tx,
      rows.map((r) => r.orgUnitId).filter((u): u is string => Boolean(u)),
      today,
    );

    let scoped: ScopedBudget[] = rows.map((row) => {
      const d = byId.get(row.id);
      const dim = row.orgUnitId ? dims.get(row.orgUnitId) : undefined;
      return {
        row,
        balances: balances.get(row.id) ?? emptyBalances(),
        ownerPersonId: row.ownerPersonId,
        ownerName: d?.owner_name ?? null,
        orgUnitId: row.orgUnitId,
        orgUnitName: d?.ou_name ?? null,
        locationId: dim?.locationId ?? null,
        locationName: dim?.locationName ?? 'Not set',
        departmentId: dim?.departmentId ?? null,
        departmentName: dim?.departmentName ?? 'No team',
        legalEntityId: row.legalEntityId,
        legalEntityCode: d?.le_code ?? null,
        costCenterId: row.costCenterId,
        costCenterCode: d?.cc_code ?? null,
        categoryCode: d?.cat_code ?? null,
        categoryName: d?.cat_name ?? null,
        fiscalYearLabel: d?.fy_label ?? null,
        childCount: Number(d?.child_count ?? 0),
        lastActivityAt: d?.last_activity ? new Date(d.last_activity) : null,
      };
    });
    const visibleCount = scoped.length;
    if (filters.categoryCode)
      scoped = scoped.filter((b) => b.categoryCode === filters.categoryCode);
    if (filters.orgUnitId)
      scoped = scoped.filter(
        (b) =>
          b.orgUnitId === filters.orgUnitId ||
          b.locationId === filters.orgUnitId ||
          b.departmentId === filters.orgUnitId,
      );

    return {
      budgets: scoped,
      tenantWide,
      scopeLabel:
        empty.scopeLabel !== actor.tenantName
          ? empty.scopeLabel
          : scopeLabelFor(actor, tenantWide, scoped),
      visibleCount,
      currency: actor.reportingCurrency,
      fiscalYear: fy,
      asOf,
    };
  }
}

function scopeLabelFor(
  actor: RequestActor,
  tenantWide: boolean,
  scoped: readonly ScopedBudget[],
): string {
  if (tenantWide) return actor.tenantName;
  const tops = scoped
    .filter((b) => !scoped.some((o) => o.row.id !== b.row.id && b.row.path.startsWith(o.row.path)))
    .map((b) => b.row.name);
  return tops.length ? `${tops.join(', ')} and below` : actor.tenantName;
}
