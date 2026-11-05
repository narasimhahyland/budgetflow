import { z } from 'zod';
import { CurrencyCode, CursorQuery, Id, IsoDate, IsoDateTime, Money } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';
import { ActivityEntry, ApprovalRouteView, BudgetImpact } from './approvals';
import { DocumentSummary } from './documents';

export const REQUEST_KINDS = [
  'budget',
  'spending',
  'additional_fund',
  'over_budget',
  'exception',
] as const;
export const RequestKind = z
  .enum(REQUEST_KINDS)
  .describe(
    'budget: an event budget (own funds); additional_fund: more funds for an event; spending: a commitment against a budget.',
  );
export const REQUEST_STATUSES = [
  'draft',
  'submitted',
  'pending_approval',
  'changes_requested',
  'approved',
  'partially_approved',
  'rejected',
  'withdrawn',
  'cancelled',
] as const;
export const RequestStatus = z.enum(REQUEST_STATUSES);

export const RequestSummary = named(
  'RequestSummary',
  z
    .object({
      id: Id,
      ref: z.string(),
      kind: RequestKind,
      status: RequestStatus,
      title: z.string(),
      amount: Money,
      approvedAmount: Money.nullable(),
      budgetAmount: Money.nullable().describe('In the budget currency at the locked plan rate.'),
      budgetId: Id,
      budgetName: z.string(),
      eventId: Id.nullable(),
      eventName: z.string().nullable(),
      spend: z
        .object({ committed: Money, used: Money, released: Money })
        .strict()
        .nullable()
        .describe(
          'The request’s commitment in its budget currency: committed, used (matched actuals) and released.',
        ),
      requesterPersonId: Id,
      requesterName: z.string(),
      currentStep: z
        .object({ approverName: z.string(), dueAt: IsoDateTime.nullable(), stepNo: z.int() })
        .strict()
        .nullable(),
      onHold: z.boolean(),
      holdReason: z.string().nullable(),
      cancelReason: z.string().nullable(),
      decisionReason: z.string().nullable(),
      createdAt: IsoDateTime,
      updatedAt: IsoDateTime,
      submittedAt: IsoDateTime.nullable(),
    })
    .strict(),
);
export type RequestSummary = z.infer<typeof RequestSummary>;

export const RequestList = named(
  'RequestList',
  z
    .object({
      items: z.array(RequestSummary),
      nextCursor: z.string().nullable(),
      counts: z
        .object({
          all: z.int(),
          drafts: z.int(),
          pending: z.int(),
          approved: z.int(),
          rejected: z.int(),
        })
        .strict(),
    })
    .strict(),
);
export type RequestList = z.infer<typeof RequestList>;

export const RequestListQuery = CursorQuery.extend({
  scope: z.enum(['mine', 'visible']).optional().describe('mine (default): my own requests.'),
  tab: z.enum(['all', 'drafts', 'pending', 'approved', 'rejected']).optional(),
  kind: RequestKind.optional(),
  budgetId: Id.optional(),
  eventId: Id.optional(),
  q: z.string().max(100).optional(),
}).strict();

export const RequestVersion = named(
  'RequestVersion',
  z
    .object({
      version: z.int().min(1),
      submittedAt: IsoDateTime,
      amount: Money,
      title: z.string().nullable(),
      purpose: z.string().nullable(),
      neededBy: IsoDate.nullable(),
    })
    .strict()
    .describe(
      'What the requester sent at one submission (first submission and each resubmission).',
    ),
);
export type RequestVersion = z.infer<typeof RequestVersion>;

export const RequestDetail = named(
  'RequestDetail',
  RequestSummary.extend({
    purpose: z.string(),
    spendType: z.string(),
    category: z.string().nullable(),
    neededBy: IsoDate.nullable(),
    overBudget: z.boolean(),
    commitmentId: Id.nullable(),
    route: ApprovalRouteView.nullable(),
    impact: BudgetImpact.nullable(),
    activity: z.array(ActivityEntry),
    versions: z.array(RequestVersion).describe('Submitted versions, oldest first.'),
    documents: z.array(DocumentSummary),
    allowedActions: z.array(z.enum(['submit', 'withdraw', 'resubmit', 'decide', 'upload'])),
    myTaskId: Id.nullable().describe('The viewer’s pending approval task, if any.'),
  }).strict(),
);
export type RequestDetail = z.infer<typeof RequestDetail>;

export const CreateRequestBody = named(
  'CreateRequestBody',
  z
    .object({
      kind: z.enum(['spending', 'additional_fund', 'over_budget']),
      budgetId: Id,
      eventId: Id.optional().describe(
        'Required for additional_fund: the event that needs more funds.',
      ),
      amount: Money.describe(
        'Transaction currency; converted to the budget currency at the locked plan rate.',
      ),
      spendType: z.string().trim().min(1).max(50),
      title: z.string().trim().min(3).max(200),
      purpose: z.string().trim().min(3).max(4000),
      category: z.string().trim().max(50).optional(),
      neededBy: IsoDate.optional(),
      submit: z.boolean().optional().describe('Submit now (default) or save a draft.'),
    })
    .strict(),
);
export type CreateRequestBody = z.infer<typeof CreateRequestBody>;

export const ResubmitRequestBody = named(
  'ResubmitRequestBody',
  z
    .object({
      amount: Money.optional(),
      title: z.string().trim().min(3).max(200).optional(),
      purpose: z.string().trim().min(3).max(4000).optional(),
      neededBy: IsoDate.optional(),
    })
    .strict(),
);
export const WithdrawRequestBody = named(
  'WithdrawRequestBody',
  z.object({ reason: z.string().trim().max(500).optional() }).strict(),
);

export const RequestableBudget = named(
  'RequestableBudget',
  z
    .object({
      budgetId: Id,
      name: z.string(),
      code: z.string().nullable(),
      status: z.string(),
      currency: CurrencyCode,
      blockedCode: z.string().nullable(),
      blockedReason: z
        .string()
        .nullable()
        .describe('Why new requests are refused (frozen, set to zero).'),
      requestedThisYear: Money.describe('What the viewer requested from it this fiscal year.'),
      pendingCount: z.int(),
      approverHint: z.string().nullable().describe('Who approves requests from this budget.'),
      available: Money.nullable().describe('Only when the viewer may read the budget.'),
    })
    .strict(),
);
export const RequestableBudgetList = named(
  'RequestableBudgetList',
  z.object({ items: z.array(RequestableBudget) }).strict(),
);

export const RoutePreviewQuery = z
  .object({
    budgetId: Id,
    amountMinor: z.coerce.number().int().positive(),
    currency: CurrencyCode,
    spendType: z.string().min(1).max(50),
    eventId: Id.optional(),
  })
  .strict();
export const RoutePreview = named(
  'RoutePreview',
  z
    .object({
      route: ApprovalRouteView.nullable(),
      impact: BudgetImpact,
      blockedCode: z.string().nullable(),
      blockedReason: z.string().nullable(),
    })
    .strict()
    .describe('Simulation: the route and impact a request would get, with no side effects.'),
);

export type RequestableBudget = z.infer<typeof RequestableBudget>;
export type RoutePreview = z.infer<typeof RoutePreview>;
export type ResubmitRequestBody = z.infer<typeof ResubmitRequestBody>;

const RequestParams = z.object({ requestId: Id }).strict();

export const requestEndpoints = {
  listRequests: {
    operationId: 'listRequests',
    method: 'get',
    path: '/api/requests',
    summary: 'My requests (or every request I may see) with status and the current approver',
    tags: ['requests'],
    auth: true,
    query: RequestListQuery,
    response: { status: 200, schema: RequestList },
    errors: [400, 401],
  },
  createRequest: {
    operationId: 'createRequest',
    method: 'post',
    path: '/api/requests',
    summary:
      'Create a spending, additional-fund or over-budget request (submitting pre-encumbers it)',
    tags: ['requests'],
    auth: true,
    idempotent: true,
    body: CreateRequestBody,
    response: { status: 201, schema: RequestDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  requestableBudgets: {
    operationId: 'requestableBudgets',
    method: 'get',
    path: '/api/requests/requestable-budgets',
    summary: 'Budgets I may request from, with blocks and what I already requested',
    tags: ['requests'],
    auth: true,
    response: { status: 200, schema: RequestableBudgetList },
    errors: [401],
  },
  previewRoute: {
    operationId: 'previewRoute',
    method: 'get',
    path: '/api/requests/route-preview',
    summary: 'Simulate the approval route and budget impact of a request (no side effects)',
    tags: ['requests'],
    auth: true,
    query: RoutePreviewQuery,
    response: { status: 200, schema: RoutePreview },
    errors: [400, 401, 403, 404, 422],
  },
  getRequest: {
    operationId: 'getRequest',
    method: 'get',
    path: '/api/requests/{requestId}',
    summary: 'A request with its route, rules, budget impact and activity',
    tags: ['requests'],
    auth: true,
    params: RequestParams,
    response: { status: 200, schema: RequestDetail },
    errors: [401, 403, 404],
  },
  submitRequest: {
    operationId: 'submitRequest',
    method: 'post',
    path: '/api/requests/{requestId}/submit',
    summary: 'Submit a draft: pre-encumbers the amount and routes it for approval',
    tags: ['requests'],
    auth: true,
    idempotent: true,
    params: RequestParams,
    response: { status: 200, schema: RequestDetail },
    errors: [401, 403, 404, 409, 422],
  },
  withdrawRequest: {
    operationId: 'withdrawRequest',
    method: 'post',
    path: '/api/requests/{requestId}/withdraw',
    summary: 'Withdraw a request still waiting for a decision (releases the pre-encumbrance)',
    tags: ['requests'],
    auth: true,
    idempotent: true,
    params: RequestParams,
    body: WithdrawRequestBody,
    response: { status: 200, schema: RequestDetail },
    errors: [401, 403, 404, 409],
  },
  resubmitRequest: {
    operationId: 'resubmitRequest',
    method: 'post',
    path: '/api/requests/{requestId}/resubmit',
    summary: 'Resubmit after changes were requested',
    tags: ['requests'],
    auth: true,
    idempotent: true,
    params: RequestParams,
    body: ResubmitRequestBody,
    response: { status: 200, schema: RequestDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
} as const satisfies Record<string, Endpoint>;
