import { z } from 'zod';
import { Id, IsoDate, IsoDateTime, Money } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';
import { ActivityEntry, ApprovalRouteView, DecisionRequest, DecisionResponse } from './approvals';
import { DocumentSummary } from './documents';

export const CONTRIBUTION_STATUSES = [
  'draft',
  'submitted',
  'pending_approval',
  'changes_requested',
  'approved_full',
  'approved_partial',
  'rejected',
  'withdrawn',
  'earmarked',
  'transferred',
  'settled',
  'cancelled',
] as const;
export const ContributionStatus = z.enum(CONTRIBUTION_STATUSES);
export const ContributionMode = z
  .enum(['earmark', 'transfer'])
  .describe(
    'earmark (default): held on the giving budget for the event; transfer: moved to the event budget.',
  );
export const INTERCOMPANY_MODES = ['block', 'recharge_at_cost', 'recharge_with_markup'] as const;
export const IntercompanyMode = z.enum(INTERCOMPANY_MODES);
export const RECHARGE_STATUSES = [
  'proposed',
  'pending_tax_approval',
  'approved',
  'scheduled',
  'exported',
  'posted',
  'blocked',
  'cancelled',
] as const;
export const RechargeStatus = z.enum(RECHARGE_STATUSES);

export const IntercompanyView = named(
  'IntercompanyView',
  z
    .object({
      crossEntity: z.boolean(),
      giverEntityName: z.string(),
      receiverEntityName: z.string(),
      mode: IntercompanyMode.nullable(),
      markupBps: z.int(),
      rechargeId: Id.nullable(),
      rechargeStatus: RechargeStatus.nullable(),
      taxApproverName: z.string().nullable(),
      message: z.string(),
    })
    .strict(),
);

export const ContributionSummary = named(
  'ContributionSummary',
  z
    .object({
      id: Id,
      ref: z.string(),
      status: ContributionStatus,
      eventId: Id.nullable(),
      eventName: z.string().nullable(),
      eventCode: z.string().nullable(),
      requesterPersonId: Id,
      requesterName: z.string(),
      giverBudgetId: Id,
      giverBudgetName: z.string(),
      giverOwnerName: z.string().nullable(),
      receiverBudgetId: Id.nullable(),
      receiverBudgetName: z.string().nullable(),
      requested: Money,
      approved: Money.nullable(),
      mode: ContributionMode,
      purpose: z.string(),
      neededBy: IsoDate.nullable(),
      reasonCode: z.string().nullable(),
      decisionReason: z.string().nullable(),
      message: z.string().nullable(),
      decidedByName: z.string().nullable(),
      decidedAt: IsoDateTime.nullable(),
      onHold: z.boolean(),
      holdReason: z.string().nullable(),
      cancelReason: z.string().nullable(),
      intercompany: IntercompanyView.nullable(),
      createdAt: IsoDateTime,
      updatedAt: IsoDateTime,
    })
    .strict()
    .describe('An Inter-Director Budget Contribution Request.'),
);
export type ContributionSummary = z.infer<typeof ContributionSummary>;

export const ContributionList = named(
  'ContributionList',
  z.object({ items: z.array(ContributionSummary) }).strict(),
);
export const ContributionListQuery = z
  .object({
    eventId: Id.optional(),
    role: z.enum(['giver', 'requester', 'all']).optional(),
  })
  .strict();

export const ContributionDetail = named(
  'ContributionDetail',
  ContributionSummary.extend({
    route: ApprovalRouteView.nullable(),
    giverPosition: z
      .object({
        authorized: Money,
        held: Money,
        available: Money,
        availableAfterFull: Money,
        lowAfterFull: z
          .boolean()
          .describe('Full contribution leaves under 10% available (soft warning).'),
      })
      .strict()
      .nullable()
      .describe("The giving budget's position: only the giving director and finance see it."),
    cofunding: z
      .object({ cap: Money, funded: Money, pending: Money, gap: Money, estimate: Money })
      .strict()
      .nullable(),
    transferAllowed: z.boolean(),
    allowedActions: z.array(z.enum(['decide', 'withdraw', 'upload'])),
    myTaskId: Id.nullable(),
    activity: z.array(ActivityEntry),
    documents: z.array(DocumentSummary),
  }).strict(),
);
export type ContributionDetail = z.infer<typeof ContributionDetail>;

export const CreateContributionBody = named(
  'CreateContributionBody',
  z
    .object({
      eventId: Id,
      giverBudgetId: Id,
      amount: Money.describe("In the giving budget's currency."),
      mode: ContributionMode.optional(),
      purpose: z.string().trim().min(3).max(4000),
      neededBy: IsoDate.optional(),
    })
    .strict(),
);
export type CreateContributionBody = z.infer<typeof CreateContributionBody>;

export const CandidateGivingBudget = named(
  'CandidateGivingBudget',
  z
    .object({
      budgetId: Id,
      name: z.string(),
      code: z.string().nullable(),
      ownerName: z.string().nullable(),
      legalEntityId: Id,
      legalEntityName: z.string(),
      currency: z.string(),
      crossEntity: z.boolean(),
      intercompanyMode: IntercompanyMode.nullable(),
      blockedReason: z.string().nullable(),
    })
    .strict()
    .describe('A budget a contribution can be asked from: names only, never balances.'),
);
export const CandidateGivingBudgetList = named(
  'CandidateGivingBudgetList',
  z.object({ items: z.array(CandidateGivingBudget) }).strict(),
);

export const RechargeView = named(
  'RechargeView',
  z
    .object({
      id: Id,
      contributionId: Id.nullable(),
      contributionRef: z.string().nullable(),
      eventId: Id.nullable(),
      eventName: z.string().nullable(),
      fromLegalEntityId: Id,
      fromEntityName: z.string(),
      toLegalEntityId: Id,
      toEntityName: z.string(),
      mode: IntercompanyMode,
      amount: Money,
      markup: Money,
      total: Money,
      markupBps: z.int(),
      status: RechargeStatus,
      taxApproverName: z.string().nullable(),
      taxApprovedAt: IsoDateTime.nullable(),
      journalId: Id.nullable(),
      canApprove: z.boolean(),
      createdAt: IsoDateTime,
    })
    .strict()
    .describe('Intercompany recharge schedule line for a cross-entity contribution.'),
);
export type RechargeView = z.infer<typeof RechargeView>;
export const RechargeList = named(
  'RechargeList',
  z.object({ items: z.array(RechargeView) }).strict(),
);

export const IntercompanyPolicyView = named(
  'IntercompanyPolicyView',
  z
    .object({
      id: Id,
      fromLegalEntityId: Id.nullable(),
      fromEntityName: z.string().nullable(),
      toLegalEntityId: Id.nullable(),
      toEntityName: z.string().nullable(),
      mode: IntercompanyMode,
      markupBps: z.int(),
      taxApproverName: z.string().nullable(),
      validFrom: IsoDate,
      validTo: IsoDate.nullable(),
    })
    .strict(),
);
export const IntercompanyPolicyList = named(
  'IntercompanyPolicyList',
  z.object({ items: z.array(IntercompanyPolicyView) }).strict(),
);

export type CandidateGivingBudget = z.infer<typeof CandidateGivingBudget>;
export type IntercompanyPolicyView = z.infer<typeof IntercompanyPolicyView>;

const ContributionParams = z.object({ contributionId: Id }).strict();
const RechargeParams = z.object({ rechargeId: Id }).strict();

export const CandidateGivingBudgetsQuery = z
  .object({
    eventId: Id,
    q: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe('Matches the budget name or code (case-insensitive).'),
  })
  .strict();
export type CandidateGivingBudgetsQuery = z.infer<typeof CandidateGivingBudgetsQuery>;

export const contributionEndpoints = {
  listContributions: {
    operationId: 'listContributions',
    method: 'get',
    path: '/api/contributions',
    summary: 'Inter-Director Budget Contribution Requests I asked for, was asked for, or may see',
    tags: ['contributions'],
    auth: true,
    query: ContributionListQuery,
    response: { status: 200, schema: ContributionList },
    errors: [400, 401],
  },
  createContribution: {
    operationId: 'createContribution',
    method: 'post',
    path: '/api/contributions',
    summary:
      "Ask another director's budget to co-fund an event (Inter-Director Budget Contribution Request)",
    tags: ['contributions'],
    auth: true,
    idempotent: true,
    body: CreateContributionBody,
    response: { status: 201, schema: ContributionDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  candidateGivingBudgets: {
    operationId: 'candidateGivingBudgets',
    method: 'get',
    path: '/api/contributions/candidate-budgets',
    summary:
      'Budgets a contribution can be asked from (names, owners and intercompany treatment only)',
    tags: ['contributions'],
    auth: true,
    query: CandidateGivingBudgetsQuery,
    response: { status: 200, schema: CandidateGivingBudgetList },
    errors: [400, 401, 403, 404],
  },
  getContribution: {
    operationId: 'getContribution',
    method: 'get',
    path: '/api/contributions/{contributionId}',
    summary: 'An Inter-Director Budget Contribution Request with its route and co-funding progress',
    tags: ['contributions'],
    auth: true,
    params: ContributionParams,
    response: { status: 200, schema: ContributionDetail },
    errors: [401, 403, 404],
  },
  decideContribution: {
    operationId: 'decideContribution',
    method: 'post',
    path: '/api/contributions/{contributionId}/decision',
    summary: 'The giving director contributes in full, in part, declines or asks for changes',
    tags: ['contributions'],
    auth: true,
    idempotent: true,
    params: ContributionParams,
    body: DecisionRequest,
    response: { status: 200, schema: DecisionResponse },
    errors: [400, 401, 403, 404, 409, 422],
  },
  withdrawContribution: {
    operationId: 'withdrawContribution',
    method: 'post',
    path: '/api/contributions/{contributionId}/withdraw',
    summary: 'Withdraw a contribution request still waiting for a decision',
    tags: ['contributions'],
    auth: true,
    idempotent: true,
    params: ContributionParams,
    response: { status: 200, schema: ContributionDetail },
    errors: [401, 403, 404, 409],
  },
  listRecharges: {
    operationId: 'listRecharges',
    method: 'get',
    path: '/api/recharges',
    summary: 'Intercompany recharge schedule for cross-entity contributions',
    tags: ['contributions'],
    auth: true,
    query: z.object({ eventId: Id.optional() }).strict(),
    response: { status: 200, schema: RechargeList },
    errors: [401, 403],
  },
  approveRecharge: {
    operationId: 'approveRecharge',
    method: 'post',
    path: '/api/recharges/{rechargeId}/approve',
    summary: 'The tax approver approves a recharge; posts the balanced due-to / due-from journal',
    tags: ['contributions'],
    auth: true,
    idempotent: true,
    params: RechargeParams,
    response: { status: 200, schema: RechargeView },
    errors: [401, 403, 404, 409],
  },
  listIntercompanyPolicies: {
    operationId: 'listIntercompanyPolicies',
    method: 'get',
    path: '/api/intercompany-policies',
    summary: 'Intercompany policy: block, recharge at cost or with markup, and the tax approver',
    tags: ['contributions'],
    auth: true,
    response: { status: 200, schema: IntercompanyPolicyList },
    errors: [401, 403],
  },
} as const satisfies Record<string, Endpoint>;
