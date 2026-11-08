import { ApiProblem, DB, PolicyService, todayUtc, type RequestActor } from '@bf/api/core';
import { budgets, reportExports, reportSchedules, withTenant, type Db, type Tx } from '@bf/api/db';
import type {
  LedgerLine,
  Money,
  ReportCatalog,
  ReportDrilldown,
  ReportFilters,
  ReportId,
  ReportReconciliation,
  ReportResult,
  ReportRow,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import { buildReport, type ReportExtras } from './report-builders';
import { REPORT_LIST, REPORT_SPECS } from './report-definitions';
import { sumBuckets, ReportReads, type BucketTotals } from './report-reads.service';
import { ReportExtrasReads, type EventFiguresQuery } from './report-extras.service';
import { SavedViewsService } from './saved-views.service';

const DEFAULT_LIMIT = 200;

const emptyExtras = (): ReportExtras => ({
  events: [],
  headcount: new Map(),
  participation: new Map(),
  forecasts: { cycle: null, compare: null, byBudget: new Map(), compareByBudget: new Map() },
  fxLines: [],
  planRates: [],
});

/** The report catalog, report runs in the shared frame, and drill-down to the ledger lines. */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly reads: ReportReads,
    private readonly extras: ReportExtrasReads,
    private readonly views: SavedViewsService,
  ) {}

  private tx<T>(actor: RequestActor, body: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, body);
  }

  private assertCanRead(actor: RequestActor): void {
    const tenantWide = this.reads.tenantWide(actor);
    if (tenantWide) return;
    if (this.reads.scopePaths(actor) === 'none')
      throw ApiProblem.forbidden('Reports are for finance roles and budget owners.');
  }

  async catalog(actor: RequestActor): Promise<ReportCatalog> {
    this.assertCanRead(actor);
    return this.tx(actor, async (tx) => {
      const tenantWide = this.reads.tenantWide(actor);
      const visible = REPORT_LIST.filter((r) => tenantWide || r.ownerScoped);
      const [savedViews, schedules, exports] = await Promise.all([
        this.views.listInTx(tx, actor),
        tx.select({ n: count() }).from(reportSchedules).where(eq(reportSchedules.active, true)),
        tx.select({ n: count() }).from(reportExports),
      ]);
      const dataset = await this.reads.dataset(tx, actor, {}, todayUtc());
      return {
        generatedAt: new Date().toISOString(),
        scope: {
          tenantWide,
          label: dataset.scopeLabel,
          budgetIds: dataset.visibleCount,
          note: tenantWide ? null : 'Showing budgets you can see.',
        },
        reports: visible.map((r) => ({
          reportId: r.reportId,
          name: r.name,
          question: r.question,
          group: r.group,
          screen: r.screen,
          groupBys: r.groupBys,
          formats: r.formats,
          ownerScoped: r.ownerScoped,
        })),
        savedViews,
        activeSchedules: Number(schedules[0]?.n ?? 0),
        recentExports: Number(exports[0]?.n ?? 0),
      };
    });
  }

  run(actor: RequestActor, reportId: ReportId, filters: ReportFilters, limit?: number) {
    this.assertCanRead(actor);
    const spec = REPORT_SPECS[reportId];
    if (!spec.ownerScoped && !this.reads.tenantWide(actor))
      throw ApiProblem.forbidden('This report is open to finance roles and the CEO.');
    return this.tx(actor, (tx) => this.runInTx(tx, actor, reportId, filters, limit));
  }

  /** Runs a report inside an open transaction; the worker uses this with the schedule owner's actor. */
  async runInTx(
    tx: Tx,
    actor: RequestActor,
    reportId: ReportId,
    filters: ReportFilters,
    limit = DEFAULT_LIMIT,
  ): Promise<ReportResult> {
    const spec = REPORT_SPECS[reportId];
    const today = todayUtc();
    const dataset = await this.reads.dataset(tx, actor, filters, today);
    const extras = await this.loadExtras(tx, reportId, dataset, filters);
    const built = buildReport(reportId, dataset, filters, extras);
    const totals = sumBuckets(dataset.budgets);
    const money = (amountMinor: number): Money => ({
      amountMinor,
      currency: dataset.currency,
    });
    const rows = built.rows.slice(0, limit);
    return {
      reportId,
      name: spec.name,
      question: spec.question,
      generatedAt: dataset.asOf,
      currency: dataset.currency,
      scope: {
        tenantWide: dataset.tenantWide,
        label: dataset.scopeLabel,
        budgetIds: dataset.budgets.length,
        note: dataset.tenantWide ? null : 'Showing budgets you can see.',
      },
      filters: {
        ...filters,
        ...(dataset.fiscalYear ? { fiscalYearId: dataset.fiscalYear.id } : {}),
      },
      groupBy: built.groupBy,
      kpis: built.kpis,
      columns: built.columns,
      rows,
      totals: built.totals,
      series: built.series,
      rowCount: built.rows.length,
      truncated: built.rows.length > rows.length,
      notes: built.notes ?? [],
      reconciliation: reconcile(built, totals, dataset.budgets.length, money),
    };
  }

  private loadExtras(
    tx: Tx,
    reportId: ReportId,
    dataset: Awaited<ReturnType<ReportReads['dataset']>>,
    filters: ReportFilters,
  ): Promise<ReportExtras> {
    const query: EventFiguresQuery = {
      budgetIds: dataset.budgets.map((b) => b.row.id),
      periodFrom: filters.periodFrom ?? dataset.fiscalYear?.startDate,
      periodTo: filters.periodTo ?? dataset.fiscalYear?.endDate,
    };
    switch (reportId) {
      case 'event-spending':
        return this.extras.events(tx, query);
      case 'spend-per-head':
        return this.extras.headcount(tx);
      case 'participation-reach':
        return this.extras.participation(tx, query);
      case 'forecast-variance':
        return this.extras.forecasts(tx, {
          budgetIds: query.budgetIds,
          cycleId: filters.forecastCycleId,
          compareCycleId: filters.compareCycleId,
          fiscalYearId: dataset.fiscalYear?.id,
        });
      default:
        return Promise.resolve(emptyExtras());
    }
  }

  /** The ledger lines behind one figure: the same rows the cached balance was built from. */
  drilldown(
    actor: RequestActor,
    reportId: ReportId,
    q: {
      budgetId: string;
      bucket: string;
      subtree?: 'true' | 'false';
      periodFrom?: string;
      periodTo?: string;
      limit?: number;
    },
  ): Promise<ReportDrilldown> {
    this.assertCanRead(actor);
    return this.tx(actor, async (tx) => {
      const [budget] = await tx.select().from(budgets).where(eq(budgets.id, q.budgetId));
      if (!budget) throw ApiProblem.notFound('budget');
      this.policy.assert(
        actor,
        'report.read',
        { kind: 'budget', tenantId: actor.tenantId, id: budget.id, path: budget.path },
        'budget',
      );
      const limit = q.limit ?? 100;
      const scope =
        q.subtree === 'true'
          ? sql`l.budget_id in (select id from budgets where left(path, ${budget.path.length}) = ${budget.path})`
          : sql`l.budget_id = ${budget.id}::uuid`;
      const res = await tx.execute<Record<string, string | null>>(sql`
        select l.id, l.journal_id, l.line_no, l.budget_id, l.account::text as account,
               l.legal_entity_id, l.cost_center_id, l.gl_account_id, l.event_code,
               l.fiscal_period_id, l.accounting_date,
               l.transaction_currency, l.transaction_amount_minor::text as transaction_amount_minor,
               l.budget_currency, l.budget_amount_minor::text as budget_amount_minor,
               l.reporting_currency, l.reporting_amount_minor::text as reporting_amount_minor,
               l.budget_rate_type, l.budget_rate, l.budget_rate_ids,
               l.reporting_rate_type, l.reporting_rate, l.reporting_rate_ids,
               l.plan_version_id, l.reversal_of_line_id,
               count(*) over ()::text as total_count,
               sum(l.reporting_amount_minor) over ()::text as total_amount
        from ledger_lines l
        join fiscal_periods fp on fp.id = l.fiscal_period_id
        where ${scope} and l.account = ${q.bucket}
          ${q.periodFrom ? sql`and fp.end_date >= ${q.periodFrom}` : sql``}
          ${q.periodTo ? sql`and fp.start_date <= ${q.periodTo}` : sql``}
        order by l.accounting_date desc, l.id desc
        limit ${limit}`);
      const lineCount = Number(res.rows[0]?.['total_count'] ?? 0);
      const sign = q.bucket === 'allocated_out' ? -1 : 1;
      const totalMinor = sign * Number(res.rows[0]?.['total_amount'] ?? 0);
      return {
        reportId,
        budgetId: budget.id,
        bucket: q.bucket,
        total: { amountMinor: totalMinor, currency: actor.reportingCurrency },
        lineCount,
        truncated: lineCount > res.rows.length,
        lines: res.rows.map(toLedgerLine),
      };
    });
  }
}

function toLedgerLine(r: Record<string, unknown>): LedgerLine {
  const num = (v: unknown) => Number(v);
  const rate = (type: unknown, value: unknown, ids: unknown, from: unknown, to: unknown) =>
    type
      ? {
          type: type as LedgerLine['reportingRate']['type'],
          from: from as string,
          to: to as string,
          value: Number(value).toFixed(12),
          rateIds: (ids as string[] | null) ?? [],
        }
      : null;
  return {
    id: r['id'] as string,
    journalId: r['journal_id'] as string,
    lineNo: num(r['line_no']),
    budgetId: (r['budget_id'] as string | null) ?? null,
    account: r['account'] as LedgerLine['account'],
    legalEntityId: r['legal_entity_id'] as string,
    costCenterId: (r['cost_center_id'] as string | null) ?? null,
    glAccountId: (r['gl_account_id'] as string | null) ?? null,
    eventCode: (r['event_code'] as string | null) ?? null,
    periodId: r['fiscal_period_id'] as string,
    accountingDate: r['accounting_date'] as string,
    transaction: {
      amountMinor: num(r['transaction_amount_minor']),
      currency: r['transaction_currency'] as string,
    },
    budget:
      r['budget_amount_minor'] === null
        ? null
        : {
            amountMinor: num(r['budget_amount_minor']),
            currency: r['budget_currency'] as string,
          },
    reporting: {
      amountMinor: num(r['reporting_amount_minor']),
      currency: r['reporting_currency'] as string,
    },
    budgetRate: rate(
      r['budget_rate_type'],
      r['budget_rate'],
      r['budget_rate_ids'],
      r['transaction_currency'],
      r['budget_currency'],
    ),
    reportingRate: rate(
      r['reporting_rate_type'],
      r['reporting_rate'],
      r['reporting_rate_ids'],
      r['transaction_currency'],
      r['reporting_currency'],
    )!,
    planVersionId: (r['plan_version_id'] as string | null) ?? null,
    reversalOfLineId: (r['reversal_of_line_id'] as string | null) ?? null,
  };
}

/**
 * Checks the table against the ledger: every money column a report declares must equal (or, for a
 * subset such as event money, not exceed) the matching bucket aggregate. A difference is a bug, not
 * a rounding detail, so it is reported rather than hidden.
 */
function reconcile(
  built: {
    rows: ReportRow[];
    reconcile: { column: string; buckets: (keyof BucketTotals)[]; mode: 'equals' | 'at_most' }[];
  },
  totals: BucketTotals,
  budgetsCounted: number,
  money: (amountMinor: number) => Money,
): ReportReconciliation {
  const differences: { key: string; expected: Money; actual: Money }[] = [];
  for (const rule of built.reconcile) {
    const expected = rule.buckets.reduce((s, b) => s + totals[b], 0);
    const actual = built.rows.reduce(
      (s, r) => s + (r.cells[rule.column]?.money?.amountMinor ?? 0),
      0,
    );
    const ok = rule.mode === 'equals' ? actual === expected : actual <= expected;
    if (!ok)
      differences.push({ key: rule.column, expected: money(expected), actual: money(actual) });
  }
  return {
    source: 'ledger_balances',
    budgetsCounted,
    authorized: money(totals.authorized),
    held: money(totals.held),
    preEncumbered: money(totals.preEncumbered),
    encumbered: money(totals.encumbered),
    actual: money(totals.actual),
    accrued: money(totals.accrued),
    available: money(totals.available),
    ties: differences.length === 0,
    differences,
  };
}
