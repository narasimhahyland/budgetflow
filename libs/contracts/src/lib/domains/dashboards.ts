import { z } from 'zod';
import { BudgetStatus, CurrencyCode, Id, IsoDate, IsoDateTime, Money } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';
import { CloseEntityChecklist, ClosePeriodSummary } from './close';
import { ReportScope } from './reports';

/**
 * Gap package B2: the dashboards the plan lists (012, 017, 017a). Every figure is computed by the
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
} as const satisfies Record<string, Endpoint>;
