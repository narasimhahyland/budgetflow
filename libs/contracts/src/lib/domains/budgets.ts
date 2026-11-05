import { z } from 'zod';
import {
  BudgetStatus,
  BudgetType,
  ConsumingBucket,
  ControlMode,
  CurrencyCode,
  CursorQuery,
  Id,
  IsoDate,
  IsoDateTime,
  Money,
} from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';
import { Journal, LedgerLineList } from './ledger';
import { EmploymentType } from './org';

const BudgetParams = z.object({ budgetId: Id }).strict();

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

export const PerHeadDriverConfig = named(
  'PerHeadDriverConfig',
  z
    .object({
      rateMinor: z
        .int()
        .min(1)
        .describe('Rate per eligible employee per month in the budget currency.'),
      eligibleTypes: z.array(EmploymentType).min(1),
      prorate: z
        .boolean()
        .describe('Count joiners and leavers for the part of the year they work.'),
      orgUnitId: Id.describe('Location or team whose headcount drives the amount.'),
      snapshotId: Id.nullable().describe('HR headcount snapshot the current amount is based on.'),
      asOfDate: IsoDate.nullable(),
      eligibleHeadcountMilli: z.int().describe('Eligible headcount in thousandths.'),
      amountMinor: z.int().describe('Amount allocated by the driver so far (budget currency).'),
      programTemplateId: Id.nullable(),
    })
    .strict(),
);
export type PerHeadDriverConfig = z.infer<typeof PerHeadDriverConfig>;

export const BudgetDisplay = named(
  'BudgetDisplay',
  z
    .object({
      ownerName: z.string().nullable(),
      parentName: z.string().nullable(),
      legalEntityCode: z.string().nullable(),
      legalEntityName: z.string().nullable(),
      costCenterCode: z.string().nullable(),
      orgUnitName: z.string().nullable(),
      fiscalYearLabel: z.string().nullable(),
      categoryName: z.string().nullable(),
    })
    .strict()
    .describe('Names for display; ids stay authoritative.'),
);

export const AvailableExplanation = named(
  'AvailableExplanation',
  z
    .object({
      companyWide: Money.describe(
        'Authorized − held − pre-encumbered − encumbered − actual over this budget and everything below it (child allocations counted once).',
      ),
      underRules: Money.describe("Available under this budget's own control basis."),
      difference: Money,
      reasons: z.array(
        z
          .object({
            kind: z.enum(['allocated_to_children', 'held', 'basis_excludes', 'children_spend']),
            amountMinor: z.int(),
          })
          .strict(),
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
      depth: z.int(),
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
      available: AvailableExplanation,
      utilizationBps: z
        .int()
        .describe(
          'Roll-up utilization: (encumbered + actual of this budget and everything below it) / authorized in basis points, child spend counted once; pending shown separately.',
        ),
      thresholdsReachedPct: z.array(z.int()).describe('Owner alert thresholds already reached.'),
      allocationDriver: z.enum(['fixed', 'per_head']),
      driver: PerHeadDriverConfig.nullable(),
      phasingMethod: z.enum(['even', 'seasonal', 'manual']).nullable(),
      childCount: z.int(),
      display: BudgetDisplay,
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
      currency: CurrencyCode.optional().describe(
        'Defaults to the tenant reporting currency (USD): every budget is held in USD for now.',
      ),
      programTemplateId: Id.optional().describe('Program template whose defaults apply.'),
      draft: z
        .boolean()
        .optional()
        .describe('Child budgets only: save as draft and activate later.'),
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

export type ControlSettings = z.infer<typeof ControlSettings>;
export type BudgetBalances = z.infer<typeof BudgetBalances>;
export type BudgetList = z.infer<typeof BudgetList>;
export type AllocateRequest = z.infer<typeof AllocateRequest>;
export type AllocationResponse = z.infer<typeof AllocationResponse>;

export const BudgetListQuery = CursorQuery.extend({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  fiscalYearId: Id.optional(),
  rootId: Id.optional().describe('Only this budget and everything below it.'),
  parentId: Id.optional().describe('Only direct children of this budget.'),
  topLevel: z
    .enum(['true', 'false'])
    .optional()
    .describe(
      'Only the highest budgets the user can see (roots, or the top of each owned subtree).',
    ),
  status: BudgetStatus.optional(),
  budgetType: BudgetType.optional(),
  q: z.string().trim().max(100).optional().describe('Name or code contains.'),
}).strict();

export const BudgetSummaryQuery = z
  .object({ fiscalYearId: Id.optional(), rootId: Id.optional() })
  .strict();

export const BudgetSummary = named(
  'BudgetSummary',
  z
    .object({
      scope: z.enum(['tenant', 'owned', 'budget']),
      fiscalYearId: Id.nullable(),
      rootId: Id.nullable(),
      currency: CurrencyCode,
      authorized: Money,
      held: Money.describe(
        'Earmarks and reserve holds across the scope; held money cannot be spent.',
      ),
      preEncumbered: Money,
      encumbered: Money,
      actual: Money,
      available: Money.describe(
        'Company-wide Available: authorized − held − pre-encumbered − encumbered − actual, child allocations counted once.',
      ),
      utilizationBps: z.int(),
      budgetCount: z.int(),
      byStatus: z.record(z.string(), z.int()),
      frozenCount: z.int(),
      setToZeroCount: z.int(),
      overThresholdCount: z.int(),
    })
    .strict()
    .describe('Roll-up of the budgets in scope.'),
);
export type BudgetSummary = z.infer<typeof BudgetSummary>;

// Controls ------------------------------------------------------------------------------------
const ReasonFields = {
  reasonCode: z.string().trim().min(1).max(50),
  reason: z.string().trim().min(3).max(1000),
};
export const ReductionDestination = z.enum(['parent', 'savings', 'reallocation']);

export const ControlPreviewRequest = named(
  'ControlPreviewRequest',
  z
    .object({
      action: z.enum(['freeze', 'reduce', 'set_to_zero']),
      amountMinor: z.int().min(1).optional().describe('Reduce only.'),
      cascade: z.boolean().optional(),
      destination: ReductionDestination.optional(),
      destinationBudgetId: Id.optional(),
    })
    .strict(),
);
export type ControlPreviewRequest = z.infer<typeof ControlPreviewRequest>;

export const ControlImpact = named(
  'ControlImpact',
  z
    .object({
      action: z.enum(['freeze', 'reduce', 'set_to_zero']),
      budgetId: Id,
      currency: CurrencyCode,
      currentAuthorizedMinor: z.int(),
      floorMinor: z
        .int()
        .describe(
          'Allocated out (kept by children) + held + encumbered + actual; pending requests excluded.',
        ),
      reductionMinor: z.int(),
      newAuthorizedMinor: z.int(),
      heldMinor: z.int(),
      encumberedMinor: z.int(),
      actualMinor: z.int(),
      childrenAllocatedMinor: z.int(),
      pendingMinor: z.int().describe('Pending requests (pre-encumbered), listed but not floored.'),
      availableBeforeMinor: z.int(),
      availableAfterMinor: z.int(),
      cascade: z.boolean(),
      blocksNewRequests: z.boolean(),
      pendingRequestPolicy: z
        .enum(['cancel', 'hold', 'release', 'return_unfit'])
        .describe('What Phase 5 does with pending requests after this change.'),
      unfitRequestIds: z
        .array(Id)
        .describe(
          'Reduce: pending requests that no longer fit and go back to their requesters, most recent first.',
        ),
      destination: ReductionDestination.nullable(),
      destinationBudgetId: Id.nullable(),
      destinationName: z.string().nullable(),
      affected: z
        .array(
          z
            .object({
              budgetId: Id,
              name: z.string(),
              depth: z.int(),
              status: BudgetStatus,
              newStatus: BudgetStatus,
              authorizedMinor: z.int(),
              reductionMinor: z.int(),
              floorMinor: z.int(),
              encumberedMinor: z.int(),
              pendingMinor: z.int(),
            })
            .strict(),
        )
        .describe('This budget and, with cascade, every budget below it.'),
      maxReductionMinor: z.int(),
      problem: z
        .object({ code: z.string(), message: z.string() })
        .strict()
        .nullable()
        .describe('Why the change cannot be made as asked (the preview still shows the impact).'),
    })
    .strict()
    .describe('Impact preview the user confirms before freezing, reducing or setting to zero.'),
);
export type ControlImpact = z.infer<typeof ControlImpact>;

export const FreezeRequest = named(
  'FreezeRequest',
  z.object({ ...ReasonFields, cascade: z.boolean().optional() }).strict(),
);
export const UnfreezeRequest = named(
  'UnfreezeRequest',
  z.object({ reason: ReasonFields.reason, cascade: z.boolean().optional() }).strict(),
);
export const ReduceRequest = named(
  'ReduceRequest',
  z
    .object({
      ...ReasonFields,
      amountMinor: z.int().min(1).describe('In the budget currency.'),
      destination: ReductionDestination,
      destinationBudgetId: Id.optional(),
      confirmedFloorMinor: z.int().describe('Floor from the impact preview the user confirmed.'),
    })
    .strict(),
);
export const SetToZeroRequest = named(
  'SetToZeroRequest',
  z
    .object({
      ...ReasonFields,
      destination: ReductionDestination,
      destinationBudgetId: Id.optional(),
      cascade: z.boolean().optional(),
      confirmedFloorMinor: z.int(),
      confirmText: z
        .string()
        .describe('The budget code (or name when it has no code) typed to confirm.'),
    })
    .strict(),
);
export const RestoreRequest = named(
  'RestoreRequest',
  z.object({ reason: ReasonFields.reason }).strict(),
);
export type FreezeRequest = z.infer<typeof FreezeRequest>;
export type UnfreezeRequest = z.infer<typeof UnfreezeRequest>;
export type ReduceRequest = z.infer<typeof ReduceRequest>;
export type SetToZeroRequest = z.infer<typeof SetToZeroRequest>;
export type RestoreRequest = z.infer<typeof RestoreRequest>;

export const ControlResult = named(
  'ControlResult',
  z
    .object({
      budget: BudgetDetail,
      journalId: Id.nullable(),
      affectedBudgetIds: z.array(Id),
      event: z
        .object({
          topic: z.literal('budget.control_changed'),
          action: z.enum(['frozen', 'unfrozen', 'reduced', 'set_to_zero', 'restored']),
          pendingRequestPolicy: z.enum(['cancel', 'hold', 'release', 'return_unfit']),
          unfitRequestIds: z.array(Id),
        })
        .strict(),
    })
    .strict(),
);
export type ControlResult = z.infer<typeof ControlResult>;

// Transfers ------------------------------------------------------------------------------------
export const TransferRequest = named(
  'TransferRequest',
  z
    .object({
      ...ReasonFields,
      toBudgetId: Id,
      amountMinor: z.int().min(1).describe("In the source budget's currency."),
      accountingDate: IsoDate.optional(),
    })
    .strict()
    .describe('Move money to another budget of the same tree, along the hierarchy.'),
);
export type TransferRequest = z.infer<typeof TransferRequest>;

export const BudgetChangeRequest = named(
  'BudgetChangeRequest',
  z
    .object({
      id: Id,
      kind: z.enum(['increase', 'contingency_release', 'sibling_transfer']),
      budgetId: Id,
      budgetName: z.string(),
      sourceBudgetId: Id,
      sourceBudgetName: z.string(),
      amount: Money,
      approvedAmount: Money.nullable(),
      reason: z.string(),
      status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
      requestedByName: z.string().nullable(),
      createdAt: IsoDateTime,
      decidedAt: IsoDateTime.nullable(),
      decidedByName: z.string().nullable(),
      decisionNote: z.string().nullable(),
      journalId: Id.nullable(),
      canDecide: z.boolean(),
      sourceAvailableMinor: z.int().nullable(),
    })
    .strict(),
);
export type BudgetChangeRequest = z.infer<typeof BudgetChangeRequest>;

export const TransferResult = named(
  'TransferResult',
  z
    .object({
      journal: Journal.nullable(),
      from: BudgetDetail,
      to: BudgetDetail,
      changeRequest: BudgetChangeRequest.nullable().optional(),
    })
    .strict(),
);
export type TransferResult = z.infer<typeof TransferResult>;

// Settings and limits --------------------------------------------------------------------------
export const BudgetSettingsRequest = named(
  'BudgetSettingsRequest',
  z
    .object({
      expectedVersion: z.int().describe('Version the user edited; a newer version is a conflict.'),
      name: z.string().trim().min(2).max(200).optional(),
      ownerPersonId: Id.nullable().optional(),
      costCenterId: Id.nullable().optional(),
      categoryCode: z.string().max(50).nullable().optional(),
      control: ControlSettings.optional(),
      alertThresholdsPct: z.array(z.int().min(1).max(100)).max(5).optional(),
      reason: z.string().trim().max(1000).optional(),
    })
    .strict(),
);
export type BudgetSettingsRequest = z.infer<typeof BudgetSettingsRequest>;

export const BudgetLimit = named(
  'BudgetLimit',
  z
    .object({
      id: Id.optional(),
      kind: z.enum(['category', 'per_event', 'per_person']),
      categoryCode: z.string().max(50).nullable(),
      orgUnitId: Id.nullable().describe('Location the limit applies to (null: every location).'),
      orgUnitName: z.string().nullable().optional(),
      amountMinor: z.int().min(1),
      mode: z.enum(['hard', 'soft']),
    })
    .strict(),
);
export type BudgetLimit = z.infer<typeof BudgetLimit>;
export const BudgetLimits = named(
  'BudgetLimits',
  z.object({ currency: CurrencyCode, items: z.array(BudgetLimit) }).strict(),
);
export type BudgetLimits = z.infer<typeof BudgetLimits>;
export const SetBudgetLimitsRequest = named(
  'SetBudgetLimitsRequest',
  z
    .object({ items: z.array(BudgetLimit).max(50), reason: z.string().max(1000).optional() })
    .strict(),
);
export type SetBudgetLimitsRequest = z.infer<typeof SetBudgetLimitsRequest>;

export const SpendCheckRequest = named(
  'SpendCheckRequest',
  z
    .object({
      amountMinor: z.int().min(1).describe('In the budget currency.'),
      categoryCode: z.string().max(50).optional(),
      orgUnitId: Id.optional(),
      plannedAttendance: z.int().min(1).optional(),
      categoryCommittedMinor: z.int().min(0).optional(),
    })
    .strict()
    .describe('Would a new request of this amount be accepted? No side effects.'),
);
export type SpendCheckRequest = z.infer<typeof SpendCheckRequest>;
export const SpendCheckResult = named(
  'SpendCheckResult',
  z
    .object({
      outcome: z.enum(['ok', 'warning', 'blocked']),
      availableMinor: z.int(),
      availableAfterMinor: z.int(),
      toleranceMinor: z.int(),
      currency: CurrencyCode,
      reasons: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
      limits: z.array(
        z
          .object({
            limitId: z.string(),
            kind: z.enum(['category', 'per_event', 'per_person']),
            outcome: z.enum(['warning', 'blocked']),
            limitMinor: z.int(),
            valueMinor: z.int(),
            message: z.string(),
          })
          .strict(),
      ),
    })
    .strict(),
);
export type SpendCheckResult = z.infer<typeof SpendCheckResult>;

// Phasing, versions, history ------------------------------------------------------------------
export const BudgetPhasing = named(
  'BudgetPhasing',
  z
    .object({
      budgetId: Id,
      method: z.enum(['even', 'seasonal', 'manual']).nullable(),
      currency: CurrencyCode,
      authorizedMinor: z.int(),
      phasedMinor: z.int(),
      outOfDate: z.boolean().describe('The phased total no longer equals authorized.'),
      periods: z.array(
        z
          .object({
            periodId: Id,
            periodNumber: z.int(),
            label: z.string(),
            startDate: IsoDate,
            endDate: IsoDate,
            status: z.string(),
            allotmentMinor: z.int(),
            committedMinor: z.int().describe('Encumbered posted in the period.'),
            actualMinor: z.int(),
          })
          .strict(),
      ),
    })
    .strict(),
);
export type BudgetPhasing = z.infer<typeof BudgetPhasing>;
export const SetPhasingRequest = named(
  'SetPhasingRequest',
  z
    .object({
      method: z.enum(['even', 'seasonal', 'manual']),
      weights: z.array(z.int().min(0).max(1000)).max(53).optional(),
      amountsMinor: z.array(z.int().min(0)).max(53).optional(),
    })
    .strict(),
);
export type SetPhasingRequest = z.infer<typeof SetPhasingRequest>;

export const BudgetVersion = named(
  'BudgetVersion',
  z
    .object({
      version: z.int(),
      reason: z.string(),
      createdAt: IsoDateTime,
      actorName: z.string().nullable(),
      snapshot: z.record(z.string(), z.unknown()),
    })
    .strict(),
);
export const BudgetVersionList = named(
  'BudgetVersionList',
  z.object({ items: z.array(BudgetVersion) }).strict(),
);
export type BudgetVersion = z.infer<typeof BudgetVersion>;

export const AllocationHistoryItem = named(
  'AllocationHistoryItem',
  z
    .object({
      journalId: Id,
      journalType: z.string(),
      accountingDate: IsoDate,
      createdAt: IsoDateTime,
      direction: z.enum(['in', 'out']),
      bucket: z.enum(['authorized', 'allocated_out']),
      amount: Money,
      counterparties: z.array(z.object({ budgetId: Id.nullable(), name: z.string() }).strict()),
      reasonCode: z.string().nullable(),
      reason: z.string().nullable(),
      actorName: z.string().nullable(),
      reversed: z.boolean(),
    })
    .strict(),
);
export const AllocationHistory = named(
  'AllocationHistory',
  z.object({ items: z.array(AllocationHistoryItem) }).strict(),
);
export type AllocationHistoryItem = z.infer<typeof AllocationHistoryItem>;

// Allocation grid ------------------------------------------------------------------------------
export const NewChildBudget = named(
  'NewChildBudget',
  z
    .object({
      name: z.string().trim().min(2).max(200),
      code: z.string().trim().min(1).max(50).optional(),
      legalEntityId: Id.optional().describe("Defaults to the parent's legal entity."),
      costCenterId: Id.nullable().optional(),
      orgUnitId: Id.nullable().optional(),
      ownerPersonId: Id.nullable().optional(),
      categoryCode: z.string().max(50).optional(),
      budgetType: BudgetType.optional(),
    })
    .strict(),
);
export const BatchAllocationRequest = named(
  'BatchAllocationRequest',
  z
    .object({
      dryRun: z.boolean().describe('Preview without posting.'),
      memo: z.string().max(500).optional(),
      lines: z
        .array(
          z
            .object({
              childBudgetId: Id.optional(),
              newChild: NewChildBudget.optional(),
              amountMinor: z.int().min(1).describe("In the parent's budget currency."),
            })
            .strict(),
        )
        .min(1)
        .max(200),
    })
    .strict()
    .describe('Allocation grid: every line is checked, then all post as one change or none do.'),
);
export type BatchAllocationRequest = z.infer<typeof BatchAllocationRequest>;
export const BatchAllocationResult = named(
  'BatchAllocationResult',
  z
    .object({
      dryRun: z.boolean(),
      ok: z.boolean(),
      currency: CurrencyCode,
      totalMinor: z.int(),
      availableBeforeMinor: z.int(),
      availableAfterMinor: z.int(),
      lines: z.array(
        z
          .object({
            index: z.int(),
            childBudgetId: Id.nullable(),
            name: z.string(),
            amountMinor: z.int(),
            outcome: z
              .enum(['ok', 'draft', 'error'])
              .describe(
                'draft: a new row without an owner, created as a Draft that receives nothing.',
              ),
            code: z.string().nullable(),
            message: z.string().nullable(),
          })
          .strict(),
      ),
      journalIds: z.array(Id),
      parent: BudgetDetail.nullable(),
    })
    .strict(),
);
export type BatchAllocationResult = z.infer<typeof BatchAllocationResult>;

// Per-head driver -----------------------------------------------------------------------------
export const PerHeadRequest = named(
  'PerHeadRequest',
  z
    .object({
      childBudgetId: Id,
      rateMinor: z
        .int()
        .min(1)
        .describe("Rate per eligible employee per month, in the parent's budget currency."),
      eligibleTypes: z.array(EmploymentType).min(1),
      prorate: z.boolean(),
      orgUnitId: Id.optional().describe("Defaults to the child budget's org unit."),
      asOf: IsoDate.optional().describe(
        'Headcount snapshot on or before this date (default today).',
      ),
      programTemplateId: Id.optional(),
      dryRun: z.boolean(),
    })
    .strict(),
);
export type PerHeadRequest = z.infer<typeof PerHeadRequest>;
export const PerHeadPreview = named(
  'PerHeadPreview',
  z
    .object({
      parentId: Id,
      childBudgetId: Id,
      childName: z.string(),
      orgUnitId: Id,
      orgUnitName: z.string().nullable(),
      snapshotId: Id,
      asOfDate: IsoDate,
      currency: CurrencyCode,
      rateMinor: z.int(),
      monthsLeft: z.int().min(1).optional(),
      headcount: z.int(),
      eligibleHeadcount: z.int(),
      eligibleHeadcountMilli: z.int(),
      excludedHeadcount: z.int(),
      byType: z.array(
        z
          .object({
            employmentType: EmploymentType,
            headcount: z.int(),
            headcountMilli: z.int(),
            eligible: z.boolean(),
          })
          .strict(),
      ),
      amountMinor: z.int(),
      currentDriverAmountMinor: z.int(),
      deltaMinor: z.int().describe('Positive: allocate more; negative: return to the parent.'),
      parentAvailableMinor: z.int(),
      fits: z.boolean(),
    })
    .strict(),
);
export type PerHeadPreview = z.infer<typeof PerHeadPreview>;
export const PerHeadResult = named(
  'PerHeadResult',
  z
    .object({
      preview: PerHeadPreview,
      journalId: Id.nullable(),
      child: BudgetDetail.nullable(),
    })
    .strict(),
);
export type PerHeadResult = z.infer<typeof PerHeadResult>;
export const TrueUpRequest = named(
  'TrueUpRequest',
  z.object({ dryRun: z.boolean(), asOf: IsoDate.optional() }).strict(),
);

// Increase requests, contingency releases and sibling transfer requests -----------------------
export const BudgetChangeRequestList = named(
  'BudgetChangeRequestList',
  z.object({ items: z.array(BudgetChangeRequest) }).strict(),
);
export const ChangeRequestQuery = z
  .object({
    status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
    budgetId: Id.optional(),
    kind: z.enum(['increase', 'contingency_release', 'sibling_transfer']).optional(),
  })
  .strict();
export const CreateIncreaseRequest = named(
  'CreateIncreaseRequest',
  z
    .object({ amountMinor: z.int().min(1), reason: z.string().trim().min(3).max(1000) })
    .strict()
    .describe('Ask the parent budget for more money; posts nothing until approved.'),
);
export const CreateReleaseRequest = named(
  'CreateReleaseRequest',
  z
    .object({
      toBudgetId: Id,
      amountMinor: z.int().min(1),
      reason: z.string().trim().min(3).max(1000),
    })
    .strict()
    .describe('Ask to release contingency reserve to a budget; posts nothing until approved.'),
);
export const DecideChangeRequest = named(
  'DecideChangeRequest',
  z
    .object({
      decision: z.enum(['approve', 'reject']),
      approvedAmountMinor: z.int().min(1).optional().describe('Partial approval.'),
      note: z.string().trim().max(1000).optional(),
    })
    .strict(),
);
export type CreateIncreaseRequest = z.infer<typeof CreateIncreaseRequest>;
export type CreateReleaseRequest = z.infer<typeof CreateReleaseRequest>;
export type DecideChangeRequest = z.infer<typeof DecideChangeRequest>;

// Roll forward --------------------------------------------------------------------------------
export const RollForwardRequest = named(
  'RollForwardRequest',
  z
    .object({
      targetFiscalYearId: Id,
      planVersionId: Id.describe('Approved plan version of the target year the new root ties to.'),
      scalePct: z.number().min(0).max(1000).describe('100 copies amounts; 0 copies the structure.'),
      name: z.string().trim().min(2).max(200).optional(),
      code: z.string().trim().min(1).max(50).optional(),
      dryRun: z.boolean(),
    })
    .strict()
    .describe("Clone last year's tree into a new fiscal year."),
);
export type RollForwardRequest = z.infer<typeof RollForwardRequest>;
export const RollForwardResult = named(
  'RollForwardResult',
  z
    .object({
      dryRun: z.boolean(),
      rootId: Id.nullable(),
      currency: CurrencyCode,
      totalMinor: z.int(),
      budgets: z.array(
        z
          .object({
            sourceId: Id,
            newId: Id.nullable(),
            name: z.string(),
            depth: z.int(),
            amountMinor: z.int(),
          })
          .strict(),
      ),
    })
    .strict(),
);
export type RollForwardResult = z.infer<typeof RollForwardResult>;

const ChangeRequestParams = z.object({ requestId: Id }).strict();

export const budgetEndpoints = {
  listBudgets: {
    operationId: 'listBudgets',
    method: 'get',
    path: '/api/budgets',
    summary: 'Budgets visible to the user',
    tags: ['budgets'],
    auth: true,
    query: BudgetListQuery,
    response: { status: 200, schema: BudgetList },
    errors: [400, 401, 403],
  },
  budgetSummary: {
    operationId: 'budgetSummary',
    method: 'get',
    path: '/api/budgets/summary',
    summary: 'Company-wide roll-up of the budgets in scope (child allocations counted once)',
    tags: ['budgets'],
    auth: true,
    query: BudgetSummaryQuery,
    response: { status: 200, schema: BudgetSummary },
    errors: [400, 401, 403, 404],
  },
  activateBudget: {
    operationId: 'activateBudget',
    method: 'post',
    path: '/api/budgets/{budgetId}/activate',
    summary: 'Activate a draft budget',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    response: { status: 200, schema: BudgetDetail },
    errors: [401, 403, 404, 409],
  },
  updateBudgetSettings: {
    operationId: 'updateBudgetSettings',
    method: 'put',
    path: '/api/budgets/{budgetId}/settings',
    summary: 'Change owner, category, control basis, mode, tolerance and alert thresholds',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: BudgetSettingsRequest,
    response: { status: 200, schema: BudgetDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getBudgetLimits: {
    operationId: 'getBudgetLimits',
    method: 'get',
    path: '/api/budgets/{budgetId}/limits',
    summary: 'Category, per-event and per-person limits',
    tags: ['budgets'],
    auth: true,
    params: BudgetParams,
    response: { status: 200, schema: BudgetLimits },
    errors: [401, 403, 404],
  },
  setBudgetLimits: {
    operationId: 'setBudgetLimits',
    method: 'put',
    path: '/api/budgets/{budgetId}/limits',
    summary: 'Replace the limits of a budget',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: SetBudgetLimitsRequest,
    response: { status: 200, schema: BudgetLimits },
    errors: [400, 401, 403, 404, 422],
  },
  spendCheck: {
    operationId: 'spendCheck',
    method: 'post',
    path: '/api/budgets/{budgetId}/spend-check',
    summary:
      'Check a new request against status, control mode, tolerance and limits (no side effects)',
    tags: ['budgets'],
    auth: true,
    params: BudgetParams,
    body: SpendCheckRequest,
    response: { status: 200, schema: SpendCheckResult },
    errors: [400, 401, 403, 404],
  },
  previewControl: {
    operationId: 'previewControl',
    method: 'post',
    path: '/api/budgets/{budgetId}/controls/preview',
    summary: 'Impact preview for freeze, reduce or set to zero',
    tags: ['budgets'],
    auth: true,
    params: BudgetParams,
    body: ControlPreviewRequest,
    response: { status: 200, schema: ControlImpact },
    errors: [400, 401, 403, 404],
  },
  freezeBudget: {
    operationId: 'freezeBudget',
    method: 'post',
    path: '/api/budgets/{budgetId}/freeze',
    summary: 'Freeze: block new requests and allocations while commitments complete',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: FreezeRequest,
    response: { status: 200, schema: ControlResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
  unfreezeBudget: {
    operationId: 'unfreezeBudget',
    method: 'post',
    path: '/api/budgets/{budgetId}/unfreeze',
    summary: 'Unfreeze a frozen budget',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: UnfreezeRequest,
    response: { status: 200, schema: ControlResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
  reduceBudget: {
    operationId: 'reduceBudget',
    method: 'post',
    path: '/api/budgets/{budgetId}/reduce',
    summary: 'Reduce authorized, floored, with a destination for the cut money',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: ReduceRequest,
    response: { status: 200, schema: ControlResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
  setBudgetToZero: {
    operationId: 'setBudgetToZero',
    method: 'post',
    path: '/api/budgets/{budgetId}/set-to-zero',
    summary: 'Set to zero down to the floor (optionally cascading to children)',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: SetToZeroRequest,
    response: { status: 200, schema: ControlResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
  restoreBudget: {
    operationId: 'restoreBudget',
    method: 'post',
    path: '/api/budgets/{budgetId}/restore',
    summary: 'Lift a set to zero so the budget accepts allocations again (no money returns)',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: RestoreRequest,
    response: { status: 200, schema: ControlResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
  transferBudget: {
    operationId: 'transferBudget',
    method: 'post',
    path: '/api/budgets/{budgetId}/transfers',
    summary: 'Transfer money to another budget of the same tree',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: TransferRequest,
    response: { status: 201, schema: TransferResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
  allocateBatch: {
    operationId: 'allocateBatch',
    method: 'post',
    path: '/api/budgets/{budgetId}/allocations/batch',
    summary: 'Allocation grid: preview, then post many allocations as one change',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: BatchAllocationRequest,
    response: { status: 200, schema: BatchAllocationResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
  allocationHistory: {
    operationId: 'allocationHistory',
    method: 'get',
    path: '/api/budgets/{budgetId}/allocation-history',
    summary: 'Allocations, increases, reductions and transfers in and out of a budget',
    tags: ['budgets'],
    auth: true,
    params: BudgetParams,
    response: { status: 200, schema: AllocationHistory },
    errors: [401, 403, 404],
  },
  budgetVersions: {
    operationId: 'budgetVersions',
    method: 'get',
    path: '/api/budgets/{budgetId}/versions',
    summary: 'Immutable version history with reasons',
    tags: ['budgets'],
    auth: true,
    params: BudgetParams,
    response: { status: 200, schema: BudgetVersionList },
    errors: [401, 403, 404],
  },
  getPhasing: {
    operationId: 'getPhasing',
    method: 'get',
    path: '/api/budgets/{budgetId}/phasing',
    summary: 'Period phasing with commitments and actuals per period',
    tags: ['budgets'],
    auth: true,
    params: BudgetParams,
    response: { status: 200, schema: BudgetPhasing },
    errors: [401, 403, 404],
  },
  setPhasing: {
    operationId: 'setPhasing',
    method: 'put',
    path: '/api/budgets/{budgetId}/phasing',
    summary: 'Phase authorized over the fiscal periods (even, seasonal or manual)',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: SetPhasingRequest,
    response: { status: 200, schema: BudgetPhasing },
    errors: [400, 401, 403, 404, 422],
  },
  allocatePerHead: {
    operationId: 'allocatePerHead',
    method: 'post',
    path: '/api/budgets/{budgetId}/per-head',
    summary: 'Per-head driver allocation: rate x eligible headcount from the HR import',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: PerHeadRequest,
    response: { status: 200, schema: PerHeadResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
  perHeadTrueUp: {
    operationId: 'perHeadTrueUp',
    method: 'post',
    path: '/api/budgets/{budgetId}/per-head/true-up',
    summary: 'Recalculate a per-head budget from the latest headcount and post the difference',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: TrueUpRequest,
    response: { status: 200, schema: PerHeadResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
  requestIncrease: {
    operationId: 'requestIncrease',
    method: 'post',
    path: '/api/budgets/{budgetId}/increase-requests',
    summary: 'Ask the parent budget for more money',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: CreateIncreaseRequest,
    response: { status: 201, schema: BudgetChangeRequest },
    errors: [400, 401, 403, 404, 409, 422],
  },
  requestContingencyRelease: {
    operationId: 'requestContingencyRelease',
    method: 'post',
    path: '/api/budgets/{budgetId}/releases',
    summary: 'Ask to release contingency reserve to a budget',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: CreateReleaseRequest,
    response: { status: 201, schema: BudgetChangeRequest },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listChangeRequests: {
    operationId: 'listChangeRequests',
    method: 'get',
    path: '/api/budget-requests',
    summary: 'Increase requests and contingency releases the user can see',
    tags: ['budgets'],
    auth: true,
    query: ChangeRequestQuery,
    response: { status: 200, schema: BudgetChangeRequestList },
    errors: [400, 401, 403],
  },
  decideChangeRequest: {
    operationId: 'decideChangeRequest',
    method: 'post',
    path: '/api/budget-requests/{requestId}/decision',
    summary: 'Approve (fully or partly) or reject an increase or contingency release',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: ChangeRequestParams,
    body: DecideChangeRequest,
    response: { status: 200, schema: BudgetChangeRequest },
    errors: [400, 401, 403, 404, 409, 422],
  },
  rollForward: {
    operationId: 'rollForward',
    method: 'post',
    path: '/api/budgets/{budgetId}/roll-forward',
    summary: "Clone a root budget's tree into another fiscal year",
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: RollForwardRequest,
    response: { status: 200, schema: RollForwardResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
  createBudget: {
    operationId: 'createBudget',
    method: 'post',
    path: '/api/budgets',
    summary: 'Create a root budget with its original amount, or an empty child budget',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    body: CreateBudgetRequest,
    response: { status: 201, schema: BudgetDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getBudget: {
    operationId: 'getBudget',
    method: 'get',
    path: '/api/budgets/{budgetId}',
    summary: 'A budget with ledger-derived balances',
    tags: ['budgets'],
    auth: true,
    params: BudgetParams,
    response: { status: 200, schema: BudgetDetail },
    errors: [401, 403, 404],
  },
  allocate: {
    operationId: 'allocate',
    method: 'post',
    path: '/api/budgets/{budgetId}/allocations',
    summary: 'Allocate to a child budget, checked against parent available at the locked plan rate',
    tags: ['budgets'],
    auth: true,
    idempotent: true,
    params: BudgetParams,
    body: AllocateRequest,
    response: { status: 201, schema: AllocationResponse },
    errors: [400, 401, 403, 404, 409, 422],
  },
  budgetLedger: {
    operationId: 'budgetLedger',
    method: 'get',
    path: '/api/budgets/{budgetId}/ledger',
    summary: 'Ledger lines posted to a budget',
    tags: ['ledger'],
    auth: true,
    params: BudgetParams,
    response: { status: 200, schema: LedgerLineList },
    errors: [401, 403, 404],
  },
} as const satisfies Record<string, Endpoint>;
