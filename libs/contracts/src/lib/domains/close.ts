import { z } from 'zod';
import { CurrencyCode, Id, IsoDate, IsoDateTime, Money } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

const Reason = z.string().trim().min(1).max(500);
const ReasonCode = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$/)
  .describe('Reason code: letters, digits, dot, dash or underscore (up to 50).');
const PeriodParams = z.object({ periodId: Id }).strict();
const ReopenParams = z.object({ requestId: Id }).strict();
const RunParams = z.object({ runId: Id }).strict();
const RunLineParams = z.object({ runId: Id, lineId: Id }).strict();
const BudgetParams = z.object({ budgetId: Id }).strict();

// Period close checklist -------------------------------------------------------------------------

export const CLOSE_CHECK_CODES = [
  'gl_tieout_signed_off',
  'journals_balanced',
  'ledger_check_clean',
  'audit_chain_verified',
  'actuals_imported',
  'unmatched_actuals_cleared',
  'accruals_reviewed',
  'prepaids_recognized',
  'commitments_accrued',
] as const;
export const CloseCheckCode = z
  .enum(CLOSE_CHECK_CODES)
  .describe('Checklist check run per legal entity before a period closes.');
export type CloseCheckCode = z.infer<typeof CloseCheckCode>;

export const CloseCheckKind = z
  .enum(['hard', 'soft'])
  .describe('Hard checks block the close and cannot be acknowledged; soft checks can.');
export const CloseCheckStatus = z.enum(['pass', 'warn', 'fail']);

export const CloseCheckAcknowledgement = named(
  'CloseCheckAcknowledgement',
  z
    .object({
      id: Id,
      reasonCode: z.string(),
      reason: z.string(),
      acknowledgedByName: z.string().nullable(),
      acknowledgedAt: IsoDateTime,
    })
    .strict()
    .describe('A soft check accepted with a reason (append-only).'),
);
export type CloseCheckAcknowledgement = z.infer<typeof CloseCheckAcknowledgement>;

export const CloseCheck = named(
  'CloseCheck',
  z
    .object({
      code: CloseCheckCode,
      kind: CloseCheckKind,
      status: CloseCheckStatus,
      title: z.string(),
      detail: z.string().describe('Plain-English explanation of what passed or what blocks.'),
      count: z.int().min(0),
      amount: Money.nullable(),
      blocking: z
        .boolean()
        .describe('True when this check stops the close right now (hard and failing).'),
      acknowledgement: CloseCheckAcknowledgement.nullable(),
    })
    .strict(),
);
export type CloseCheck = z.infer<typeof CloseCheck>;

export const CloseEntityChecklist = named(
  'CloseEntityChecklist',
  z
    .object({
      legalEntityId: Id,
      legalEntityCode: z.string(),
      legalEntityName: z.string(),
      checks: z.array(CloseCheck),
      blocking: z.boolean(),
    })
    .strict()
    .describe('One row of the close checklist: every check for one legal entity.'),
);
export type CloseEntityChecklist = z.infer<typeof CloseEntityChecklist>;

export const PeriodSnapshotTotals = named(
  'PeriodSnapshotTotals',
  z
    .object({
      authorizedMinor: z.int(),
      allocatedOutMinor: z.int(),
      heldMinor: z.int(),
      preEncumberedMinor: z.int(),
      encumberedMinor: z.int(),
      actualMinor: z.int(),
      accruedMinor: z.int(),
    })
    .strict()
    .describe('As-of bucket totals in the reporting currency, cumulative to the period end.'),
);
export type PeriodSnapshotTotals = z.infer<typeof PeriodSnapshotTotals>;

export const PeriodSnapshot = named(
  'PeriodSnapshot',
  z
    .object({
      id: Id,
      fiscalPeriodId: Id,
      periodLabel: z.string(),
      legalEntityId: Id,
      legalEntityCode: z.string(),
      version: z.int().min(1).describe('Re-closing a reopened period takes the next version.'),
      currency: CurrencyCode,
      budgetCount: z.int().min(0),
      totals: PeriodSnapshotTotals,
      takenByName: z.string().nullable(),
      takenAt: IsoDateTime,
    })
    .strict()
    .describe('Immutable as-of balances taken when a period closed.'),
);
export type PeriodSnapshot = z.infer<typeof PeriodSnapshot>;

export const PeriodSnapshotList = named(
  'PeriodSnapshotList',
  z.object({ items: z.array(PeriodSnapshot) }).strict(),
);

export const ReopenRequest = named(
  'ReopenRequest',
  z
    .object({
      id: Id,
      fiscalPeriodId: Id,
      periodLabel: z.string(),
      action: z.enum(['reopen', 'unlock']),
      reasonCode: z.string(),
      reason: z.string(),
      requestedByPersonId: Id.nullable(),
      requestedByName: z.string().nullable(),
      requestedAt: IsoDateTime,
      status: z.enum(['pending', 'approved', 'declined']),
      decidedByName: z.string().nullable(),
      decidedAt: IsoDateTime.nullable(),
      decisionReason: z.string().nullable(),
    })
    .strict()
    .describe('Break-glass: reopening or unlocking a period needs two different people.'),
);
export type ReopenRequest = z.infer<typeof ReopenRequest>;

export const ClosePeriodSummary = named(
  'ClosePeriodSummary',
  z
    .object({
      id: Id,
      fiscalYearId: Id,
      fiscalYearLabel: z.string(),
      label: z.string(),
      periodNumber: z.int(),
      startDate: IsoDate,
      endDate: IsoDate,
      status: z.enum(['open', 'soft_closed', 'closed', 'locked']),
      targetCloseDate: IsoDate.nullable(),
      snapshotCount: z.int().min(0),
      lateItemCount: z.int().min(0),
      reopenRequestPending: z.boolean(),
    })
    .strict(),
);
export type ClosePeriodSummary = z.infer<typeof ClosePeriodSummary>;

export const ClosePeriodList = named(
  'ClosePeriodList',
  z.object({ items: z.array(ClosePeriodSummary) }).strict(),
);

export const ClosePeriodDetail = named(
  'ClosePeriodDetail',
  z
    .object({
      period: ClosePeriodSummary,
      entities: z.array(CloseEntityChecklist),
      blockingReasons: z
        .array(z.string())
        .describe('Why Close is unavailable right now, in plain English.'),
      allowedActions: z
        .array(z.enum(['soft_close', 'close', 'lock', 'reopen', 'unlock']))
        .describe('Status changes the actor may take now.'),
      snapshots: z.array(PeriodSnapshot),
      reopenRequest: ReopenRequest.nullable(),
      closeConfirmation: z
        .string()
        .describe('The phrase the close request must repeat, for example "CLOSE OCT 2026".'),
    })
    .strict(),
);
export type ClosePeriodDetail = z.infer<typeof ClosePeriodDetail>;

export const LateItem = named(
  'LateItem',
  z
    .object({
      journalId: Id,
      journalType: z.string(),
      accountingDate: IsoDate,
      originalPeriodId: Id.nullable(),
      originalPeriodLabel: z.string().nullable(),
      postedPeriodId: Id,
      postedPeriodLabel: z.string(),
      command: z.string(),
      amount: Money,
      createdAt: IsoDateTime,
    })
    .strict()
    .describe('A posting dated in this closed period that landed in the next open one.'),
);
export type LateItem = z.infer<typeof LateItem>;

export const LateItemList = named('LateItemList', z.object({ items: z.array(LateItem) }).strict());

export const AcknowledgeCheckRequest = named(
  'AcknowledgeCheckRequest',
  z
    .object({
      legalEntityId: Id,
      code: CloseCheckCode,
      reasonCode: ReasonCode,
      reason: Reason,
    })
    .strict()
    .describe('Accept a soft check with a reason. Hard checks cannot be acknowledged.'),
);

export const ClosePeriodRequest = named(
  'ClosePeriodRequest',
  z
    .object({
      confirmation: z
        .string()
        .trim()
        .min(1)
        .describe('Must equal `closeConfirmation` from the period detail.'),
    })
    .strict(),
);

export const PeriodStatusRequest = named(
  'PeriodStatusRequest',
  z.object({ reason: Reason.optional() }).strict(),
);

export const RequestReopenRequest = named(
  'RequestReopenRequest',
  z
    .object({
      action: z.enum(['reopen', 'unlock']),
      reasonCode: ReasonCode,
      reason: Reason,
    })
    .strict(),
);

export const ReopenDecisionRequest = named(
  'ReopenDecisionRequest',
  z
    .object({
      decision: z.enum(['approve', 'decline']),
      reason: Reason,
    })
    .strict()
    .describe('A second person decides; the requester may not approve their own request.'),
);

// Rollover policies ------------------------------------------------------------------------------

export const RolloverPolicy = named(
  'RolloverPolicy',
  z
    .object({
      id: Id,
      code: z.string(),
      name: z.string(),
      mode: z.enum(['lapse', 'carry_full', 'carry_capped', 'carry_with_approval']),
      capBps: z
        .int()
        .min(0)
        .nullable()
        .describe('Carry cap as basis points of authorized (carry_capped only).'),
      sweepTo: z.enum(['parent', 'corporate']),
      budgetCount: z.int().min(0),
    })
    .strict(),
);
export type RolloverPolicy = z.infer<typeof RolloverPolicy>;

export const RolloverPolicyList = named(
  'RolloverPolicyList',
  z.object({ items: z.array(RolloverPolicy) }).strict(),
);

export const AssignRolloverPolicyRequest = named(
  'AssignRolloverPolicyRequest',
  z.object({ rolloverPolicyId: Id.nullable(), reason: Reason }).strict(),
);

export const BudgetRolloverPolicy = named(
  'BudgetRolloverPolicy',
  z.object({ budgetId: Id, budgetName: z.string(), rolloverPolicyId: Id.nullable() }).strict(),
);

// Year-end run -----------------------------------------------------------------------------------

export const YEAR_END_LINE_STATUSES = [
  'planned',
  'awaiting_approval',
  'approved',
  'declined',
  'blocked',
  'executed',
] as const;
export const YearEndLineStatus = z.enum(YEAR_END_LINE_STATUSES);
export type YearEndLineStatus = z.infer<typeof YearEndLineStatus>;

export const YearEndLine = named(
  'YearEndLine',
  z
    .object({
      id: Id,
      budgetId: Id,
      budgetName: z.string(),
      budgetPath: z.string(),
      currency: CurrencyCode,
      availableMinor: z.int().describe('Available at the dry run, before any year-end posting.'),
      rolloverPolicyId: Id.nullable(),
      rolloverPolicyCode: z.string().nullable(),
      mode: z.enum(['lapse', 'carry_full', 'carry_capped', 'carry_with_approval']).nullable(),
      carryMinor: z.int().min(0),
      lapseMinor: z.int().min(0),
      sweepToBudgetId: Id.nullable(),
      sweepToName: z.string().nullable(),
      openCommitmentCount: z.int().min(0),
      openCommitmentMinor: z.int().min(0),
      targetBudgetId: Id.nullable().describe(
        'Counterpart budget in the target year, matched by code.',
      ),
      targetBudgetName: z.string().nullable(),
      status: YearEndLineStatus,
      blockedReason: z.string().nullable(),
      approvedCarryMinor: z.int().min(0).nullable(),
      decisionReason: z.string().nullable(),
      journalIds: z.array(Id),
    })
    .strict()
    .describe(
      'What one budget carries, lapses or sweeps at year end, and the commitments it keeps.',
    ),
);
export type YearEndLine = z.infer<typeof YearEndLine>;

export const YearEndReadinessCheck = named(
  'YearEndReadinessCheck',
  z
    .object({
      code: z.enum([
        'target_year_exists',
        'target_plan_rates_locked',
        'target_budgets_exist',
        'final_period_closed',
        'rollover_policies_assigned',
        'carry_approvals_decided',
      ]),
      title: z.string(),
      detail: z.string(),
      passed: z.boolean(),
      blocksExecution: z.boolean(),
    })
    .strict(),
);
export type YearEndReadinessCheck = z.infer<typeof YearEndReadinessCheck>;

export const YearEndTotals = named(
  'YearEndTotals',
  z
    .object({
      currency: CurrencyCode,
      carryMinor: z.int(),
      lapseMinor: z.int(),
      commitmentCarryMinor: z.int(),
      commitmentCount: z.int().min(0),
      budgetCount: z.int().min(0),
    })
    .strict(),
);
export type YearEndTotals = z.infer<typeof YearEndTotals>;

export const YearEndRun = named(
  'YearEndRun',
  z
    .object({
      id: Id,
      fiscalYearId: Id,
      fiscalYearLabel: z.string(),
      targetFiscalYearId: Id,
      targetFiscalYearLabel: z.string(),
      targetPlanVersionId: Id.nullable(),
      rootBudgetId: Id,
      rootBudgetName: z.string(),
      status: z.enum(['draft', 'dry_run', 'running', 'completed', 'failed']),
      commitmentFreezeDate: IsoDate.nullable(),
      createdByName: z.string().nullable(),
      createdAt: IsoDateTime,
      executedAt: IsoDateTime.nullable(),
      executedByName: z.string().nullable(),
      error: z.string().nullable(),
      readiness: z.array(YearEndReadinessCheck),
      totals: YearEndTotals,
      lines: z.array(YearEndLine),
      executeConfirmation: z.string().describe('For example "RUN YEAR END FY2026".'),
      journalIds: z.array(Id),
    })
    .strict(),
);
export type YearEndRun = z.infer<typeof YearEndRun>;

export const YearEndRunList = named(
  'YearEndRunList',
  z.object({ items: z.array(YearEndRun) }).strict(),
);

export const CreateYearEndRunRequest = named(
  'CreateYearEndRunRequest',
  z
    .object({
      rootBudgetId: Id.describe('Root budget of the year that is ending.'),
      targetFiscalYearId: Id,
      targetPlanVersionId: Id.nullable().optional(),
      commitmentFreezeDate: IsoDate.optional(),
    })
    .strict(),
);

export const YearEndCarryDecisionRequest = named(
  'YearEndCarryDecisionRequest',
  z
    .object({
      decision: z.enum(['approve', 'approve_part', 'decline']),
      approvedCarryMinor: z
        .int()
        .min(0)
        .optional()
        .describe('Required for approve_part; must not exceed the requested carry.'),
      reason: Reason,
    })
    .strict(),
);

export const ExecuteYearEndRequest = named(
  'ExecuteYearEndRequest',
  z
    .object({
      confirmation: z.string().trim().min(1).describe('Must equal `executeConfirmation`.'),
      accountingDate: IsoDate.optional().describe(
        'Accounting date for the postings in the year that is ending; defaults to its last day.',
      ),
      targetAccountingDate: IsoDate.optional().describe(
        'Accounting date for the postings in the target year; defaults to its first day.',
      ),
    })
    .strict(),
);

export const closeEndpoints = {
  listClosePeriods: {
    operationId: 'listClosePeriods',
    method: 'get',
    path: '/api/close/periods',
    summary: 'Accounting periods with their close state',
    tags: ['close'],
    auth: true,
    query: z.object({ fiscalYearId: Id.optional() }).strict(),
    response: { status: 200, schema: ClosePeriodList },
    errors: [400, 401, 403],
  },
  getClosePeriod: {
    operationId: 'getClosePeriod',
    method: 'get',
    path: '/api/close/periods/{periodId}',
    summary: 'Close checklist for a period, per legal entity',
    tags: ['close'],
    auth: true,
    params: PeriodParams,
    response: { status: 200, schema: ClosePeriodDetail },
    errors: [400, 401, 403, 404],
  },
  acknowledgeCloseCheck: {
    operationId: 'acknowledgeCloseCheck',
    method: 'post',
    path: '/api/close/periods/{periodId}/acknowledgements',
    summary: 'Accept a soft check with a reason',
    tags: ['close'],
    auth: true,
    idempotent: true,
    params: PeriodParams,
    body: AcknowledgeCheckRequest,
    response: { status: 201, schema: ClosePeriodDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  softClosePeriod: {
    operationId: 'softClosePeriod',
    method: 'post',
    path: '/api/close/periods/{periodId}/soft-close',
    summary: 'Soft-close a period (finance adjustments only)',
    tags: ['close'],
    auth: true,
    idempotent: true,
    params: PeriodParams,
    body: PeriodStatusRequest,
    response: { status: 201, schema: ClosePeriodDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  closePeriod: {
    operationId: 'closePeriod',
    method: 'post',
    path: '/api/close/periods/{periodId}/close',
    summary: 'Close a period and take the as-of snapshots',
    tags: ['close'],
    auth: true,
    idempotent: true,
    params: PeriodParams,
    body: ClosePeriodRequest,
    response: { status: 201, schema: ClosePeriodDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  lockPeriod: {
    operationId: 'lockPeriod',
    method: 'post',
    path: '/api/close/periods/{periodId}/lock',
    summary: 'Lock a closed period after reporting',
    tags: ['close'],
    auth: true,
    idempotent: true,
    params: PeriodParams,
    body: PeriodStatusRequest,
    response: { status: 201, schema: ClosePeriodDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  requestPeriodReopen: {
    operationId: 'requestPeriodReopen',
    method: 'post',
    path: '/api/close/periods/{periodId}/reopen-requests',
    summary: 'Request a break-glass reopen or unlock',
    tags: ['close'],
    auth: true,
    idempotent: true,
    params: PeriodParams,
    body: RequestReopenRequest,
    response: { status: 201, schema: ReopenRequest },
    errors: [400, 401, 403, 404, 409, 422],
  },
  decidePeriodReopen: {
    operationId: 'decidePeriodReopen',
    method: 'post',
    path: '/api/close/reopen-requests/{requestId}/decision',
    summary: 'Approve or decline a reopen request (a different person)',
    tags: ['close'],
    auth: true,
    idempotent: true,
    params: ReopenParams,
    body: ReopenDecisionRequest,
    response: { status: 201, schema: ReopenRequest },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listPeriodSnapshots: {
    operationId: 'listPeriodSnapshots',
    method: 'get',
    path: '/api/close/periods/{periodId}/snapshots',
    summary: 'As-of snapshots taken when the period closed',
    tags: ['close'],
    auth: true,
    params: PeriodParams,
    response: { status: 200, schema: PeriodSnapshotList },
    errors: [400, 401, 403, 404],
  },
  listLateItems: {
    operationId: 'listLateItems',
    method: 'get',
    path: '/api/close/periods/{periodId}/late-items',
    summary: 'Postings dated in this period that landed in a later open one',
    tags: ['close'],
    auth: true,
    params: PeriodParams,
    response: { status: 200, schema: LateItemList },
    errors: [400, 401, 403, 404],
  },
  listRolloverPolicies: {
    operationId: 'listRolloverPolicies',
    method: 'get',
    path: '/api/close/rollover-policies',
    summary: 'Rollover policies and how many budgets use them',
    tags: ['close'],
    auth: true,
    response: { status: 200, schema: RolloverPolicyList },
    errors: [401, 403],
  },
  assignRolloverPolicy: {
    operationId: 'assignRolloverPolicy',
    method: 'put',
    path: '/api/close/budgets/{budgetId}/rollover-policy',
    summary: "Set a budget's rollover policy",
    tags: ['close'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: AssignRolloverPolicyRequest,
    response: { status: 200, schema: BudgetRolloverPolicy },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listYearEndRuns: {
    operationId: 'listYearEndRuns',
    method: 'get',
    path: '/api/close/year-end-runs',
    summary: 'Year-end runs',
    tags: ['close'],
    auth: true,
    query: z.object({ fiscalYearId: Id.optional() }).strict(),
    response: { status: 200, schema: YearEndRunList },
    errors: [400, 401, 403],
  },
  createYearEndRun: {
    operationId: 'createYearEndRun',
    method: 'post',
    path: '/api/close/year-end-runs',
    summary: 'Set up a year-end run',
    tags: ['close'],
    auth: true,
    idempotent: true,
    body: CreateYearEndRunRequest,
    response: { status: 201, schema: YearEndRun },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getYearEndRun: {
    operationId: 'getYearEndRun',
    method: 'get',
    path: '/api/close/year-end-runs/{runId}',
    summary: 'A year-end run with its readiness checks, lines and totals',
    tags: ['close'],
    auth: true,
    params: RunParams,
    response: { status: 200, schema: YearEndRun },
    errors: [400, 401, 403, 404],
  },
  dryRunYearEnd: {
    operationId: 'dryRunYearEnd',
    method: 'post',
    path: '/api/close/year-end-runs/{runId}/dry-run',
    summary: 'Recompute what every budget carries, lapses and sweeps. Posts nothing',
    tags: ['close'],
    auth: true,
    idempotent: true,
    params: RunParams,
    response: { status: 201, schema: YearEndRun },
    errors: [400, 401, 403, 404, 409, 422],
  },
  decideYearEndCarry: {
    operationId: 'decideYearEndCarry',
    method: 'post',
    path: '/api/close/year-end-runs/{runId}/lines/{lineId}/decision',
    summary: 'Decide a carry-with-approval line',
    tags: ['close'],
    auth: true,
    idempotent: true,
    params: RunLineParams,
    body: YearEndCarryDecisionRequest,
    response: { status: 201, schema: YearEndRun },
    errors: [400, 401, 403, 404, 409, 422],
  },
  executeYearEndRun: {
    operationId: 'executeYearEndRun',
    method: 'post',
    path: '/api/close/year-end-runs/{runId}/execution',
    summary: 'Post the lapses, sweeps, carries and commitment carry-forwards',
    tags: ['close'],
    auth: true,
    idempotent: true,
    params: RunParams,
    body: ExecuteYearEndRequest,
    response: { status: 201, schema: YearEndRun },
    errors: [400, 401, 403, 404, 409, 422],
  },
} as const satisfies Record<string, Endpoint>;
