import type {
  Money,
  ReportCell,
  ReportFilters,
  ReportGroupBy,
  ReportId,
  ReportRow,
} from '@bf/contracts';
import {
  commentaryRequired,
  forecastVariance,
  runRateAmount,
  runRateForecast,
  type ForecastFacts,
  type ForecastMethod,
  type FxBridgeInput,
  type FxRate,
} from '@bf/domain';
import { REPORT_SPECS } from './report-definitions';
import {
  committedOf,
  sumBuckets,
  type BucketTotals,
  type ReportDataset,
  type ScopedBudget,
} from './report-reads.service';

export interface ReportColumnSpec {
  key: string;
  label: string;
  type: 'text' | 'money' | 'number' | 'percent' | 'date' | 'status';
  align: 'start' | 'end';
  drillable: boolean;
  hint?: string | null;
}

export interface ReconcileRule {
  column: string;
  buckets: (keyof BucketTotals)[];
  mode: 'equals' | 'at_most';
}

export interface BuiltReport {
  groupBy: ReportGroupBy;
  /** Plain-English statements the frame shows as banners. */
  notes?: string[];
  kpis: {
    key: string;
    label: string;
    money?: Money | null;
    number?: number | null;
    bps?: number | null;
    hint?: string | null;
  }[];
  columns: ReportColumnSpec[];
  rows: ReportRow[];
  totals: ReportRow | null;
  series: {
    key: string;
    label: string;
    unit: 'money' | 'count' | 'percent';
    points: { key: string; label: string; value: number }[];
  }[];
  reconcile: ReconcileRule[];
}

/** Extra data the event, fairness, participation and forecast reports need beyond the budget dataset. */
export interface ReportExtras {
  events: EventFigures[];
  headcount: Map<string, number>;
  participation: Map<string, ParticipationFigures>;
  forecasts: ForecastExtras;
  fxLines: FxLineTotals[];
  planRates: FxRate[];
}

export interface ForecastCycleRef {
  id: string;
  name: string;
  asOfDate: string;
  dueDate: string;
  status: 'open' | 'closed';
  varianceThresholdBps: number;
  varianceThresholdMinor: number;
}

export interface ForecastSnapshotFigures {
  budgetId: string;
  amountMinor: number;
  method: ForecastMethod;
  status: 'accepted' | 'submitted';
  commentary: string | null;
  asOfDate: string;
  systemGenerated: boolean;
  currency: string;
}

export interface ForecastExtras {
  cycle: ForecastCycleRef | null;
  compare: ForecastCycleRef | null;
  byBudget: Map<string, ForecastSnapshotFigures>;
  compareByBudget: Map<string, ForecastSnapshotFigures>;
}

/** Actual spend in one transaction currency, with the reporting amount the ledger stored for it. */
export type FxLineTotals = FxBridgeInput;

export interface EventFigures {
  id: string;
  name: string;
  eventCode: string;
  status: string;
  startsAt: Date | null;
  locationId: string | null;
  locationName: string;
  fundedMinor: number;
  returnedMinor: number;
  preEncumberedMinor: number;
  encumberedMinor: number;
  actualMinor: number;
  attendees: number | null;
  coFunders: number;
}

export interface ParticipationFigures {
  locationId: string | null;
  label: string;
  eligible: number;
  reached: number;
  eventsHeld: number;
  attendances: number;
  saidGoing: number;
  noShows: number;
}

const bps = (part: number, whole: number) => (whole > 0 ? Math.round((part * 10_000) / whole) : 0);

/**
 * Final tie-break for every report's row order. Rows tie on the figure they are ranked by more often
 * than it looks (any two budgets with nothing authorized yet tie at zero), and the budget query has
 * no ORDER BY, so without this the order of tied rows is whatever Postgres returned: the same report
 * run twice, or run after unrelated rows were inserted, comes back in a different order. Label then
 * key is a total order because row keys are unique.
 */
const tieBreak = (a: { label: string; key: string }, b: { label: string; key: string }) =>
  a.label.localeCompare(b.label) || a.key.localeCompare(b.key);

export function buildReport(
  reportId: ReportId,
  dataset: ReportDataset,
  filters: ReportFilters,
  extras: ReportExtras,
): BuiltReport {
  const money = (amountMinor: number): Money => ({
    amountMinor,
    currency: dataset.currency,
  });
  const ctx = { dataset, filters, extras, money };
  switch (reportId) {
    case 'utilization':
      return utilization(ctx);
    case 'budget-vs-actual':
      return budgetVsActual(ctx);
    case 'allocation':
      return allocation(ctx);
    case 'unused-expired':
      return unusedExpired(ctx);
    case 'location-comparison':
      return comparison(ctx, 'location');
    case 'department-comparison':
      return comparison(ctx, 'department');
    case 'event-spending':
      return eventSpending(ctx);
    case 'spend-per-head':
      return spendPerHead(ctx);
    case 'participation-reach':
      return participationReach(ctx);
    case 'forecast-variance':
      return forecastVarianceReport(ctx);
  }
}

interface Ctx {
  dataset: ReportDataset;
  filters: ReportFilters;
  extras: ReportExtras;
  money: (amountMinor: number) => Money;
}

interface Group {
  key: string;
  label: string;
  budgetId: string | null;
  orgUnitId: string | null;
  status: ReportRow['status'];
  tags: string[];
  members: ScopedBudget[];
}

function groupKeyOf(b: ScopedBudget, groupBy: ReportGroupBy): Group {
  switch (groupBy) {
    case 'location':
      return {
        key: b.locationId ?? 'none',
        label: b.locationName,
        budgetId: null,
        orgUnitId: b.locationId,
        status: null,
        tags: [],
        members: [],
      };
    case 'department':
      return {
        key: b.departmentId ?? 'none',
        label: b.departmentName,
        budgetId: null,
        orgUnitId: b.departmentId,
        status: null,
        tags: [],
        members: [],
      };
    case 'legal_entity':
      return {
        key: b.legalEntityId,
        label: b.legalEntityCode ?? 'Not set',
        budgetId: null,
        orgUnitId: null,
        status: null,
        tags: [],
        members: [],
      };
    case 'cost_center':
      return {
        key: b.costCenterId ?? 'none',
        label: b.costCenterCode ?? 'No cost center',
        budgetId: null,
        orgUnitId: null,
        status: null,
        tags: [],
        members: [],
      };
    case 'category':
      return {
        key: b.categoryCode ?? 'none',
        label: b.categoryName ?? 'No category',
        budgetId: null,
        orgUnitId: null,
        status: null,
        tags: [],
        members: [],
      };
    default:
      return {
        key: b.row.id,
        label: b.row.name,
        budgetId: b.row.id,
        orgUnitId: b.orgUnitId,
        status: b.row.status,
        tags: statusTags(b),
        members: [],
      };
  }
}

function statusTags(b: ScopedBudget): string[] {
  if (b.row.status === 'frozen') return ['Frozen'];
  if (b.row.status === 'set_to_zero') return ['Set to zero'];
  return [];
}

function groupBudgets(rows: readonly ScopedBudget[], groupBy: ReportGroupBy): Group[] {
  const map = new Map<string, Group>();
  for (const b of rows) {
    const g = groupKeyOf(b, groupBy);
    const existing = map.get(g.key) ?? g;
    existing.members.push(b);
    map.set(g.key, existing);
  }
  return [...map.values()];
}

const cellMoney = (m: Money, bucket?: string): ReportCell => ({
  money: m,
  ...(bucket ? { bucket } : {}),
});
const cellText = (text: string | null): ReportCell => ({ text });
const cellNumber = (n: number | null): ReportCell => ({ number: n });
const cellBps = (n: number | null): ReportCell => ({ bps: n });

function totalsRow(label: string, cells: Record<string, ReportCell>): ReportRow {
  return {
    key: 'totals',
    label,
    budgetId: null,
    eventId: null,
    orgUnitId: null,
    status: null,
    tags: [],
    cells,
  };
}

function resolveGroupBy(reportId: ReportId, filters: ReportFilters): ReportGroupBy {
  const spec = REPORT_SPECS[reportId];
  const wanted = filters.groupBy;
  return wanted && spec.groupBys.includes(wanted) ? wanted : spec.defaultGroupBy;
}

// 082 Utilization ------------------------------------------------------------------------------

function utilization({ dataset, filters, money }: Ctx): BuiltReport {
  const groupBy = resolveGroupBy('utilization', filters);
  const groups = groupBudgets(dataset.budgets, groupBy);
  const total = sumBuckets(dataset.budgets);
  const rows = groups
    .map((g) => {
      const t = sumBuckets(g.members);
      const used = t.held + t.preEncumbered + t.encumbered + t.actual;
      return {
        key: g.key,
        label: g.label,
        budgetId: g.budgetId,
        eventId: null,
        orgUnitId: g.orgUnitId,
        status: g.status,
        tags: g.tags,
        cells: {
          owner: cellText(g.budgetId ? (g.members[0]?.ownerName ?? null) : null),
          budgets: cellNumber(g.members.length),
          authorized: cellMoney(money(t.authorized), 'authorized'),
          pending: cellMoney(money(t.preEncumbered), 'pre_encumbered'),
          held: cellMoney(money(t.held), 'held'),
          committed: cellMoney(money(t.encumbered), 'encumbered'),
          actual: cellMoney(money(t.actual), 'actual'),
          available: cellMoney(money(t.available)),
          utilization: cellBps(bps(used, t.authorized)),
        },
        sort: t.authorized,
      };
    })
    .sort((a, b) => b.sort - a.sort || tieBreak(a, b))
    .map(({ sort: _sort, ...row }) => row);

  const used = total.held + total.preEncumbered + total.encumbered + total.actual;
  return {
    groupBy,
    kpis: [
      { key: 'authorized', label: 'Authorized', money: money(total.authorized) },
      { key: 'pending', label: 'Pending requests', money: money(total.preEncumbered) },
      { key: 'committed', label: 'Approved commitments', money: money(total.encumbered) },
      { key: 'actual', label: 'Actual', money: money(total.actual) },
      {
        key: 'available',
        label: 'Available',
        money: money(total.available),
        hint: 'Company-wide: Authorized − Held − Pre-encumbered − Encumbered − Actual.',
      },
      { key: 'utilization', label: 'Utilization', bps: bps(used, total.authorized) },
    ],
    columns: [
      { key: 'label', label: 'Budget', type: 'text', align: 'start', drillable: false },
      { key: 'owner', label: 'Owner', type: 'text', align: 'start', drillable: false },
      { key: 'budgets', label: 'Budgets', type: 'number', align: 'end', drillable: false },
      { key: 'authorized', label: 'Authorized', type: 'money', align: 'end', drillable: true },
      { key: 'pending', label: 'Pending', type: 'money', align: 'end', drillable: true },
      { key: 'held', label: 'Held', type: 'money', align: 'end', drillable: true },
      { key: 'committed', label: 'Commitments', type: 'money', align: 'end', drillable: true },
      { key: 'actual', label: 'Actual', type: 'money', align: 'end', drillable: true },
      {
        key: 'available',
        label: 'Available',
        type: 'money',
        align: 'end',
        drillable: false,
        hint: 'Authorized − Held − Pre-encumbered − Encumbered − Actual.',
      },
      { key: 'utilization', label: 'Utilization', type: 'percent', align: 'end', drillable: false },
    ],
    rows,
    totals: totalsRow('Total', {
      owner: cellText(null),
      budgets: cellNumber(dataset.budgets.length),
      authorized: cellMoney(money(total.authorized)),
      pending: cellMoney(money(total.preEncumbered)),
      held: cellMoney(money(total.held)),
      committed: cellMoney(money(total.encumbered)),
      actual: cellMoney(money(total.actual)),
      available: cellMoney(money(total.available)),
      utilization: cellBps(bps(used, total.authorized)),
    }),
    series: [
      {
        key: 'actual',
        label: 'Actual',
        unit: 'money',
        points: rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.cells['actual'].money?.amountMinor ?? 0,
        })),
      },
      {
        key: 'available',
        label: 'Available',
        unit: 'money',
        points: rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.cells['available'].money?.amountMinor ?? 0,
        })),
      },
    ],
    reconcile: [
      { column: 'authorized', buckets: ['authorized'], mode: 'equals' },
      { column: 'pending', buckets: ['preEncumbered'], mode: 'equals' },
      { column: 'held', buckets: ['held'], mode: 'equals' },
      { column: 'committed', buckets: ['encumbered'], mode: 'equals' },
      { column: 'actual', buckets: ['actual'], mode: 'equals' },
      { column: 'available', buckets: ['available'], mode: 'equals' },
    ],
  };
}

// 080 Budget versus actual ----------------------------------------------------------------------

function budgetVsActual({ dataset, filters, money }: Ctx): BuiltReport {
  const groupBy = resolveGroupBy('budget-vs-actual', filters);
  const groups = groupBudgets(dataset.budgets, groupBy);
  const total = sumBuckets(dataset.budgets);
  const rows = groups
    .map((g) => {
      const t = sumBuckets(g.members);
      const committed = t.held + t.preEncumbered + t.encumbered;
      return {
        key: g.key,
        label: g.label,
        budgetId: g.budgetId,
        eventId: null,
        orgUnitId: g.orgUnitId,
        status: g.status,
        tags: g.tags,
        cells: {
          owner: cellText(g.budgetId ? (g.members[0]?.ownerName ?? null) : null),
          authorized: cellMoney(money(t.authorized), 'authorized'),
          actual: cellMoney(money(t.actual), 'actual'),
          committed: cellMoney(money(committed), 'encumbered'),
          variance: cellMoney(money(t.authorized - t.actual)),
          variancePct: cellBps(bps(t.authorized - t.actual, t.authorized)),
          available: cellMoney(money(t.available)),
        },
        sort: t.authorized,
      };
    })
    .sort((a, b) => b.sort - a.sort || tieBreak(a, b))
    .map(({ sort: _sort, ...row }) => row);
  const committed = total.held + total.preEncumbered + total.encumbered;
  return {
    groupBy,
    kpis: [
      { key: 'authorized', label: 'Authorized', money: money(total.authorized) },
      { key: 'actual', label: 'Actual', money: money(total.actual) },
      { key: 'committed', label: 'Committed', money: money(committed) },
      { key: 'variance', label: 'Variance', money: money(total.authorized - total.actual) },
      { key: 'available', label: 'Available', money: money(total.available) },
    ],
    columns: [
      { key: 'label', label: 'Budget', type: 'text', align: 'start', drillable: false },
      { key: 'owner', label: 'Owner', type: 'text', align: 'start', drillable: false },
      { key: 'authorized', label: 'Authorized', type: 'money', align: 'end', drillable: true },
      { key: 'actual', label: 'Actual', type: 'money', align: 'end', drillable: true },
      { key: 'committed', label: 'Committed', type: 'money', align: 'end', drillable: true },
      { key: 'variance', label: 'Variance', type: 'money', align: 'end', drillable: false },
      { key: 'variancePct', label: 'Variance %', type: 'percent', align: 'end', drillable: false },
      { key: 'available', label: 'Available', type: 'money', align: 'end', drillable: false },
    ],
    rows,
    totals: totalsRow('Total', {
      owner: cellText(null),
      authorized: cellMoney(money(total.authorized)),
      actual: cellMoney(money(total.actual)),
      committed: cellMoney(money(committed)),
      variance: cellMoney(money(total.authorized - total.actual)),
      variancePct: cellBps(bps(total.authorized - total.actual, total.authorized)),
      available: cellMoney(money(total.available)),
    }),
    series: [
      {
        key: 'authorized',
        label: 'Authorized',
        unit: 'money',
        points: rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.cells['authorized'].money?.amountMinor ?? 0,
        })),
      },
      {
        key: 'actual',
        label: 'Actual',
        unit: 'money',
        points: rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.cells['actual'].money?.amountMinor ?? 0,
        })),
      },
    ],
    reconcile: [
      { column: 'authorized', buckets: ['authorized'], mode: 'equals' },
      { column: 'actual', buckets: ['actual'], mode: 'equals' },
      { column: 'committed', buckets: ['held', 'preEncumbered', 'encumbered'], mode: 'equals' },
      { column: 'available', buckets: ['available'], mode: 'equals' },
    ],
  };
}

// 081 Allocation --------------------------------------------------------------------------------

function allocation({ dataset, money }: Ctx): BuiltReport {
  const byParent = new Map<string, number>();
  for (const b of dataset.budgets)
    if (b.row.parentId)
      byParent.set(b.row.parentId, (byParent.get(b.row.parentId) ?? 0) + b.balances.authorized);
  const total = sumBuckets(dataset.budgets);
  const rows = [...dataset.budgets]
    .sort((a, b) => a.row.path.localeCompare(b.row.path))
    .map((b) => {
      const childAuthorized = byParent.get(b.row.id) ?? 0;
      const ties = b.childCount === 0 || childAuthorized === b.balances.allocated_out;
      return {
        key: b.row.id,
        label: b.row.name,
        budgetId: b.row.id,
        eventId: null,
        orgUnitId: b.orgUnitId,
        status: b.row.status,
        tags: statusTags(b),
        cells: {
          owner: cellText(b.ownerName),
          depth: cellNumber(b.row.depth),
          authorized: cellMoney(money(b.balances.authorized), 'authorized'),
          allocatedOut: cellMoney(money(b.balances.allocated_out), 'allocated_out'),
          unallocated: cellMoney(money(b.balances.authorized - b.balances.allocated_out)),
          children: cellNumber(b.childCount),
          driver: cellText(b.row.allocationDriver === 'per_head' ? 'Per head' : 'Fixed'),
          check: {
            text: b.childCount === 0 ? '\u2013' : ties ? 'Ties' : 'Does not tie',
            tone: (b.childCount === 0
              ? 'neutral'
              : ties
                ? 'success'
                : 'error') as ReportCell['tone'],
          },
        },
      };
    });
  const mismatched = rows.filter((r) => r.cells['check'].text === 'Does not tie').length;
  return {
    groupBy: 'budget',
    kpis: [
      { key: 'authorized', label: 'Authorized (net)', money: money(total.authorized) },
      { key: 'allocatedOut', label: 'Allocated out', money: money(total.allocatedOut) },
      { key: 'unallocated', label: 'Unallocated', money: money(total.authorized) },
      { key: 'mismatched', label: 'Budgets that do not tie', number: mismatched },
    ],
    columns: [
      { key: 'label', label: 'Budget', type: 'text', align: 'start', drillable: false },
      { key: 'owner', label: 'Owner', type: 'text', align: 'start', drillable: false },
      { key: 'depth', label: 'Level', type: 'number', align: 'end', drillable: false },
      { key: 'authorized', label: 'Authorized', type: 'money', align: 'end', drillable: true },
      {
        key: 'allocatedOut',
        label: 'Allocated out',
        type: 'money',
        align: 'end',
        drillable: true,
      },
      {
        key: 'unallocated',
        label: 'Unallocated',
        type: 'money',
        align: 'end',
        drillable: false,
        hint: 'At a leaf budget this is its own spending room.',
      },
      { key: 'children', label: 'Children', type: 'number', align: 'end', drillable: false },
      { key: 'driver', label: 'Driver', type: 'text', align: 'start', drillable: false },
      {
        key: 'check',
        label: 'Check',
        type: 'status',
        align: 'start',
        drillable: false,
        hint: "Allocated out equals the sum of the children's authorized amounts.",
      },
    ],
    rows,
    totals: totalsRow('Total', {
      owner: cellText(null),
      depth: cellNumber(null),
      authorized: cellMoney(money(total.authorized + total.allocatedOut)),
      allocatedOut: cellMoney(money(total.allocatedOut)),
      unallocated: cellMoney(money(total.authorized)),
      children: cellNumber(dataset.budgets.reduce((s, b) => s + b.childCount, 0)),
      driver: cellText(null),
      check: cellText(mismatched === 0 ? 'Ties' : `${mismatched} do not tie`),
    }),
    series: [],
    reconcile: [
      { column: 'unallocated', buckets: ['authorized'], mode: 'equals' },
      { column: 'allocatedOut', buckets: ['allocatedOut'], mode: 'equals' },
    ],
  };
}

// 086 Unused and expired budget -------------------------------------------------------------------

function unusedExpired({ dataset, money }: Ctx): BuiltReport {
  const fy = dataset.fiscalYear;
  const elapsedBps = fy?.elapsedBps ?? 0;
  const daysLeft = fy?.daysLeft ?? 0;
  const total = sumBuckets(dataset.budgets);
  const rows = dataset.budgets
    .map((b) => {
      const net = b.balances.authorized - b.balances.allocated_out;
      const committed = committedOf(b);
      const available = net - committed - b.balances.actual;
      const forecast = runRateForecast({
        status: b.row.status,
        authorizedMinor: net,
        heldMinor: b.balances.held,
        preEncumberedMinor: b.balances.pre_encumbered,
        encumberedMinor: b.balances.encumbered,
        actualMinor: b.balances.actual,
        phasedToDateMinor: null,
        elapsedBps,
        daysLeft,
        monthsLeft: fy?.monthsLeft ?? 0,
        toleranceBps: b.row.toleranceBps,
        openCommitmentsMinor: b.balances.encumbered,
        agedCommitmentsMinor: 0,
        agedCommitmentsCount: 0,
        unmatchedActualsMinor: 0,
        unmatchedActualsCount: 0,
      });
      const forecastUnused = Math.max(net - forecast, 0);
      return {
        key: b.row.id,
        label: b.row.name,
        budgetId: b.row.id,
        eventId: null,
        orgUnitId: b.orgUnitId,
        status: b.row.status,
        tags: statusTags(b),
        cells: {
          owner: cellText(b.ownerName),
          available: cellMoney(money(available)),
          forecastUnused: cellMoney(money(forecastUnused)),
          forecastUnusedPct: cellBps(bps(forecastUnused, net)),
          daysLeft: cellNumber(daysLeft),
          method: cellText('Run-rate'),
        },
        sort: forecastUnused,
      };
    })
    .sort((a, b) => b.sort - a.sort || tieBreak(a, b))
    .map(({ sort: _sort, ...row }) => row);
  const forecastUnusedTotal = rows.reduce(
    (s, r) => s + (r.cells['forecastUnused'].money?.amountMinor ?? 0),
    0,
  );
  return {
    groupBy: 'budget',
    kpis: [
      { key: 'available', label: 'Available company-wide', money: money(total.available) },
      { key: 'forecastUnused', label: 'Forecast unused', money: money(forecastUnusedTotal) },
      { key: 'daysLeft', label: 'Days left in the fiscal year', number: daysLeft },
    ],
    columns: [
      { key: 'label', label: 'Budget', type: 'text', align: 'start', drillable: false },
      { key: 'owner', label: 'Owner', type: 'text', align: 'start', drillable: false },
      { key: 'available', label: 'Available', type: 'money', align: 'end', drillable: false },
      {
        key: 'forecastUnused',
        label: 'Forecast unused at year end',
        type: 'money',
        align: 'end',
        drillable: false,
      },
      {
        key: 'forecastUnusedPct',
        label: 'Share of authorized',
        type: 'percent',
        align: 'end',
        drillable: false,
      },
      { key: 'daysLeft', label: 'Days left', type: 'number', align: 'end', drillable: false },
      { key: 'method', label: 'Method', type: 'text', align: 'start', drillable: false },
    ],
    rows,
    totals: totalsRow('Total', {
      owner: cellText(null),
      available: cellMoney(money(total.available)),
      forecastUnused: cellMoney(money(forecastUnusedTotal)),
      forecastUnusedPct: cellBps(bps(forecastUnusedTotal, total.authorized)),
      daysLeft: cellNumber(daysLeft),
      method: cellText('Run-rate'),
    }),
    series: [],
    reconcile: [{ column: 'available', buckets: ['available'], mode: 'equals' }],
  };
}

// 083 / 084 Location and department comparison ----------------------------------------------------

function comparison({ dataset, money }: Ctx, dimension: 'location' | 'department'): BuiltReport {
  const groups = groupBudgets(dataset.budgets, dimension);
  const total = sumBuckets(dataset.budgets);
  const rows = groups
    .map((g) => {
      const t = sumBuckets(g.members);
      const committed = t.held + t.preEncumbered + t.encumbered;
      return {
        key: g.key,
        label: g.label,
        budgetId: null,
        eventId: null,
        orgUnitId: g.orgUnitId,
        status: null,
        tags: [],
        cells: {
          budgets: cellNumber(g.members.length),
          authorized: cellMoney(money(t.authorized), 'authorized'),
          committed: cellMoney(money(committed), 'encumbered'),
          actual: cellMoney(money(t.actual), 'actual'),
          available: cellMoney(money(t.available)),
          utilization: cellBps(bps(committed + t.actual, t.authorized)),
          share: cellBps(bps(t.authorized, total.authorized)),
        },
        sort: t.authorized,
      };
    })
    .sort((a, b) => b.sort - a.sort || tieBreak(a, b))
    .map(({ sort: _sort, ...row }) => row);
  const committed = total.held + total.preEncumbered + total.encumbered;
  const label = dimension === 'location' ? 'Location' : 'Department';
  return {
    groupBy: dimension,
    kpis: [
      { key: 'groups', label: `${label}s compared`, number: rows.length },
      { key: 'authorized', label: 'Authorized', money: money(total.authorized) },
      { key: 'actual', label: 'Actual', money: money(total.actual) },
      {
        key: 'utilization',
        label: 'Utilization',
        bps: bps(committed + total.actual, total.authorized),
      },
    ],
    columns: [
      { key: 'label', label, type: 'text', align: 'start', drillable: false },
      { key: 'budgets', label: 'Budgets', type: 'number', align: 'end', drillable: false },
      { key: 'authorized', label: 'Authorized', type: 'money', align: 'end', drillable: true },
      { key: 'committed', label: 'Committed', type: 'money', align: 'end', drillable: true },
      { key: 'actual', label: 'Actual', type: 'money', align: 'end', drillable: true },
      { key: 'available', label: 'Available', type: 'money', align: 'end', drillable: false },
      { key: 'utilization', label: 'Utilization', type: 'percent', align: 'end', drillable: false },
      {
        key: 'share',
        label: 'Share of authorized',
        type: 'percent',
        align: 'end',
        drillable: false,
      },
    ],
    rows,
    totals: totalsRow('Total', {
      budgets: cellNumber(dataset.budgets.length),
      authorized: cellMoney(money(total.authorized)),
      committed: cellMoney(money(committed)),
      actual: cellMoney(money(total.actual)),
      available: cellMoney(money(total.available)),
      utilization: cellBps(bps(committed + total.actual, total.authorized)),
      share: cellBps(10_000),
    }),
    series: [
      {
        key: 'authorized',
        label: 'Authorized',
        unit: 'money',
        points: rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.cells['authorized'].money?.amountMinor ?? 0,
        })),
      },
      {
        key: 'actual',
        label: 'Actual',
        unit: 'money',
        points: rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.cells['actual'].money?.amountMinor ?? 0,
        })),
      },
    ],
    reconcile: [
      { column: 'authorized', buckets: ['authorized'], mode: 'equals' },
      { column: 'committed', buckets: ['held', 'preEncumbered', 'encumbered'], mode: 'equals' },
      { column: 'actual', buckets: ['actual'], mode: 'equals' },
      { column: 'available', buckets: ['available'], mode: 'equals' },
    ],
  };
}

// 085 Event spending ------------------------------------------------------------------------------

function eventSpending({ extras, money }: Ctx): BuiltReport {
  const events = extras.events;
  const rows = events.map((e) => {
    const costPerAttendee =
      e.attendees && e.attendees > 0 ? Math.round(e.actualMinor / e.attendees) : null;
    return {
      key: e.id,
      label: `${e.name} (${e.eventCode})`,
      budgetId: null,
      eventId: e.id,
      orgUnitId: e.locationId,
      status: null,
      tags: [e.status],
      cells: {
        dates: cellText(e.startsAt ? e.startsAt.toISOString().slice(0, 10) : null),
        location: cellText(e.locationName),
        eventStatus: cellText(e.status),
        funded: cellMoney(money(e.fundedMinor)),
        pending: cellMoney(money(e.preEncumberedMinor), 'pre_encumbered'),
        committed: cellMoney(money(e.encumberedMinor), 'encumbered'),
        actual: cellMoney(money(e.actualMinor), 'actual'),
        attendees: cellNumber(e.attendees),
        costPerAttendee:
          costPerAttendee === null ? cellText('–') : cellMoney(money(costPerAttendee)),
        surplusReturned: cellMoney(money(e.returnedMinor)),
        coFunders: cellNumber(e.coFunders),
      },
    };
  });
  const sum = (pick: (e: EventFigures) => number) => events.reduce((s, e) => s + pick(e), 0);
  const funded = sum((e) => e.fundedMinor);
  const actual = sum((e) => e.actualMinor);
  const attendees = sum((e) => e.attendees ?? 0);
  return {
    groupBy: 'event',
    kpis: [
      { key: 'events', label: 'Events', number: events.length },
      { key: 'funded', label: 'Funded', money: money(funded) },
      { key: 'actual', label: 'Spent', money: money(actual) },
      { key: 'committed', label: 'Open commitments', money: money(sum((e) => e.encumberedMinor)) },
      {
        key: 'surplusReturned',
        label: 'Surplus returned',
        money: money(sum((e) => e.returnedMinor)),
      },
      {
        key: 'costPerAttendee',
        label: 'Average cost per attendee',
        money: money(attendees > 0 ? Math.round(actual / attendees) : 0),
      },
    ],
    columns: [
      { key: 'label', label: 'Event', type: 'text', align: 'start', drillable: false },
      { key: 'dates', label: 'Starts', type: 'date', align: 'start', drillable: false },
      { key: 'location', label: 'Location', type: 'text', align: 'start', drillable: false },
      { key: 'eventStatus', label: 'Status', type: 'status', align: 'start', drillable: false },
      { key: 'funded', label: 'Funded', type: 'money', align: 'end', drillable: false },
      { key: 'pending', label: 'Pending', type: 'money', align: 'end', drillable: false },
      { key: 'committed', label: 'Committed open', type: 'money', align: 'end', drillable: false },
      { key: 'actual', label: 'Actual', type: 'money', align: 'end', drillable: false },
      { key: 'attendees', label: 'Attendees', type: 'number', align: 'end', drillable: false },
      {
        key: 'costPerAttendee',
        label: 'Cost per attendee',
        type: 'money',
        align: 'end',
        drillable: false,
        hint: 'Shown once attendance is final.',
      },
      {
        key: 'surplusReturned',
        label: 'Surplus returned',
        type: 'money',
        align: 'end',
        drillable: false,
      },
      { key: 'coFunders', label: 'Co-funders', type: 'number', align: 'end', drillable: false },
    ],
    rows,
    totals: totalsRow('Total', {
      dates: cellText(null),
      location: cellText(null),
      eventStatus: cellText(null),
      funded: cellMoney(money(funded)),
      pending: cellMoney(money(sum((e) => e.preEncumberedMinor))),
      committed: cellMoney(money(sum((e) => e.encumberedMinor))),
      actual: cellMoney(money(actual)),
      attendees: cellNumber(attendees),
      costPerAttendee: cellMoney(money(attendees > 0 ? Math.round(actual / attendees) : 0)),
      surplusReturned: cellMoney(money(sum((e) => e.returnedMinor))),
      coFunders: cellNumber(sum((e) => e.coFunders)),
    }),
    series: [
      {
        key: 'actual',
        label: 'Actual',
        unit: 'money',
        points: rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.cells['actual'].money?.amountMinor ?? 0,
        })),
      },
    ],
    // Event money is a part of the budget money in scope, never more than it.
    reconcile: [
      { column: 'actual', buckets: ['actual'], mode: 'at_most' },
      { column: 'committed', buckets: ['encumbered'], mode: 'at_most' },
    ],
  };
}

// 015a Spend per head by location -----------------------------------------------------------------

function spendPerHead({ dataset, extras, money }: Ctx): BuiltReport {
  const groups = groupBudgets(dataset.budgets, 'location');
  const total = sumBuckets(dataset.budgets);
  const totalHeads = [...groups].reduce(
    (s, g) => s + (g.orgUnitId ? (extras.headcount.get(g.orgUnitId) ?? 0) : 0),
    0,
  );
  const avgSpendPerHead = totalHeads > 0 ? Math.round(total.actual / totalHeads) : 0;
  const rows = groups
    .map((g) => {
      const t = sumBuckets(g.members);
      const heads = g.orgUnitId ? (extras.headcount.get(g.orgUnitId) ?? 0) : 0;
      const spendPerHead = heads > 0 ? Math.round(t.actual / heads) : 0;
      return {
        key: g.key,
        label: g.label,
        budgetId: null,
        eventId: null,
        orgUnitId: g.orgUnitId,
        status: null,
        tags:
          heads > 0 && avgSpendPerHead > 0
            ? spendPerHead * 100 < avgSpendPerHead * 75
              ? ['below']
              : spendPerHead * 100 > avgSpendPerHead * 125
                ? ['above']
                : []
            : [],
        cells: {
          eligible: cellNumber(heads),
          budget: cellMoney(money(t.authorized), 'authorized'),
          budgetPerHead: cellMoney(money(heads > 0 ? Math.round(t.authorized / heads) : 0)),
          actual: cellMoney(money(t.actual), 'actual'),
          spendPerHead: cellMoney(money(spendPerHead)),
          againstAverage: cellBps(bps(spendPerHead, avgSpendPerHead)),
        },
        sort: t.authorized,
      };
    })
    .sort((a, b) => b.sort - a.sort || tieBreak(a, b))
    .map(({ sort: _sort, ...row }) => row);
  return {
    groupBy: 'location',
    kpis: [
      { key: 'eligible', label: 'Eligible employees', number: totalHeads },
      {
        key: 'budgetPerHead',
        label: 'Company average budget per head',
        money: money(totalHeads > 0 ? Math.round(total.authorized / totalHeads) : 0),
      },
      {
        key: 'spendPerHead',
        label: 'Company average spend per head',
        money: money(avgSpendPerHead),
      },
    ],
    columns: [
      { key: 'label', label: 'Location', type: 'text', align: 'start', drillable: false },
      {
        key: 'eligible',
        label: 'Eligible headcount',
        type: 'number',
        align: 'end',
        drillable: false,
        hint: 'Latest HR headcount snapshot, employees only.',
      },
      { key: 'budget', label: 'Budget', type: 'money', align: 'end', drillable: true },
      {
        key: 'budgetPerHead',
        label: 'Budget per head',
        type: 'money',
        align: 'end',
        drillable: false,
      },
      { key: 'actual', label: 'Actual', type: 'money', align: 'end', drillable: true },
      {
        key: 'spendPerHead',
        label: 'Spend per head',
        type: 'money',
        align: 'end',
        drillable: false,
      },
      {
        key: 'againstAverage',
        label: 'Against company average',
        type: 'percent',
        align: 'end',
        drillable: false,
      },
    ],
    rows,
    totals: totalsRow('Company', {
      eligible: cellNumber(totalHeads),
      budget: cellMoney(money(total.authorized)),
      budgetPerHead: cellMoney(
        money(totalHeads > 0 ? Math.round(total.authorized / totalHeads) : 0),
      ),
      actual: cellMoney(money(total.actual)),
      spendPerHead: cellMoney(money(avgSpendPerHead)),
      againstAverage: cellBps(10_000),
    }),
    series: [
      {
        key: 'spendPerHead',
        label: 'Spend per head',
        unit: 'money',
        points: rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.cells['spendPerHead'].money?.amountMinor ?? 0,
        })),
      },
    ],
    reconcile: [
      { column: 'budget', buckets: ['authorized'], mode: 'equals' },
      { column: 'actual', buckets: ['actual'], mode: 'equals' },
    ],
  };
}

// 087 Forecast and variance ------------------------------------------------------------------------

const METHOD_LABELS: Record<ForecastMethod, string> = {
  run_rate: 'Run-rate',
  committed_pipeline: 'Committed + pipeline',
  owner_input: 'Owner input',
};

/** Ledger facts of one budget in the shape the forecast methods take. */
export function factsOf(b: ScopedBudget, elapsedBps: number): ForecastFacts {
  return {
    authorizedMinor: b.balances.authorized - b.balances.allocated_out,
    heldMinor: b.balances.held,
    preEncumberedMinor: b.balances.pre_encumbered,
    encumberedMinor: b.balances.encumbered,
    actualMinor: b.balances.actual,
    plannedEventsMinor: 0,
    elapsedBps,
  };
}

/**
 * Forecast against authorized per budget, with the method, the variance and the owner's commentary
 * where the variance is above the cycle threshold, plus the earlier cycle's figure when one is
 * asked for.
 *
 * Authorized, Actual YTD and Committed come from the ledger and are the only columns the
 * reconciliation checks: a forecast posts nothing, so there is no bucket for it to tie to. A budget
 * without an accepted forecast falls back to the system run-rate and the report says so in a note,
 * rather than showing an empty row.
 */
function forecastVarianceReport({ dataset, filters, extras, money }: Ctx): BuiltReport {
  const elapsedBps = dataset.fiscalYear?.elapsedBps ?? 0;
  const { cycle, compare, byBudget, compareByBudget } = extras.forecasts;
  const threshold = {
    bps: cycle?.varianceThresholdBps ?? 1_000,
    minor: cycle?.varianceThresholdMinor ?? 100_000,
  };
  const comparing = compare !== null;
  const total = sumBuckets(dataset.budgets);
  let fallbacks = 0;

  const built = dataset.budgets
    .map((b) => {
      const facts = factsOf(b, elapsedBps);
      const snapshot = byBudget.get(b.row.id);
      if (!snapshot) fallbacks += 1;
      const forecastMinor = snapshot?.amountMinor ?? runRateAmount(facts);
      const method: ForecastMethod = snapshot?.method ?? 'run_rate';
      const variance = forecastVariance(facts.authorizedMinor, forecastMinor);
      const needsCommentary = commentaryRequired(variance, threshold);
      const previous = compareByBudget.get(b.row.id);
      const tags = [...statusTags(b)];
      if (!snapshot) tags.push('System run-rate');
      else if (snapshot.systemGenerated) tags.push('System');
      if (needsCommentary && !snapshot?.commentary) tags.push('Commentary due');
      return {
        key: b.row.id,
        label: b.row.name,
        budgetId: b.row.id,
        eventId: null,
        orgUnitId: b.orgUnitId,
        status: b.row.status,
        tags,
        cells: {
          owner: cellText(b.ownerName),
          authorized: cellMoney(money(facts.authorizedMinor), 'authorized'),
          actual: cellMoney(money(facts.actualMinor), 'actual'),
          committed: cellMoney(
            money(facts.heldMinor + facts.preEncumberedMinor + facts.encumberedMinor),
            'encumbered',
          ),
          forecast: cellMoney(money(forecastMinor)),
          method: cellText(METHOD_LABELS[method]),
          variance: {
            money: money(variance.varianceMinor),
            // "Over" is the tone finance has to act on; under-spend is information, not an error.
            tone: (variance.direction === 'over'
              ? 'error'
              : variance.direction === 'under'
                ? 'success'
                : 'neutral') as ReportCell['tone'],
          },
          varianceDirection: cellText(variance.direction),
          variancePct: cellBps(variance.varianceBps),
          commentary: cellText(snapshot?.commentary ?? null),
          ...(comparing
            ? {
                previousForecast: previous
                  ? cellMoney(money(previous.amountMinor))
                  : cellText('\u2013'),
                change: previous
                  ? cellMoney(money(forecastMinor - previous.amountMinor))
                  : cellText('\u2013'),
              }
            : {}),
        },
        needsCommentary,
        sort: facts.authorizedMinor,
      };
    })
    // Largest budget first, then the shared tie-break, so two budgets with nothing authorized
    // never change places between two runs of the same report.
    .sort((a, b) => b.sort - a.sort || tieBreak(a, b));

  const commentaryOnly = filters.commentaryRequiredOnly === 'true';
  const reconcileMode: ReconcileRule['mode'] = commentaryOnly ? 'at_most' : 'equals';
  const filtered = commentaryOnly ? built.filter((r) => r.needsCommentary) : built;
  const rows = filtered.map(({ sort: _sort, needsCommentary: _needs, ...row }) => row);

  const forecastTotal = rows.reduce((s, r) => s + (r.cells['forecast'].money?.amountMinor ?? 0), 0);
  const committedTotal = total.held + total.preEncumbered + total.encumbered;
  const authorizedTotal = rows.reduce(
    (s, r) => s + (r.cells['authorized'].money?.amountMinor ?? 0),
    0,
  );
  const varianceTotal = authorizedTotal - forecastTotal;
  const commentaryDue = built.filter((r) => r.needsCommentary).length;
  const notes: string[] = [];
  if (!cycle)
    notes.push('No forecast cycle yet; showing system run-rate forecasts for every budget.');
  else if (fallbacks > 0)
    notes.push(
      `No accepted forecast for ${fallbacks} budget${fallbacks === 1 ? '' : 's'} in ${cycle.name}; showing system run-rate forecasts for ${fallbacks === 1 ? 'it' : 'them'}.`,
    );
  if (cycle) notes.push(`Forecasts from ${cycle.name}, as of ${cycle.asOfDate}.`);
  if (compare) notes.push(`Compared with ${compare.name}, as of ${compare.asOfDate}.`);
  notes.push('Forecast figures are not actuals: they post nothing and consume no budget.');

  const columns: ReportColumnSpec[] = [
    { key: 'label', label: 'Budget', type: 'text', align: 'start', drillable: false },
    { key: 'owner', label: 'Owner', type: 'text', align: 'start', drillable: false },
    { key: 'authorized', label: 'Authorized', type: 'money', align: 'end', drillable: true },
    { key: 'actual', label: 'Actual YTD', type: 'money', align: 'end', drillable: true },
    { key: 'committed', label: 'Committed', type: 'money', align: 'end', drillable: true },
    {
      key: 'forecast',
      label: 'Forecast at year end',
      type: 'money',
      align: 'end',
      drillable: false,
      hint: 'A forecast, not an actual: it posts nothing and consumes no budget.',
    },
    { key: 'method', label: 'Method', type: 'text', align: 'start', drillable: false },
    { key: 'variance', label: 'Variance', type: 'money', align: 'end', drillable: false },
    {
      key: 'varianceDirection',
      label: 'Direction',
      type: 'text',
      align: 'start',
      drillable: false,
      hint: 'Written out, so the sign is never the only signal.',
    },
    { key: 'variancePct', label: 'Variance %', type: 'percent', align: 'end', drillable: false },
    { key: 'commentary', label: 'Commentary', type: 'text', align: 'start', drillable: false },
  ];
  if (comparing)
    columns.push(
      {
        key: 'previousForecast',
        label: 'Previous forecast',
        type: 'money',
        align: 'end',
        drillable: false,
      },
      { key: 'change', label: 'Change', type: 'money', align: 'end', drillable: false },
    );

  return {
    groupBy: 'budget',
    notes,
    kpis: [
      { key: 'authorized', label: 'Authorized', money: money(total.authorized) },
      { key: 'actual', label: 'Actual YTD', money: money(total.actual) },
      { key: 'committed', label: 'Committed', money: money(committedTotal) },
      {
        key: 'forecast',
        label: 'Forecast at year end',
        money: money(forecastTotal),
        hint: 'Sum of the forecasts shown. Never posted to the ledger.',
      },
      { key: 'variance', label: 'Variance against authorized', money: money(varianceTotal) },
      { key: 'commentaryDue', label: 'Variances needing commentary', number: commentaryDue },
    ],
    columns,
    rows,
    totals: totalsRow('Total', {
      owner: cellText(null),
      authorized: cellMoney(money(total.authorized)),
      actual: cellMoney(money(total.actual)),
      committed: cellMoney(money(committedTotal)),
      forecast: cellMoney(money(forecastTotal)),
      method: cellText(methodSummary(built)),
      variance: cellMoney(money(total.authorized - forecastTotal)),
      varianceDirection: cellText(
        total.authorized - forecastTotal > 0
          ? 'under'
          : total.authorized - forecastTotal < 0
            ? 'over'
            : 'on',
      ),
      variancePct: cellBps(bps(total.authorized - forecastTotal, total.authorized)),
      commentary: cellText(null),
      ...(comparing ? { previousForecast: cellText('\u2013'), change: cellText('\u2013') } : {}),
    }),
    series: [
      {
        key: 'authorized',
        label: 'Authorized',
        unit: 'money',
        points: rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.cells['authorized'].money?.amountMinor ?? 0,
        })),
      },
      {
        key: 'forecast',
        label: 'Forecast at year end',
        unit: 'money',
        points: rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.cells['forecast'].money?.amountMinor ?? 0,
        })),
      },
    ],
    // Only the ledger columns are checked. Forecast is deliberately absent: it has no bucket.
    // "Commentary required only" shows a subset of the budgets in scope, so the columns are then
    // checked as a part of the ledger rather than the whole of it.
    reconcile: [
      { column: 'authorized', buckets: ['authorized'], mode: reconcileMode },
      { column: 'actual', buckets: ['actual'], mode: reconcileMode },
      {
        column: 'committed',
        buckets: ['held', 'preEncumbered', 'encumbered'],
        mode: reconcileMode,
      },
    ],
  };
}

/** "Mixed" when the budgets in scope used different methods, as the roll-up row shows it. */
function methodSummary(rows: readonly { cells: Record<string, ReportCell> }[]): string {
  const methods = new Set(rows.map((r) => r.cells['method'].text ?? ''));
  if (methods.size === 0) return '\u2013';
  return methods.size === 1 ? [...methods][0] : 'Mixed';
}

// 015b Participation and reach ---------------------------------------------------------------------

function participationReach({ extras }: Ctx): BuiltReport {
  const figures = [...extras.participation.values()].sort(
    (a, b) =>
      b.eligible - a.eligible ||
      a.label.localeCompare(b.label) ||
      (a.locationId ?? 'none').localeCompare(b.locationId ?? 'none'),
  );
  const rows = figures.map((f) => ({
    key: f.locationId ?? 'none',
    label: f.label,
    budgetId: null,
    eventId: null,
    orgUnitId: f.locationId,
    status: null,
    tags: [],
    cells: {
      eligible: cellNumber(f.eligible),
      reached: cellNumber(f.reached),
      reach: cellBps(bps(f.reached, f.eligible)),
      eventsHeld: cellNumber(f.eventsHeld),
      eventsPerParticipant: cellNumber(
        f.reached > 0 ? Math.round((f.attendances / f.reached) * 10) / 10 : 0,
      ),
      noShow: cellBps(bps(f.noShows, f.saidGoing)),
    },
  }));
  const sum = (pick: (f: ParticipationFigures) => number) =>
    figures.reduce((s, f) => s + pick(f), 0);
  const eligible = sum((f) => f.eligible);
  const reached = sum((f) => f.reached);
  const attendances = sum((f) => f.attendances);
  const saidGoing = sum((f) => f.saidGoing);
  const noShows = sum((f) => f.noShows);
  return {
    groupBy: 'location',
    kpis: [
      { key: 'reach', label: 'Reach', bps: bps(reached, eligible) },
      { key: 'reached', label: 'Reached at least one event', number: reached },
      {
        key: 'eventsPerParticipant',
        label: 'Events per participant',
        number: reached > 0 ? Math.round((attendances / reached) * 10) / 10 : 0,
      },
      { key: 'notReached', label: 'Not yet reached', number: Math.max(eligible - reached, 0) },
      {
        key: 'attendanceRate',
        label: 'Attended after saying Going',
        bps: bps(saidGoing - noShows, saidGoing),
      },
    ],
    columns: [
      { key: 'label', label: 'Location', type: 'text', align: 'start', drillable: false },
      { key: 'eligible', label: 'Eligible', type: 'number', align: 'end', drillable: false },
      {
        key: 'reached',
        label: 'Reached (1+ events)',
        type: 'number',
        align: 'end',
        drillable: false,
      },
      { key: 'reach', label: 'Reach', type: 'percent', align: 'end', drillable: false },
      { key: 'eventsHeld', label: 'Events held', type: 'number', align: 'end', drillable: false },
      {
        key: 'eventsPerParticipant',
        label: 'Avg events per participant',
        type: 'number',
        align: 'end',
        drillable: false,
      },
      {
        key: 'noShow',
        label: 'Going but no-show',
        type: 'percent',
        align: 'end',
        drillable: false,
      },
    ],
    rows,
    totals: totalsRow('Company', {
      eligible: cellNumber(eligible),
      reached: cellNumber(reached),
      reach: cellBps(bps(reached, eligible)),
      eventsHeld: cellNumber(sum((f) => f.eventsHeld)),
      eventsPerParticipant: cellNumber(
        reached > 0 ? Math.round((attendances / reached) * 10) / 10 : 0,
      ),
      noShow: cellBps(bps(noShows, saidGoing)),
    }),
    series: [
      {
        key: 'reach',
        label: 'Reach',
        unit: 'percent',
        points: rows.map((r) => ({
          key: r.key,
          label: r.label,
          value: r.cells['reach'].bps ?? 0,
        })),
      },
    ],
    reconcile: [],
  };
}
