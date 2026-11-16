import { z } from 'zod';
import { BudgetStatus, CurrencyCode, Id, IsoDate, IsoDateTime, Money } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';
import { CloseEntityChecklist, ClosePeriodSummary } from './close';
import { ReportScope } from './reports';

/**
 * Gap package B2: the dashboards the plan lists (012, 017, 017a, 018, 018a, 018b, 088a). Every figure is computed by the
 * API from the ledger, the queues and the integrity runs; the pages only arrange them. Each read
 * asks `PolicyService` first and filters in SQL under RLS.
 */

// 012 Finance controller dashboard ------------------------------------------------------------

export const FinanceQueueTile = named(
  'FinanceQueueTile',
  z
    .object({
      key: z.enum([
        'unmatched_actuals',
        'post_spend_exceptions',
        'accrual_proposals',
        'recharges_pending_tax',
        'stale_commitments',
        'escalated_approvals',
      ]),
      label: z.string(),
      count: z.int().min(0),
      amount: Money.nullable().describe(
        'Total in the reporting currency; null for count-only tiles.',
      ),
      oldestDays: z.int().min(0).nullable().describe('Age of the oldest item in days.'),
      detail: z.string().describe('One plain-English sentence for the tile.'),
      link: z.string().describe('Route of the queue that clears it.'),
    })
    .strict(),
);
export type FinanceQueueTile = z.infer<typeof FinanceQueueTile>;

export const FinanceRechargeStatus = named(
  'FinanceRechargeStatus',
  z
    .object({
      legalEntityId: Id,
      pendingTaxApproval: z.int().min(0),
      awaitingPosting: z.int().min(0).describe('Approved or scheduled, not yet posted.'),
      posted: z.int().min(0),
    })
    .strict()
    .describe('Recharges due in the closing period where the entity pays or receives.'),
);

export const FinanceIntegrity = named(
  'FinanceIntegrity',
  z
    .object({
      lastRun: z
        .object({
          id: Id,
          status: z.enum(['queued', 'running', 'clean', 'drift_detected', 'failed']),
          trigger: z.string(),
          requestedAt: IsoDateTime,
          finishedAt: IsoDateTime.nullable(),
          budgetsChecked: z.int().min(0).nullable(),
          driftCount: z.int().min(0),
        })
        .strict()
        .nullable(),
      auditChain: z
        .object({ valid: z.boolean(), checked: z.int().min(0), brokenAt: z.int().nullable() })
        .strict()
        .nullable()
        .describe('Audit hash-chain result of the last check.'),
      openLedgerFlags: z
        .int()
        .min(0)
        .describe(
          'Open ledger_drift, journal_unbalanced, negative_bucket, triplet_mismatch flags.',
        ),
    })
    .strict(),
);

export const FinanceFeed = named(
  'FinanceFeed',
  z
    .object({
      source: z.string(),
      label: z.string(),
      lastImportAt: IsoDateTime.nullable(),
      expectedEveryHours: z.int().min(1),
      lateByHours: z.int().min(0).nullable().describe('Null when on time.'),
    })
    .strict(),
);

export const FinanceOverview = named(
  'FinanceOverview',
  z
    .object({
      generatedAt: IsoDateTime,
      asOf: IsoDate,
      currency: CurrencyCode,
      close: z
        .array(
          z
            .object({ period: ClosePeriodSummary, entities: z.array(CloseEntityChecklist) })
            .strict(),
        )
        .describe(
          'Per fiscal calendar, the period being closed (the oldest open or soft-closed period that has ended, else the current one) with its entity checklists.',
        ),
      recharges: z.array(FinanceRechargeStatus),
      allClear: z.boolean().describe('Every check passes for every entity.'),
      tiles: z.array(FinanceQueueTile),
      integrity: FinanceIntegrity.nullable().describe('Null when the viewer lacks integrity.read.'),
      feeds: z.array(FinanceFeed),
      fx: z
        .object({
          total: Money,
          byCurrency: z.array(z.object({ currency: CurrencyCode, effect: Money }).strict()),
          fiscalYearLabel: z.string().nullable(),
        })
        .strict()
        .describe('FX effect of actuals this fiscal year; never part of spend or available.'),
    })
    .strict(),
);
export type FinanceOverview = z.infer<typeof FinanceOverview>;

// 017 Alerts dashboard ------------------------------------------------------------------------

export const ALERT_KINDS = [
  'threshold',
  'hard_block',
  'pace',
  'forecast',
  'lapse',
  'frozen',
  'set_to_zero',
  'approvals_overdue',
  'stale_commitments',
] as const;
export const AlertKind = z.enum(ALERT_KINDS);
export type AlertKind = z.infer<typeof AlertKind>;
export const ALERT_SEVERITIES = ['hard_block', 'warning', 'information'] as const;
export const AlertSeverity = z.enum(ALERT_SEVERITIES);
export type AlertSeverity = z.infer<typeof AlertSeverity>;
export const ALERT_TABS = ['open', 'acknowledged', 'resolved'] as const;
export const AlertTab = z.enum(ALERT_TABS);
export type AlertTab = z.infer<typeof AlertTab>;

export const BudgetAlert = named(
  'BudgetAlert',
  z
    .object({
      key: z
        .string()
        .max(200)
        .describe(
          'Stable key: kind, budget and band. A worsening condition produces a new key, so it is raised again.',
        ),
      kind: AlertKind,
      severity: AlertSeverity,
      tone: z.enum(['error', 'warning', 'info', 'important']),
      budgetId: Id,
      budgetName: z.string(),
      budgetStatus: BudgetStatus,
      ownerName: z.string().nullable(),
      text: z.string().describe('What it means, in one sentence.'),
      rule: z.string().describe('The rule or threshold that raised it.'),
      raisedAt: IsoDateTime.nullable(),
      action: z.object({ label: z.string(), link: z.string() }).strict(),
      snoozable: z.boolean().describe('Hard-block alerts cannot be snoozed.'),
      acknowledgedAt: IsoDateTime.nullable(),
      snoozedUntil: IsoDateTime.nullable(),
      resolvedAt: IsoDateTime.nullable().describe(
        'Resolved tab only: when you last saw it raised.',
      ),
      owned: z.boolean().describe('The viewer owns or co-owns the budget.'),
    })
    .strict(),
);
export type BudgetAlert = z.infer<typeof BudgetAlert>;

export const AlertsOverview = named(
  'AlertsOverview',
  z
    .object({
      generatedAt: IsoDateTime,
      asOf: IsoDate,
      currency: CurrencyCode,
      scope: ReportScope,
      tab: AlertTab,
      counts: z
        .object({ open: z.int(), acknowledged: z.int(), resolved: z.int() })
        .strict()
        .describe('Per tab, before the type and severity filters.'),
      severity: z
        .object({ hardBlock: z.int(), warning: z.int(), information: z.int() })
        .strict()
        .describe('Open alerts by severity, after filters.'),
      items: z.array(BudgetAlert),
    })
    .strict(),
);
export type AlertsOverview = z.infer<typeof AlertsOverview>;

export const AlertsQuery = z
  .object({
    tab: AlertTab.optional(),
    kind: AlertKind.optional(),
    severity: AlertSeverity.optional(),
    ownedOnly: z.enum(['true', 'false']).optional().describe('Only budgets I own.'),
  })
  .strict();

export const AlertDecisionRequest = named(
  'AlertDecisionRequest',
  z
    .object({
      key: z.string().min(1).max(200),
      decision: z.enum(['acknowledge', 'snooze']),
    })
    .strict()
    .describe(
      'Acknowledge or snooze one alert for yourself. It does not change the budget; snoozing lasts 7 days.',
    ),
);
export type AlertDecisionRequest = z.infer<typeof AlertDecisionRequest>;

// 017a Exceptions dashboard -------------------------------------------------------------------

export const CONTROL_EXCEPTION_TYPES = [
  'post_spend_breach',
  'split_request',
  'duplicate',
  'approved_over_budget',
  'approved_after_escalation',
  'late_posting',
  'missing_recharge',
  'just_under_threshold',
  'ledger_integrity',
] as const;
export const ControlExceptionType = z.enum(CONTROL_EXCEPTION_TYPES);
export type ControlExceptionType = z.infer<typeof ControlExceptionType>;

export const ExceptionTypeRow = named(
  'ExceptionTypeRow',
  z
    .object({
      type: ControlExceptionType,
      label: z.string(),
      source: z.string(),
      informational: z.boolean().describe('Counts for audit sampling, not work items.'),
      open: z.int().min(0),
      oldestDays: z.int().min(0).nullable(),
      atStake: Money.nullable(),
      queue: z.object({ label: z.string(), link: z.string() }).strict(),
      bands: z
        .object({ d0to7: z.int(), d8to30: z.int(), d31to60: z.int(), over60: z.int() })
        .strict()
        .describe('Open items by age band.'),
    })
    .strict(),
);
export type ExceptionTypeRow = z.infer<typeof ExceptionTypeRow>;

export const ExceptionItem = named(
  'ExceptionItem',
  z
    .object({
      id: z.string(),
      type: ControlExceptionType,
      reference: z.string(),
      summary: z.string(),
      location: z.string().nullable(),
      raisedAt: IsoDateTime,
      ageDays: z.int().min(0),
      atStake: Money.nullable(),
      link: z.string(),
    })
    .strict(),
);
export type ExceptionItem = z.infer<typeof ExceptionItem>;

export const ExceptionsOverview = named(
  'ExceptionsOverview',
  z
    .object({
      generatedAt: IsoDateTime,
      asOf: IsoDate,
      currency: CurrencyCode,
      fiscalYearLabel: z.string().nullable(),
      kpis: z
        .object({
          open: z.int(),
          informational: z.int(),
          olderThan14Days: z.int(),
          resolvedThisMonth: z.int(),
          atStake: Money,
        })
        .strict(),
      integrityFlagOpen: z.boolean().describe('Any ledger integrity or audit chain flag is open.'),
      withheld: z
        .array(ControlExceptionType)
        .describe('Types built from integrity flags, left out for viewers without integrity.read.'),
      types: z.array(ExceptionTypeRow),
      trend: z
        .array(z.object({ weekStart: IsoDate, opened: z.int(), resolved: z.int() }).strict())
        .describe('Work items opened and resolved per week, last 8 weeks.'),
      byLocation: z.array(
        z.object({ location: z.string(), open: z.int(), atStake: Money }).strict(),
      ),
      items: z
        .array(ExceptionItem)
        .describe('Open items of the selected type, oldest first; empty without a type.'),
    })
    .strict(),
);
export type ExceptionsOverview = z.infer<typeof ExceptionsOverview>;

export const ExceptionsQuery = z.object({ type: ControlExceptionType.optional() }).strict();

// 018 Pending approvals dashboard -----------------------------------------------------------------

export const SLA_STATES = ['within', 'due_today', 'breached'] as const;
export const SlaState = z.enum(SLA_STATES);
export type SlaState = z.infer<typeof SlaState>;
export const PENDING_KINDS = [
  'spending',
  'additional_fund',
  'over_budget',
  'budget',
  'exception',
  'co_funding',
] as const;
export const PendingKind = z.enum(PENDING_KINDS);
export type PendingKind = z.infer<typeof PendingKind>;

export const PendingApprovalItem = named(
  'PendingApprovalItem',
  z
    .object({
      taskId: Id,
      subjectType: z.enum(['request', 'contribution']),
      subjectId: Id,
      reference: z.string(),
      title: z.string(),
      kind: PendingKind,
      requesterName: z.string().nullable(),
      budgetId: Id.nullable(),
      budgetName: z.string().nullable(),
      amount: Money.nullable().describe(
        'Held amount in the reporting currency (pre-encumbered), or the requested amount when it is in the reporting currency.',
      ),
      transactionAmount: Money.nullable(),
      held: z
        .boolean()
        .describe('Pre-encumbered on the budget (requests); co-funding requests are not yet held.'),
      step: z.string(),
      stepNo: z.int(),
      approverPersonId: Id,
      approverName: z.string(),
      delegateName: z.string().nullable(),
      waitingHours: z.number(),
      dueAt: IsoDateTime.nullable(),
      sla: SlaState,
      slaText: z.string(),
      lastNotifiedChannel: z.string().nullable(),
      lastNudgedAt: IsoDateTime.nullable(),
      canNudge: z
        .boolean()
        .describe('False within 4 hours of the last nudge, or without permission.'),
    })
    .strict(),
);
export type PendingApprovalItem = z.infer<typeof PendingApprovalItem>;

export const PendingApprovalsOverview = named(
  'PendingApprovalsOverview',
  z
    .object({
      generatedAt: IsoDateTime,
      currency: CurrencyCode,
      scope: ReportScope,
      kpis: z
        .object({
          pending: z.int(),
          preEncumbered: Money.describe('Pending requests, held on their budgets.'),
          coFundingRequested: Money.describe('Co-funding requests: requested, not yet held.'),
          pastSla: z.int(),
          medianWaitHours: z.number().nullable(),
        })
        .strict(),
      bySteps: z.array(
        z
          .object({
            step: z.string(),
            within: z.int(),
            dueToday: z.int(),
            breached: z.int(),
          })
          .strict(),
      ),
      aging: z.array(
        z
          .object({
            approverPersonId: Id,
            approverName: z.string(),
            bands: z.array(z.object({ count: z.int(), amount: Money }).strict()).length(4),
            pastSla: z.int(),
          })
          .strict(),
      ),
      items: z.array(PendingApprovalItem),
    })
    .strict(),
);
export type PendingApprovalsOverview = z.infer<typeof PendingApprovalsOverview>;

export const PendingApprovalsQuery = z
  .object({
    kind: PendingKind.optional(),
    sla: SlaState.optional(),
    approverPersonId: Id.optional(),
  })
  .strict();

export const NudgeResponse = named(
  'NudgeResponse',
  z
    .object({
      taskId: Id,
      approverName: z.string(),
      channels: z.array(z.string()),
      nudgedAt: IsoDateTime,
      nextNudgeAt: IsoDateTime,
    })
    .strict(),
);
export type NudgeResponse = z.infer<typeof NudgeResponse>;

// 018a Approval performance -------------------------------------------------------------------

export const ApproverPerformance = named(
  'ApproverPerformance',
  z
    .object({
      approverPersonId: Id.nullable().describe('Null for the "Others" group.'),
      approverName: z.string(),
      step: z.string(),
      decisions: z.int(),
      medianHours: z.number().nullable(),
      p90Hours: z.number().nullable(),
      pastSla: z.int(),
      delegationsUsed: z.int(),
    })
    .strict(),
);
export type ApproverPerformance = z.infer<typeof ApproverPerformance>;

export const ApprovalPerformance = named(
  'ApprovalPerformance',
  z
    .object({
      generatedAt: IsoDateTime,
      periodDays: z.int(),
      view: z
        .enum(['named', 'aggregate', 'own'])
        .describe(
          'named: finance and the CEO; aggregate: analysts; own: an approver sees only themselves.',
        ),
      kpis: z
        .object({
          decisions: z.int(),
          medianHours: z.number().nullable(),
          p90Hours: z.number().nullable(),
          slaCompliancePct: z.number().nullable(),
          changesRequestedPct: z.number().nullable(),
          outsideWebPct: z.number().nullable(),
          targetHours: z.int(),
        })
        .strict(),
      smallSample: z.boolean().describe('Fewer than 30 decisions: medians may move a lot.'),
      byStep: z.array(
        z
          .object({
            step: z.string(),
            decisions: z.int(),
            medianHours: z.number().nullable(),
            p90Hours: z.number().nullable(),
          })
          .strict(),
      ),
      byChannel: z.array(
        z
          .object({
            channel: z.string(),
            decisions: z.int(),
            sharePct: z.number(),
            medianHours: z.number().nullable(),
          })
          .strict(),
      ),
      weekly: z.array(
        z
          .object({
            weekStart: IsoDate,
            decisions: z.int(),
            medianHours: z.number().nullable(),
            slaCompliancePct: z.number().nullable(),
          })
          .strict(),
      ),
      approvers: z
        .array(ApproverPerformance)
        .describe(
          'Ranked when at least 10 decisions; others grouped. Empty in the aggregate view.',
        ),
      own: z
        .object({
          decisions: z.int(),
          medianHours: z.number().nullable(),
          companyMedianHours: z.number().nullable(),
        })
        .strict()
        .nullable()
        .describe('The viewer as an approver, against the company median.'),
      suggestions: z
        .array(z.object({ text: z.string(), link: z.string() }).strict())
        .describe('Rules-based hints; nothing changes automatically.'),
    })
    .strict(),
);
export type ApprovalPerformance = z.infer<typeof ApprovalPerformance>;

export const ApprovalPerformanceQuery = z
  .object({ days: z.enum(['30', '90', '365']).optional() })
  .strict();

// 018b Product analytics ------------------------------------------------------------------------

export const ProductKpi = named(
  'ProductKpi',
  z
    .object({
      key: z.enum([
        'owner_activation',
        'weekly_active_owners',
        'time_to_first_allocation',
        'time_to_approve',
        'auto_match_rate',
        'unused_at_period_end',
      ]),
      label: z.string(),
      value: z.number().nullable(),
      unit: z.enum(['percent', 'days', 'hours']),
      detail: z.string(),
      target: z
        .object({
          value: z.number(),
          comparison: z.enum(['at_least', 'at_most']),
          text: z.string(),
        })
        .strict()
        .nullable(),
      status: z.enum(['on_target', 'below_target', 'no_target', 'insufficient']),
      definition: z.string(),
      events: z.array(z.string()),
    })
    .strict(),
);
export type ProductKpi = z.infer<typeof ProductKpi>;

export const ProductAnalytics = named(
  'ProductAnalytics',
  z
    .object({
      generatedAt: IsoDateTime,
      period: z.enum(['30', '90', 'fy']),
      from: IsoDate,
      to: IsoDate,
      insufficient: z
        .boolean()
        .describe('Fewer than 14 days or 20 owners of data: figures are shown with a warning.'),
      owners: z.int(),
      kpis: z.array(ProductKpi),
      funnel: z.array(z.object({ step: z.string(), count: z.int() }).strict()),
      weeklyActive: z.array(
        z.object({ weekStart: IsoDate, owners: z.int(), employees: z.int() }).strict(),
      ),
      decisionsByChannel: z.array(z.object({ channel: z.string(), decisions: z.int() }).strict()),
      autoMatchBySource: z.array(
        z.object({ source: z.string(), matched: z.int(), automatic: z.int() }).strict(),
      ),
    })
    .strict(),
);
export type ProductAnalytics = z.infer<typeof ProductAnalytics>;

export const ProductAnalyticsQuery = z
  .object({ period: z.enum(['30', '90', 'fy']).optional() })
  .strict();

// 088a Evidence pack ----------------------------------------------------------------------------

export const EVIDENCE_CONTENTS = [
  'summary',
  'approvals',
  'audit_trail',
  'contributions',
  'commitments',
  'actuals',
  'reconciliation',
  'exceptions',
  'comments',
] as const;
export const EvidenceContent = z.enum(EVIDENCE_CONTENTS);
export type EvidenceContent = z.infer<typeof EvidenceContent>;

export const CreateEvidencePackRequest = named(
  'CreateEvidencePackRequest',
  z
    .object({
      subjectType: z.enum(['event', 'budget']),
      subjectId: Id,
      contents: z
        .array(EvidenceContent)
        .min(1)
        .describe('Defaults on the screen: everything except comments.'),
      includeAttendees: z
        .boolean()
        .describe(
          'Off: attendee counts only. On: names, entities and cost centers; never needs or survey answers.',
        ),
    })
    .strict(),
);
export type CreateEvidencePackRequest = z.infer<typeof CreateEvidencePackRequest>;

export const EvidencePackFile = named(
  'EvidencePackFile',
  z.object({ name: z.string(), sizeBytes: z.int(), sha256: z.string().length(64) }).strict(),
);
export type EvidencePackFile = z.infer<typeof EvidencePackFile>;

export const EvidencePack = named(
  'EvidencePack',
  z
    .object({
      id: Id,
      subjectType: z.enum(['event', 'budget']),
      subjectId: Id,
      subjectLabel: z.string(),
      contents: z.array(EvidenceContent),
      includeAttendees: z.boolean(),
      status: z.enum(['queued', 'running', 'ready', 'failed', 'cancelled', 'expired']),
      step: z.string().nullable(),
      counts: z.record(z.string(), z.int()),
      requestedByName: z.string().nullable(),
      requestedAt: IsoDateTime,
      completedAt: IsoDateTime.nullable(),
      expiresAt: IsoDateTime,
      fileName: z.string().nullable(),
      sizeBytes: z.int().nullable(),
      manifest: z.array(EvidencePackFile),
      manifestSha256: z.string().nullable(),
      chain: z
        .object({
          valid: z.boolean(),
          fromSeq: z.int().nullable(),
          toSeq: z.int().nullable(),
          brokenAt: z.int().nullable(),
          checked: z.int(),
        })
        .strict()
        .nullable(),
      error: z.string().nullable(),
      canDownload: z.boolean(),
    })
    .strict(),
);
export type EvidencePack = z.infer<typeof EvidencePack>;

export const EvidencePackList = named(
  'EvidencePackList',
  z.object({ items: z.array(EvidencePack), canGenerate: z.boolean() }).strict(),
);
export type EvidencePackList = z.infer<typeof EvidencePackList>;

export const EvidencePackDownload = named(
  'EvidencePackDownload',
  z.object({ url: z.string(), fileName: z.string(), expiresAt: IsoDateTime }).strict(),
);
export type EvidencePackDownload = z.infer<typeof EvidencePackDownload>;

export const dashboardEndpoints = {
  getFinanceOverview: {
    operationId: 'getFinanceOverview',
    method: 'get',
    path: '/api/dashboards/finance',
    summary: 'Finance controller dashboard: close status, blocking queues, integrity, feeds, FX',
    tags: ['dashboards'],
    auth: true,
    response: { status: 200, schema: FinanceOverview },
    errors: [401, 403],
  },
  getAlerts: {
    operationId: 'getAlerts',
    method: 'get',
    path: '/api/dashboards/alerts',
    summary: 'Budget alerts on the budgets the viewer is responsible for',
    tags: ['dashboards'],
    auth: true,
    query: AlertsQuery,
    response: { status: 200, schema: AlertsOverview },
    errors: [400, 401, 403],
  },
  decideAlert: {
    operationId: 'decideAlert',
    method: 'post',
    path: '/api/dashboards/alerts/decisions',
    summary: 'Acknowledge or snooze an alert for yourself',
    tags: ['dashboards'],
    auth: true,
    idempotent: true,
    body: AlertDecisionRequest,
    response: { status: 200, schema: BudgetAlert },
    errors: [400, 401, 403, 404, 422],
  },
  getExceptions: {
    operationId: 'getExceptions',
    method: 'get',
    path: '/api/dashboards/exceptions',
    summary: 'Control exceptions by type and age, with the queue that works each',
    tags: ['dashboards'],
    auth: true,
    query: ExceptionsQuery,
    response: { status: 200, schema: ExceptionsOverview },
    errors: [400, 401, 403],
  },
  getPendingApprovals: {
    operationId: 'getPendingApprovals',
    method: 'get',
    path: '/api/dashboards/pending-approvals',
    summary: 'What is waiting for approval, at which step, with whom and how old',
    tags: ['dashboards'],
    auth: true,
    query: PendingApprovalsQuery,
    response: { status: 200, schema: PendingApprovalsOverview },
    errors: [400, 401, 403],
  },
  nudgeApprover: {
    operationId: 'nudgeApprover',
    method: 'post',
    path: '/api/dashboards/pending-approvals/{taskId}/nudge',
    summary: 'Remind the approver of one pending task (once per 4 hours); never decides',
    tags: ['dashboards'],
    auth: true,
    idempotent: true,
    params: z.object({ taskId: Id }).strict(),
    response: { status: 200, schema: NudgeResponse },
    errors: [400, 401, 403, 404, 409],
  },
  getApprovalPerformance: {
    operationId: 'getApprovalPerformance',
    method: 'get',
    path: '/api/dashboards/approval-performance',
    summary: 'Approval cycle time, SLA compliance, channel mix and bottlenecks',
    tags: ['dashboards'],
    auth: true,
    query: ApprovalPerformanceQuery,
    response: { status: 200, schema: ApprovalPerformance },
    errors: [400, 401, 403],
  },
  getProductAnalytics: {
    operationId: 'getProductAnalytics',
    method: 'get',
    path: '/api/analytics/kpis',
    summary: 'Product KPIs against targets from the analytics events (counts only)',
    tags: ['dashboards'],
    auth: true,
    query: ProductAnalyticsQuery,
    response: { status: 200, schema: ProductAnalytics },
    errors: [400, 401, 403],
  },
  listEvidencePacks: {
    operationId: 'listEvidencePacks',
    method: 'get',
    path: '/api/evidence-packs',
    summary: 'Evidence packs the viewer may see, newest first',
    tags: ['dashboards'],
    auth: true,
    response: { status: 200, schema: EvidencePackList },
    errors: [401, 403],
  },
  createEvidencePack: {
    operationId: 'createEvidencePack',
    method: 'post',
    path: '/api/evidence-packs',
    summary: 'Generate an evidence pack for an event or budget (worker job)',
    tags: ['dashboards'],
    auth: true,
    idempotent: true,
    body: CreateEvidencePackRequest,
    response: { status: 202, schema: EvidencePack },
    errors: [400, 401, 403, 404, 422],
  },
  getEvidencePack: {
    operationId: 'getEvidencePack',
    method: 'get',
    path: '/api/evidence-packs/{packId}',
    summary: 'One evidence pack with its progress, manifest and chain verification',
    tags: ['dashboards'],
    auth: true,
    params: z.object({ packId: Id }).strict(),
    response: { status: 200, schema: EvidencePack },
    errors: [400, 401, 403, 404],
  },
  downloadEvidencePack: {
    operationId: 'downloadEvidencePack',
    method: 'get',
    path: '/api/evidence-packs/{packId}/download',
    summary: 'A short-lived signed URL for a ready pack (audited)',
    tags: ['dashboards'],
    auth: true,
    params: z.object({ packId: Id }).strict(),
    response: { status: 200, schema: EvidencePackDownload },
    errors: [400, 401, 403, 404, 409],
  },
} as const satisfies Record<string, Endpoint>;
