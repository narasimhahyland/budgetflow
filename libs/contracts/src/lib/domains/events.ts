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
      rsvpRespondedAt: IsoDateTime.nullable().optional(),
      waitlistPosition: z.int().nullable().optional(),
      remindersSentCount: z.int().optional(),
      attendanceStatus: z.string(),
      needsSubmitted: z.boolean().optional(),
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
    templateId: Id.nullable().optional(),
    seriesId: Id.nullable().optional(),
    attendanceFinal: z.boolean().optional(),
    organizerNotes: z.string().nullable().optional(),
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
      templateId: Id.optional(),
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

// Phase 9: Event Depth --------------------------------------------------------------------------

export const TemplateChecklistTaskInput = z
  .object({
    section: z.enum(['before', 'on_the_day', 'after']),
    title: z.string().trim().min(1).max(200),
    relativeDueDays: z.int().min(-365).max(365),
    ownerRole: z.enum(['organizer', 'co_organizer']).default('organizer'),
    linkedItemType: z.string().max(30).nullable().optional(),
    isSystem: z.boolean().default(false),
  })
  .strict();

export const TemplateAgendaItemInput = z
  .object({
    startTime: z.string().trim().min(1).max(20),
    endTime: z.string().trim().max(20).nullable().optional(),
    title: z.string().trim().min(1).max(200),
    locationRoom: z.string().trim().max(200).nullable().optional(),
    hostName: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    visibleToInvitees: z.boolean().default(true),
  })
  .strict();

export const TemplateSurveyQuestion = z
  .object({
    id: z.string().min(1).max(50),
    type: z.enum(['rating', 'yes_no', 'single_choice', 'short_text']),
    prompt: z.string().trim().min(1).max(300),
    required: z.boolean().default(true),
    options: z.array(z.string()).max(10).optional(),
  })
  .strict();

export const EventTemplate = named(
  'EventTemplate',
  z
    .object({
      id: Id,
      scope: z.enum(['company', 'personal']),
      status: z.enum(['draft', 'published', 'archived']),
      ownerPersonId: Id.nullable(),
      ownerName: z.string().nullable(),
      name: z.string(),
      category: z.string(),
      eventType: z.string(),
      typicalDuration: z.string(),
      locationType: z.enum(['office', 'venue', 'remote']),
      estimatePerAttendee: Money,
      useLocationLimit: z.boolean(),
      toleranceBps: z.int(),
      costSplitRule: z.enum(['location', 'legal_entity', 'cost_center']),
      checklistTasks: z.array(TemplateChecklistTaskInput),
      agendaItems: z.array(TemplateAgendaItemInput),
      invitationDefaults: z
        .object({
          message: z.string(),
          rsvpDeadlineDaysBefore: z.int(),
          capacity: z.int().nullable(),
          waitlistEnabled: z.boolean(),
        })
        .strict(),
      needsConfig: z
        .object({
          collectDietary: z.boolean(),
          collectAccessibility: z.boolean(),
          collectTravel: z.boolean(),
          collectPhotoConsent: z.boolean(),
        })
        .strict(),
      surveyQuestions: z.array(TemplateSurveyQuestion),
      preferredVendors: z.array(
        z.object({ id: Id, name: z.string(), status: z.string() }).strict(),
      ),
      version: z.int(),
      updatedAt: IsoDateTime,
    })
    .strict(),
);
export type EventTemplate = z.infer<typeof EventTemplate>;

export const EventTemplateList = named(
  'EventTemplateList',
  z.object({ items: z.array(EventTemplate) }).strict(),
);

export const UpsertEventTemplateBody = named(
  'UpsertEventTemplateBody',
  z
    .object({
      scope: z.enum(['company', 'personal']).default('personal'),
      status: z.enum(['draft', 'published', 'archived']).default('draft'),
      name: z.string().trim().min(2).max(200),
      category: z.string().trim().min(1).max(50).default('employee_events'),
      eventType: z.string().trim().min(2).max(50).default('celebration'),
      typicalDuration: z.string().trim().min(1).max(100).default('Half day'),
      locationType: z.enum(['office', 'venue', 'remote']).default('office'),
      estimatePerAttendee: Money,
      useLocationLimit: z.boolean().default(false),
      toleranceBps: z.int().min(0).max(5000).default(500),
      costSplitRule: z.enum(['location', 'legal_entity', 'cost_center']).default('location'),
      checklistTasks: z.array(TemplateChecklistTaskInput).max(50).optional(),
      agendaItems: z.array(TemplateAgendaItemInput).max(50).optional(),
      invitationDefaults: z
        .object({
          message: z.string().max(2000).default(''),
          rsvpDeadlineDaysBefore: z.int().min(1).max(90).default(4),
          capacity: z.int().min(1).max(10_000).nullable().default(null),
          waitlistEnabled: z.boolean().default(true),
        })
        .strict()
        .optional(),
      needsConfig: z
        .object({
          collectDietary: z.boolean().default(true),
          collectAccessibility: z.boolean().default(true),
          collectTravel: z.boolean().default(false),
          collectPhotoConsent: z.boolean().default(true),
        })
        .strict()
        .optional(),
      surveyQuestions: z.array(TemplateSurveyQuestion).max(5).optional(),
      preferredVendorIds: z.array(Id).max(20).optional(),
    })
    .strict(),
);
export type UpsertEventTemplateBody = z.infer<typeof UpsertEventTemplateBody>;

export const RecurringSeriesBody = named(
  'RecurringSeriesBody',
  z
    .object({
      name: z.string().trim().min(3).max(200),
      eventType: z.string().trim().min(2).max(50).default('team_event'),
      homeBudgetId: Id,
      templateId: Id.optional(),
      locationOrgUnitIds: z.array(Id).min(1).max(20),
      estimatePerOccurrence: Money,
      toleranceBps: z.int().min(0).max(5000).default(500),
      frequency: z.enum(['monthly', 'quarterly', 'yearly', 'custom']),
      firstDate: IsoDate,
      endCount: z.int().min(1).max(12).optional(),
      endDate: IsoDate.optional(),
      customDates: z.array(IsoDate).max(12).optional(),
      dryRun: z.boolean().default(false),
    })
    .strict(),
);
export type RecurringSeriesBody = z.infer<typeof RecurringSeriesBody>;

export const RecurringSeriesOccurrence = z
  .object({
    occurrenceDate: IsoDate,
    fiscalPeriodLabel: z.string().nullable(),
    periodStatus: z.string().nullable(),
    blockedReason: z.string().nullable(),
    eventCode: z.string(),
    estimate: Money,
    createdEventId: Id.nullable(),
  })
  .strict();

export const RecurringSeriesResult = named(
  'RecurringSeriesResult',
  z
    .object({
      seriesId: Id.nullable(),
      dryRun: z.boolean(),
      occurrences: z.array(RecurringSeriesOccurrence),
      totalEstimate: Money,
      budgetAvailable: Money,
      budgetName: z.string(),
      exceedsAvailableToday: z.boolean(),
      hasBlockedOccurrences: z.boolean(),
    })
    .strict(),
);
export type RecurringSeriesResult = z.infer<typeof RecurringSeriesResult>;

export const CloneEventBody = named(
  'CloneEventBody',
  z
    .object({
      name: z.string().trim().min(3).max(200),
      startsAt: IsoDateTime,
      endsAt: IsoDateTime.optional(),
      copyDetailsAndLocations: z.boolean().default(true),
      copyChecklist: z.boolean().default(true),
      copyAgenda: z.boolean().default(true),
      copyInvitationText: z.boolean().default(true),
      copySurvey: z.boolean().default(true),
      copyVendorShortlist: z.boolean().default(true),
      copyEstimate: z.boolean().default(true),
      copyParticipants: z.boolean().default(false),
    })
    .strict(),
);
export type CloneEventBody = z.infer<typeof CloneEventBody>;

export const ChecklistTaskComment = z
  .object({
    id: Id,
    authorName: z.string(),
    text: z.string(),
    createdAt: IsoDateTime,
  })
  .strict();

export const EventChecklistTask = named(
  'EventChecklistTask',
  z
    .object({
      id: Id,
      section: z.enum(['before', 'on_the_day', 'after']),
      title: z.string(),
      description: z.string().nullable(),
      assigneePersonId: Id.nullable(),
      assigneeName: z.string().nullable(),
      dueDate: IsoDate.nullable(),
      overdue: z.boolean(),
      reminder: z.string().nullable(),
      status: z.enum(['open', 'done']),
      linkedItemType: z.string().nullable(),
      linkedItemId: Id.nullable(),
      linkedLabel: z.string().nullable(),
      isSystem: z.boolean(),
      sortOrder: z.int(),
      comments: z.array(ChecklistTaskComment),
    })
    .strict(),
);
export type EventChecklistTask = z.infer<typeof EventChecklistTask>;

export const EventAgendaItem = named(
  'EventAgendaItem',
  z
    .object({
      id: Id,
      startTime: z.string(),
      endTime: z.string().nullable(),
      title: z.string(),
      locationRoom: z.string().nullable(),
      hostName: z.string().nullable(),
      notes: z.string().nullable(),
      visibleToInvitees: z.boolean(),
      sortOrder: z.int(),
    })
    .strict(),
);
export type EventAgendaItem = z.infer<typeof EventAgendaItem>;

export const EventPlanView = named(
  'EventPlanView',
  z
    .object({
      eventId: Id,
      canManage: z.boolean(),
      readOnly: z.boolean(),
      templateId: Id.nullable(),
      templateName: z.string().nullable(),
      totalTasks: z.int(),
      doneTasks: z.int(),
      overdueTasks: z.int(),
      tasks: z.array(EventChecklistTask),
      agenda: z.array(EventAgendaItem),
    })
    .strict(),
);
export type EventPlanView = z.infer<typeof EventPlanView>;

export const UpsertChecklistTaskBody = named(
  'UpsertChecklistTaskBody',
  z
    .object({
      section: z.enum(['before', 'on_the_day', 'after']).default('before'),
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(1000).nullable().optional(),
      assigneePersonId: Id.nullable().optional(),
      dueDate: IsoDate.nullable().optional(),
      reminder: z.string().max(30).nullable().optional(),
      status: z.enum(['open', 'done']).optional(),
      sortOrder: z.int().optional(),
      comment: z.string().trim().min(1).max(500).optional(),
    })
    .strict(),
);
export type UpsertChecklistTaskBody = z.infer<typeof UpsertChecklistTaskBody>;

export const UpsertAgendaItemBody = named(
  'UpsertAgendaItemBody',
  z
    .object({
      startTime: z.string().trim().min(1).max(20),
      endTime: z.string().trim().max(20).nullable().optional(),
      title: z.string().trim().min(1).max(200),
      locationRoom: z.string().trim().max(200).nullable().optional(),
      hostName: z.string().trim().max(200).nullable().optional(),
      notes: z.string().trim().max(1000).nullable().optional(),
      visibleToInvitees: z.boolean().default(true),
      sortOrder: z.int().optional(),
    })
    .strict(),
);
export type UpsertAgendaItemBody = z.infer<typeof UpsertAgendaItemBody>;

export const EventInvitationView = named(
  'EventInvitationView',
  z
    .object({
      eventId: Id,
      status: z.enum(['not_sent', 'open', 'closed']),
      message: z.string(),
      deadline: IsoDateTime.nullable(),
      capacity: z.int().nullable(),
      waitlistEnabled: z.boolean(),
      autoPromoteWaitlist: z.boolean(),
      attachCalendarInvite: z.boolean(),
      collectTravelNeeds: z.boolean(),
      sentAt: IsoDateTime.nullable(),
      remindersSentCount: z.int(),
      counts: z
        .object({
          invited: z.int(),
          going: z.int(),
          cantGo: z.int(),
          waitlisted: z.int(),
          noResponse: z.int(),
        })
        .strict(),
      byLocation: z.array(
        z
          .object({
            locationName: z.string(),
            invited: z.int(),
            going: z.int(),
          })
          .strict(),
      ),
      plannedAttendance: z.int(),
      attendanceChangedFromPlan: z.boolean(),
      participants: z.array(EventParticipant),
    })
    .strict(),
);
export type EventInvitationView = z.infer<typeof EventInvitationView>;

export const SendInvitationsBody = named(
  'SendInvitationsBody',
  z
    .object({
      message: z.string().trim().min(1).max(2000),
      deadline: IsoDateTime,
      capacity: z.int().min(1).max(100_000).nullable().optional(),
      waitlistEnabled: z.boolean().default(true),
      autoPromoteWaitlist: z.boolean().default(true),
      attachCalendarInvite: z.boolean().default(true),
      collectTravelNeeds: z.boolean().default(false),
    })
    .strict(),
);
export type SendInvitationsBody = z.infer<typeof SendInvitationsBody>;

export const EmployeeInvitationView = named(
  'EmployeeInvitationView',
  z
    .object({
      invitationId: Id,
      eventId: Id,
      eventName: z.string(),
      eventCode: z.string(),
      eventStatus: EventStatus,
      startsAt: IsoDateTime.nullable(),
      endsAt: IsoDateTime.nullable(),
      venue: z.string().nullable(),
      organizerName: z.string(),
      message: z.string(),
      deadline: IsoDateTime.nullable(),
      rsvpClosed: z.boolean(),
      rsvpStatus: z.enum(['invited', 'going', 'cant_go', 'waitlisted']),
      waitlistPosition: z.int().nullable(),
      collectTravelNeeds: z.boolean(),
      needsSubmitted: z.boolean(),
      needs: z
        .object({
          dietaryPreference: z.string().default('no_preference'),
          dietaryOther: z.string().nullable().default(null),
          allergies: z.array(z.string()).default([]),
          allergyOther: z.string().nullable().default(null),
          severeAllergy: z.boolean().default(false),
          accessibility: z.array(z.string()).default([]),
          accessibilityOther: z.string().nullable().default(null),
          needsTravel: z.boolean().default(false),
          travelFromCity: z.string().nullable().default(null),
          travelArrival: z.string().nullable().default(null),
          needsHotelNight: z.boolean().default(false),
          photoConsent: z.boolean().default(true),
          reuseForFutureEvents: z.boolean().default(false),
        })
        .strict(),
      visibleAgenda: z.array(EventAgendaItem),
    })
    .strict(),
);
export type EmployeeInvitationView = z.infer<typeof EmployeeInvitationView>;

export const RsvpRespondBody = named(
  'RsvpRespondBody',
  z
    .object({
      response: z.enum(['going', 'cant_go']),
    })
    .strict(),
);
export type RsvpRespondBody = z.infer<typeof RsvpRespondBody>;

export const SubmitAttendeeNeedsBody = named(
  'SubmitAttendeeNeedsBody',
  z
    .object({
      dietaryPreference: z
        .enum(['no_preference', 'vegetarian', 'vegan', 'jain', 'halal', 'kosher', 'other'])
        .default('no_preference'),
      dietaryOther: z.string().trim().max(200).nullable().optional(),
      allergies: z.array(z.string().max(50)).max(10).default([]),
      allergyOther: z.string().trim().max(200).nullable().optional(),
      severeAllergy: z.boolean().default(false),
      accessibility: z.array(z.string().max(50)).max(10).default([]),
      accessibilityOther: z.string().trim().max(200).nullable().optional(),
      needsTravel: z.boolean().default(false),
      travelFromCity: z.string().trim().max(100).nullable().optional(),
      travelArrival: z.string().trim().max(100).nullable().optional(),
      needsHotelNight: z.boolean().default(false),
      photoConsent: z.boolean().default(true),
      reuseForFutureEvents: z.boolean().default(false),
    })
    .strict(),
);
export type SubmitAttendeeNeedsBody = z.infer<typeof SubmitAttendeeNeedsBody>;

export const EventNeedsSummaryView = named(
  'EventNeedsSummaryView',
  z
    .object({
      eventId: Id,
      canSeeIndividual: z.boolean(),
      deletedAt: IsoDateTime.nullable(),
      collectTravelNeeds: z.boolean(),
      goingCount: z.int(),
      answeredCount: z.int(),
      dietaryCounts: z.record(z.string(), z.int()),
      allergyCounts: z.record(z.string(), z.int()),
      severeAllergyCount: z.int(),
      accessibilityCounts: z.record(z.string(), z.int()),
      travelCount: z.int(),
      hotelNightCount: z.int(),
      photoConsentYes: z.int(),
      photoConsentNo: z.int(),
      individuals: z.array(
        z
          .object({
            participantId: Id,
            name: z.string(),
            locationName: z.string().nullable(),
            dietaryPreference: z.string(),
            dietaryOther: z.string().nullable(),
            allergies: z.array(z.string()),
            severeAllergy: z.boolean(),
            accessibility: z.array(z.string()),
            needsTravel: z.boolean(),
            travelFromCity: z.string().nullable(),
            needsHotelNight: z.boolean(),
            photoConsent: z.boolean(),
          })
          .strict(),
      ),
    })
    .strict(),
);
export type EventNeedsSummaryView = z.infer<typeof EventNeedsSummaryView>;

export const ExportCatererNeedsBody = named(
  'ExportCatererNeedsBody',
  z
    .object({
      content: z.enum(['counts_only', 'counts_and_allergies']).default('counts_only'),
      foodSafetyConfirmed: z.boolean().default(false),
      format: z.enum(['csv', 'pdf']).default('csv'),
    })
    .strict(),
);

export const ExportCatererNeedsResult = named(
  'ExportCatererNeedsResult',
  z
    .object({
      fileName: z.string(),
      format: z.enum(['csv', 'pdf']),
      content: z.string(),
      audited: z.boolean(),
    })
    .strict(),
);

export const AttendanceSplitShare = z
  .object({
    sourceId: Id,
    budgetId: Id,
    budgetName: z.string(),
    locationName: z.string(),
    contributionRef: z.string().nullable(),
    approvedMinor: z.int(),
    plannedHeadcount: z.int(),
    plannedAmount: Money,
    actualHeadcount: z.int(),
    actualAmount: Money,
    deltaMinor: z.int(),
    exceedsApprovedByMinor: z.int(),
  })
  .strict();

export const EventAttendanceView = named(
  'EventAttendanceView',
  z
    .object({
      eventId: Id,
      canManage: z.boolean(),
      locked: z.boolean(),
      attendanceFinal: z.boolean(),
      splitAppliedAt: IsoDateTime.nullable(),
      splitAppliedByName: z.string().nullable(),
      splitKeepReason: z.string().nullable(),
      counts: z
        .object({
          planned: z.int(),
          going: z.int(),
          attended: z.int(),
          walkIn: z.int(),
          noShow: z.int(),
          notMarked: z.int(),
          totalActualAttendees: z.int(),
        })
        .strict(),
      costSoFar: Money,
      perHeadPlanned: Money,
      perHeadActual: Money,
      noShowCost: Money,
      perHeadLimit: z
        .object({
          limit: Money,
          mode: z.enum(['hard', 'soft']),
          exceeded: z.boolean(),
          excess: Money,
          message: z.string().nullable(),
        })
        .strict()
        .nullable(),
      previewBasis: z.enum(['rsvp', 'attendance']),
      shares: z.array(AttendanceSplitShare),
      entityBreakdown: z.array(
        z.object({ entityName: z.string(), attendees: z.int(), shareBps: z.int() }).strict(),
      ),
      blockedReason: z.string().nullable(),
      participants: z.array(EventParticipant),
    })
    .strict(),
);
export type EventAttendanceView = z.infer<typeof EventAttendanceView>;

export const MarkAttendanceBody = named(
  'MarkAttendanceBody',
  z
    .object({
      marks: z
        .array(
          z
            .object({
              participantId: Id,
              status: z.enum(['attended', 'no_show', 'walk_in', 'unknown']),
            })
            .strict(),
        )
        .max(2000)
        .optional(),
      markAllGoingAttended: z.boolean().optional(),
      walkInPersonId: Id.optional(),
      finalize: z.boolean().optional(),
    })
    .strict(),
);
export type MarkAttendanceBody = z.infer<typeof MarkAttendanceBody>;

export const ApplyAttendanceSplitBody = named(
  'ApplyAttendanceSplitBody',
  z
    .object({
      action: z.enum(['apply', 'keep_planned']).default('apply'),
      reason: z.string().trim().min(3).max(500),
      confirmed: z.boolean().default(true),
    })
    .strict(),
);
export type ApplyAttendanceSplitBody = z.infer<typeof ApplyAttendanceSplitBody>;

export const VendorQuoteItem = named(
  'VendorQuoteItem',
  z
    .object({
      id: Id,
      quoteRequestId: Id,
      vendorId: Id,
      vendorName: z.string(),
      vendorStatus: z.enum(['approved', 'preferred', 'blocked', 'unknown']),
      status: z.enum(['requested', 'received', 'selected', 'declined', 'expired']),
      amount: Money,
      budgetAmount: Money,
      perHead: Money,
      depositPct: z.int(),
      deposit: Money,
      depositRefundable: z.boolean(),
      depositTerms: z.string().nullable(),
      cancellationTerms: z.string().nullable(),
      validUntil: IsoDate.nullable(),
      expired: z.boolean(),
      includesText: z.string().nullable(),
      isLowest: z.boolean(),
      exceedsAvailableByMinor: z.int(),
      policyCheck: z.enum(['within_limit', 'above_limit', 'above_available']),
      policyMessage: z.string(),
      documentId: Id.nullable(),
      commitmentId: Id.nullable(),
      selectionReason: z.string().nullable(),
    })
    .strict(),
);
export type VendorQuoteItem = z.infer<typeof VendorQuoteItem>;

export const EventQuoteRequestView = named(
  'EventQuoteRequestView',
  z
    .object({
      id: Id,
      eventId: Id,
      title: z.string(),
      category: z.string(),
      description: z.string().nullable(),
      quantity: z.int(),
      neededBy: IsoDate.nullable(),
      respondBy: IsoDate.nullable(),
      includeDietaryCounts: z.boolean(),
      emailed: z.boolean(),
      receivedCount: z.int(),
      totalCount: z.int(),
      quotes: z.array(VendorQuoteItem),
    })
    .strict(),
);

export const EventQuotesView = named(
  'EventQuotesView',
  z
    .object({
      eventId: Id,
      canManage: z.boolean(),
      funded: Money,
      committed: Money,
      available: Money,
      perHeadLimit: Money.nullable(),
      requests: z.array(EventQuoteRequestView),
    })
    .strict(),
);
export type EventQuotesView = z.infer<typeof EventQuotesView>;

export const CreateQuoteRequestBody = named(
  'CreateQuoteRequestBody',
  z
    .object({
      title: z.string().trim().min(2).max(200),
      category: z.string().trim().min(1).max(50).default('catering'),
      description: z.string().trim().max(1000).optional(),
      quantity: z.int().min(1).max(100_000).default(1),
      neededBy: IsoDate.optional(),
      respondBy: IsoDate.optional(),
      includeDietaryCounts: z.boolean().default(false),
      emailed: z.boolean().default(true),
      vendorIds: z.array(Id).min(1).max(10),
    })
    .strict(),
);
export type CreateQuoteRequestBody = z.infer<typeof CreateQuoteRequestBody>;

export const RecordVendorQuoteBody = named(
  'RecordVendorQuoteBody',
  z
    .object({
      quoteRequestId: Id,
      vendorId: Id,
      amount: Money,
      depositPct: z.int().min(0).max(100).default(0),
      depositRefundable: z.boolean().default(true),
      depositTerms: z.string().trim().max(300).optional(),
      cancellationTerms: z.string().trim().max(300).optional(),
      validUntil: IsoDate.optional(),
      includesText: z.string().trim().max(500).optional(),
      documentId: Id.optional(),
    })
    .strict(),
);
export type RecordVendorQuoteBody = z.infer<typeof RecordVendorQuoteBody>;

export const SelectVendorQuoteBody = named(
  'SelectVendorQuoteBody',
  z
    .object({
      reason: z.string().trim().max(500).optional(),
      notifyDeclinedVendors: z.boolean().default(true),
      serviceStart: IsoDate.optional(),
      serviceEnd: IsoDate.optional(),
    })
    .strict(),
);
export type SelectVendorQuoteBody = z.infer<typeof SelectVendorQuoteBody>;

export const GalleryPhotoView = named(
  'GalleryPhotoView',
  z
    .object({
      id: Id,
      caption: z.string(),
      fileName: z.string(),
      uploadedByName: z.string(),
      mine: z.boolean(),
      status: z.enum(['visible', 'hidden', 'removal_requested']),
      removalReason: z.string().nullable(),
      createdAt: IsoDateTime,
    })
    .strict(),
);

export const EventFeedbackView = named(
  'EventFeedbackView',
  z
    .object({
      eventId: Id,
      canManage: z.boolean(),
      surveyId: Id,
      status: z.enum(['draft', 'scheduled', 'open', 'closed']),
      anonymous: z.boolean(),
      scheduledFor: IsoDateTime.nullable(),
      closesAt: IsoDateTime.nullable(),
      questions: z.array(TemplateSurveyQuestion),
      audienceCount: z.int(),
      responseCount: z.int(),
      responseRatePct: z.int(),
      minimumResponsesMet: z.boolean(),
      averageRating: z.number().nullable(),
      wouldAttendAgainPct: z.int().nullable(),
      ratingDistribution: z.array(z.object({ rating: z.int(), count: z.int() }).strict()),
      byLocation: z.array(
        z
          .object({
            locationName: z.string(),
            responses: z.int(),
            averageRating: z.number(),
          })
          .strict(),
      ),
      comments: z.array(
        z
          .object({
            id: Id,
            comment: z.string(),
            submittedAt: IsoDateTime,
            hidden: z.boolean(),
            hiddenReason: z.string().nullable(),
          })
          .strict(),
      ),
      photoConsentNoCount: z.int(),
      photos: z.array(GalleryPhotoView),
      mySurveyAnswered: z.boolean(),
    })
    .strict(),
);
export type EventFeedbackView = z.infer<typeof EventFeedbackView>;

export const UpdateEventSurveyBody = named(
  'UpdateEventSurveyBody',
  z
    .object({
      questions: z.array(TemplateSurveyQuestion).min(1).max(5).optional(),
      scheduledFor: IsoDateTime.nullable().optional(),
      status: z.enum(['draft', 'scheduled', 'open', 'closed']).optional(),
    })
    .strict(),
);
export type UpdateEventSurveyBody = z.infer<typeof UpdateEventSurveyBody>;

export const SubmitSurveyResponseBody = named(
  'SubmitSurveyResponseBody',
  z
    .object({
      rating: z.int().min(1).max(5),
      wouldAttendAgain: z.boolean(),
      comment: z.string().trim().max(1000).optional(),
      answers: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
);
export type SubmitSurveyResponseBody = z.infer<typeof SubmitSurveyResponseBody>;

export const UploadGalleryPhotoBody = named(
  'UploadGalleryPhotoBody',
  z
    .object({
      caption: z.string().trim().min(1).max(200),
      fileName: z.string().trim().min(1).max(200),
      photoPreferencesChecked: z.boolean(),
      documentId: Id.optional(),
    })
    .strict(),
);
export type UploadGalleryPhotoBody = z.infer<typeof UploadGalleryPhotoBody>;

export const ModerateGalleryPhotoBody = named(
  'ModerateGalleryPhotoBody',
  z
    .object({
      action: z.enum(['remove_me', 'hide', 'restore']),
      reason: z.string().trim().max(300).optional(),
    })
    .strict(),
);

export const EventScorecardView = named(
  'EventScorecardView',
  z
    .object({
      eventId: Id,
      eventName: z.string(),
      eventCode: z.string(),
      status: EventStatus,
      startsAt: IsoDateTime.nullable(),
      endsAt: IsoDateTime.nullable(),
      closedAt: IsoDateTime.nullable(),
      provisional: z.boolean(),
      provisionalReason: z.string().nullable(),
      attendanceFinal: z.boolean(),
      canManage: z.boolean(),
      kpis: z
        .object({
          plannedCostPerAttendee: Money,
          actualCostPerAttendee: Money.nullable(),
          costPerAttendeeDeltaBps: z.int().nullable(),
          fundedTotal: Money,
          spentTotal: Money,
          surplusTotal: Money,
          invitedCount: z.int(),
          goingCount: z.int(),
          attendedCount: z.int(),
          participationPct: z.int(),
          noShowCount: z.int(),
          noShowRatePct: z.int(),
          noShowCost: Money,
          averageRating: z.number().nullable(),
          responseCount: z.int(),
          wouldAttendAgainPct: z.int().nullable(),
          fxEffect: Money,
        })
        .strict(),
      costByCategory: z.array(
        z
          .object({
            category: z.string(),
            planned: Money,
            actual: Money,
          })
          .strict(),
      ),
      fundingAndReturns: z.array(
        z
          .object({
            sourceId: Id,
            budgetName: z.string(),
            contributionRef: z.string().nullable(),
            mode: ContributionMode,
            crossEntity: z.boolean(),
            approved: Money,
            actualShare: Money,
            surplusReturned: Money,
          })
          .strict(),
      ),
      participationByLocation: z.array(
        z
          .object({
            locationName: z.string(),
            invited: z.int(),
            attended: z.int(),
            ratePct: z.int(),
          })
          .strict(),
      ),
      comparison: z
        .object({
          label: z.string(),
          eventCount: z.int(),
          enoughEvents: z.boolean(),
          costPerAttendee: Money.nullable(),
          participationPct: z.int().nullable(),
          noShowRatePct: z.int().nullable(),
          averageRating: z.number().nullable(),
        })
        .strict(),
      organizerNotes: z.string().nullable(),
    })
    .strict(),
);
export type EventScorecardView = z.infer<typeof EventScorecardView>;

export const EventsDashboardView = named(
  'EventsDashboardView',
  z
    .object({
      generatedAt: IsoDateTime,
      kpis: z
        .object({
          upcomingCount: z.int(),
          upcomingFunded: Money,
          upcomingCaps: Money,
          upcomingGap: Money,
          closedPlannedPerAttendee: Money,
          closedActualPerAttendee: Money,
          closedParticipationPct: z.int(),
          waitingForReconciliationCount: z.int(),
        })
        .strict(),
      attention: z.array(
        z
          .object({
            id: z.string(),
            eventId: Id,
            eventName: z.string(),
            tone: z.enum(['warning', 'important', 'info']),
            text: z.string(),
            actionLabel: z.string(),
            actionPath: z.string(),
          })
          .strict(),
      ),
      upcoming: z.array(
        EventSummary.extend({
          goingCount: z.int(),
          capacityCount: z.int(),
          nextTaskTitle: z.string().nullable(),
          nextTaskOverdue: z.boolean(),
        }).strict(),
      ),
      recentlyClosed: z.array(
        z
          .object({
            id: Id,
            name: z.string(),
            eventCode: z.string(),
            closedAt: IsoDateTime.nullable(),
            costPerAttendee: Money,
            averageRating: z.number().nullable(),
            responseCount: z.int(),
          })
          .strict(),
      ),
    })
    .strict(),
);
export type EventsDashboardView = z.infer<typeof EventsDashboardView>;

export const ApplyTemplateToEventBody = named(
  'ApplyTemplateToEventBody',
  z.object({ templateId: Id }).strict(),
);

export const UpdateChecklistTaskBody = named(
  'UpdateChecklistTaskBody',
  UpsertChecklistTaskBody.partial().strict(),
);

export const UpdateAgendaItemBody = named(
  'UpdateAgendaItemBody',
  UpsertAgendaItemBody.partial().strict(),
);

export const RemindInvitationsBody = named(
  'RemindInvitationsBody',
  z.object({ participantIds: z.array(Id).max(2000).optional() }).strict(),
);

export const SetEventRsvpStateBody = named(
  'SetEventRsvpStateBody',
  z.object({ status: z.enum(['open', 'closed']), deadline: IsoDateTime.optional() }).strict(),
);

export const ModerateSurveyCommentBody = named(
  'ModerateSurveyCommentBody',
  z.object({ hidden: z.boolean(), reason: z.string().trim().max(300).optional() }).strict(),
);

export const UpdateScorecardNotesBody = named(
  'UpdateScorecardNotesBody',
  z.object({ notes: z.string().trim().max(2000) }).strict(),
);

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
  getEventsDashboard: {
    operationId: 'getEventsDashboard',
    method: 'get',
    path: '/api/events/dashboard',
    summary:
      'Organizer and location-manager events dashboard: KPIs, attention items, upcoming and closed',
    tags: ['events'],
    auth: true,
    query: z
      .object({ onlyMine: z.enum(['true', 'false']).optional(), locationId: Id.optional() })
      .strict(),
    response: { status: 200, schema: EventsDashboardView },
    errors: [401, 403],
  },
  listEventTemplates: {
    operationId: 'listEventTemplates',
    method: 'get',
    path: '/api/events/templates',
    summary: 'Company and personal event templates',
    tags: ['events'],
    auth: true,
    query: z.object({ scope: z.enum(['company', 'personal', 'all']).optional() }).strict(),
    response: { status: 200, schema: EventTemplateList },
    errors: [401],
  },
  getEventTemplate: {
    operationId: 'getEventTemplate',
    method: 'get',
    path: '/api/events/templates/{templateId}',
    summary: 'An event template with its checklist, agenda, survey and preferred vendors',
    tags: ['events'],
    auth: true,
    params: z.object({ templateId: Id }).strict(),
    response: { status: 200, schema: EventTemplate },
    errors: [401, 404],
  },
  createEventTemplate: {
    operationId: 'createEventTemplate',
    method: 'post',
    path: '/api/events/templates',
    summary: 'Create a personal or company event template',
    tags: ['events'],
    auth: true,
    idempotent: true,
    body: UpsertEventTemplateBody,
    response: { status: 201, schema: EventTemplate },
    errors: [400, 401, 403, 409, 422],
  },
  updateEventTemplate: {
    operationId: 'updateEventTemplate',
    method: 'put',
    path: '/api/events/templates/{templateId}',
    summary: 'Update or publish an event template',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: z.object({ templateId: Id }).strict(),
    body: UpsertEventTemplateBody,
    response: { status: 200, schema: EventTemplate },
    errors: [400, 401, 403, 404, 409, 422],
  },
  archiveEventTemplate: {
    operationId: 'archiveEventTemplate',
    method: 'post',
    path: '/api/events/templates/{templateId}/archive',
    summary: 'Archive an event template',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: z.object({ templateId: Id }).strict(),
    body: ReasonBody,
    response: { status: 200, schema: EventTemplate },
    errors: [401, 403, 404],
  },
  createRecurringEventSeries: {
    operationId: 'createRecurringEventSeries',
    method: 'post',
    path: '/api/events/series',
    summary: 'Preview or create a recurring series of draft events (up to 12 months ahead)',
    tags: ['events'],
    auth: true,
    idempotent: true,
    body: RecurringSeriesBody,
    response: { status: 200, schema: RecurringSeriesResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
  cloneEvent: {
    operationId: 'cloneEvent',
    method: 'post',
    path: '/api/events/{eventId}/clone',
    summary: 'Clone an event into a new draft event with shifted dates (never copies money)',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: CloneEventBody,
    response: { status: 201, schema: EventDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getEventPlan: {
    operationId: 'getEventPlan',
    method: 'get',
    path: '/api/events/{eventId}/plan',
    summary: 'Event checklist tasks and agenda items',
    tags: ['events'],
    auth: true,
    params: EventParams,
    response: { status: 200, schema: EventPlanView },
    errors: [401, 403, 404],
  },
  applyTemplateToEventPlan: {
    operationId: 'applyTemplateToEventPlan',
    method: 'post',
    path: '/api/events/{eventId}/plan/apply-template',
    summary: 'Apply a template checklist and agenda to an event',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: ApplyTemplateToEventBody,
    response: { status: 200, schema: EventPlanView },
    errors: [401, 403, 404, 409],
  },
  createChecklistTask: {
    operationId: 'createChecklistTask',
    method: 'post',
    path: '/api/events/{eventId}/plan/tasks',
    summary: 'Add a checklist task to an event',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: UpsertChecklistTaskBody,
    response: { status: 201, schema: EventPlanView },
    errors: [400, 401, 403, 404, 409],
  },
  updateChecklistTask: {
    operationId: 'updateChecklistTask',
    method: 'patch',
    path: '/api/events/{eventId}/plan/tasks/{taskId}',
    summary: 'Update, complete or comment on an event checklist task',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: z.object({ eventId: Id, taskId: Id }).strict(),
    body: UpdateChecklistTaskBody,
    response: { status: 200, schema: EventPlanView },
    errors: [400, 401, 403, 404, 409],
  },
  createAgendaItem: {
    operationId: 'createAgendaItem',
    method: 'post',
    path: '/api/events/{eventId}/plan/agenda',
    summary: 'Add an agenda item to an event',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: UpsertAgendaItemBody,
    response: { status: 201, schema: EventPlanView },
    errors: [400, 401, 403, 404, 409],
  },
  updateAgendaItem: {
    operationId: 'updateAgendaItem',
    method: 'patch',
    path: '/api/events/{eventId}/plan/agenda/{itemId}',
    summary: 'Update an agenda item',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: z.object({ eventId: Id, itemId: Id }).strict(),
    body: UpdateAgendaItemBody,
    response: { status: 200, schema: EventPlanView },
    errors: [400, 401, 403, 404, 409],
  },
  getEventInvitations: {
    operationId: 'getEventInvitations',
    method: 'get',
    path: '/api/events/{eventId}/invitations',
    summary: 'RSVP tracker, capacity and waitlist for an event',
    tags: ['events'],
    auth: true,
    params: EventParams,
    response: { status: 200, schema: EventInvitationView },
    errors: [401, 403, 404],
  },
  sendEventInvitations: {
    operationId: 'sendEventInvitations',
    method: 'post',
    path: '/api/events/{eventId}/invitations/send',
    summary: 'Send invitations with RSVP deadline, capacity and waitlist rules',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: SendInvitationsBody,
    response: { status: 200, schema: EventInvitationView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  remindEventInvitations: {
    operationId: 'remindEventInvitations',
    method: 'post',
    path: '/api/events/{eventId}/invitations/remind',
    summary: 'Send RSVP reminders to invited participants without a response',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: RemindInvitationsBody,
    response: { status: 200, schema: EventInvitationView },
    errors: [401, 403, 404],
  },
  setEventRsvpState: {
    operationId: 'setEventRsvpState',
    method: 'post',
    path: '/api/events/{eventId}/invitations/status',
    summary: 'Close or reopen RSVPs for an event',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: SetEventRsvpStateBody,
    response: { status: 200, schema: EventInvitationView },
    errors: [400, 401, 403, 404, 422],
  },
  getEmployeeInvitation: {
    operationId: 'getEmployeeInvitation',
    method: 'get',
    path: '/api/invitations/{invitationId}',
    summary: 'Employee self-service invitation view',
    tags: ['events'],
    auth: true,
    params: z.object({ invitationId: Id }).strict(),
    response: { status: 200, schema: EmployeeInvitationView },
    errors: [401, 403, 404],
  },
  respondToInvitation: {
    operationId: 'respondToInvitation',
    method: 'post',
    path: '/api/invitations/{invitationId}/rsvp',
    summary: 'Submit Going or Can’t go response (enforces capacity and waitlist)',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: z.object({ invitationId: Id }).strict(),
    body: RsvpRespondBody,
    response: { status: 200, schema: EmployeeInvitationView },
    errors: [400, 401, 403, 404, 409],
  },
  submitAttendeeNeeds: {
    operationId: 'submitAttendeeNeeds',
    method: 'post',
    path: '/api/invitations/{invitationId}/needs',
    summary: 'Submit dietary, allergy, accessibility, travel and photo-consent preferences',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: z.object({ invitationId: Id }).strict(),
    body: SubmitAttendeeNeedsBody,
    response: { status: 200, schema: EmployeeInvitationView },
    errors: [400, 401, 403, 404, 422],
  },
  getEventNeeds: {
    operationId: 'getEventNeeds',
    method: 'get',
    path: '/api/events/{eventId}/needs',
    summary: 'Attendee needs summary (organizers see individual rows; others see counts only)',
    tags: ['events'],
    auth: true,
    params: EventParams,
    response: { status: 200, schema: EventNeedsSummaryView },
    errors: [401, 403, 404],
  },
  exportCatererNeeds: {
    operationId: 'exportCatererNeeds',
    method: 'post',
    path: '/api/events/{eventId}/needs/export',
    summary: 'Export dietary and allergy counts for caterers (audited when names are included)',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: ExportCatererNeedsBody,
    response: { status: 200, schema: ExportCatererNeedsResult },
    errors: [400, 401, 403, 404, 422],
  },
  getEventAttendance: {
    operationId: 'getEventAttendance',
    method: 'get',
    path: '/api/events/{eventId}/attendance',
    summary: 'Attendance tracker and per-head cost split recalculation preview',
    tags: ['events'],
    auth: true,
    params: EventParams,
    response: { status: 200, schema: EventAttendanceView },
    errors: [401, 403, 404],
  },
  markEventAttendance: {
    operationId: 'markEventAttendance',
    method: 'post',
    path: '/api/events/{eventId}/attendance',
    summary: 'Mark attendance, add walk-ins or finalize attendance',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: MarkAttendanceBody,
    response: { status: 200, schema: EventAttendanceView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  applyEventAttendanceSplit: {
    operationId: 'applyEventAttendanceSplit',
    method: 'post',
    path: '/api/events/{eventId}/attendance/apply-split',
    summary:
      'Apply the attendance-based cost split (re-posts commitment funding lines) or keep planned split',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: ApplyAttendanceSplitBody,
    response: { status: 200, schema: EventAttendanceView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getEventQuotes: {
    operationId: 'getEventQuotes',
    method: 'get',
    path: '/api/events/{eventId}/quotes',
    summary: 'Vendor quote requests and side-by-side quote comparison',
    tags: ['events'],
    auth: true,
    params: EventParams,
    response: { status: 200, schema: EventQuotesView },
    errors: [401, 403, 404],
  },
  createEventQuoteRequest: {
    operationId: 'createEventQuoteRequest',
    method: 'post',
    path: '/api/events/{eventId}/quotes/requests',
    summary: 'Request quotes from approved or preferred vendors',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: CreateQuoteRequestBody,
    response: { status: 201, schema: EventQuotesView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  recordVendorQuote: {
    operationId: 'recordVendorQuote',
    method: 'post',
    path: '/api/events/{eventId}/quotes',
    summary:
      'Record or update a vendor quote in transaction currency (converted at the locked plan rate)',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: RecordVendorQuoteBody,
    response: { status: 201, schema: EventQuotesView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  selectVendorQuote: {
    operationId: 'selectVendorQuote',
    method: 'post',
    path: '/api/events/{eventId}/quotes/{quoteId}/select',
    summary: 'Select a vendor quote and create its commitment',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: z.object({ eventId: Id, quoteId: Id }).strict(),
    body: SelectVendorQuoteBody,
    response: { status: 200, schema: EventQuotesView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  declineVendorQuote: {
    operationId: 'declineVendorQuote',
    method: 'post',
    path: '/api/events/{eventId}/quotes/{quoteId}/decline',
    summary: 'Decline a vendor quote',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: z.object({ eventId: Id, quoteId: Id }).strict(),
    body: ReasonBody,
    response: { status: 200, schema: EventQuotesView },
    errors: [401, 403, 404, 409],
  },
  getEventFeedback: {
    operationId: 'getEventFeedback',
    method: 'get',
    path: '/api/events/{eventId}/feedback',
    summary: 'Post-event survey results and private photo gallery',
    tags: ['events'],
    auth: true,
    params: EventParams,
    response: { status: 200, schema: EventFeedbackView },
    errors: [401, 403, 404],
  },
  updateEventSurvey: {
    operationId: 'updateEventSurvey',
    method: 'put',
    path: '/api/events/{eventId}/feedback/survey',
    summary: 'Configure, schedule or open the post-event survey',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: UpdateEventSurveyBody,
    response: { status: 200, schema: EventFeedbackView },
    errors: [400, 401, 403, 404, 409],
  },
  submitEventSurveyResponse: {
    operationId: 'submitEventSurveyResponse',
    method: 'post',
    path: '/api/surveys/{surveyId}/responses',
    summary: 'Submit an anonymous post-event survey response',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: z.object({ surveyId: Id }).strict(),
    body: SubmitSurveyResponseBody,
    response: { status: 201, schema: EventFeedbackView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getEmployeeSurvey: {
    operationId: 'getEmployeeSurvey',
    method: 'get',
    path: '/api/surveys/{surveyId}',
    summary: 'Get the post-event survey for an attendee',
    tags: ['events'],
    auth: true,
    params: z.object({ surveyId: Id }).strict(),
    response: { status: 200, schema: EventFeedbackView },
    errors: [401, 403, 404],
  },
  moderateSurveyComment: {
    operationId: 'moderateSurveyComment',
    method: 'post',
    path: '/api/events/{eventId}/feedback/comments/{responseId}/moderate',
    summary: 'Hide or restore an offensive survey comment with a reason',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: z.object({ eventId: Id, responseId: Id }).strict(),
    body: ModerateSurveyCommentBody,
    response: { status: 200, schema: EventFeedbackView },
    errors: [400, 401, 403, 404],
  },
  uploadGalleryPhoto: {
    operationId: 'uploadGalleryPhoto',
    method: 'post',
    path: '/api/events/{eventId}/feedback/photos',
    summary: 'Add a photo to the event gallery (requires confirming photo preferences)',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: UploadGalleryPhotoBody,
    response: { status: 201, schema: EventFeedbackView },
    errors: [400, 401, 403, 404, 422],
  },
  moderateGalleryPhoto: {
    operationId: 'moderateGalleryPhoto',
    method: 'post',
    path: '/api/events/{eventId}/feedback/photos/{photoId}/moderate',
    summary: 'Request removal of a photo, hide or restore it',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: z.object({ eventId: Id, photoId: Id }).strict(),
    body: ModerateGalleryPhotoBody,
    response: { status: 200, schema: EventFeedbackView },
    errors: [400, 401, 403, 404],
  },
  getEventScorecard: {
    operationId: 'getEventScorecard',
    method: 'get',
    path: '/api/events/{eventId}/scorecard',
    summary:
      'Event ROI scorecard: cost per attendee, no-show waste, participation, feedback and returns',
    tags: ['events'],
    auth: true,
    params: EventParams,
    query: z.object({ compareEventId: Id.optional() }).strict(),
    response: { status: 200, schema: EventScorecardView },
    errors: [401, 403, 404],
  },
  updateEventScorecardNotes: {
    operationId: 'updateEventScorecardNotes',
    method: 'put',
    path: '/api/events/{eventId}/scorecard/notes',
    summary: 'Save organizer notes on the event ROI scorecard',
    tags: ['events'],
    auth: true,
    idempotent: true,
    params: EventParams,
    body: UpdateScorecardNotesBody,
    response: { status: 200, schema: EventScorecardView },
    errors: [400, 401, 403, 404, 409],
  },
} as const satisfies Record<string, Endpoint>;
