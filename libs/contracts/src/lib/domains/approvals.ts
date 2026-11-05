import { z } from 'zod';
import { CursorQuery, Id, IsoDate, IsoDateTime, Money } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';
import { DocumentSummary } from './documents';

export const APPROVAL_RESOLVERS = [
  'budget_owner',
  'parent_owner',
  'giving_director',
  'finance_review',
  'executive',
] as const;
export const ApprovalResolver = z.enum(APPROVAL_RESOLVERS);

export const APPROVAL_TASK_STATUSES = [
  'waiting',
  'pending',
  'approved',
  'partially_approved',
  'rejected',
  'changes_requested',
  'escalated',
  'cancelled',
] as const;
export const ApprovalTaskStatus = z.enum(APPROVAL_TASK_STATUSES);
export const ApprovalSubjectType = z.enum(['request', 'contribution']);
export const ApprovalChannel = z.enum(['web', 'email', 'slack', 'teams', 'mobile', 'api']);

export const ActivityEntry = named(
  'ActivityEntry',
  z
    .object({
      id: Id,
      at: IsoDateTime,
      actorName: z.string().nullable(),
      onBehalfOfName: z.string().nullable(),
      action: z.string().describe('Audit action, for example request.submitted.'),
      summary: z.string().describe('Plain-English line for the activity timeline.'),
      reason: z.string().nullable(),
      channel: z.string().nullable(),
    })
    .strict(),
);
export type ActivityEntry = z.infer<typeof ActivityEntry>;

export const RouteStepView = named(
  'RouteStepView',
  z
    .object({
      stepNo: z.int(),
      taskId: Id.nullable(),
      personId: Id,
      personName: z.string(),
      resolver: ApprovalResolver,
      reason: z.string(),
      limit: Money.nullable().describe("The approver's delegation-of-authority limit used."),
      status: ApprovalTaskStatus,
      decidedAt: IsoDateTime.nullable(),
      actedByName: z.string().nullable(),
      onBehalfOfName: z.string().nullable(),
      comment: z.string().nullable(),
      channel: ApprovalChannel.nullable(),
      dueAt: IsoDateTime.nullable(),
    })
    .strict(),
);

export const ApprovalRouteView = named(
  'ApprovalRouteView',
  z
    .object({
      steps: z.array(RouteStepView),
      skipped: z.array(
        z
          .object({
            personName: z.string(),
            reason: z.enum(['requester', 'beneficiary', 'attendee', 'no_authority', 'above_limit']),
            detail: z.string(),
          })
          .strict(),
      ),
      explanation: z.array(z.string()).describe('Why this route: the rule reasons, in order.'),
    })
    .strict(),
);
export type ApprovalRouteView = z.infer<typeof ApprovalRouteView>;

export const BudgetImpact = named(
  'BudgetImpact',
  z
    .object({
      budgetId: Id,
      budgetName: z.string(),
      budgetStatus: z.string(),
      controlMode: z.enum(['hard', 'soft', 'track']),
      authorized: Money,
      approvedCommitments: Money.describe('Encumbered.'),
      pending: Money.describe('Pre-encumbered, this request included while it is pending.'),
      held: Money.describe('Earmarks (event funding and Inter-Director contributions).'),
      actual: Money,
      thisRequest: Money.describe('This request in the budget currency at the locked plan rate.'),
      availableBefore: Money.describe("Available under this budget's rules without this request."),
      availableAfter: Money.describe("Available under this budget's rules once this is approved."),
      companyWideAvailable: Money.describe(
        'Authorized − pre-encumbered − encumbered − actual (the company-wide definition).',
      ),
      runRateMonthly: Money.describe('Committed and spent per elapsed month of the fiscal year.'),
      projectedYearEnd: Money.describe('Run rate extended to the end of the fiscal year.'),
      utilizationAfterPct: z.int().describe('Percent of authorized used once approved.'),
      warning: z.string().nullable().describe('Soft warning (can proceed).'),
      blocked: z
        .string()
        .nullable()
        .describe('Hard block reason (frozen, set to zero, over budget).'),
      blockedCode: z.string().nullable(),
    })
    .strict()
    .describe('Budget impact card shown to approvers and requesters.'),
);
export type BudgetImpact = z.infer<typeof BudgetImpact>;

export const HygieneCheck = named(
  'HygieneCheck',
  z
    .object({
      code: z.enum([
        'not_requester',
        'not_beneficiary',
        'not_attendee',
        'within_doa',
        'budget_open',
      ]),
      label: z.string(),
      passed: z.boolean(),
      detail: z.string(),
    })
    .strict(),
);

export const ApprovalTaskSummary = named(
  'ApprovalTaskSummary',
  z
    .object({
      taskId: Id,
      subjectType: ApprovalSubjectType,
      subjectId: Id,
      ref: z.string(),
      title: z.string(),
      kindLabel: z.string(),
      requesterName: z.string(),
      budgetId: Id,
      budgetName: z.string(),
      eventName: z.string().nullable(),
      amount: Money,
      budgetAmount: Money,
      taskStatus: ApprovalTaskStatus,
      subjectStatus: z.string(),
      stepNo: z.int(),
      dueAt: IsoDateTime.nullable(),
      createdAt: IsoDateTime,
      decidedAt: IsoDateTime.nullable(),
      delegatedFromName: z.string().nullable().describe('Set when the viewer acts as a delegate.'),
      escalated: z.boolean(),
      onHold: z.boolean(),
      holdReason: z.string().nullable(),
    })
    .strict(),
);
export type ApprovalTaskSummary = z.infer<typeof ApprovalTaskSummary>;

export const INBOX_TABS = ['assigned', 'delegated', 'escalated', 'completed'] as const;
export const ApprovalInbox = named(
  'ApprovalInbox',
  z
    .object({
      items: z.array(ApprovalTaskSummary),
      counts: z
        .object({ assigned: z.int(), delegated: z.int(), escalated: z.int(), completed: z.int() })
        .strict(),
      nextCursor: z.string().nullable(),
    })
    .strict(),
);
export type ApprovalInbox = z.infer<typeof ApprovalInbox>;
export const InboxQuery = CursorQuery.extend({ tab: z.enum(INBOX_TABS).optional() }).strict();

export const DECISIONS = [
  'approve',
  'approve_partial',
  'reject',
  'request_changes',
  'escalate',
] as const;
export const Decision = z.enum(DECISIONS);

export const ApprovalTaskDetail = named(
  'ApprovalTaskDetail',
  z
    .object({
      task: ApprovalTaskSummary,
      purpose: z.string(),
      eventId: Id.nullable(),
      spendType: z.string(),
      impact: BudgetImpact.nullable().describe('Null for viewers who may not see the budget.'),
      route: ApprovalRouteView,
      checks: z.array(HygieneCheck),
      doa: z
        .object({
          limit: Money.nullable(),
          withinLimit: z.boolean(),
          message: z.string(),
          onBehalfOfName: z.string().nullable(),
        })
        .strict(),
      ruleReason: z.string(),
      allowedDecisions: z.array(Decision),
      documents: z.array(DocumentSummary),
      contributionMode: z.enum(['earmark', 'transfer']).nullable(),
      transferAllowed: z.boolean(),
    })
    .strict(),
);
export type ApprovalTaskDetail = z.infer<typeof ApprovalTaskDetail>;

export const DecisionRequest = named(
  'DecisionRequest',
  z
    .object({
      decision: Decision,
      approvedAmount: Money.optional().describe('Required for approve_partial.'),
      counterOfferAmount: Money.optional().describe(
        'Optional counter-offer amount when decision is request_changes.',
      ),
      mode: z
        .enum(['earmark', 'transfer'])
        .optional()
        .describe('Contributions only: earmark (default) or transfer.'),
      reasonCode: z.string().trim().min(1).max(50).optional(),
      comment: z.string().trim().max(2000).optional(),
      noConflictAttested: z
        .boolean()
        .describe('"I have no conflict of interest" (required to approve or approve part).'),
      channel: ApprovalChannel.optional().describe('Channel used when deciding from mobile or chat.'),
    })
    .strict(),
);
export type DecisionRequest = z.infer<typeof DecisionRequest>;

export const DecisionResponse = named(
  'DecisionResponse',
  z
    .object({
      taskId: Id,
      decision: Decision,
      subjectType: ApprovalSubjectType,
      subjectId: Id,
      ref: z.string(),
      subjectStatus: z.string(),
      approvedAmount: Money.nullable(),
      nextApproverName: z.string().nullable(),
      message: z.string(),
    })
    .strict(),
);
export type DecisionResponse = z.infer<typeof DecisionResponse>;

export const EMAIL_ACTION_STATES = [
  'valid',
  'used',
  'expired',
  'stale',
  'decided',
  'held',
] as const;
export const EmailActionPreview = named(
  'EmailActionPreview',
  z
    .object({
      state: z.enum(EMAIL_ACTION_STATES),
      action: z.enum(['approve', 'reject']),
      subjectType: ApprovalSubjectType,
      subjectId: Id,
      ref: z.string(),
      title: z.string(),
      amount: Money,
      requesterName: z.string(),
      budgetName: z.string(),
      approverName: z.string(),
      availableBefore: Money.nullable(),
      availableAfter: Money.nullable(),
      warning: z.string().nullable(),
      expiresAt: IsoDateTime,
      message: z.string(),
    })
    .strict()
    .describe('What an actionable email link does, re-checked now (no change is made).'),
);
export type EmailActionPreview = z.infer<typeof EmailActionPreview>;

export const EmailActionRequest = named(
  'EmailActionRequest',
  z
    .object({
      token: z.string().min(20).max(300),
      reasonCode: z.string().trim().min(1).max(50).optional(),
      reason: z.string().trim().max(2000).optional(),
    })
    .strict()
    .describe('Executes the link once: approve, or reject with a reason.'),
);

export const DelegationView = named(
  'DelegationView',
  z
    .object({
      id: Id,
      delegatorPersonId: Id,
      delegatorName: z.string(),
      delegatePersonId: Id,
      delegateName: z.string(),
      spendType: z.string().nullable(),
      limit: Money.nullable(),
      effectiveLimit: Money.nullable()
        .optional()
        .describe('The lower of delegator DoA, delegate DoA and cap.'),
      validFrom: IsoDate,
      validTo: IsoDate,
      reason: z.string(),
      active: z.boolean(),
      status: z.enum(['active', 'scheduled', 'ended', 'revoked']).optional(),
      revokedAt: IsoDateTime.nullable().optional(),
    })
    .strict(),
);
export const DelegationList = named(
  'DelegationList',
  z.object({ items: z.array(DelegationView) }).strict(),
);
export const CreateDelegationRequest = named(
  'CreateDelegationRequest',
  z
    .object({
      delegatePersonId: Id,
      spendType: z.string().max(50).optional(),
      limit: Money.optional().describe("Capped by the delegator's own limit."),
      validFrom: IsoDate,
      validTo: IsoDate,
      reason: z.string().trim().min(3).max(500),
    })
    .strict(),
);

export const RevokeDelegationRequest = named(
  'RevokeDelegationRequest',
  z.object({ reason: z.string().trim().max(500).optional() }).strict(),
);

export const ReturnEscalationRequest = named(
  'ReturnEscalationRequest',
  z.object({ comment: z.string().trim().min(3).max(1000) }).strict(),
);

export type DelegationView = z.infer<typeof DelegationView>;
export type CreateDelegationRequest = z.infer<typeof CreateDelegationRequest>;
export type RevokeDelegationRequest = z.infer<typeof RevokeDelegationRequest>;
export type ReturnEscalationRequest = z.infer<typeof ReturnEscalationRequest>;
export type EmailActionRequest = z.infer<typeof EmailActionRequest>;

const TaskParams = z.object({ taskId: Id }).strict();
const DelegationParams = z.object({ delegationId: Id }).strict();
const TokenParams = z.object({ token: z.string().min(20).max(300) }).strict();

export const approvalEndpoints = {
  getApprovalInbox: {
    operationId: 'getApprovalInbox',
    method: 'get',
    path: '/api/approvals/inbox',
    summary: 'Approval tasks assigned to me, delegated to me, escalated, or completed',
    tags: ['approvals'],
    auth: true,
    query: InboxQuery,
    response: { status: 200, schema: ApprovalInbox },
    errors: [400, 401],
  },
  getApprovalTask: {
    operationId: 'getApprovalTask',
    method: 'get',
    path: '/api/approvals/tasks/{taskId}',
    summary: 'An approval task with budget impact, route, rules and hygiene checks',
    tags: ['approvals'],
    auth: true,
    params: TaskParams,
    response: { status: 200, schema: ApprovalTaskDetail },
    errors: [401, 403, 404],
  },
  decideApprovalTask: {
    operationId: 'decideApprovalTask',
    method: 'post',
    path: '/api/approvals/tasks/{taskId}/decision',
    summary:
      'Approve, approve part, reject, request changes or escalate (DoA and hygiene re-checked)',
    tags: ['approvals'],
    auth: true,
    idempotent: true,
    params: TaskParams,
    body: DecisionRequest,
    response: { status: 200, schema: DecisionResponse },
    errors: [400, 401, 403, 404, 409, 422],
  },
  previewEmailAction: {
    operationId: 'previewEmailAction',
    method: 'get',
    path: '/api/approvals/email-actions/{token}',
    summary: 'What an actionable email link does, re-checked now (public, token-bound)',
    tags: ['approvals'],
    auth: false,
    params: TokenParams,
    response: { status: 200, schema: EmailActionPreview },
    errors: [400, 404],
  },
  executeEmailAction: {
    operationId: 'executeEmailAction',
    method: 'post',
    path: '/api/approvals/email-actions',
    summary: 'Approve or reject from an email link (signed, single use, expiring)',
    tags: ['approvals'],
    auth: false,
    body: EmailActionRequest,
    response: { status: 200, schema: DecisionResponse },
    errors: [400, 404, 409, 410, 422],
  },
  listDelegations: {
    operationId: 'listDelegations',
    method: 'get',
    path: '/api/approvals/delegations',
    summary: 'Delegations I gave or received',
    tags: ['approvals'],
    auth: true,
    response: { status: 200, schema: DelegationList },
    errors: [401],
  },
  createDelegation: {
    operationId: 'createDelegation',
    method: 'post',
    path: '/api/approvals/delegations',
    summary: 'Delegate my approvals for a period, capped by my own limit',
    tags: ['approvals'],
    auth: true,
    idempotent: true,
    body: CreateDelegationRequest,
    response: { status: 201, schema: DelegationView },
    errors: [400, 401, 403, 409, 422],
  },
  revokeDelegation: {
    operationId: 'revokeDelegation',
    method: 'post',
    path: '/api/approvals/delegations/{delegationId}/revoke',
    summary: 'End a delegation immediately and return open items to the delegator',
    tags: ['approvals'],
    auth: true,
    idempotent: true,
    params: DelegationParams,
    body: RevokeDelegationRequest,
    response: { status: 200, schema: DelegationView },
    errors: [400, 401, 403, 404, 409],
  },
  returnEscalatedTask: {
    operationId: 'returnEscalatedTask',
    method: 'post',
    path: '/api/approvals/tasks/{taskId}/return',
    summary: 'Return an SLA-escalated task to the original approver with a note',
    tags: ['approvals'],
    auth: true,
    idempotent: true,
    params: TaskParams,
    body: ReturnEscalationRequest,
    response: { status: 200, schema: DecisionResponse },
    errors: [400, 401, 403, 404, 409, 422],
  },
} as const satisfies Record<string, Endpoint>;
