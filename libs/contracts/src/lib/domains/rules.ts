import { z } from 'zod';
import { CurrencyCode, CursorQuery, Id, IsoDate, IsoDateTime, Money, RoleId } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';
import { ApprovalChannel, ApprovalRouteView } from './approvals';

export const RULE_EFFECTS = [
  'block',
  'freeze',
  'require_approval',
  'warn',
  'auto_approve',
] as const;
export const RuleEffect = z.enum(RULE_EFFECTS);

export const RULE_STATUSES = ['draft', 'scheduled', 'active', 'expired', 'retired'] as const;
export const RuleStatus = z.enum(RULE_STATUSES);

export const FACT_KEYS = [
  'amount_reporting_minor',
  'amount_budget_minor',
  'amount_per_person_minor',
  'remaining_pct',
  'category',
  'spend_type',
  'location',
  'legal_entity',
  'requester_role',
  'seniority',
  'employee_count',
  'vendor_status',
  'attendee_type',
  'alcohol_requested',
  'is_cash_equivalent',
] as const;
export const FactKey = z.enum(FACT_KEYS);

export const CONDITION_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in'] as const;
export const ConditionOperator = z.enum(CONDITION_OPERATORS);

export const ConditionLeaf = named(
  'ConditionLeaf',
  z
    .object({
      kind: z.literal('leaf').optional().default('leaf'),
      fact: FactKey,
      op: ConditionOperator,
      value: z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.string()),
        z.array(z.number()),
      ]),
    })
    .strict(),
);

export const ConditionGroup = named(
  'ConditionGroup',
  z
    .object({
      kind: z.literal('group').optional().default('group'),
      logic: z.enum(['and', 'or']),
      conditions: z.array(ConditionLeaf).min(1).max(30),
    })
    .strict(),
);

export const RuleAction = named(
  'RuleAction',
  z
    .object({
      effect: RuleEffect,
      approvers: z
        .array(z.string().min(1).max(50))
        .optional()
        .describe('Roles or resolver steps required when effect is require_approval.'),
      mode: z.enum(['sequential', 'parallel']).optional(),
      notifyAudience: z.array(z.enum(['requester', 'approver', 'owner', 'finance'])).optional(),
      requireReceiptAboveMinor: z.int().min(0).optional(),
      message: z.string().max(500).optional(),
    })
    .strict(),
);

export const RuleScope = named(
  'RuleScope',
  z
    .object({
      orgUnitIds: z.array(Id).optional(),
      legalEntityCodes: z.array(z.string().max(30)).optional(),
      requestKinds: z.array(z.string().max(50)).optional(),
    })
    .strict(),
);

export const RuleConflictItem = named(
  'RuleConflictItem',
  z
    .object({
      ruleId: Id,
      ruleCode: z.string(),
      ruleName: z.string(),
      version: z.int(),
      priority: z.int(),
      effect: RuleEffect,
      winningEffect: RuleEffect,
      reason: z.string(),
      blocking: z.boolean(),
    })
    .strict(),
);

export const RuleVersionView = named(
  'RuleVersionView',
  z
    .object({
      id: Id,
      ruleId: Id,
      version: z.int(),
      status: RuleStatus,
      priority: z.int(),
      effect: RuleEffect,
      conditions: ConditionGroup,
      actions: z.array(RuleAction).min(1),
      scope: RuleScope,
      explanation: z.string(),
      validFrom: IsoDate,
      validTo: IsoDate.nullable(),
      publishedAt: IsoDateTime.nullable(),
      publishedByName: z.string().nullable(),
      createdByName: z.string().nullable(),
      createdAt: IsoDateTime,
      matchCount30d: z.int(),
    })
    .strict(),
);
export type RuleVersionView = z.infer<typeof RuleVersionView>;

export const RuleSummary = named(
  'RuleSummary',
  z
    .object({
      id: Id,
      code: z.string(),
      name: z.string(),
      family: z.string(),
      templateCode: z.string().nullable(),
      priority: z.int(),
      effect: RuleEffect,
      status: RuleStatus,
      activeVersion: z.int().nullable(),
      draftVersion: z.int().nullable(),
      scopeSummary: z.string(),
      matches30d: z.int(),
      validFrom: IsoDate.nullable(),
      validTo: IsoDate.nullable(),
      lastPublishedByName: z.string().nullable(),
      conflictsWith: z.array(z.string()),
    })
    .strict(),
);
export type RuleSummary = z.infer<typeof RuleSummary>;

export const RuleDetail = named(
  'RuleDetail',
  z
    .object({
      id: Id,
      code: z.string(),
      name: z.string(),
      family: z.string(),
      templateCode: z.string().nullable(),
      status: RuleStatus,
      active: RuleVersionView.nullable(),
      draft: RuleVersionView.nullable(),
      versions: z.array(RuleVersionView),
      conflicts: z.array(RuleConflictItem),
      backtestSummary: z
        .object({
          evaluatedCount: z.int(),
          changedCount: z.int(),
          stricterCount: z.int(),
          looserCount: z.int(),
          blockedCount: z.int(),
        })
        .strict(),
      allowedActions: z.array(z.string()),
    })
    .strict(),
);
export type RuleDetail = z.infer<typeof RuleDetail>;

export const RuleList = named('RuleList', z.object({ items: z.array(RuleSummary) }).strict());

export const RuleListQuery = z
  .object({
    status: RuleStatus.optional(),
    effect: RuleEffect.optional(),
    family: z.string().max(50).optional(),
    q: z.string().max(100).optional(),
    effectiveOn: IsoDate.optional(),
  })
  .strict();

export const RulesDashboard = named(
  'RulesDashboard',
  z
    .object({
      kpis: z
        .object({
          activeRules: z.int(),
          draftsAwaitingPublish: z.int(),
          conflicts: z.int(),
          scheduledToStart: z.int(),
          openExceptions: z.int(),
          approvalsPastSla: z.int(),
        })
        .strict(),
      weeklyDecisions: z.array(
        z
          .object({
            weekLabel: z.string(),
            autoApproved: z.int(),
            approvalRequired: z.int(),
            warned: z.int(),
            blocked: z.int(),
          })
          .strict(),
      ),
      mostMatchedRules: z.array(
        z
          .object({
            ruleId: Id,
            code: z.string(),
            name: z.string(),
            effect: RuleEffect,
            matches: z.int(),
            sharePct: z.number(),
            lastChange: IsoDate,
          })
          .strict(),
      ),
      needsAttention: z.array(
        z
          .object({
            id: z.string(),
            tone: z.enum(['important', 'warning', 'info']),
            title: z.string(),
            detail: z.string(),
            linkPath: z.string(),
          })
          .strict(),
      ),
      allowedActions: z.array(z.string()),
    })
    .strict(),
);
export type RulesDashboard = z.infer<typeof RulesDashboard>;

export const CreateRuleRequest = named(
  'CreateRuleRequest',
  z
    .object({
      mode: z.enum(['template', 'threshold_table', 'duplicate', 'blank']),
      name: z.string().trim().min(2).max(200),
      code: z.string().trim().min(2).max(30).optional(),
      family: z.string().max(50).optional(),
      priority: z.int().min(1).max(1000).optional(),
      templateCode: z.string().max(50).optional(),
      templateParams: z.record(z.string(), z.unknown()).optional(),
      duplicateFromRuleId: Id.optional(),
      conditions: ConditionGroup.optional(),
      actions: z.array(RuleAction).min(1).optional(),
      scope: RuleScope.optional(),
      explanation: z.string().trim().min(3).max(500).optional(),
      validFrom: IsoDate.optional(),
      validTo: IsoDate.nullable().optional(),
    })
    .strict(),
);
export type CreateRuleRequest = z.infer<typeof CreateRuleRequest>;

export const UpdateRuleDraftRequest = named(
  'UpdateRuleDraftRequest',
  z
    .object({
      name: z.string().trim().min(2).max(200).optional(),
      priority: z.int().min(1).max(1000),
      conditions: ConditionGroup,
      actions: z.array(RuleAction).min(1),
      scope: RuleScope,
      explanation: z.string().trim().min(3).max(500),
      validFrom: IsoDate,
      validTo: IsoDate.nullable().optional(),
    })
    .strict(),
);
export type UpdateRuleDraftRequest = z.infer<typeof UpdateRuleDraftRequest>;

export const PublishRuleRequest = named(
  'PublishRuleRequest',
  z
    .object({
      validFrom: IsoDate.optional(),
      validTo: IsoDate.nullable().optional(),
      reason: z.string().trim().max(500).optional(),
    })
    .strict(),
);

export const RetireRuleRequest = named(
  'RetireRuleRequest',
  z.object({ reason: z.string().trim().min(3).max(500) }).strict(),
);

export const RestoreRuleVersionRequest = named(
  'RestoreRuleVersionRequest',
  z.object({ version: z.int().min(1) }).strict(),
);

export const ReorderRulesRequest = named(
  'ReorderRulesRequest',
  z
    .object({
      items: z
        .array(z.object({ ruleId: Id, priority: z.int().min(1).max(1000) }).strict())
        .min(1)
        .max(200),
      reason: z.string().trim().max(500).optional(),
    })
    .strict(),
);

// Simulation (069 & 077) ------------------------------------------------------------------------

export const SimulationFactsInput = named(
  'SimulationFactsInput',
  z
    .object({
      amountMinor: z.int().min(1),
      currency: CurrencyCode.optional().default('USD'),
      remainingPct: z.number().min(0).max(100).optional().default(50),
      category: z.string().max(50).optional().default('employee_events'),
      spendType: z.string().max(50).optional().default('employee_events'),
      location: z.string().max(100).optional().default('Bengaluru'),
      legalEntity: z.string().max(30).optional().default('HYL-IN'),
      requesterRole: z.string().max(50).optional().default('event-organizer'),
      seniority: z.int().min(1).max(10).optional().default(3),
      employeeCount: z.int().min(1).max(10000).optional().default(20),
      vendorStatus: z
        .enum(['approved', 'preferred', 'blocked', 'unknown'])
        .optional()
        .default('approved'),
      attendeeType: z.enum(['employee', 'client']).optional().default('employee'),
      alcoholRequested: z.boolean().optional().default(false),
      isCashEquivalent: z.boolean().optional().default(false),
    })
    .strict(),
);
export type SimulationFactsInput = z.infer<typeof SimulationFactsInput>;

export const SimulatedMatch = named(
  'SimulatedMatch',
  z
    .object({
      ruleId: Id,
      ruleCode: z.string(),
      ruleName: z.string(),
      version: z.int(),
      priority: z.int(),
      effect: RuleEffect,
      approvers: z.array(z.string()),
      explanation: z.string(),
      decisive: z.boolean(),
      overridden: z.boolean(),
      matchedFacts: z.record(z.string(), z.unknown()),
    })
    .strict(),
);

export const SingleSimulationRequest = named(
  'SingleSimulationRequest',
  z
    .object({
      ruleId: Id.optional(),
      includeDraft: z.boolean().optional().default(true),
      draftOverride: UpdateRuleDraftRequest.optional(),
      facts: SimulationFactsInput,
    })
    .strict(),
);

export const SingleSimulationResponse = named(
  'SingleSimulationResponse',
  z
    .object({
      effect: z.enum(['block', 'freeze', 'require_approval', 'warn', 'auto_approve', 'none']),
      requiredApprovers: z.array(z.string()),
      decisiveRuleCode: z.string().nullable(),
      explanation: z.string(),
      matches: z.array(SimulatedMatch),
      conditionChecklist: z.array(
        z
          .object({
            label: z.string(),
            passed: z.boolean(),
            actualValue: z.string(),
          })
          .strict(),
      ),
    })
    .strict(),
);
export type SingleSimulationResponse = z.infer<typeof SingleSimulationResponse>;

export const BacktestRequest = named(
  'BacktestRequest',
  z
    .object({
      ruleId: Id.optional(),
      periodLabel: z.string().max(60).optional(),
      scopeLocation: z.string().max(100).optional(),
    })
    .strict(),
);

export const BacktestItem = named(
  'BacktestItem',
  z
    .object({
      requestId: Id,
      ref: z.string(),
      title: z.string(),
      requesterName: z.string(),
      budgetName: z.string(),
      location: z.string(),
      amount: Money,
      activeOutcome: z.string(),
      draftOutcome: z.string(),
      changeKind: z.enum(['unchanged', 'stricter', 'looser', 'blocked']),
      diffFact: z.string(),
      activeExplanation: z.string(),
      draftExplanation: z.string(),
    })
    .strict(),
);

export const BacktestResponse = named(
  'BacktestResponse',
  z
    .object({
      ruleId: Id.nullable(),
      ruleCode: z.string(),
      ruleName: z.string(),
      activeVersion: z.int().nullable(),
      draftVersion: z.int().nullable(),
      periodLabel: z.string(),
      totalEvaluated: z.int(),
      unchangedCount: z.int(),
      stricterCount: z.int(),
      looserCount: z.int(),
      nowBlockedCount: z.int(),
      conflictCount: z.int(),
      matrix: z.record(z.string(), z.record(z.string(), z.int())),
      items: z.array(BacktestItem),
    })
    .strict(),
);
export type BacktestResponse = z.infer<typeof BacktestResponse>;

// Version diff (078) ----------------------------------------------------------------------------

export const RuleVersionDiff = named(
  'RuleVersionDiff',
  z
    .object({
      ruleId: Id,
      ruleCode: z.string(),
      fromVersion: z.int(),
      toVersion: z.int(),
      summaryLines: z.array(
        z
          .object({
            kind: z.enum(['added', 'removed', 'changed', 'unchanged']),
            field: z.string(),
            before: z.string().nullable(),
            after: z.string().nullable(),
            text: z.string(),
          })
          .strict(),
      ),
      decisionsWithToVersion: z.int(),
    })
    .strict(),
);
export type RuleVersionDiff = z.infer<typeof RuleVersionDiff>;

// Templates & Threshold Table (071a) ------------------------------------------------------------

export const ThresholdBand = named(
  'ThresholdBand',
  z
    .object({
      minMinor: z.int().min(0),
      maxMinor: z.int().min(1).nullable(),
      approvers: z.array(z.string().min(1).max(50)).min(1),
    })
    .strict(),
);

export const ThresholdTableFamily = named(
  'ThresholdTableFamily',
  z
    .object({
      family: z.enum(['events_engagement', 'gifts_entertainment', 'contributions']),
      label: z.string(),
      remainingPctBelow: z.int().min(0).max(100),
      remainingApprover: z.string(),
      generatedRuleCode: z.string(),
      bands: z.array(ThresholdBand).min(1),
    })
    .strict(),
);

export const PolicyTemplateCard = named(
  'PolicyTemplateCard',
  z
    .object({
      code: z.string(),
      name: z.string(),
      description: z.string(),
      defaultEffect: RuleEffect,
      parameters: z.array(
        z
          .object({
            key: z.string(),
            label: z.string(),
            type: z.enum(['money_usd', 'percent', 'categories', 'boolean', 'select']),
            defaultValue: z.unknown(),
          })
          .strict(),
      ),
      usedByRuleCodes: z.array(z.string()),
    })
    .strict(),
);

export const TemplatesAndThresholdsView = named(
  'TemplatesAndThresholdsView',
  z
    .object({
      families: z.array(ThresholdTableFamily),
      templates: z.array(PolicyTemplateCard),
      allowedActions: z.array(z.string()),
    })
    .strict(),
);
export type TemplatesAndThresholdsView = z.infer<typeof TemplatesAndThresholdsView>;

export const UpdateThresholdTableRequest = named(
  'UpdateThresholdTableRequest',
  z
    .object({
      family: z.enum(['events_engagement', 'gifts_entertainment', 'contributions']),
      remainingPctBelow: z.int().min(0).max(100),
      bands: z.array(ThresholdBand).min(1),
      publish: z.boolean().optional().default(true),
    })
    .strict(),
);

// Approval Routing Workflow Builder (070) -------------------------------------------------------

export const WorkflowStepDef = named(
  'WorkflowStepDef',
  z
    .object({
      stepNo: z.int().min(1),
      label: z.string().trim().min(1).max(120),
      resolver: z.enum([
        'budget_owner',
        'parent_owner',
        'giving_director',
        'finance_review',
        'executive',
        'tax_approver',
      ]),
      mode: z.enum(['sequential', 'parallel']).default('sequential'),
      groupRule: z.enum(['any_one', 'all']).default('any_one'),
      conditionLabel: z.string().nullable().default(null),
      amountAboveMinor: z.int().min(0).nullable().default(null),
      remainingBelowPct: z.int().min(0).max(100).nullable().default(null),
      crossEntityOnly: z.boolean().default(false),
      fromThresholdTable: z.boolean().default(false),
      slaBusinessHours: z.int().min(1).max(720).default(48),
      applyDoa: z.boolean().default(true),
    })
    .strict(),
);

export const WorkflowRouteView = named(
  'WorkflowRouteView',
  z
    .object({
      id: Id,
      requestKind: z.enum([
        'spending',
        'budget',
        'additional_fund',
        'over_budget',
        'exception',
        'contribution',
      ]),
      label: z.string(),
      activeVersion: z.int(),
      draftVersion: z.int().nullable(),
      status: z.enum(['active', 'draft']),
      validFrom: IsoDate,
      steps: z.array(WorkflowStepDef),
      allowedActions: z.array(z.string()),
    })
    .strict(),
);
export type WorkflowRouteView = z.infer<typeof WorkflowRouteView>;

export const WorkflowRouteList = named(
  'WorkflowRouteList',
  z.object({ items: z.array(WorkflowRouteView) }).strict(),
);

export const SaveWorkflowRouteRequest = named(
  'SaveWorkflowRouteRequest',
  z
    .object({
      requestKind: z.enum([
        'spending',
        'budget',
        'additional_fund',
        'over_budget',
        'exception',
        'contribution',
      ]),
      steps: z.array(WorkflowStepDef).min(1),
      publish: z.boolean().optional().default(true),
      validFrom: IsoDate.optional(),
    })
    .strict(),
);

export const TestWorkflowRouteRequest = named(
  'TestWorkflowRouteRequest',
  z
    .object({
      requestKind: z.enum([
        'spending',
        'budget',
        'additional_fund',
        'over_budget',
        'exception',
        'contribution',
      ]),
      budgetId: Id,
      amountMinor: z.int().min(1),
      currency: CurrencyCode.optional().default('USD'),
      spendType: z.string().min(1).max(50).default('employee_events'),
      requesterPersonId: Id.optional(),
      legalEntityId: Id.optional(),
    })
    .strict(),
);

export const TestWorkflowRouteResponse = named(
  'TestWorkflowRouteResponse',
  z
    .object({
      route: ApprovalRouteView,
      matchedRuleCodes: z.array(z.string()),
    })
    .strict(),
);

// DoA Matrix Admin (070a) -----------------------------------------------------------------------

export const DoaAdminRow = named(
  'DoaAdminRow',
  z
    .object({
      id: Id.optional(),
      role: RoleId.nullable(),
      personId: Id.nullable(),
      personName: z.string().nullable().optional(),
      spendType: z.string().min(1).max(50),
      legalEntityId: Id.nullable(),
      legalEntityCode: z.string().nullable().optional(),
      limit: Money,
      validFrom: IsoDate,
      validTo: IsoDate.nullable(),
      changeMarker: z.enum(['unchanged', 'added', 'changed', 'removed']).optional(),
      previousLimitMinor: z.int().nullable().optional(),
    })
    .strict(),
);

export const DoaMatrixVersionSummary = named(
  'DoaMatrixVersionSummary',
  z
    .object({
      id: Id,
      version: z.int(),
      status: z.enum(['draft', 'awaiting_approval', 'active', 'scheduled', 'superseded']),
      validFrom: IsoDate,
      validTo: IsoDate.nullable(),
      approvedByName: z.string().nullable(),
      createdAt: IsoDateTime,
    })
    .strict(),
);

export const DoaMatrixAdminView = named(
  'DoaMatrixAdminView',
  z
    .object({
      versions: z.array(DoaMatrixVersionSummary),
      selectedVersion: DoaMatrixVersionSummary,
      activeVersion: DoaMatrixVersionSummary.nullable(),
      rows: z.array(DoaAdminRow),
      impact: z
        .object({
          openTasksAffected: z.int(),
          delegationsAffected: z.int(),
          referencingRuleCodes: z.array(z.string()),
        })
        .strict(),
      warnings: z.array(z.string()),
      allowedActions: z.array(z.string()),
    })
    .strict(),
);
export type DoaMatrixAdminView = z.infer<typeof DoaMatrixAdminView>;

export const SaveDoaDraftRequest = named(
  'SaveDoaDraftRequest',
  z
    .object({
      validFrom: IsoDate,
      rows: z
        .array(
          z
            .object({
              role: RoleId.nullable().optional(),
              personId: Id.nullable().optional(),
              spendType: z.string().min(1).max(50),
              legalEntityId: Id.nullable().optional(),
              limitMinor: z.int().min(1),
              currency: CurrencyCode.optional().default('USD'),
              validFrom: IsoDate.optional(),
              validTo: IsoDate.nullable().optional(),
            })
            .strict(),
        )
        .min(1),
      submitForApproval: z.boolean().optional().default(false),
    })
    .strict(),
);

export const ApproveDoaVersionRequest = named(
  'ApproveDoaVersionRequest',
  z
    .object({
      versionId: Id,
      comment: z.string().max(500).optional(),
    })
    .strict(),
);

// Policy Configuration Views (071, 072, 072a, 073, 073a, 074, 075, 076) -------------------------

export const SpendingLimitItem = named(
  'SpendingLimitItem',
  z
    .object({
      id: z.string(),
      name: z.string(),
      appliesTo: z.string(),
      measure: z.enum(['per_request', 'per_person_event', 'per_event', 'per_period']),
      location: z.string(),
      amountUsdMinor: z.int().min(1),
      referenceLocal: Money.nullable(),
      outcome: RuleEffect,
      validFrom: IsoDate,
      status: z.enum(['active', 'draft']),
    })
    .strict(),
);

export const EmployeeCapSummary = named(
  'EmployeeCapSummary',
  z
    .object({
      annualCapUsdMinor: z.int().min(1),
      includedCategories: z.array(z.string()),
      warnAtPct: z.int(),
      blockAtPct: z.int(),
      employeesNearestCap: z.array(
        z
          .object({
            personId: Id,
            displayName: z.string(),
            location: z.string(),
            usedMinor: z.int(),
            leftMinor: z.int(),
          })
          .strict(),
      ),
    })
    .strict(),
);

export const CategoryPolicyItem = named(
  'CategoryPolicyItem',
  z
    .object({
      categoryCode: z.string(),
      categoryName: z.string(),
      status: z.enum(['allowed', 'allowed_with_approval', 'not_allowed']),
      requesterGroups: z.array(z.string()),
      receiptAboveUsdMinor: z.int().min(0),
      itemisedReceipt: z.boolean(),
      attendeeListFromCount: z.int().min(1),
      approvalFamily: z.string(),
      employeeGlCode: z.string(),
      clientGlCode: z.string(),
      postSpendRecheck: z.boolean(),
      generatedRuleCodes: z.array(z.string()),
      explanation: z.string(),
    })
    .strict(),
);

export const GiftsEntertainmentPolicy = named(
  'GiftsEntertainmentPolicy',
  z
    .object({
      giftsEnabled: z.boolean(),
      giftCapPerRecipientMinor: z.int().min(1),
      giftAnnualCapMinor: z.int().min(1),
      blockCashEquivalents: z.boolean(),
      giftsOutcomeAboveCap: RuleEffect,
      locationOverrides: z.array(
        z
          .object({
            location: z.string(),
            localAmount: Money,
            usdEquivalentMinor: z.int(),
          })
          .strict(),
      ),
      entertainmentEnabled: z.boolean(),
      entertainmentCapPerAttendeeMinor: z.int().min(1),
      employeeGlCode: z.string(),
      clientGlCode: z.string(),
      alcoholEnabled: z.boolean(),
      alcoholAllowedAtApprovedEvents: z.boolean(),
      alcoholCapPerAttendeeMinor: z.int().min(1),
      postSpendRecheck: z.boolean(),
      generatedRuleCodes: z.array(z.string()),
    })
    .strict(),
);

export const LocationPolicyRow = named(
  'LocationPolicyRow',
  z
    .object({
      orgUnitId: Id,
      locationName: z.string(),
      localCurrency: CurrencyCode,
      planRateToUsd: z.string(),
      teamEventsPerPersonUsdMinor: z.int().min(1),
      teamMealsPerPersonUsdMinor: z.int().min(1),
      teamMealsLocalMinor: z.int().min(1),
      alcoholPolicy: z.enum(['not_allowed', 'approved_events']),
      receiptAboveUsdMinor: z.int().min(1),
      overriddenFields: z.array(z.string()),
      ruleCode: z.string(),
      validFrom: IsoDate,
    })
    .strict(),
);

export const VendorControlItem = named(
  'VendorControlItem',
  z
    .object({
      vendorId: Id,
      vendorName: z.string(),
      category: z.string().nullable(),
      country: z.string().nullable(),
      locations: z.array(z.string()),
      status: z.enum(['preferred', 'approved', 'blocked', 'unknown']),
      reasonCode: z.string().nullable(),
      reason: z.string().nullable(),
      validFrom: IsoDate,
      validTo: IsoDate.nullable(),
      requests90d: z.int(),
      actualSpend90dUsdMinor: z.int(),
      openCommitmentsCount: z.int(),
    })
    .strict(),
);

export const OverBudgetPolicyView = named(
  'OverBudgetPolicyView',
  z
    .object({
      hardModeToleranceBps: z.int(),
      softModeTolerancePct: z.int().min(0).max(25),
      softModeCapUsdMinor: z.int().min(1),
      parentOwnerApprovesUpToUsdMinor: z.int().min(1),
      financeControllerAbove: z.boolean(),
      offerContributionFirst: z.boolean(),
      justificationRequired: z.boolean(),
      commitmentTolerancePct: z.int().min(0).max(25),
      commitmentToleranceCapUsdMinor: z.int().min(1),
      ruleCode: z.string(),
      nonDefaultBudgets: z.array(
        z
          .object({
            budgetId: Id,
            budgetName: z.string(),
            controlMode: z.enum(['hard', 'soft', 'track']),
            toleranceBps: z.int(),
          })
          .strict(),
      ),
    })
    .strict(),
);

export const FreezeZeroPolicyView = named(
  'FreezeZeroPolicyView',
  z
    .object({
      freezeAllowedRoles: z.array(RoleId).min(1),
      freezeReasonCodes: z.array(z.string()).min(1),
      freezePendingPolicy: z.literal('hold'),
      reduceAllowedRoles: z.array(RoleId).min(1),
      reduceDestinations: z.array(z.enum(['parent', 'savings', 'reallocation'])),
      zeroAllowedRoles: z.array(RoleId).min(1),
      zeroReasonCodes: z.array(z.string()).min(1),
      zeroPendingPolicy: z.literal('cancel'),
      autoFreezeAt100PctHard: z.boolean(),
      autoFreezeOnOwnerDeparture: z.boolean(),
      notifyParentAt90Pct: z.boolean(),
      hardModeBudgetCount: z.int(),
      generatedRuleCodes: z.array(z.string()),
    })
    .strict(),
);

export const SlaStepPolicy = named(
  'SlaStepPolicy',
  z
    .object({
      stepType: z.enum([
        'budget_owner',
        'parent_owner',
        'finance_controller',
        'ceo',
        'tax_approver',
        'giving_director',
      ]),
      label: z.string(),
      slaBusinessDays: z.int().min(1).max(30),
      slaBusinessHours: z.int().min(1).max(720),
      remindAt50Pct: z.boolean(),
      remind1HourBeforeDue: z.boolean(),
      escalateTo: z.enum(['next_doa_authority', 'finance_controller', 'ceo']),
      originalApproverKeepsRight: z.boolean(),
    })
    .strict(),
);

export const NotificationEventMatrixRow = named(
  'NotificationEventMatrixRow',
  z
    .object({
      eventKey: z.string(),
      label: z.string(),
      required: z.boolean(),
      audiences: z.array(z.enum(['requester', 'approver', 'owner', 'finance'])),
      inApp: z.boolean(),
      email: z.boolean(),
    })
    .strict(),
);

export const SlaAndNotificationPolicy = named(
  'SlaAndNotificationPolicy',
  z
    .object({
      steps: z.array(SlaStepPolicy),
      quietHoursStart: z.string(),
      quietHoursEnd: z.string(),
      dailyApproverDigest: z.boolean(),
      dailyDigestTimeLocal: z.string(),
      events: z.array(NotificationEventMatrixRow),
    })
    .strict(),
);

export const PolicyConfigsBundle = named(
  'PolicyConfigsBundle',
  z
    .object({
      spendingLimits: z.object({
        items: z.array(SpendingLimitItem),
        employeeCap: EmployeeCapSummary,
      }),
      categories: z.array(CategoryPolicyItem),
      giftsEntertainment: GiftsEntertainmentPolicy,
      locations: z.array(LocationPolicyRow),
      vendors: z.object({
        unknownVendorPolicy: z.enum(['allow', 'warn_quote', 'require_fc', 'block']),
        items: z.array(VendorControlItem),
      }),
      overBudget: OverBudgetPolicyView,
      freezeZero: FreezeZeroPolicyView,
      slaNotifications: SlaAndNotificationPolicy,
      allowedActions: z.array(z.string()),
    })
    .strict(),
);
export type PolicyConfigsBundle = z.infer<typeof PolicyConfigsBundle>;

export const UpdatePolicySectionRequest = named(
  'UpdatePolicySectionRequest',
  z
    .object({
      section: z.enum([
        'spending_limits',
        'employee_cap',
        'category_policy',
        'gifts_entertainment',
        'location_policy',
        'vendor_control',
        'over_budget',
        'freeze_zero',
        'sla_notifications',
      ]),
      payload: z.record(z.string(), z.unknown()),
      reason: z.string().trim().max(500).optional(),
    })
    .strict(),
);

// Post-spend exception queue (074a) -------------------------------------------------------------

export const EXCEPTION_TYPES = [
  'alcohol_over_cap',
  'blocked_vendor',
  'missing_receipt',
  'gifts_over_cap',
  'split_purchase',
  'duplicate_spend',
] as const;
export const ExceptionType = z.enum(EXCEPTION_TYPES);

export const EXCEPTION_STATUSES = ['open', 'explained', 'resolved'] as const;
export const ExceptionStatus = z.enum(EXCEPTION_STATUSES);

export const EXCEPTION_RESOLUTIONS = [
  'accept_with_reason',
  'ask_repayment',
  'reclassify',
  'mark_duplicate',
  'not_an_exception',
] as const;
export const ExceptionResolution = z.enum(EXCEPTION_RESOLUTIONS);

export const PostSpendExceptionItem = named(
  'PostSpendExceptionItem',
  z
    .object({
      id: Id,
      raisedAt: IsoDateTime,
      type: ExceptionType,
      typeLabel: z.string(),
      status: ExceptionStatus,
      sourceKind: z.enum(['actual', 'request']),
      sourceRef: z.string(),
      sourceId: Id.nullable(),
      budgetId: Id,
      budgetName: z.string(),
      location: z.string(),
      personName: z.string(),
      transactionAmount: Money,
      reportingAmount: Money,
      ruleCode: z.string(),
      ruleVersion: z.int(),
      ageDays: z.int(),
      summary: z.string(),
      facts: z.record(z.string(), z.unknown()),
      relatedItems: z.array(
        z
          .object({
            ref: z.string(),
            date: IsoDate,
            amount: Money,
            reportingAmount: Money,
            description: z.string(),
          })
          .strict(),
      ),
      ownerExplanation: z.string().nullable(),
      resolution: ExceptionResolution.nullable(),
      resolutionReasonCode: z.string().nullable(),
      resolutionReason: z.string().nullable(),
      repaymentAmount: Money.nullable(),
      reclassifiedToGlCode: z.string().nullable(),
      reversalJournalId: Id.nullable(),
      resolvedByName: z.string().nullable(),
      resolvedAt: IsoDateTime.nullable(),
      allowedActions: z.array(z.enum(['resolve', 'explain'])),
    })
    .strict(),
);
export type PostSpendExceptionItem = z.infer<typeof PostSpendExceptionItem>;

export const PostSpendExceptionList = named(
  'PostSpendExceptionList',
  z
    .object({
      items: z.array(PostSpendExceptionItem),
      counts: z.object({ open: z.int(), explained: z.int(), resolved: z.int() }).strict(),
    })
    .strict(),
);

export const ExceptionListQuery = z
  .object({
    type: ExceptionType.optional(),
    status: ExceptionStatus.optional(),
    budgetId: Id.optional(),
    location: z.string().max(100).optional(),
  })
  .strict();

export const ResolveExceptionRequest = named(
  'ResolveExceptionRequest',
  z
    .object({
      action: z.enum(['resolve', 'explain']),
      resolution: ExceptionResolution.optional(),
      reasonCode: z.string().trim().min(1).max(50).optional(),
      reason: z.string().trim().min(3).max(1000),
      repaymentMinor: z.int().min(1).optional(),
      reclassifyGlCode: z.string().max(30).optional(),
    })
    .strict(),
);

// Approval History (090) & SLA Escalation Job ---------------------------------------------------

export const ApprovalHistoryItem = named(
  'ApprovalHistoryItem',
  z
    .object({
      actionId: Id,
      taskId: Id,
      decidedAt: IsoDateTime,
      subjectType: z.enum(['request', 'contribution']),
      subjectId: Id,
      ref: z.string(),
      title: z.string(),
      requestKind: z.string(),
      requesterName: z.string(),
      budgetId: Id,
      budgetName: z.string(),
      amount: Money,
      reportingAmount: Money,
      decision: z.string(),
      approverPersonId: Id,
      approverName: z.string(),
      onBehalfOfName: z.string().nullable(),
      doaLimit: Money.nullable(),
      doaMatrixVersion: z.int(),
      channel: ApprovalChannel,
      timeToDecideMinutes: z.int(),
      timeToDecideLabel: z.string(),
      ruleVersions: z.array(z.string()),
      slaStatus: z.enum(['within_sla', 'breached']),
      escalated: z.boolean(),
      delegated: z.boolean(),
      comment: z.string().nullable(),
      auditEventId: Id.nullable(),
      explanation: z.array(z.string()),
    })
    .strict(),
);
export type ApprovalHistoryItem = z.infer<typeof ApprovalHistoryItem>;

export const ApprovalHistoryResponse = named(
  'ApprovalHistoryResponse',
  z
    .object({
      summary: z
        .object({
          totalDecisions: z.int(),
          medianMinutes: z.int(),
          medianLabel: z.string(),
          escalationPct: z.number(),
          emailPct: z.number(),
        })
        .strict(),
      items: z.array(ApprovalHistoryItem),
    })
    .strict(),
);
export type ApprovalHistoryResponse = z.infer<typeof ApprovalHistoryResponse>;

export const ApprovalHistoryQuery = CursorQuery.extend({
  decision: z.string().max(30).optional(),
  approverPersonId: Id.optional(),
  budgetId: Id.optional(),
  channel: ApprovalChannel.optional(),
  delegatedOnly: z.enum(['true', 'false']).optional(),
  escalatedOnly: z.enum(['true', 'false']).optional(),
  aboveSlaOnly: z.enum(['true', 'false']).optional(),
  ruleCode: z.string().max(30).optional(),
}).strict();
export type ApprovalHistoryQuery = z.infer<typeof ApprovalHistoryQuery>;

export const SlaSweepRequest = named(
  'SlaSweepRequest',
  z.object({ asOf: IsoDateTime.optional() }).strict(),
);

export const SlaSweepResponse = named(
  'SlaSweepResponse',
  z
    .object({
      evaluatedTasks: z.int(),
      escalatedCount: z.int(),
      escalatedTaskIds: z.array(Id),
    })
    .strict(),
);
export type SlaSweepResponse = z.infer<typeof SlaSweepResponse>;

// Counter-offer on requests (065) ---------------------------------------------------------------

export const CounterOfferBody = named(
  'CounterOfferBody',
  z
    .object({
      offeredAmount: Money,
      comment: z.string().trim().min(3).max(2000),
      reasonCode: z.string().trim().max(50).optional(),
    })
    .strict(),
);

const RuleParams = z.object({ ruleId: Id }).strict();
const ExceptionParams = z.object({ exceptionId: Id }).strict();

export const rulesEndpoints = {
  getRulesDashboard: {
    operationId: 'getRulesDashboard',
    method: 'get',
    path: '/api/rules/dashboard',
    summary:
      'Rules and policies overview: KPIs, 30-day decisions, top matched rules and attention items',
    tags: ['rules'],
    auth: true,
    response: { status: 200, schema: RulesDashboard },
    errors: [401, 403],
  },
  listRules: {
    operationId: 'listRules',
    method: 'get',
    path: '/api/rules',
    summary: 'List rules with priority, status, active/draft versions and conflict markers',
    tags: ['rules'],
    auth: true,
    query: RuleListQuery,
    response: { status: 200, schema: RuleList },
    errors: [400, 401, 403],
  },
  createRule: {
    operationId: 'createRule',
    method: 'post',
    path: '/api/rules',
    summary: 'Create a draft rule from a template, threshold table, duplicate or blank builder',
    tags: ['rules'],
    auth: true,
    idempotent: true,
    body: CreateRuleRequest,
    response: { status: 201, schema: RuleDetail },
    errors: [400, 401, 403, 409, 422],
  },
  reorderRules: {
    operationId: 'reorderRules',
    method: 'post',
    path: '/api/rules/reorder',
    summary: 'Change rule priorities and create new versions for moved rules',
    tags: ['rules'],
    auth: true,
    idempotent: true,
    body: ReorderRulesRequest,
    response: { status: 200, schema: RuleList },
    errors: [400, 401, 403, 422],
  },
  getRule: {
    operationId: 'getRule',
    method: 'get',
    path: '/api/rules/{ruleId}',
    summary: 'Get a rule with its active version, draft, version history and conflict check',
    tags: ['rules'],
    auth: true,
    params: RuleParams,
    response: { status: 200, schema: RuleDetail },
    errors: [401, 403, 404],
  },
  updateRuleDraft: {
    operationId: 'updateRuleDraft',
    method: 'put',
    path: '/api/rules/{ruleId}/draft',
    summary:
      'Save edits to a rule draft (creates a new draft version if only an active version exists)',
    tags: ['rules'],
    auth: true,
    idempotent: true,
    params: RuleParams,
    body: UpdateRuleDraftRequest,
    response: { status: 200, schema: RuleDetail },
    errors: [400, 401, 403, 404, 422],
  },
  publishRule: {
    operationId: 'publishRule',
    method: 'post',
    path: '/api/rules/{ruleId}/publish',
    summary: 'Publish a rule draft as an immutable active version (blocked while conflicts exist)',
    tags: ['rules'],
    auth: true,
    idempotent: true,
    params: RuleParams,
    body: PublishRuleRequest,
    response: { status: 200, schema: RuleDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  retireRule: {
    operationId: 'retireRule',
    method: 'post',
    path: '/api/rules/{ruleId}/retire',
    summary: 'Retire an active rule with a reason',
    tags: ['rules'],
    auth: true,
    idempotent: true,
    params: RuleParams,
    body: RetireRuleRequest,
    response: { status: 200, schema: RuleDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  restoreRuleVersion: {
    operationId: 'restoreRuleVersion',
    method: 'post',
    path: '/api/rules/{ruleId}/restore',
    summary: 'Copy an older version into a new draft version',
    tags: ['rules'],
    auth: true,
    idempotent: true,
    params: RuleParams,
    body: RestoreRuleVersionRequest,
    response: { status: 200, schema: RuleDetail },
    errors: [400, 401, 403, 404, 422],
  },
  compareRuleVersions: {
    operationId: 'compareRuleVersions',
    method: 'get',
    path: '/api/rules/{ruleId}/diff',
    summary: 'Compare two versions of a rule in plain English',
    tags: ['rules'],
    auth: true,
    params: RuleParams,
    query: z
      .object({
        fromVersion: z.coerce.number().int().min(1).optional(),
        toVersion: z.coerce.number().int().min(1).optional(),
      })
      .strict(),
    response: { status: 200, schema: RuleVersionDiff },
    errors: [400, 401, 403, 404],
  },
  simulateSingleRequest: {
    operationId: 'simulateSingleRequest',
    method: 'post',
    path: '/api/rules/simulate',
    summary: 'Evaluate a test request against active and draft rules with no side effects',
    tags: ['rules'],
    auth: true,
    body: SingleSimulationRequest,
    response: { status: 200, schema: SingleSimulationResponse },
    errors: [400, 401, 403, 422],
  },
  runRuleBacktest: {
    operationId: 'runRuleBacktest',
    method: 'post',
    path: '/api/rules/backtest',
    summary: 'Backtest draft rules against historical requests with no side effects',
    tags: ['rules'],
    auth: true,
    idempotent: true,
    body: BacktestRequest,
    response: { status: 200, schema: BacktestResponse },
    errors: [400, 401, 403, 422],
  },
  getTemplatesAndThresholds: {
    operationId: 'getTemplatesAndThresholds',
    method: 'get',
    path: '/api/rules/templates-thresholds',
    summary: 'Approval threshold bands and policy templates',
    tags: ['rules'],
    auth: true,
    response: { status: 200, schema: TemplatesAndThresholdsView },
    errors: [401, 403],
  },
  updateThresholdTable: {
    operationId: 'updateThresholdTable',
    method: 'put',
    path: '/api/rules/templates-thresholds',
    summary: 'Validate and publish an approval threshold band table',
    tags: ['rules'],
    auth: true,
    idempotent: true,
    body: UpdateThresholdTableRequest,
    response: { status: 200, schema: TemplatesAndThresholdsView },
    errors: [400, 401, 403, 422],
  },
  listWorkflowRoutes: {
    operationId: 'listWorkflowRoutes',
    method: 'get',
    path: '/api/rules/routing',
    summary: 'Approval workflow routes per request kind',
    tags: ['rules'],
    auth: true,
    response: { status: 200, schema: WorkflowRouteList },
    errors: [401, 403],
  },
  saveWorkflowRoute: {
    operationId: 'saveWorkflowRoute',
    method: 'put',
    path: '/api/rules/routing',
    summary: 'Validate and publish an approval routing workflow',
    tags: ['rules'],
    auth: true,
    idempotent: true,
    body: SaveWorkflowRouteRequest,
    response: { status: 200, schema: WorkflowRouteView },
    errors: [400, 401, 403, 422],
  },
  testWorkflowRoute: {
    operationId: 'testWorkflowRoute',
    method: 'post',
    path: '/api/rules/routing/test',
    summary: 'Test an approval workflow route against a sample request (no side effects)',
    tags: ['rules'],
    auth: true,
    body: TestWorkflowRouteRequest,
    response: { status: 200, schema: TestWorkflowRouteResponse },
    errors: [400, 401, 403, 404, 422],
  },
  getDoaMatrixAdmin: {
    operationId: 'getDoaMatrixAdmin',
    method: 'get',
    path: '/api/rules/doa-admin',
    summary: 'Delegation-of-authority matrix versions, draft comparison and impact',
    tags: ['rules'],
    auth: true,
    query: z.object({ versionId: Id.optional() }).strict(),
    response: { status: 200, schema: DoaMatrixAdminView },
    errors: [401, 403, 404],
  },
  saveDoaMatrixDraft: {
    operationId: 'saveDoaMatrixDraft',
    method: 'put',
    path: '/api/rules/doa-admin',
    summary: 'Create or update a draft DoA matrix version and optionally submit for CEO approval',
    tags: ['rules'],
    auth: true,
    idempotent: true,
    body: SaveDoaDraftRequest,
    response: { status: 200, schema: DoaMatrixAdminView },
    errors: [400, 401, 403, 409, 422],
  },
  approveDoaMatrixVersion: {
    operationId: 'approveDoaMatrixVersion',
    method: 'post',
    path: '/api/rules/doa-admin/approve',
    summary: 'Approve and activate a submitted DoA matrix version (cannot self-approve)',
    tags: ['rules'],
    auth: true,
    idempotent: true,
    body: ApproveDoaVersionRequest,
    response: { status: 200, schema: DoaMatrixAdminView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getPolicyConfigs: {
    operationId: 'getPolicyConfigs',
    method: 'get',
    path: '/api/rules/policies',
    summary:
      'Spending limits, categories, gifts/entertainment/alcohol, locations, vendors, over-budget, freeze/zero and SLA policies',
    tags: ['rules'],
    auth: true,
    response: { status: 200, schema: PolicyConfigsBundle },
    errors: [401, 403],
  },
  updatePolicyConfig: {
    operationId: 'updatePolicyConfig',
    method: 'put',
    path: '/api/rules/policies',
    summary: 'Validate and publish a policy configuration section as an audited rule version',
    tags: ['rules'],
    auth: true,
    idempotent: true,
    body: UpdatePolicySectionRequest,
    response: { status: 200, schema: PolicyConfigsBundle },
    errors: [400, 401, 403, 409, 422],
  },
  listPostSpendExceptions: {
    operationId: 'listPostSpendExceptions',
    method: 'get',
    path: '/api/rules/exceptions',
    summary:
      'Post-spend policy exceptions queue (alcohol over cap, blocked vendors, split purchases, duplicates, missing receipts)',
    tags: ['rules'],
    auth: true,
    query: ExceptionListQuery,
    response: { status: 200, schema: PostSpendExceptionList },
    errors: [400, 401, 403],
  },
  resolvePostSpendException: {
    operationId: 'resolvePostSpendException',
    method: 'post',
    path: '/api/rules/exceptions/{exceptionId}/resolve',
    summary: 'Resolve or explain a post-spend policy exception (reclassifications post reversals)',
    tags: ['rules'],
    auth: true,
    idempotent: true,
    params: ExceptionParams,
    body: ResolveExceptionRequest,
    response: { status: 200, schema: PostSpendExceptionItem },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listApprovalHistory: {
    operationId: 'listApprovalHistory',
    method: 'get',
    path: '/api/approvals/history',
    summary:
      'Searchable record of approval decisions with authority, channel, rule versions and SLA',
    tags: ['approvals'],
    auth: true,
    query: ApprovalHistoryQuery,
    response: { status: 200, schema: ApprovalHistoryResponse },
    errors: [400, 401, 403],
  },
  runSlaEscalationSweep: {
    operationId: 'runSlaEscalationSweep',
    method: 'post',
    path: '/api/approvals/sla-sweep',
    summary: 'Evaluate overdue approval tasks and escalate them idempotently by DoA',
    tags: ['approvals'],
    auth: true,
    idempotent: true,
    body: SlaSweepRequest,
    response: { status: 200, schema: SlaSweepResponse },
    errors: [401, 403],
  },
} as const satisfies Record<string, Endpoint>;

export type ThresholdBand = z.infer<typeof ThresholdBand>;
export type ThresholdTableFamily = z.infer<typeof ThresholdTableFamily>;
export type PolicyTemplateCard = z.infer<typeof PolicyTemplateCard>;
export type WorkflowStepDef = z.infer<typeof WorkflowStepDef>;
export type RuleAction = z.infer<typeof RuleAction>;
export type ConditionGroup = z.infer<typeof ConditionGroup>;
export type ConditionLeaf = z.infer<typeof ConditionLeaf>;
export type RuleScope = z.infer<typeof RuleScope>;
export type SlaStepPolicy = z.infer<typeof SlaStepPolicy>;
export type NotificationEventMatrixRow = z.infer<typeof NotificationEventMatrixRow>;
export type SpendingLimitItem = z.infer<typeof SpendingLimitItem>;
export type CategoryPolicyItem = z.infer<typeof CategoryPolicyItem>;
export type GiftsEntertainmentPolicy = z.infer<typeof GiftsEntertainmentPolicy>;
export type LocationPolicyRow = z.infer<typeof LocationPolicyRow>;
export type VendorControlItem = z.infer<typeof VendorControlItem>;
export type OverBudgetPolicyView = z.infer<typeof OverBudgetPolicyView>;
export type FreezeZeroPolicyView = z.infer<typeof FreezeZeroPolicyView>;
export type EmployeeCapSummary = z.infer<typeof EmployeeCapSummary>;
export type SlaAndNotificationPolicy = z.infer<typeof SlaAndNotificationPolicy>;
export type DoaAdminRow = z.infer<typeof DoaAdminRow>;
export type DoaMatrixVersionSummary = z.infer<typeof DoaMatrixVersionSummary>;
export type RuleConflictItem = z.infer<typeof RuleConflictItem>;
export type SimulatedMatch = z.infer<typeof SimulatedMatch>;
export type BacktestItem = z.infer<typeof BacktestItem>;
