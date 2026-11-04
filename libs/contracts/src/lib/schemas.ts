import { z } from 'zod';
import { named } from './registry';
import {
  AppliedRate,
  BudgetStatus,
  BudgetType,
  ConsumingBucket,
  ControlMode,
  CurrencyCode,
  Id,
  IsoDate,
  IsoDateTime,
  LedgerAccount,
  Money,
  RoleId,
} from './common';

// Health ---------------------------------------------------------------------------------------
export const HealthResponse = named(
  'HealthResponse',
  z
    .object({ status: z.literal('ok') })
    .strict()
    .describe('Liveness.'),
);

export const ReadinessResponse = named(
  'ReadinessResponse',
  z
    .object({
      status: z.enum(['ready', 'not_ready']),
      checks: z
        .object({ database: z.enum(['up', 'down']), identityProvider: z.enum(['up', 'down']) })
        .strict(),
    })
    .strict()
    .describe('Readiness: database and Keycloak JWKS reachable.'),
);

// Identity -------------------------------------------------------------------------------------
export const MeResponse = named(
  'MeResponse',
  z
    .object({
      subject: z.string(),
      tenantId: Id,
      tenantName: z.string(),
      reportingCurrency: CurrencyCode,
      personId: Id.nullable(),
      displayName: z.string(),
      roles: z.array(RoleId),
      memberships: z.array(
        z.object({ tenantId: Id, tenantName: z.string(), roles: z.array(RoleId) }).strict(),
      ),
    })
    .strict()
    .describe('The signed-in user in the selected tenant, with every tenant they belong to.'),
);

// Budgets --------------------------------------------------------------------------------------
export const ControlSettings = named(
  'ControlSettings',
  z
    .object({
      basis: z.array(ConsumingBucket).min(1).describe('Buckets counted against available.'),
      mode: ControlMode.describe('hard blocks, soft warns, track only records.'),
      toleranceBps: z
        .int()
        .min(0)
        .max(10_000)
        .describe('Spend tolerance in basis points of authorized.'),
    })
    .strict(),
);

const bucketMoney = z
  .object({
    authorized: Money,
    allocatedOut: Money,
    held: Money,
    preEncumbered: Money,
    encumbered: Money,
    actual: Money,
    accrued: Money,
  })
  .strict();

export const BudgetBalances = named(
  'BudgetBalances',
  z
    .object({
      budgetCurrency: bucketMoney.describe(
        'Bucket balances in the budget currency (natural sign).',
      ),
      reporting: bucketMoney.describe(
        'Bucket balances in the reporting currency at the locked plan rate.',
      ),
      available: Money.describe(
        'authorized − counted buckets per the control basis, budget currency.',
      ),
      availableReporting: Money,
      allocationAvailable: Money.describe(
        'What can still be allocated to children (allocated out always counts, no tolerance).',
      ),
    })
    .strict(),
);

export const BudgetDetail = named(
  'BudgetDetail',
  z
    .object({
      id: Id,
      parentId: Id.nullable(),
      path: z.string().describe('Materialized path of ancestor ids, root first.'),
      name: z.string(),
      code: z.string().nullable(),
      status: BudgetStatus,
      allocationBadge: z.enum(['unallocated', 'partially_allocated', 'fully_allocated']),
      budgetType: BudgetType,
      categoryCode: z.string().nullable(),
      legalEntityId: Id,
      costCenterId: Id.nullable(),
      orgUnitId: Id.nullable(),
      ownerPersonId: Id.nullable(),
      currency: CurrencyCode,
      reportingCurrency: CurrencyCode,
      fiscalYearId: Id,
      planVersionId: Id.nullable(),
      control: ControlSettings,
      alertThresholdsPct: z.array(z.int().min(1).max(100)),
      balances: BudgetBalances,
      version: z.int(),
      allowedActions: z
        .array(z.string())
        .describe('Actions the current user may take on this budget (from PolicyService).'),
      createdAt: IsoDateTime,
    })
    .strict()
    .describe('A budget with its ledger-derived balances.'),
);
export type BudgetDetail = z.infer<typeof BudgetDetail>;

export const BudgetList = named(
  'BudgetList',
  z
    .object({ items: z.array(BudgetDetail), nextCursor: z.string().nullable() })
    .strict()
    .describe('Budgets visible to the user, cursor-paginated.'),
);

export const CreateBudgetRequest = named(
  'CreateBudgetRequest',
  z
    .object({
      name: z.string().trim().min(2).max(200),
      code: z.string().trim().min(1).max(50).optional(),
      parentId: Id.nullable().optional().describe('Omit for a root budget.'),
      legalEntityId: Id,
      costCenterId: Id.nullable()
        .optional()
        .describe(
          'Required on leaf budgets that take spend (Phase 4 enforces at first commitment).',
        ),
      orgUnitId: Id.nullable().optional(),
      ownerPersonId: Id.nullable().optional(),
      categoryCode: z.string().max(50).optional(),
      budgetType: BudgetType.optional().describe('Defaults to operating.'),
      currency: CurrencyCode,
      fiscalYearId: Id,
      planVersionId: Id.optional().describe(
        'Required for a root budget: the approved plan version it ties to.',
      ),
      originalAmount: Money.optional().describe(
        'Root budgets only: the original authorized amount in the budget currency.',
      ),
      control: ControlSettings.optional(),
      alertThresholdsPct: z.array(z.int().min(1).max(100)).max(5).optional(),
      accountingDate: IsoDate.optional(),
    })
    .strict()
    .describe('Create a root budget (posts the original budget journal) or an empty child budget.'),
);
export type CreateBudgetRequest = z.infer<typeof CreateBudgetRequest>;

// Ledger ---------------------------------------------------------------------------------------
export const LedgerLine = named(
  'LedgerLine',
  z
    .object({
      id: Id,
      journalId: Id,
      lineNo: z.int(),
      budgetId: Id.nullable(),
      account: LedgerAccount,
      legalEntityId: Id,
      costCenterId: Id.nullable(),
      glAccountId: Id.nullable(),
      eventCode: z.string().nullable(),
      periodId: Id,
      accountingDate: IsoDate,
      transaction: Money.describe('Signed: debit positive, credit negative.'),
      budget: Money.nullable(),
      reporting: Money,
      budgetRate: AppliedRate.nullable(),
      reportingRate: AppliedRate,
      planVersionId: Id.nullable(),
      reversalOfLineId: Id.nullable(),
    })
    .strict()
    .describe('One append-only ledger line carrying the currency triplet.'),
);

export const JournalTotals = z
  .object({
    debitTransactionMinor: z.int(),
    creditTransactionMinor: z.int(),
    debitReportingMinor: z.int(),
    creditReportingMinor: z.int(),
  })
  .strict();

export const Journal = named(
  'Journal',
  z
    .object({
      id: Id,
      type: z.string(),
      transactionCurrency: CurrencyCode,
      reportingCurrency: CurrencyCode,
      accountingDate: IsoDate,
      periodId: Id,
      periodLabel: z.string(),
      late: z
        .boolean()
        .describe('Posted to the next open period because its own period was closed.'),
      originalPeriodId: Id.nullable(),
      reversalOfJournalId: Id.nullable(),
      reversedByJournalId: Id.nullable(),
      reasonCode: z.string().nullable(),
      reason: z.string().nullable(),
      actorPersonId: Id.nullable(),
      createdAt: IsoDateTime,
      totals: JournalTotals,
      balanced: z.boolean(),
      lines: z.array(LedgerLine),
    })
    .strict()
    .describe('A balanced, append-only journal.'),
);
export type Journal = z.infer<typeof Journal>;

export const LedgerLineList = named(
  'LedgerLineList',
  z.object({ items: z.array(LedgerLine) }).strict(),
);

export const AllocateRequest = named(
  'AllocateRequest',
  z
    .object({
      childBudgetId: Id,
      amount: Money.describe(
        "In the parent's or the child's budget currency; converted at the locked plan rate.",
      ),
      accountingDate: IsoDate.optional(),
      memo: z.string().max(500).optional(),
    })
    .strict(),
);

export const AllocationResponse = named(
  'AllocationResponse',
  z.object({ journal: Journal, parent: BudgetDetail, child: BudgetDetail }).strict(),
);

export const ManualJournalRequest = named(
  'ManualJournalRequest',
  z
    .object({
      transactionCurrency: CurrencyCode,
      accountingDate: IsoDate.optional(),
      reasonCode: z.string().trim().min(1).max(50),
      reason: z.string().trim().min(5).max(1000),
      lines: z
        .array(
          z
            .object({
              budgetId: Id.nullable(),
              account: LedgerAccount,
              side: z.enum(['debit', 'credit']),
              amountMinor: z.int().positive(),
              legalEntityId: Id.optional().describe(
                'Counter-account lines only; budget lines use the budget legal entity.',
              ),
            })
            .strict(),
        )
        .min(2)
        .max(50),
    })
    .strict()
    .describe(
      'Opening balances and adjustments to commitment, actual and accrual buckets (finance admins).',
    ),
);

export const ReversalRequest = named(
  'ReversalRequest',
  z
    .object({
      reasonCode: z.string().trim().min(1).max(50),
      reason: z.string().trim().min(5).max(1000),
      accountingDate: IsoDate.optional(),
    })
    .strict(),
);

// Integrity ------------------------------------------------------------------------------------
export const IntegrityCheckRun = named(
  'IntegrityCheckRun',
  z
    .object({
      id: Id,
      kind: z.literal('ledger_rebuild'),
      status: z.enum(['queued', 'running', 'clean', 'drift_detected', 'failed']),
      requestedAt: IsoDateTime,
      startedAt: IsoDateTime.nullable(),
      finishedAt: IsoDateTime.nullable(),
      flagsRaised: z.int(),
      summary: z
        .object({
          budgetsChecked: z.int(),
          journalsChecked: z.int(),
          linesChecked: z.int(),
          unbalancedJournals: z.array(Id),
          balanceDrifts: z.array(
            z
              .object({
                budgetId: Id,
                periodId: Id,
                bucket: z.string(),
                rebuiltBudgetMinor: z.int(),
                cachedBudgetMinor: z.int(),
                rebuiltReportingMinor: z.int(),
                cachedReportingMinor: z.int(),
              })
              .strict(),
          ),
          hierarchyMismatches: z.array(
            z
              .object({
                parentId: Id,
                allocatedOutReportingMinor: z.int(),
                childrenAuthorizedReportingMinor: z.int(),
              })
              .strict(),
          ),
          planTieMismatches: z.array(
            z
              .object({
                planVersionId: Id,
                planFundingReportingMinor: z.int(),
                rootAuthorizedReportingMinor: z.int(),
              })
              .strict(),
          ),
          auditChain: z
            .object({ valid: z.boolean(), checked: z.int(), firstBrokenSeq: z.int().nullable() })
            .strict(),
        })
        .strict()
        .nullable(),
    })
    .strict()
    .describe(
      'A ledger rebuild check run by the worker: rebuilt balances versus cached ones, journal balance, hierarchy, plan tie-out and the audit chain.',
    ),
);

// Audit ----------------------------------------------------------------------------------------
export const AuditEvent = named(
  'AuditEvent',
  z
    .object({
      id: Id,
      seq: z.int(),
      occurredAt: IsoDateTime,
      actorPersonId: Id.nullable(),
      actorSubject: z.string().nullable(),
      onBehalfOfPersonId: Id.nullable(),
      action: z.string(),
      resourceType: z.string(),
      resourceId: z.string(),
      legalEntityId: Id.nullable(),
      requestId: z.string().nullable(),
      reason: z.string().nullable(),
      changes: z.record(z.string(), z.unknown()),
      prevHash: z.string().length(64),
      hash: z.string().length(64),
    })
    .strict(),
);

export const AuditEventList = named(
  'AuditEventList',
  z.object({ items: z.array(AuditEvent), nextCursor: z.string().nullable() }).strict(),
);

export const AuditEventQuery = z
  .object({
    resourceType: z.string().max(50).optional(),
    resourceId: z.string().max(100).optional(),
    action: z.string().max(100).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export const AuditVerification = named(
  'AuditVerification',
  z
    .object({
      valid: z.boolean(),
      checked: z.int(),
      firstBrokenSeq: z.int().nullable(),
      reason: z.string().nullable(),
      verifiedAt: IsoDateTime,
    })
    .strict(),
);

export type HealthResponse = z.infer<typeof HealthResponse>;
export type ReadinessResponse = z.infer<typeof ReadinessResponse>;
export type MeResponse = z.infer<typeof MeResponse>;
export type ControlSettings = z.infer<typeof ControlSettings>;
export type BudgetBalances = z.infer<typeof BudgetBalances>;
export type BudgetList = z.infer<typeof BudgetList>;
export type LedgerLine = z.infer<typeof LedgerLine>;
export type LedgerLineList = z.infer<typeof LedgerLineList>;
export type AllocateRequest = z.infer<typeof AllocateRequest>;
export type AllocationResponse = z.infer<typeof AllocationResponse>;
export type ManualJournalRequest = z.infer<typeof ManualJournalRequest>;
export type ReversalRequest = z.infer<typeof ReversalRequest>;
export type IntegrityCheckRun = z.infer<typeof IntegrityCheckRun>;
export type AuditEvent = z.infer<typeof AuditEvent>;
export type AuditEventList = z.infer<typeof AuditEventList>;
export type AuditVerification = z.infer<typeof AuditVerification>;
