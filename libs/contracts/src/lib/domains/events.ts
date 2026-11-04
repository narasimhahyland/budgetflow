import { z } from 'zod';
import { CurrencyCode, CursorQuery, Id, IsoDate, IsoDateTime, Money } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';
import { ActivityEntry } from './approvals';
import {
  ContributionMode,
  ContributionStatus,
  IntercompanyMode,
  RechargeView,
} from './contributions';
import { DocumentSummary } from './documents';

export const EVENT_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'funded',
  'in_progress',
  'completed',
  'reconciling',
  'closed',
  'cancelled',
] as const;
export const EventStatus = z.enum(EVENT_STATUSES);
export const COMMITMENT_STATUSES = [
  'pre_encumbered',
  'encumbered',
  'partially_consumed',
  'consumed',
  'released',
  'cancelled',
  'expired',
  'carried_forward',
] as const;
export const CommitmentStatus = z.enum(COMMITMENT_STATUSES);

export const EventSummary = named(
  'EventSummary',
  z
    .object({
      id: Id,
      name: z.string(),
      eventCode: z.string(),
      eventType: z.string(),
      status: EventStatus,
      startsAt: IsoDateTime.nullable(),
      endsAt: IsoDateTime.nullable(),
      venue: z.string().nullable(),
      organizerPersonId: Id,
      organizerName: z.string(),
      homeBudgetId: Id,
      homeBudgetName: z.string(),
      legalEntityId: Id,
      currency: CurrencyCode,
      estimate: Money,
      cap: Money.describe('Funding cap: min(own funds + contributions, estimate + tolerance).'),
      funded: Money,
      committed: Money,
      pendingContributions: z.int(),
      participantCount: z.int(),
      locationNames: z.array(z.string()),
      fullyFunded: z.boolean(),
    })
    .strict(),
);
export type EventSummary = z.infer<typeof EventSummary>;

export const EventList = named(
  'EventList',
  z.object({ items: z.array(EventSummary), nextCursor: z.string().nullable() }).strict(),
);
export const EventListQuery = CursorQuery.extend({
  status: EventStatus.optional(),
  q: z.string().max(100).optional(),
  cofunded: z.enum(['true', 'false']).optional(),
}).strict();

export const FundingSourceView = named(
  'FundingSourceView',
  z
    .object({
      id: Id,
      kind: z.enum(['own', 'contribution']),
      budgetId: Id,
      budgetName: z.string(),
      originBudgetId: Id,
      originBudgetName: z.string(),
      ownerName: z.string().nullable(),
      mode: ContributionMode,
      funded: Money,
      consumed: Money,
      returned: Money,
      remaining: Money,
      sharePct: z.int().describe('Share of total funding in basis points.'),
      status: z.enum(['active', 'returned', 'cancelled']),
      requestId: Id.nullable(),
      requestRef: z.string().nullable(),
      contributionId: Id.nullable(),
      contributionRef: z.string().nullable(),
    })
    .strict(),
);
export type FundingSourceView = z.infer<typeof FundingSourceView>;

export const EventFundingView = named(
  'EventFundingView',
  z
    .object({
      estimate: Money,
      tolerance: Money,
      ceiling: Money.describe('Estimate + tolerance: the most the event may raise.'),
      ownFunds: Money,
      contributions: Money,
      pending: Money.describe('Own funds and contributions waiting for a decision.'),
      cap: Money,
      committed: Money,
      actual: Money,
      available: Money.describe("Available under this event's rules: cap − committed."),
      gap: Money,
      fullyFunded: z.boolean(),
      perHead: Money.nullable(),
      perHeadLimit: Money.nullable(),
    })
    .strict(),
);

export const CostSplitRow = named(
  'CostSplitRow',
  z
    .object({
      dimension: z.enum(['location', 'legal_entity', 'cost_center']),
      id: Id.nullable(),
      name: z.string(),
      participants: z.int(),
      shareBps: z.int(),
      amount: Money,
      intercompany: z.boolean(),
    })
    .strict(),
);

export const EventParticipant = named(
  'EventParticipant',
  z
    .object({
      id: Id,
      personId: Id.nullable(),
      name: z.string(),
      jobTitle: z.string().nullable(),
      isEmployee: z.boolean(),
      employingEntityId: Id.nullable(),
      employingEntityName: z.string().nullable(),
      costCenterId: Id.nullable(),
      costCenterCode: z.string().nullable(),
      locationOrgUnitId: Id.nullable(),
      locationName: z.string().nullable(),
      rsvpStatus: z.string(),
      attendanceStatus: z.string(),
      costShare: Money,
      intercompany: z.boolean(),
      missingCostCenter: z.boolean(),
    })
    .strict(),
);
export type EventParticipant = z.infer<typeof EventParticipant>;
export const EventParticipantList = named(
  'EventParticipantList',
  z.object({ items: z.array(EventParticipant) }).strict(),
);

export const EventCostLine = named(
  'EventCostLine',
  z
    .object({
      lineNo: z.int(),
      category: z.string(),
      description: z.string(),
      quantity: z.int(),
      unitCost: Money,
      amount: Money,
    })
    .strict(),
);

export const EventCommitment = named(
  'EventCommitment',
  z
    .object({
      id: Id,
      description: z.string(),
      vendorId: Id.nullable(),
      vendorName: z.string().nullable(),
      status: CommitmentStatus,
      amount: Money.describe('Transaction currency.'),
      budgetAmount: Money.describe('Budget currency, as first posted at the locked plan rate.'),
      consumed: Money,
      released: Money,
      serviceStart: IsoDate.nullable(),
      serviceEnd: IsoDate.nullable(),
      createdAt: IsoDateTime,
      fundingLines: z.array(
        z
          .object({
            budgetId: Id,
            budgetName: z.string(),
            sourceKind: z.enum(['own', 'contribution', 'budget']),
            amount: Money,
          })
          .strict(),
      ),
    })
    .strict(),
);
export type EventCommitment = z.infer<typeof EventCommitment>;

export const LifecycleStep = z
  .object({ status: EventStatus, label: z.string(), reached: z.boolean(), current: z.boolean() })
  .strict();

export const EventDetail = named(
  'EventDetail',
  EventSummary.extend({
    description: z.string().nullable(),
    spendType: z.string(),
    toleranceBps: z.int(),
    expectedAttendance: z.int().nullable(),
    costCenterId: Id.nullable(),
    ownFundsRequested: Money,
    coOrganizers: z.array(z.object({ personId: Id, name: z.string() }).strict()),
    locations: z.array(
      z
        .object({
          orgUnitId: Id,
          name: z.string(),
          legalEntityName: z.string().nullable(),
          participants: z.int(),
        })
        .strict(),
    ),
    costLines: z.array(EventCostLine),
    funding: EventFundingView,
    sources: z.array(FundingSourceView),
    contributions: z.array(
      z
        .object({
          id: Id,
          ref: z.string(),
          giverBudgetName: z.string(),
          giverOwnerName: z.string().nullable(),
          requested: Money,
          approved: Money.nullable(),
          mode: ContributionMode,
          status: ContributionStatus,
          updatedAt: IsoDateTime,
        })
        .strict(),
    ),
    splits: z
      .object({
        byLocation: z.array(CostSplitRow),
        byEntity: z.array(CostSplitRow),
        byCostCenter: z.array(CostSplitRow),
      })
      .strict(),
    lifecycle: z.array(LifecycleStep),
    intercompany: z
      .object({ crossEntity: z.boolean(), mode: IntercompanyMode.nullable(), message: z.string() })
      .strict()
      .nullable(),
    ownFundsRequest: z.object({ id: Id, ref: z.string(), status: z.string() }).strict().nullable(),
    commitments: z.array(EventCommitment),
    recharges: z.array(RechargeView),
    documents: z.array(DocumentSummary),
    blockedReason: z.string().nullable(),
    allowedActions: z.array(
      z.enum([
        'edit',
        'submit',
        'request_contribution',
        'request_funds',
        'add_participants',
        'commit',
        'start',
        'complete',
        'close',
        'cancel',
        'confirm_funding',
        'upload',
      ]),
    ),
  }).strict(),
);
export type EventDetail = z.infer<typeof EventDetail>;

const CostLineInput = z
  .object({
    category: z.string().trim().min(1).max(50),
    description: z.string().trim().min(1).max(200),
    quantity: z.int().min(1).max(100_000),
    unitCost: Money,
  })
  .strict();

export const CreateEventBody = named(
  'CreateEventBody',
  z
    .object({
      name: z.string().trim().min(3).max(200),
      eventType: z.string().trim().min(2).max(50),
      spendType: z.string().trim().min(1).max(50).optional(),
      homeBudgetId: Id.describe('The budget that funds the event first (own funds).'),
      costCenterId: Id.optional(),
      eventCode: z
        .string()
        .trim()
        .regex(/^[A-Z0-9-]{3,50}$/)
        .optional()
        .describe('Generated when omitted; actuals match on it.'),
      startsAt: IsoDateTime,
      endsAt: IsoDateTime,
      venue: z.string().trim().max(200).optional(),
      description: z.string().trim().max(4000).optional(),
      expectedAttendance: z.int().min(1).max(100_000).optional(),
      estimate: Money.optional().describe('Total estimate; the sum of cost lines when omitted.'),
      toleranceBps: z.int().min(0).max(5000),
      ownFunds: Money.describe('Asked from the home budget when the event is submitted.'),
      perHeadLimit: Money.optional(),
      locationOrgUnitIds: z.array(Id).min(1).max(20),
      coOrganizerPersonIds: z.array(Id).max(10).optional(),
      participantPersonIds: z.array(Id).max(2000).optional(),
      costLines: z.array(CostLineInput).max(100).optional(),
    })
    .strict(),
);
export type CreateEventBody = z.infer<typeof CreateEventBody>;

export const UpdateEventBody = named(
  'UpdateEventBody',
  z
    .object({
      name: z.string().trim().min(3).max(200).optional(),
      eventType: z.string().trim().min(2).max(50).optional(),
      startsAt: IsoDateTime.optional(),
      endsAt: IsoDateTime.optional(),
      venue: z.string().trim().max(200).optional(),
      description: z.string().trim().max(4000).optional(),
      expectedAttendance: z.int().min(1).max(100_000).optional(),
      estimate: Money.optional(),
      toleranceBps: z.int().min(0).max(5000).optional(),
      ownFunds: Money.optional(),
      locationOrgUnitIds: z.array(Id).min(1).max(20).optional(),
      costLines: z.array(CostLineInput).max(100).optional(),
    })
    .strict()
    .describe('Draft events only.'),
);
export type UpdateEventBody = z.infer<typeof UpdateEventBody>;

export const AddParticipantsBody = named(
  'AddParticipantsBody',
  z
    .object({
      personIds: z.array(Id).max(2000).optional(),
      guests: z
        .array(
          z
            .object({
              name: z.string().trim().min(2).max(200),
              employingEntityId: Id.optional(),
              costCenterId: Id.optional(),
              locationOrgUnitId: Id.optional(),
            })
            .strict(),
        )
        .max(200)
        .optional(),
    })
    .strict(),
);

export const CreateEventCommitmentBody = named(
  'CreateEventCommitmentBody',
  z
    .object({
      description: z.string().trim().min(3).max(500),
      vendorId: Id.optional(),
      amount: Money.describe(
        'Transaction currency (INR, EUR or USD); converted at the locked plan rate.',
      ),
      serviceStart: IsoDate.optional(),
      serviceEnd: IsoDate.optional(),
    })
    .strict(),
);

export const ReasonBody = named(
  'ReasonBody',
  z.object({ reason: z.string().trim().max(1000).optional() }).strict(),
);

export const CloseEventResponse = named(
  'CloseEventResponse',
  z
    .object({
      event: EventDetail,
      surplusReturns: z.array(
        z.object({ sourceId: Id, budgetId: Id, budgetName: z.string(), amount: Money }).strict(),
      ),
    })
    .strict(),
);

export const EventActivity = named(
  'EventActivity',
  z.object({ items: z.array(ActivityEntry) }).strict(),
);

export const CofundingBoard = named(
  'CofundingBoard',
  z
    .object({
      generatedAt: IsoDateTime,
      events: z.array(
        z
          .object({
            id: Id,
            name: z.string(),
            eventCode: z.string(),
            status: EventStatus,
            startsAt: IsoDateTime.nullable(),
            estimate: Money,
            cap: Money,
            ownFunds: Money,
            approved: Money,
            pending: Money,
            gap: Money,
            fullyFunded: z.boolean(),
            contributions: z.array(
              z
                .object({
                  id: Id,
                  ref: z.string(),
                  giverBudgetName: z.string(),
                  giverOwnerName: z.string().nullable(),
                  requested: Money,
                  approved: Money.nullable(),
                  mode: ContributionMode,
                  status: ContributionStatus,
                  updatedAt: IsoDateTime,
                })
                .strict(),
            ),
            activity: z.array(z.object({ at: IsoDateTime, text: z.string() }).strict()),
          })
          .strict(),
      ),
    })
    .strict()
    .describe(
      'Live co-funding: contributors see each other’s amounts, never each other’s balances.',
    ),
);
export type CofundingBoard = z.infer<typeof CofundingBoard>;

export const UtilizationRow = z
  .object({
    id: Id.nullable(),
    name: z.string(),
    budgets: z.int(),
    authorized: Money,
    held: Money,
    pending: Money,
    committed: Money,
    actual: Money,
    available: Money,
    utilizationBps: z.int(),
  })
  .strict();
export const UtilizationReport = named(
  'UtilizationReport',
  z
    .object({
      groupBy: z.enum(['location', 'team', 'budget']),
      currency: CurrencyCode,
      rows: z.array(UtilizationRow),
      totals: UtilizationRow,
      generatedAt: IsoDateTime,
    })
    .strict()
    .describe('Budget utilization by location or team in the reporting currency (USD).'),
);
export type UtilizationReport = z.infer<typeof UtilizationReport>;

export type EventList = z.infer<typeof EventList>;
export type CloseEventResponse = z.infer<typeof CloseEventResponse>;
export type CreateEventCommitmentBody = z.infer<typeof CreateEventCommitmentBody>;
export type AddParticipantsBody = z.infer<typeof AddParticipantsBody>;

const EventParams = z.object({ eventId: Id }).strict();

const transition = <Op extends string>(operationId: Op, verb: string, summary: string) => ({
  operationId,
  method: 'post' as const,
  path: `/api/events/{eventId}/${verb}`,
  summary,
  tags: ['events'],
  auth: true,
  idempotent: true,
  params: EventParams,
  body: ReasonBody,
  response: { status: 200, schema: EventDetail },
  errors: [401, 403, 404, 409, 422],
});

export const eventEndpoints = {
  listEvents: {
    operationId: 'listEvents',
    method: 'get',
    path: '/api/events',
    summary: 'Events I organize, fund or may see',
    tags: ['events'],
    auth: true,
    query: EventListQuery,
    response: { status: 200, schema: EventList },
    errors: [400, 401],
  },
  createEvent: {
    operationId: 'createEvent',
    method: 'post',
    path: '/api/events',
    summary: 'Create a draft cross-location event with its estimate, locations and participants',
    tags: ['events'],
    auth: true,
    idempotent: true,
    body: CreateEventBody,
    response: { status: 201, schema: EventDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getCofundingBoard: {
    operationId: 'getCofundingBoard',
    method: 'get',
    path: '/api/events/cofunding-board',
    summary: 'Live co-funding board: each event’s cap, approved, pending and gap per contributor',
    tags: ['events'],
    auth: true,
    response: { status: 200, schema: CofundingBoard },
    errors: [401],
  },
  getUtilization: {
    operationId: 'getUtilization',
    method: 'get',
    path: '/api/utilization',
    summary: 'Budget utilization by location or team (reporting currency)',
    tags: ['events'],
    auth: true,
    query: z.object({ groupBy: z.enum(['location', 'team', 'budget']).optional() }).strict(),
    response: { status: 200, schema: UtilizationReport },
    errors: [400, 401, 403],
  },
  getEvent: {
    operationId: 'getEvent',
    method: 'get',
    path: '/api/events/{eventId}',
    summary: 'An event with funding, cost split, commitments and lifecycle',
    tags: ['events'],
    auth: true,
    params: EventParams,
    response: { status: 200, schema: EventDetail },
    errors: [401, 403, 404],
  },
  updateEvent: {
    operationId: 'updateEvent',
    method: 'patch',
    path: '/api/events/{eventId}',
    summary: 'Edit a draft event',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: UpdateEventBody,
    response: { status: 200, schema: EventDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  submitEvent: transition(
    'submitEvent',
    'submit',
    'Submit: asks the home budget for the own funds (event budget request) and routes it for approval',
  ),
  confirmEventFunding: transition(
    'confirmEventFunding',
    'confirm-funding',
    'Confirm the event is funded with what is approved so far',
  ),
  startEvent: transition('startEvent', 'start', 'Mark the event in progress'),
  completeEvent: transition('completeEvent', 'complete', 'Mark the event completed'),
  cancelEvent: transition(
    'cancelEvent',
    'cancel',
    'Cancel: releases open commitments and returns every funding source',
  ),
  closeEvent: {
    operationId: 'closeEvent',
    method: 'post',
    path: '/api/events/{eventId}/close',
    summary:
      'Close: releases what is left and returns the surplus to each contributor in the consumption order',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: ReasonBody,
    response: { status: 200, schema: CloseEventResponse },
    errors: [401, 403, 404, 409, 422],
  },
  listEventParticipants: {
    operationId: 'listEventParticipants',
    method: 'get',
    path: '/api/events/{eventId}/participants',
    summary: 'Participants with employing entity, cost center and cost share',
    tags: ['events'],
    auth: true,
    params: EventParams,
    response: { status: 200, schema: EventParticipantList },
    errors: [401, 403, 404],
  },
  addEventParticipants: {
    operationId: 'addEventParticipants',
    method: 'post',
    path: '/api/events/{eventId}/participants',
    summary: 'Add employees from the directory (or guests) to an event',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: AddParticipantsBody,
    response: { status: 200, schema: EventParticipantList },
    errors: [400, 401, 403, 404, 409, 422],
  },
  removeEventParticipant: {
    operationId: 'removeEventParticipant',
    method: 'delete',
    path: '/api/events/{eventId}/participants/{participantId}',
    summary: 'Remove a participant',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: z.object({ eventId: Id, participantId: Id }).strict(),
    response: { status: 200, schema: EventParticipantList },
    errors: [401, 403, 404, 409],
  },
  createEventCommitment: {
    operationId: 'createEventCommitment',
    method: 'post',
    path: '/api/events/{eventId}/commitments',
    summary:
      'Commit spend against the event funding (pro rata across sources, within the funding cap)',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: CreateEventCommitmentBody,
    response: { status: 201, schema: EventCommitment },
    errors: [400, 401, 403, 404, 409, 422],
  },
  releaseEventCommitment: {
    operationId: 'releaseEventCommitment',
    method: 'post',
    path: '/api/events/{eventId}/commitments/{commitmentId}/release',
    summary: 'Release what is left of a commitment back to the event funding',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: z.object({ eventId: Id, commitmentId: Id }).strict(),
    body: ReasonBody,
    response: { status: 200, schema: EventCommitment },
    errors: [401, 403, 404, 409],
  },
  eventActivity: {
    operationId: 'eventActivity',
    method: 'get',
    path: '/api/events/{eventId}/activity',
    summary: 'Audit trail of the event, its funding requests and contributions',
    tags: ['events'],
    auth: true,
    params: EventParams,
    response: { status: 200, schema: EventActivity },
    errors: [401, 403, 404],
  },
} as const satisfies Record<string, Endpoint>;
