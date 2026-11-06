import { z } from 'zod';
import {
  BudgetStatus,
  BudgetType,
  CurrencyCode,
  ForecastMethod,
  Id,
  IsoDate,
  IsoDateTime,
  Money,
  RateType,
} from '../common';
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
  // Phase 11: forecast snapshots joined to the ledger (087).
  'forecast-variance',
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
      /** 087 only. Omitted means the latest accepted forecast per budget. */
      forecastCycleId: Id.optional().describe(
        'Report the forecasts of this cycle, for example "October reforecast".',
      ),
      compareCycleId: Id.optional().describe(
        'Add "Previous forecast" and "Change" columns from an earlier cycle.',
      ),
      forecastMethod: ForecastMethod.optional(),
      commentaryRequiredOnly: z
        .enum(['true', 'false'])
        .optional()
        .describe('Only the rows whose variance is above the cycle threshold.'),
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
      notes: z
        .array(z.string())
        .describe(
          'Plain-English statements the frame shows as banners, for example "No accepted forecast yet; showing run-rate forecasts".',
        ),
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

// 016a Board and FP&A pack -----------------------------------------------------------------------

export const BOARD_PACK_PAGES = [
  'summary',
  'legal_entity',
  'region',
  'function',
  'category',
  'period',
  'variance_fx',
  'top_commitments',
  'controls_applied',
  'exceptions',
  'cofunding',
] as const;
export const BoardPackPageId = z
  .enum(BOARD_PACK_PAGES)
  .describe('Fixed building blocks of the pack; they can be toggled and reordered, not rewritten.');
export type BoardPackPageId = z.infer<typeof BoardPackPageId>;

export const BoardPackSource = named(
  'BoardPackSource',
  z
    .object({
      kind: z.enum(['close_snapshot', 'open_period_draft']),
      fiscalPeriodId: Id,
      periodLabel: z.string(),
      snapshotVersion: z
        .int()
        .nullable()
        .describe('Version of the close snapshot; null for an open-period draft.'),
      takenAt: IsoDateTime.nullable(),
      draft: z
        .boolean()
        .describe('True for an open period: every page and the PDF carry a "Draft" watermark.'),
      statement: z
        .string()
        .describe('The sentence the cover page prints about where the figures came from.'),
    })
    .strict()
    .describe('Where the pack read its numbers. A closed period reads an immutable snapshot.'),
);
export type BoardPackSource = z.infer<typeof BoardPackSource>;

export const BoardPackPage = named(
  'BoardPackPage',
  z
    .object({
      page: BoardPackPageId,
      title: z.string(),
      statement: z
        .string()
        .nullable()
        .describe(
          'Shown instead of rows when the page has no data, for example "No controls applied in October 2026".',
        ),
      columns: z.array(ReportColumn),
      rows: z
        .array(ReportRow)
        .describe('Ordered by label then key, so a regenerated pack matches.'),
      totals: ReportRow.nullable(),
      series: z.array(ReportSeries),
    })
    .strict(),
);
export type BoardPackPage = z.infer<typeof BoardPackPage>;

export const FxBridgeRow = named(
  'FxBridgeRow',
  z
    .object({
      transactionCurrency: CurrencyCode,
      transaction: Money.describe('Spend as posted, in its transaction currency.'),
      atPlanRate: Money.describe(
        'The same spend at the locked plan rate: the rate budget control uses.',
      ),
      atReportingRate: Money.describe('The same spend at the reporting rate type.'),
      fxEffect: Money.describe('At reporting rate − at plan rate.'),
      planRate: z.string().nullable().describe('The plan cross rate applied, 12 decimals.'),
      note: z.string().describe('"Not part of spend or variance; FX never consumes budget."'),
    })
    .strict(),
);
export type FxBridgeRow = z.infer<typeof FxBridgeRow>;

export const FxBridge = named(
  'FxBridge',
  z
    .object({
      reportingRateType: RateType.describe(
        'The company\u2019s reporting rate type; monthly average by default.',
      ),
      rows: z.array(FxBridgeRow).describe('One row per transaction currency, ordered by code.'),
      totalEffect: Money,
      note: z.string(),
    })
    .strict()
    .describe(
      'Why a constant-currency total differs from the reported one. The effect is bridged on its own and never enters spend, variance or any budget bucket.',
    ),
);
export type FxBridge = z.infer<typeof FxBridge>;

export const BoardPack = named(
  'BoardPack',
  z
    .object({
      generatedAt: IsoDateTime,
      currency: CurrencyCode,
      title: z
        .string()
        .describe('Cover title, for example "Hyland \u2014 budget pack \u2014 October 2026".'),
      source: BoardPackSource,
      constantCurrency: z.boolean(),
      scope: ReportScope,
      pages: z.array(BoardPackPage),
      fxBridge: FxBridge,
      reconciliation: ReportReconciliation,
      notes: z.array(z.string()),
    })
    .strict()
    .describe('The pack as the builder previews it and the generation job renders it.'),
);
export type BoardPack = z.infer<typeof BoardPack>;

export const BoardPackQuery = z
  .object({
    fiscalPeriodId: Id.optional().describe('Defaults to the latest closed period.'),
    draft: z
      .enum(['true', 'false'])
      .optional()
      .describe('Read the current open period instead; every page is watermarked "Draft".'),
    pages: z
      .string()
      .optional()
      .describe('Comma-separated page ids in the order wanted; omitted means every page.'),
    constantCurrency: z.enum(['true', 'false']).optional(),
    rootBudgetId: Id.optional(),
    forecastCycleId: Id.optional(),
  })
  .strict();

export const BOARD_PACK_STATUSES = ['queued', 'running', 'ready', 'failed', 'expired'] as const;
export const BoardPackStatus = z.enum(BOARD_PACK_STATUSES);
export type BoardPackStatus = z.infer<typeof BoardPackStatus>;

export const BoardPackFile = named(
  'BoardPackFile',
  z
    .object({
      format: z.enum(['pdf', 'xlsx']),
      fileName: z.string(),
      sizeBytes: z.int().min(0),
      sha256: z.string(),
    })
    .strict()
    .describe('A rendered file in the DocumentStore under a tenant-scoped key.'),
);
export type BoardPackFile = z.infer<typeof BoardPackFile>;

export const BoardPackGeneration = named(
  'BoardPackGeneration',
  z
    .object({
      id: Id,
      status: BoardPackStatus,
      source: BoardPackSource,
      pages: z.array(BoardPackPageId),
      formats: z.array(z.enum(['pdf', 'xlsx'])),
      constantCurrency: z.boolean(),
      currency: CurrencyCode,
      pageCount: z.int().min(0),
      rowCount: z.int().min(0),
      files: z.array(BoardPackFile),
      failedPage: BoardPackPageId.nullable(),
      error: z.string().nullable(),
      requestedByName: z.string().nullable(),
      requestedAt: IsoDateTime,
      completedAt: IsoDateTime.nullable(),
      expiresAt: IsoDateTime.describe(
        'Download links stop working after this; the pack is regenerated.',
      ),
    })
    .strict()
    .describe(
      'A pack generation. Rendering runs in the worker; the files land in the DocumentStore.',
    ),
);
export type BoardPackGeneration = z.infer<typeof BoardPackGeneration>;

export const BoardPackGenerationList = named(
  'BoardPackGenerationList',
  z.object({ items: z.array(BoardPackGeneration) }).strict(),
);

export const CreateBoardPackRequest = named(
  'CreateBoardPackRequest',
  z
    .object({
      fiscalPeriodId: Id.optional(),
      draft: z.boolean().optional(),
      pages: z.array(BoardPackPageId).min(1).max(BOARD_PACK_PAGES.length).optional(),
      formats: z
        .array(z.enum(['pdf', 'xlsx']))
        .min(1)
        .max(2)
        .optional(),
      constantCurrency: z.boolean().optional(),
      rootBudgetId: Id.optional(),
      forecastCycleId: Id.optional(),
    })
    .strict()
    .describe('Queues a generation. Defaults: the latest closed period, every page, PDF and XLSX.'),
);
export type CreateBoardPackRequest = z.infer<typeof CreateBoardPackRequest>;

export const BoardPackDownload = named(
  'BoardPackDownload',
  z
    .object({ url: z.string(), fileName: z.string(), expiresAt: IsoDateTime })
    .strict()
    .describe('A short-lived signed URL for one rendered file.'),
);
export type BoardPackDownload = z.infer<typeof BoardPackDownload>;

const ReportParams = z.object({ reportId: ReportId }).strict();
const ScheduleParams = z.object({ scheduleId: Id }).strict();
const ViewParams = z.object({ viewId: Id }).strict();
const GenerationParams = z.object({ generationId: Id }).strict();

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
  getBoardPack: {
    operationId: 'getBoardPack',
    method: 'get',
    path: '/api/reports/board-pack',
    summary: 'Preview the board and FP&A pack from a close snapshot or the open period',
    tags: ['reports'],
    auth: true,
    query: BoardPackQuery,
    response: { status: 200, schema: BoardPack },
    errors: [400, 401, 403, 404, 409, 422],
  },
  createBoardPackGeneration: {
    operationId: 'createBoardPackGeneration',
    method: 'post',
    path: '/api/reports/board-pack/generations',
    summary: 'Generate the pack in the background into the DocumentStore',
    tags: ['reports'],
    auth: true,
    idempotent: true,
    body: CreateBoardPackRequest,
    response: { status: 202, schema: BoardPackGeneration },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listBoardPackGenerations: {
    operationId: 'listBoardPackGenerations',
    method: 'get',
    path: '/api/reports/board-pack/generations',
    summary: 'Pack generations with their status, newest first',
    tags: ['reports'],
    auth: true,
    response: { status: 200, schema: BoardPackGenerationList },
    errors: [401, 403],
  },
  getBoardPackGeneration: {
    operationId: 'getBoardPackGeneration',
    method: 'get',
    path: '/api/reports/board-pack/generations/{generationId}',
    summary: 'One pack generation, with the files it rendered',
    tags: ['reports'],
    auth: true,
    params: GenerationParams,
    response: { status: 200, schema: BoardPackGeneration },
    errors: [400, 401, 403, 404],
  },
  downloadBoardPack: {
    operationId: 'downloadBoardPack',
    method: 'get',
    path: '/api/reports/board-pack/generations/{generationId}/download',
    summary: 'A short-lived signed URL for a rendered pack file',
    tags: ['reports'],
    auth: true,
    params: GenerationParams,
    query: z.object({ format: z.enum(['pdf', 'xlsx']) }).strict(),
    response: { status: 200, schema: BoardPackDownload },
    errors: [400, 401, 403, 404, 409],
  },
} as const satisfies Record<string, Endpoint>;
