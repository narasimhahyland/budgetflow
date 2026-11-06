import { z } from 'zod';
import { BudgetStatus, BudgetType, CurrencyCode, Id, IsoDate, IsoDateTime, Money } from '../common';
import { LedgerLine } from './ledger';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

/**
 * Phase 10 reporting and analytics. Every report answers through the same frame (filters, columns,
 * rows, totals, KPIs, chart series, drill-down to ledger lines) so the UI learns it once, and every
 * money figure carries the reconciliation block proving it was built from ledger buckets.
 */
export const REPORT_IDS = [
  'budget-vs-actual',
  'allocation',
  'utilization',
  'location-comparison',
  'department-comparison',
  'event-spending',
  'unused-expired',
  'spend-per-head',
  'participation-reach',
] as const;
export const ReportId = z.enum(REPORT_IDS).describe('Report in the Phase 10 catalog.');
export type ReportId = z.infer<typeof ReportId>;

export const REPORT_GROUPS = ['budgets', 'comparisons', 'events', 'fairness'] as const;
export const ReportGroup = z
  .enum(REPORT_GROUPS)
  .describe('Catalog grouping, by the question people ask.');

export const REPORT_GROUP_BYS = [
  'budget',
  'location',
  'department',
  'legal_entity',
  'cost_center',
  'category',
  'month',
  'status',
  'event',
  'none',
] as const;
export const ReportGroupBy = z.enum(REPORT_GROUP_BYS);
export type ReportGroupBy = z.infer<typeof ReportGroupBy>;

export const REPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export const ReportFormat = z.enum(REPORT_FORMATS);
export type ReportFormat = z.infer<typeof ReportFormat>;

export const ReportTone = z.enum(['neutral', 'info', 'success', 'warning', 'error']);

/** Filters of the shared report frame; a saved view and a schedule store exactly this object. */
export const ReportFilters = named(
  'ReportFilters',
  z
    .object({
      fiscalYearId: Id.optional(),
      rootBudgetId: Id.optional().describe('Org scope: this budget and everything below it.'),
      orgUnitId: Id.optional(),
      legalEntityId: Id.optional(),
      costCenterId: Id.optional(),
      categoryCode: z.string().trim().max(50).optional(),
      budgetType: BudgetType.optional(),
      status: BudgetStatus.optional(),
      groupBy: ReportGroupBy.optional(),
      periodFrom: IsoDate.optional().describe('Accounting date from (inclusive).'),
      periodTo: IsoDate.optional().describe('Accounting date to (inclusive).'),
    })
    .strict()
    .describe('Report filters; stored verbatim on saved views and schedules, never report data.'),
);
export type ReportFilters = z.infer<typeof ReportFilters>;

export const ReportRunQuery = ReportFilters.extend({
  limit: z.coerce.number().int().min(1).max(500).optional(),
}).strict();

export const ReportColumn = named(
  'ReportColumn',
  z
    .object({
      key: z.string(),
      label: z.string(),
      type: z.enum(['text', 'money', 'number', 'percent', 'date', 'status']),
      align: z.enum(['start', 'end']),
      drillable: z
        .boolean()
        .describe('A drill-down to the ledger lines behind this cell is available.'),
      hint: z.string().nullable().optional(),
    })
    .strict(),
);

export const ReportCell = named(
  'ReportCell',
  z
    .object({
      text: z.string().nullable().optional(),
      money: Money.nullable().optional(),
      number: z.number().nullable().optional(),
      bps: z.int().nullable().optional().describe('Percentage in basis points (10,000 = 100%).'),
      tone: ReportTone.nullable().optional(),
      /** Ledger bucket behind a drillable money cell. */
      bucket: z.string().nullable().optional(),
    })
    .strict()
    .describe('One table cell; exactly the typed value the column declares is filled.'),
);
export type ReportCell = z.infer<typeof ReportCell>;

export const ReportRow = named(
  'ReportRow',
  z
    .object({
      key: z.string().describe('Stable row key; pass it back to drill down.'),
      label: z.string(),
      budgetId: Id.nullable(),
      eventId: Id.nullable(),
      orgUnitId: Id.nullable(),
      status: BudgetStatus.nullable(),
      tags: z.array(z.string()),
      cells: z.record(z.string(), ReportCell),
    })
    .strict(),
);
export type ReportRow = z.infer<typeof ReportRow>;

export const ReportKpi = named(
  'ReportKpi',
  z
    .object({
      key: z.string(),
      label: z.string(),
      money: Money.nullable().optional(),
      number: z.number().nullable().optional(),
      bps: z.int().nullable().optional(),
      hint: z.string().nullable().optional(),
      tone: ReportTone.nullable().optional(),
    })
    .strict(),
);

export const ReportSeries = named(
  'ReportSeries',
  z
    .object({
      key: z.string(),
      label: z.string(),
      unit: z.enum(['money', 'count', 'percent']),
      points: z.array(z.object({ key: z.string(), label: z.string(), value: z.number() }).strict()),
    })
    .strict()
    .describe('Chart series; the table is always the accessible alternative.'),
);

/**
 * Proof that the report was built from ledger buckets. `authorized` is summed net of allocated out so
 * child allocations count once; `available` follows the company-wide definition (Authorized − Held −
 * Pre-encumbered − Encumbered − Actual). `ties` is false when a money total in the table disagrees.
 */
export const ReportReconciliation = named(
  'ReportReconciliation',
  z
    .object({
      source: z.literal('ledger_balances'),
      budgetsCounted: z.int(),
      authorized: Money.describe('Sum of authorized − allocated out over the budgets in scope.'),
      held: Money,
      preEncumbered: Money,
      encumbered: Money,
      actual: Money,
      accrued: Money,
      available: Money.describe('Authorized − Held − Pre-encumbered − Encumbered − Actual.'),
      ties: z.boolean(),
      differences: z.array(z.object({ key: z.string(), expected: Money, actual: Money }).strict()),
    })
    .strict(),
);
export type ReportReconciliation = z.infer<typeof ReportReconciliation>;

export const ReportScope = named(
  'ReportScope',
  z
    .object({
      tenantWide: z.boolean(),
      label: z.string().describe('For example "India Region and below" or "Hyland".'),
      budgetIds: z.int().describe('How many budgets the viewer may see under the filters.'),
      note: z
        .string()
        .nullable()
        .describe('"Showing budgets you can see." when the viewer is scoped.'),
    })
    .strict(),
);

export const ReportResult = named(
  'ReportResult',
  z
    .object({
      reportId: ReportId,
      name: z.string(),
      question: z.string(),
      generatedAt: IsoDateTime,
      currency: CurrencyCode.describe('Reporting currency; every money figure uses it.'),
      scope: ReportScope,
      filters: ReportFilters.describe('The filters as resolved (defaults filled in).'),
      groupBy: ReportGroupBy,
      kpis: z.array(ReportKpi),
      columns: z.array(ReportColumn),
      rows: z.array(ReportRow),
      totals: ReportRow.nullable(),
      series: z.array(ReportSeries),
      rowCount: z.int(),
      truncated: z.boolean(),
      reconciliation: ReportReconciliation,
    })
    .strict()
    .describe('One run of a report in the shared frame.'),
);
export type ReportResult = z.infer<typeof ReportResult>;

export const ReportDefinition = named(
  'ReportDefinition',
  z
    .object({
      reportId: ReportId,
      name: z.string(),
      question: z.string(),
      group: ReportGroup,
      screen: z.string().describe('Screen number in the inventory, for traceability.'),
      groupBys: z.array(ReportGroupBy),
      formats: z.array(ReportFormat),
      ownerScoped: z
        .boolean()
        .describe('Whether a budget owner may open it scoped to their subtree.'),
    })
    .strict(),
);

export const SavedReportView = named(
  'SavedReportView',
  z
    .object({
      id: Id,
      reportId: ReportId,
      name: z.string(),
      filters: ReportFilters,
      favourite: z.boolean(),
      ownerPersonId: Id.nullable(),
      lastOpenedAt: IsoDateTime.nullable(),
      createdAt: IsoDateTime,
    })
    .strict()
    .describe('A saved view stores filters only; data is always recomputed when it is opened.'),
);
export type SavedReportView = z.infer<typeof SavedReportView>;

export const ReportCatalog = named(
  'ReportCatalog',
  z
    .object({
      generatedAt: IsoDateTime,
      scope: ReportScope,
      reports: z.array(ReportDefinition),
      savedViews: z.array(SavedReportView),
      activeSchedules: z.int(),
      recentExports: z.int(),
    })
    .strict(),
);
export type ReportCatalog = z.infer<typeof ReportCatalog>;

// Drill-down -----------------------------------------------------------------------------------

export const ReportDrilldownQuery = z
  .object({
    budgetId: Id,
    bucket: z.enum([
      'held',
      'pre_encumbered',
      'encumbered',
      'actual',
      'authorized',
      'allocated_out',
    ]),
    subtree: z
      .enum(['true', 'false'])
      .optional()
      .describe('Include the budget\u2019s children (roll-up rows); default false.'),
    periodFrom: IsoDate.optional(),
    periodTo: IsoDate.optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export const ReportDrilldown = named(
  'ReportDrilldown',
  z
    .object({
      reportId: ReportId,
      budgetId: Id,
      bucket: z.string(),
      total: Money.describe('Sum of the lines, in the reporting currency.'),
      lineCount: z.int(),
      truncated: z.boolean(),
      lines: z.array(LedgerLine),
    })
    .strict()
    .describe('The ledger lines behind one figure, newest first.'),
);
export type ReportDrilldown = z.infer<typeof ReportDrilldown>;

// 013 Budget health overview -------------------------------------------------------------------

export const HEALTH_CHECKS = ['pace', 'forecast', 'controls', 'hygiene', 'unused'] as const;
export const HealthCheck = z.enum(HEALTH_CHECKS);
export const HEALTH_LEVELS = ['healthy', 'watch', 'at_risk'] as const;
export const HealthLevel = z.enum(HEALTH_LEVELS);
export type HealthLevel = z.infer<typeof HealthLevel>;

export const HealthReason = named(
  'HealthReason',
  z
    .object({
      check: HealthCheck,
      level: HealthLevel,
      text: z.string().describe('One sentence an owner can act on.'),
    })
    .strict(),
);

export const BudgetHealthRow = named(
  'BudgetHealthRow',
  z
    .object({
      budgetId: Id,
      name: z.string(),
      ownerName: z.string().nullable(),
      status: BudgetStatus,
      level: HealthLevel.describe('Worst result across the five checks.'),
      reasons: z.array(HealthReason),
      authorized: Money,
      committed: Money.describe('Held + pre-encumbered + encumbered over the subtree.'),
      actual: Money,
      available: Money.describe('Company-wide Available over the subtree.'),
      utilizationBps: z.int(),
      pacedToDateBps: z.int().describe('Committed plus actual against the phased amount to date.'),
      lastActivityAt: IsoDateTime.nullable(),
    })
    .strict(),
);
export type BudgetHealthRow = z.infer<typeof BudgetHealthRow>;

export const HealthMatrixRow = named(
  'HealthMatrixRow',
  z
    .object({
      key: z.string(),
      label: z.string(),
      orgUnitId: Id.nullable(),
      budgetId: Id.nullable(),
      cells: z.record(z.string(), z.object({ watch: z.int(), atRisk: z.int() }).strict()),
    })
    .strict(),
);

export const HealthThresholds = named(
  'HealthThresholds',
  z
    .object({
      paceWatchBps: z.int(),
      paceAtRiskBps: z.int(),
      forecastWatchBps: z.int(),
      forecastAtRiskBps: z.int(),
      hygieneDays: z.int(),
      hygieneAtRiskMinor: z.int(),
      unusedWatchBps: z.int(),
      unusedDaysLeft: z.int(),
    })
    .strict()
    .describe('Company settings behind the five health checks; shown in the check tooltips.'),
);

export const BudgetHealthOverview = named(
  'BudgetHealthOverview',
  z
    .object({
      generatedAt: IsoDateTime,
      asOf: IsoDate,
      currency: CurrencyCode,
      scope: ReportScope,
      thresholds: HealthThresholds,
      summary: z
        .object({ budgets: z.int(), healthy: z.int(), watch: z.int(), atRisk: z.int() })
        .strict(),
      matrix: z.array(HealthMatrixRow),
      rows: z.array(BudgetHealthRow).describe('Budgets needing attention, worst first.'),
      reconciliation: ReportReconciliation,
    })
    .strict(),
);
export type BudgetHealthOverview = z.infer<typeof BudgetHealthOverview>;

export const BudgetHealthQuery = z
  .object({
    fiscalYearId: Id.optional(),
    rootBudgetId: Id.optional(),
    level: HealthLevel.optional(),
    check: HealthCheck.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

// 091 Saved views, scheduled delivery and exports ------------------------------------------------

export const CreateSavedViewRequest = named(
  'CreateSavedViewRequest',
  z
    .object({
      reportId: ReportId,
      name: z.string().trim().min(1).max(120),
      filters: ReportFilters,
      favourite: z.boolean().optional(),
    })
    .strict(),
);
export type CreateSavedViewRequest = z.infer<typeof CreateSavedViewRequest>;

export const SavedReportViewList = named(
  'SavedReportViewList',
  z.object({ items: z.array(SavedReportView) }).strict(),
);

export const SCHEDULE_FREQUENCIES = [
  'daily_weekdays',
  'weekly',
  'monthly',
  'monthly_after_close',
] as const;
export const ScheduleFrequency = z.enum(SCHEDULE_FREQUENCIES);
export type ScheduleFrequency = z.infer<typeof ScheduleFrequency>;

export const SCHEDULE_RUN_STATUSES = ['queued', 'delivered', 'partly_delivered', 'failed'] as const;
export const ScheduleRunStatus = z.enum(SCHEDULE_RUN_STATUSES);

export const ScheduleChannel = named(
  'ScheduleChannel',
  z
    .object({
      provider: z.enum(['slack', 'teams']),
      channel: z
        .string()
        .trim()
        .min(2)
        .max(80)
        .describe('Channel name; must be allowed by the chat installation (061e).'),
    })
    .strict()
    .describe('Channels receive headline figures and a sign-in link, never a file.'),
);
export type ScheduleChannel = z.infer<typeof ScheduleChannel>;

export const ScheduleRecipient = named(
  'ScheduleRecipient',
  z
    .object({
      personId: Id,
      name: z.string(),
      email: z.string().describe('Directory address; external addresses are refused.'),
      hasAccess: z
        .boolean()
        .describe('Whether the recipient can see the same data in BudgetFlow right now.'),
      skipReason: z.string().nullable(),
    })
    .strict(),
);
export type ScheduleRecipient = z.infer<typeof ScheduleRecipient>;

export const ReportSchedule = named(
  'ReportSchedule',
  z
    .object({
      id: Id,
      name: z.string(),
      reportId: ReportId,
      reportName: z.string(),
      savedViewId: Id.nullable(),
      filters: ReportFilters,
      formats: z.array(ReportFormat),
      frequency: ScheduleFrequency,
      weekday: z.int().min(0).max(6).nullable().describe('0 = Sunday; weekly schedules only.'),
      dayOfMonth: z.int().min(1).max(28).nullable(),
      sendTime: z.string().describe('HH:MM in the schedule timezone.'),
      timezone: z.string(),
      message: z.string().nullable(),
      recipients: z.array(ScheduleRecipient),
      channels: z.array(ScheduleChannel),
      ownerPersonId: Id.nullable(),
      ownerName: z.string().nullable(),
      active: z.boolean(),
      pausedReason: z.string().nullable(),
      nextRunAt: IsoDateTime.nullable(),
      lastRunAt: IsoDateTime.nullable(),
      lastRunStatus: ScheduleRunStatus.nullable(),
      createdAt: IsoDateTime,
    })
    .strict()
    .describe('Runs with its owner\u2019s access; recipients without that access are skipped.'),
);
export type ReportSchedule = z.infer<typeof ReportSchedule>;

export const ReportScheduleList = named(
  'ReportScheduleList',
  z.object({ items: z.array(ReportSchedule) }).strict(),
);

export const CreateScheduleRequest = named(
  'CreateScheduleRequest',
  z
    .object({
      name: z.string().trim().min(1).max(120),
      reportId: ReportId,
      savedViewId: Id.optional(),
      filters: ReportFilters,
      formats: z.array(ReportFormat).min(1).max(3),
      frequency: ScheduleFrequency,
      weekday: z.int().min(0).max(6).optional(),
      dayOfMonth: z.int().min(1).max(28).optional(),
      sendTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .default('08:00'),
      timezone: z.string().trim().min(1).max(60).optional(),
      recipientPersonIds: z.array(Id).max(50).optional(),
      channels: z.array(ScheduleChannel).max(10).optional(),
      message: z.string().trim().max(500).optional(),
    })
    .strict()
    .describe('At least one recipient or channel, and at least one format.'),
);
export type CreateScheduleRequest = z.infer<typeof CreateScheduleRequest>;

export const UpdateScheduleRequest = named(
  'UpdateScheduleRequest',
  z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      filters: ReportFilters.optional(),
      formats: z.array(ReportFormat).min(1).max(3).optional(),
      frequency: ScheduleFrequency.optional(),
      weekday: z.int().min(0).max(6).nullable().optional(),
      dayOfMonth: z.int().min(1).max(28).nullable().optional(),
      sendTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional(),
      timezone: z.string().trim().min(1).max(60).optional(),
      recipientPersonIds: z.array(Id).max(50).optional(),
      channels: z.array(ScheduleChannel).max(10).optional(),
      message: z.string().trim().max(500).nullable().optional(),
      active: z.boolean().optional(),
    })
    .strict(),
);
export type UpdateScheduleRequest = z.infer<typeof UpdateScheduleRequest>;

export const ScheduleRun = named(
  'ScheduleRun',
  z
    .object({
      id: Id,
      scheduleId: Id,
      runAt: IsoDateTime,
      status: ScheduleRunStatus,
      trigger: z.enum(['scheduled', 'manual']),
      deliveredCount: z.int(),
      skippedCount: z.int(),
      channelCount: z.int(),
      rowCount: z.int(),
      skipped: z.array(z.object({ personId: Id, name: z.string(), reason: z.string() }).strict()),
      exportIds: z.array(Id),
      error: z.string().nullable(),
    })
    .strict(),
);
export type ScheduleRun = z.infer<typeof ScheduleRun>;

export const ScheduleRunList = named(
  'ScheduleRunList',
  z.object({ items: z.array(ScheduleRun) }).strict(),
);

export const REPORT_EXPORT_STATUSES = ['queued', 'running', 'ready', 'failed', 'expired'] as const;
export const ReportExportStatus = z.enum(REPORT_EXPORT_STATUSES);

export const ReportExport = named(
  'ReportExport',
  z
    .object({
      id: Id,
      reportId: ReportId,
      reportName: z.string(),
      format: ReportFormat,
      filters: ReportFilters,
      rowCount: z.int(),
      status: ReportExportStatus,
      sizeBytes: z.int().nullable(),
      requestedByName: z.string().nullable(),
      requestedAt: IsoDateTime,
      expiresAt: IsoDateTime,
      scheduleId: Id.nullable(),
    })
    .strict()
    .describe('Download links expire after 7 days.'),
);
export type ReportExport = z.infer<typeof ReportExport>;

export const ReportExportList = named(
  'ReportExportList',
  z.object({ items: z.array(ReportExport) }).strict(),
);

export const CreateExportRequest = named(
  'CreateExportRequest',
  z.object({ format: ReportFormat, filters: ReportFilters }).strict(),
);
export type CreateExportRequest = z.infer<typeof CreateExportRequest>;

const ReportParams = z.object({ reportId: ReportId }).strict();
const ScheduleParams = z.object({ scheduleId: Id }).strict();
const ViewParams = z.object({ viewId: Id }).strict();

export const reportEndpoints = {
  getReportCatalog: {
    operationId: 'getReportCatalog',
    method: 'get',
    path: '/api/reports',
    summary: 'Report catalog the viewer may open, with their saved views',
    tags: ['reports'],
    auth: true,
    response: { status: 200, schema: ReportCatalog },
    errors: [401, 403],
  },
  runReport: {
    operationId: 'runReport',
    method: 'get',
    path: '/api/reports/{reportId}/run',
    summary: 'Run a report in the shared frame, scoped to the viewer',
    tags: ['reports'],
    auth: true,
    params: ReportParams,
    query: ReportRunQuery,
    response: { status: 200, schema: ReportResult },
    errors: [400, 401, 403, 404, 422],
  },
  drillDownReport: {
    operationId: 'drillDownReport',
    method: 'get',
    path: '/api/reports/{reportId}/drilldown',
    summary: 'The ledger lines behind one report figure',
    tags: ['reports'],
    auth: true,
    params: ReportParams,
    query: ReportDrilldownQuery,
    response: { status: 200, schema: ReportDrilldown },
    errors: [400, 401, 403, 404],
  },
  getBudgetHealth: {
    operationId: 'getBudgetHealth',
    method: 'get',
    path: '/api/dashboards/health',
    summary: 'Budget health overview: five written checks per budget',
    tags: ['reports'],
    auth: true,
    query: BudgetHealthQuery,
    response: { status: 200, schema: BudgetHealthOverview },
    errors: [400, 401, 403, 404],
  },
  listSavedViews: {
    operationId: 'listSavedViews',
    method: 'get',
    path: '/api/reports/views',
    summary: "The viewer's saved report views",
    tags: ['reports'],
    auth: true,
    response: { status: 200, schema: SavedReportViewList },
    errors: [401, 403],
  },
  createSavedView: {
    operationId: 'createSavedView',
    method: 'post',
    path: '/api/reports/views',
    summary: 'Save the current filters as a view',
    tags: ['reports'],
    auth: true,
    idempotent: true,
    body: CreateSavedViewRequest,
    response: { status: 201, schema: SavedReportView },
    errors: [400, 401, 403, 409, 422],
  },
  deleteSavedView: {
    operationId: 'deleteSavedView',
    method: 'delete',
    path: '/api/reports/views/{viewId}',
    summary: 'Delete a saved view',
    tags: ['reports'],
    auth: true,
    idempotent: true,
    params: ViewParams,
    response: { status: 200, schema: SavedReportViewList },
    errors: [400, 401, 403, 404],
  },
  listReportSchedules: {
    operationId: 'listReportSchedules',
    method: 'get',
    path: '/api/reports/schedules',
    summary: 'Scheduled report deliveries the viewer may see',
    tags: ['reports'],
    auth: true,
    response: { status: 200, schema: ReportScheduleList },
    errors: [401, 403],
  },
  createReportSchedule: {
    operationId: 'createReportSchedule',
    method: 'post',
    path: '/api/reports/schedules',
    summary: 'Schedule a report for email and chat delivery',
    tags: ['reports'],
    auth: true,
    idempotent: true,
    body: CreateScheduleRequest,
    response: { status: 201, schema: ReportSchedule },
    errors: [400, 401, 403, 404, 409, 422],
  },
  updateReportSchedule: {
    operationId: 'updateReportSchedule',
    method: 'patch',
    path: '/api/reports/schedules/{scheduleId}',
    summary: 'Change, pause or resume a schedule',
    tags: ['reports'],
    auth: true,
    idempotent: true,
    params: ScheduleParams,
    body: UpdateScheduleRequest,
    response: { status: 200, schema: ReportSchedule },
    errors: [400, 401, 403, 404, 409, 422],
  },
  deleteReportSchedule: {
    operationId: 'deleteReportSchedule',
    method: 'delete',
    path: '/api/reports/schedules/{scheduleId}',
    summary: 'Delete a schedule',
    tags: ['reports'],
    auth: true,
    idempotent: true,
    params: ScheduleParams,
    response: { status: 200, schema: ReportScheduleList },
    errors: [400, 401, 403, 404],
  },
  runReportSchedule: {
    operationId: 'runReportSchedule',
    method: 'post',
    path: '/api/reports/schedules/{scheduleId}/runs',
    summary: 'Run a schedule now (delivery happens in the worker)',
    tags: ['reports'],
    auth: true,
    idempotent: true,
    params: ScheduleParams,
    response: { status: 202, schema: ScheduleRun },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listScheduleRuns: {
    operationId: 'listScheduleRuns',
    method: 'get',
    path: '/api/reports/schedules/{scheduleId}/runs',
    summary: 'Delivery history of a schedule, newest first',
    tags: ['reports'],
    auth: true,
    params: ScheduleParams,
    response: { status: 200, schema: ScheduleRunList },
    errors: [401, 403, 404],
  },
  createReportExport: {
    operationId: 'createReportExport',
    method: 'post',
    path: '/api/reports/{reportId}/exports',
    summary: 'Export a report run (CSV, XLSX or PDF)',
    tags: ['reports'],
    auth: true,
    idempotent: true,
    params: ReportParams,
    body: CreateExportRequest,
    response: { status: 201, schema: ReportExport },
    errors: [400, 401, 403, 404, 422],
  },
  listReportExports: {
    operationId: 'listReportExports',
    method: 'get',
    path: '/api/reports/exports',
    summary: 'Recent exports with their status and expiry',
    tags: ['reports'],
    auth: true,
    response: { status: 200, schema: ReportExportList },
    errors: [401, 403],
  },
} as const satisfies Record<string, Endpoint>;
