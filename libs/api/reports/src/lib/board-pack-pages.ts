import type { BoardPackPage, BoardPackPageId, Money, ReportCell, ReportRow } from '@bf/contracts';
import { runRateAmount } from '@bf/domain';
import type { ForecastExtras } from './report-builders';
import type { SnapshotTotals } from './board-pack.service';
import { sumBuckets, type ReportDataset, type ScopedBudget } from './report-reads.service';

/** Everything the pack's pages read, gathered once so every page tells the same story. */
export interface BoardPackData {
  dataset: ReportDataset;
  period: { id: string; label: string; endDate: string };
  /** `period_close_snapshots` of the pack's period, newest version per legal entity. */
  snapshots: SnapshotTotals[];
  forecasts: ForecastExtras;
  commitments: {
    id: string;
    description: string;
    budgetName: string;
    vendorName: string | null;
    status: string;
    amountMinor: number;
    currency: string;
    serviceEnd: string | null;
  }[];
  controls: {
    id: string;
    action: string;
    budgetId: string;
    budgetName: string | null;
    reason: string | null;
    actorName: string | null;
    occurredAt: string;
  }[];
  exceptions: { kind: string; status: string; count: number }[];
  cofunding: {
    givingBudgetName: string;
    receiving: string | null;
    status: string;
    approvedMinor: number;
    currency: string;
    mode: string | null;
    count: number;
  }[];
  monthly: {
    periodId: string;
    label: string;
    startDate: string;
    actualMinor: number;
    committedMinor: number;
  }[];
  draft: boolean;
}

const TITLES: Record<BoardPackPageId, string> = {
  summary: 'Summary',
  legal_entity: 'By legal entity',
  region: 'By region',
  function: 'By function',
  category: 'By category',
  period: 'By period',
  variance_fx: 'Variance and FX bridge',
  top_commitments: 'Top commitments',
  controls_applied: 'Controls applied',
  exceptions: 'Exceptions summary',
  cofunding: 'Co-funding and intercompany recharges',
};

const COMMITMENT_THRESHOLD_MINOR = 250_000;

const bps = (part: number, whole: number) => (whole > 0 ? Math.round((part * 10_000) / whole) : 0);
const text = (t: string | null): ReportCell => ({ text: t });
const num = (n: number | null): ReportCell => ({ number: n });
const pct = (n: number | null): ReportCell => ({ bps: n });

/**
 * One page of the pack. Pages are fixed building blocks: the same columns every month, ordered by
 * label then key so a regenerated pack lists the same rows in the same places. A page with nothing
 * to show keeps its place and carries a statement instead of rows, so the pack never silently
 * drops a section.
 */
export function buildBoardPackPage(page: BoardPackPageId, data: BoardPackData): BoardPackPage {
  const title = TITLES[page];
  const built = buildRows(page, data);
  return {
    page,
    title,
    statement: built.rows.length
      ? null
      : (built.emptyStatement ?? `No data in ${data.period.label}.`),
    columns: built.columns,
    rows: built.rows,
    totals: built.rows.length ? built.totals : null,
    series: built.series ?? [],
  };
}

interface PageBuild {
  columns: BoardPackPage['columns'];
  rows: ReportRow[];
  totals: ReportRow | null;
  series?: BoardPackPage['series'];
  emptyStatement?: string;
}

function buildRows(page: BoardPackPageId, data: BoardPackData): PageBuild {
  switch (page) {
    case 'summary':
      return summaryPage(data);
    case 'legal_entity':
      return legalEntityPage(data);
    case 'region':
      return dimensionPage(data, 'region');
    case 'function':
      return dimensionPage(data, 'function');
    case 'category':
      return dimensionPage(data, 'category');
    case 'period':
      return periodPage(data);
    case 'variance_fx':
      return variancePage(data);
    case 'top_commitments':
      return commitmentsPage(data);
    case 'controls_applied':
      return controlsPage(data);
    case 'exceptions':
      return exceptionsPage(data);
    case 'cofunding':
      return cofundingPage(data);
  }
}

const row = (
  key: string,
  label: string,
  cells: Record<string, ReportCell>,
  extra: Partial<ReportRow> = {},
): ReportRow => ({
  key,
  label,
  budgetId: null,
  eventId: null,
  orgUnitId: null,
  status: null,
  tags: [],
  cells,
  ...extra,
});

/** Total order on every page: label, then the row key, which is unique. */
const byLabel = (a: ReportRow, b: ReportRow) =>
  a.label.localeCompare(b.label) || a.key.localeCompare(b.key);

const moneyOf =
  (data: BoardPackData) =>
  (amountMinor: number): Money => ({
    amountMinor,
    currency: data.dataset.currency,
  });

// Summary -----------------------------------------------------------------------------------------

function summaryPage(data: BoardPackData): PageBuild {
  const money = moneyOf(data);
  const t = sumBuckets(data.dataset.budgets);
  const committed = t.held + t.preEncumbered + t.encumbered;
  const forecast = forecastTotal(data);
  const columns: BoardPackPage['columns'] = [
    { key: 'label', label: 'Scope', type: 'text', align: 'start', drillable: false },
    { key: 'authorized', label: 'Authorized', type: 'money', align: 'end', drillable: true },
    { key: 'pending', label: 'Pending', type: 'money', align: 'end', drillable: true },
    { key: 'committed', label: 'Committed', type: 'money', align: 'end', drillable: true },
    { key: 'actual', label: 'Actual', type: 'money', align: 'end', drillable: true },
    {
      key: 'available',
      label: 'Available',
      type: 'money',
      align: 'end',
      drillable: false,
      hint: 'Company-wide: Authorized \u2212 Held \u2212 Pre-encumbered \u2212 Encumbered \u2212 Actual, with child allocations counted once.',
    },
    { key: 'utilization', label: 'Utilization', type: 'percent', align: 'end', drillable: false },
    {
      key: 'forecast',
      label: 'Forecast at year end',
      type: 'money',
      align: 'end',
      drillable: false,
      hint: 'A forecast, not an actual: it posts nothing and consumes no budget.',
    },
  ];
  const cells = {
    authorized: { money: money(t.authorized), bucket: 'authorized' },
    pending: { money: money(t.preEncumbered), bucket: 'pre_encumbered' },
    committed: { money: money(committed), bucket: 'encumbered' },
    actual: { money: money(t.actual), bucket: 'actual' },
    available: { money: money(t.available) },
    utilization: pct(bps(committed + t.actual, t.authorized)),
    forecast: { money: money(forecast) },
  };
  const only = row('company', data.dataset.scopeLabel, cells);
  return {
    columns,
    rows: [only],
    totals: row('totals', 'Total', cells),
    emptyStatement: `No budgets in scope for ${data.period.label}.`,
  };
}

/** Forecast at year end over the budgets in scope; falls back to the system run-rate per budget. */
function forecastTotal(data: BoardPackData): number {
  const elapsedBps = data.dataset.fiscalYear?.elapsedBps ?? 0;
  return data.dataset.budgets.reduce((sum, b) => {
    const snapshot = data.forecasts.byBudget.get(b.row.id);
    if (snapshot) return sum + snapshot.amountMinor;
    return (
      sum +
      runRateAmount({
        authorizedMinor: b.balances.authorized - b.balances.allocated_out,
        heldMinor: b.balances.held,
        preEncumberedMinor: b.balances.pre_encumbered,
        encumberedMinor: b.balances.encumbered,
        actualMinor: b.balances.actual,
        plannedEventsMinor: 0,
        elapsedBps,
      })
    );
  }, 0);
}

// By legal entity: straight from the close snapshots ----------------------------------------------

function legalEntityPage(data: BoardPackData): PageBuild {
  const money = moneyOf(data);
  const columns: BoardPackPage['columns'] = [
    { key: 'label', label: 'Legal entity', type: 'text', align: 'start', drillable: false },
    { key: 'budgets', label: 'Budgets', type: 'number', align: 'end', drillable: false },
    { key: 'authorized', label: 'Authorized', type: 'money', align: 'end', drillable: false },
    { key: 'allocatedOut', label: 'Allocated out', type: 'money', align: 'end', drillable: false },
    { key: 'held', label: 'Held', type: 'money', align: 'end', drillable: false },
    { key: 'pending', label: 'Pending', type: 'money', align: 'end', drillable: false },
    { key: 'committed', label: 'Committed', type: 'money', align: 'end', drillable: false },
    { key: 'actual', label: 'Actual', type: 'money', align: 'end', drillable: false },
    { key: 'accrued', label: 'Accrued', type: 'money', align: 'end', drillable: false },
    {
      key: 'snapshot',
      label: 'Snapshot',
      type: 'text',
      align: 'start',
      drillable: false,
      hint: 'Version of the close snapshot these figures came from.',
    },
  ];
  // A closed period reads the immutable snapshot; a draft has none, so it reads the as-of ledger.
  if (data.snapshots.length) {
    const rows = data.snapshots
      .map((s) =>
        row(`entity:${s.legalEntityId ?? 'none'}`, s.code, {
          budgets: num(s.budgetCount),
          authorized: { money: money(s.authorizedMinor - s.allocatedOutMinor) },
          allocatedOut: { money: money(s.allocatedOutMinor) },
          held: { money: money(s.heldMinor) },
          pending: { money: money(s.preEncumberedMinor) },
          committed: { money: money(s.encumberedMinor) },
          actual: { money: money(s.actualMinor) },
          accrued: { money: money(s.accruedMinor) },
          snapshot: text(`v${s.version}`),
        }),
      )
      .sort(byLabel);
    const sum = (pick: (s: SnapshotTotals) => number) =>
      data.snapshots.reduce((a, s) => a + pick(s), 0);
    return {
      columns,
      rows,
      totals: row('totals', 'Total', {
        budgets: num(sum((s) => s.budgetCount)),
        authorized: { money: money(sum((s) => s.authorizedMinor - s.allocatedOutMinor)) },
        allocatedOut: { money: money(sum((s) => s.allocatedOutMinor)) },
        held: { money: money(sum((s) => s.heldMinor)) },
        pending: { money: money(sum((s) => s.preEncumberedMinor)) },
        committed: { money: money(sum((s) => s.encumberedMinor)) },
        actual: { money: money(sum((s) => s.actualMinor)) },
        accrued: { money: money(sum((s) => s.accruedMinor)) },
        snapshot: text(null),
      }),
    };
  }
  const groups = groupBy(data.dataset.budgets, (b) => ({
    key: b.legalEntityId,
    label: b.legalEntityCode ?? 'Not set',
  }));
  const rows = groups
    .map((g) => {
      const t = sumBuckets(g.members);
      return row(`entity:${g.key}`, g.label, {
        budgets: num(g.members.length),
        authorized: { money: money(t.authorized) },
        allocatedOut: { money: money(t.allocatedOut) },
        held: { money: money(t.held) },
        pending: { money: money(t.preEncumbered) },
        committed: { money: money(t.encumbered) },
        actual: { money: money(t.actual) },
        accrued: { money: money(t.accrued) },
        snapshot: text('Draft \u2014 no snapshot'),
      });
    })
    .sort(byLabel);
  const total = sumBuckets(data.dataset.budgets);
  return {
    columns,
    rows,
    totals: row('totals', 'Total', {
      budgets: num(data.dataset.budgets.length),
      authorized: { money: money(total.authorized) },
      allocatedOut: { money: money(total.allocatedOut) },
      held: { money: money(total.held) },
      pending: { money: money(total.preEncumbered) },
      committed: { money: money(total.encumbered) },
      actual: { money: money(total.actual) },
      accrued: { money: money(total.accrued) },
      snapshot: text(null),
    }),
    emptyStatement: `No legal entity has budgets in ${data.period.label}.`,
  };
}

// By region, function and category ----------------------------------------------------------------

function dimensionPage(
  data: BoardPackData,
  dimension: 'region' | 'function' | 'category',
): PageBuild {
  const money = moneyOf(data);
  const label =
    dimension === 'region' ? 'Region' : dimension === 'function' ? 'Function' : 'Category';
  const columns: BoardPackPage['columns'] = [
    { key: 'label', label, type: 'text', align: 'start', drillable: false },
    { key: 'budgets', label: 'Budgets', type: 'number', align: 'end', drillable: false },
    { key: 'authorized', label: 'Authorized', type: 'money', align: 'end', drillable: true },
    { key: 'committed', label: 'Committed', type: 'money', align: 'end', drillable: true },
    { key: 'actual', label: 'Actual', type: 'money', align: 'end', drillable: true },
    { key: 'available', label: 'Available', type: 'money', align: 'end', drillable: false },
    { key: 'utilization', label: 'Utilization', type: 'percent', align: 'end', drillable: false },
    { key: 'share', label: 'Share of authorized', type: 'percent', align: 'end', drillable: false },
  ];
  const groups = groupBy(data.dataset.budgets, (b) =>
    dimension === 'region'
      ? { key: b.locationId ?? 'none', label: b.locationName, orgUnitId: b.locationId }
      : dimension === 'function'
        ? { key: b.departmentId ?? 'none', label: b.departmentName, orgUnitId: b.departmentId }
        : { key: b.categoryCode ?? 'none', label: b.categoryName ?? 'No category' },
  );
  const total = sumBuckets(data.dataset.budgets);
  const rows = groups
    .map((g) => {
      const t = sumBuckets(g.members);
      const committed = t.held + t.preEncumbered + t.encumbered;
      return row(
        `${dimension}:${g.key}`,
        g.label,
        {
          budgets: num(g.members.length),
          authorized: { money: money(t.authorized), bucket: 'authorized' },
          committed: { money: money(committed), bucket: 'encumbered' },
          actual: { money: money(t.actual), bucket: 'actual' },
          available: { money: money(t.available) },
          utilization: pct(bps(committed + t.actual, t.authorized)),
          share: pct(bps(t.authorized, total.authorized)),
        },
        { orgUnitId: g.orgUnitId ?? null },
      );
    })
    .sort(byLabel);
  const committed = total.held + total.preEncumbered + total.encumbered;
  return {
    columns,
    rows,
    totals: row('totals', 'Total', {
      budgets: num(data.dataset.budgets.length),
      authorized: { money: money(total.authorized) },
      committed: { money: money(committed) },
      actual: { money: money(total.actual) },
      available: { money: money(total.available) },
      utilization: pct(bps(committed + total.actual, total.authorized)),
      share: pct(10_000),
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
    emptyStatement: `No ${label.toLowerCase()} has spend in ${data.period.label}.`,
  };
}

// By period ---------------------------------------------------------------------------------------

function periodPage(data: BoardPackData): PageBuild {
  const money = moneyOf(data);
  const columns: BoardPackPage['columns'] = [
    { key: 'label', label: 'Period', type: 'text', align: 'start', drillable: false },
    { key: 'starts', label: 'Starts', type: 'date', align: 'start', drillable: false },
    { key: 'committed', label: 'Committed', type: 'money', align: 'end', drillable: false },
    { key: 'actual', label: 'Actual', type: 'money', align: 'end', drillable: false },
  ];
  // Chronological, which is what a reader expects; the start date then the id is a total order.
  const rows = [...data.monthly]
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.periodId.localeCompare(b.periodId))
    .map((m) =>
      row(`period:${m.periodId}`, m.label, {
        starts: text(m.startDate),
        committed: { money: money(m.committedMinor) },
        actual: { money: money(m.actualMinor) },
      }),
    );
  return {
    columns,
    rows,
    totals: row('totals', 'Total', {
      starts: text(null),
      committed: {
        money: money(data.monthly.reduce((s, m) => s + m.committedMinor, 0)),
      },
      actual: { money: money(data.monthly.reduce((s, m) => s + m.actualMinor, 0)) },
    }),
    emptyStatement: `No accounting period of this fiscal year has postings up to ${data.period.label}.`,
  };
}

// Variance and FX bridge --------------------------------------------------------------------------

/**
 * Plan phased to date against actual and committed, by region, in constant currency. The FX effect
 * is reported in the pack's own `fxBridge`, never in these columns: an exchange-rate movement is
 * not a variance against plan and never consumes budget.
 */
function variancePage(data: BoardPackData): PageBuild {
  const money = moneyOf(data);
  const elapsedBps = data.dataset.fiscalYear?.elapsedBps ?? 0;
  const columns: BoardPackPage['columns'] = [
    { key: 'label', label: 'Region', type: 'text', align: 'start', drillable: false },
    {
      key: 'planToDate',
      label: 'Plan phased to date',
      type: 'money',
      align: 'end',
      drillable: false,
      hint: 'Authorized, phased by how far through the fiscal year the period end is.',
    },
    { key: 'actual', label: 'Actual', type: 'money', align: 'end', drillable: true },
    { key: 'committed', label: 'Committed', type: 'money', align: 'end', drillable: true },
    {
      key: 'variance',
      label: 'Variance against plan to date',
      type: 'money',
      align: 'end',
      drillable: false,
    },
    { key: 'variancePct', label: 'Variance %', type: 'percent', align: 'end', drillable: false },
    {
      key: 'fxNote',
      label: 'FX',
      type: 'text',
      align: 'start',
      drillable: false,
      hint: 'The FX effect is bridged on its own page and is not part of this variance.',
    },
  ];
  const groups = groupBy(data.dataset.budgets, (b) => ({
    key: b.locationId ?? 'none',
    label: b.locationName,
    orgUnitId: b.locationId,
  }));
  const rows = groups
    .map((g) => {
      const t = sumBuckets(g.members);
      const committed = t.held + t.preEncumbered + t.encumbered;
      const planToDate = Math.round((t.authorized * elapsedBps) / 10_000);
      const variance = planToDate - (t.actual + committed);
      return row(
        `region:${g.key}`,
        g.label,
        {
          planToDate: { money: money(planToDate) },
          actual: { money: money(t.actual), bucket: 'actual' },
          committed: { money: money(committed), bucket: 'encumbered' },
          variance: {
            money: money(variance),
            tone: (variance < 0 ? 'error' : 'success') as ReportCell['tone'],
          },
          variancePct: pct(bps(variance, planToDate)),
          fxNote: text('Bridged separately'),
        },
        { orgUnitId: g.orgUnitId ?? null },
      );
    })
    .sort(byLabel);
  const total = sumBuckets(data.dataset.budgets);
  const totalCommitted = total.held + total.preEncumbered + total.encumbered;
  const totalPlan = Math.round((total.authorized * elapsedBps) / 10_000);
  const totalVariance = totalPlan - (total.actual + totalCommitted);
  return {
    columns,
    rows,
    totals: row('totals', 'Total', {
      planToDate: { money: money(totalPlan) },
      actual: { money: money(total.actual) },
      committed: { money: money(totalCommitted) },
      variance: { money: money(totalVariance) },
      variancePct: pct(bps(totalVariance, totalPlan)),
      fxNote: text('Bridged separately'),
    }),
    emptyStatement: `No region has plan or spend up to ${data.period.label}.`,
  };
}

// Top commitments ---------------------------------------------------------------------------------

function commitmentsPage(data: BoardPackData): PageBuild {
  const money = moneyOf(data);
  const columns: BoardPackPage['columns'] = [
    { key: 'label', label: 'Commitment', type: 'text', align: 'start', drillable: false },
    { key: 'budget', label: 'Budget', type: 'text', align: 'start', drillable: false },
    { key: 'vendor', label: 'Vendor', type: 'text', align: 'start', drillable: false },
    { key: 'status', label: 'Status', type: 'status', align: 'start', drillable: false },
    { key: 'serviceEnd', label: 'Service ends', type: 'date', align: 'start', drillable: false },
    { key: 'amount', label: 'Amount', type: 'money', align: 'end', drillable: false },
  ];
  const rows = data.commitments
    .map((c) =>
      row(`commitment:${c.id}`, c.description, {
        budget: text(c.budgetName),
        vendor: text(c.vendorName),
        status: text(c.status.replace(/_/g, ' ')),
        serviceEnd: text(c.serviceEnd),
        amount: { money: { amountMinor: c.amountMinor, currency: c.currency } },
      }),
    )
    .sort(byLabel);
  return {
    columns,
    rows,
    totals: row('totals', 'Total', {
      budget: text(null),
      vendor: text(null),
      status: text(null),
      serviceEnd: text(null),
      amount: { money: money(data.commitments.reduce((s, c) => s + c.amountMinor, 0)) },
    }),
    emptyStatement: `No open commitment above ${COMMITMENT_THRESHOLD_MINOR / 100} in ${data.period.label}.`,
  };
}

// Controls applied --------------------------------------------------------------------------------

const CONTROL_LABELS: Record<string, string> = {
  'budget.frozen': 'Frozen',
  'budget.unfrozen': 'Unfrozen',
  'budget.reduced': 'Reduced',
  'budget.set_to_zero': 'Set to zero',
  'budget.restored': 'Restored',
};

function controlsPage(data: BoardPackData): PageBuild {
  const columns: BoardPackPage['columns'] = [
    { key: 'label', label: 'Budget', type: 'text', align: 'start', drillable: false },
    { key: 'control', label: 'Control', type: 'status', align: 'start', drillable: false },
    { key: 'reason', label: 'Reason', type: 'text', align: 'start', drillable: false },
    { key: 'by', label: 'Applied by', type: 'text', align: 'start', drillable: false },
    { key: 'when', label: 'Applied', type: 'date', align: 'start', drillable: false },
  ];
  const rows = data.controls
    .map((c) =>
      row(`control:${c.id}`, c.budgetName ?? c.budgetId, {
        control: text(CONTROL_LABELS[c.action] ?? c.action),
        reason: text(c.reason),
        by: text(c.actorName),
        when: text(c.occurredAt.slice(0, 10)),
      }),
    )
    .sort(byLabel);
  return {
    columns,
    rows,
    totals: null,
    emptyStatement: `No controls applied in ${data.period.label}.`,
  };
}

// Exceptions summary ------------------------------------------------------------------------------

function exceptionsPage(data: BoardPackData): PageBuild {
  const columns: BoardPackPage['columns'] = [
    { key: 'label', label: 'Exception', type: 'text', align: 'start', drillable: false },
    { key: 'status', label: 'Status', type: 'status', align: 'start', drillable: false },
    { key: 'count', label: 'Open', type: 'number', align: 'end', drillable: false },
  ];
  const rows = data.exceptions
    .map((e) =>
      row(`exception:${e.kind}:${e.status}`, e.kind.replace(/_/g, ' '), {
        status: text(e.status),
        count: num(e.count),
      }),
    )
    .sort(byLabel);
  return {
    columns,
    rows,
    totals: row('totals', 'Total', {
      status: text(null),
      count: num(data.exceptions.reduce((s, e) => s + e.count, 0)),
    }),
    emptyStatement: `No open exceptions in ${data.period.label}.`,
  };
}

// Co-funding and intercompany recharges -----------------------------------------------------------

function cofundingPage(data: BoardPackData): PageBuild {
  const money = moneyOf(data);
  const columns: BoardPackPage['columns'] = [
    { key: 'label', label: 'Giving budget', type: 'text', align: 'start', drillable: false },
    { key: 'receiving', label: 'Towards', type: 'text', align: 'start', drillable: false },
    { key: 'status', label: 'Status', type: 'status', align: 'start', drillable: false },
    { key: 'mode', label: 'Mode', type: 'text', align: 'start', drillable: false },
    { key: 'requests', label: 'Requests', type: 'number', align: 'end', drillable: false },
    { key: 'approved', label: 'Approved', type: 'money', align: 'end', drillable: false },
  ];
  const rows = data.cofunding
    .map((c, i) =>
      row(`cofunding:${i}:${c.status}`, c.givingBudgetName, {
        receiving: text(c.receiving),
        status: text(c.status.replace(/_/g, ' ')),
        mode: text(c.mode),
        requests: num(c.count),
        approved: { money: { amountMinor: c.approvedMinor, currency: c.currency } },
      }),
    )
    .sort(byLabel);
  return {
    columns,
    rows,
    totals: row('totals', 'Total', {
      receiving: text(null),
      status: text(null),
      mode: text(null),
      requests: num(data.cofunding.reduce((s, c) => s + c.count, 0)),
      approved: { money: money(data.cofunding.reduce((s, c) => s + c.approvedMinor, 0)) },
    }),
    emptyStatement: `No approved Inter-Director Budget Contribution Requests in ${data.period.label}.`,
  };
}

// Grouping ----------------------------------------------------------------------------------------

interface Group {
  key: string;
  label: string;
  orgUnitId?: string | null;
  members: ScopedBudget[];
}

function groupBy(
  rows: readonly ScopedBudget[],
  pick: (b: ScopedBudget) => { key: string; label: string; orgUnitId?: string | null },
): Group[] {
  const map = new Map<string, Group>();
  for (const b of rows) {
    const g = pick(b);
    const existing = map.get(g.key) ?? { ...g, members: [] };
    existing.members.push(b);
    map.set(g.key, existing);
  }
  return [...map.values()];
}
