import { z } from 'zod';
import { CurrencyCode, Id, IsoDate, IsoDateTime, Money } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

/**
 * Reclaim and redistribute campaigns (086a) and burn-rate alerts (gap B4). A campaign asks owners
 * to release money forecast to lapse; released money moves as reductions with a destination (a
 * target in the same legal entity, or back to the budget's parent). Burn-rate alerts tell an owner
 * that actual spend runs ahead of the budget's phasing.
 */

const Reason = z.string().trim().min(1).max(500);
const ReasonCode = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$/)
  .describe('Reason code: letters, digits, dot, dash or underscore (up to 50).');
const CampaignParams = z.object({ campaignId: Id }).strict();
const NoticeParams = z.object({ noticeId: Id }).strict();
const RunParams = z.object({ runId: Id }).strict();

export const RECLAIM_CAMPAIGN_STATUSES = ['collecting', 'redistributing', 'completed'] as const;
export const ReclaimCampaignStatus = z
  .enum(RECLAIM_CAMPAIGN_STATUSES)
  .describe('Collecting responses, redistributing released money, or completed.');
export type ReclaimCampaignStatus = z.infer<typeof ReclaimCampaignStatus>;

export const RECLAIM_NOTICE_STATUSES = [
  'sent',
  'released',
  'kept',
  'parent_review',
  'reclaimed',
] as const;
export const ReclaimNoticeStatus = z
  .enum(RECLAIM_NOTICE_STATUSES)
  .describe(
    'sent: waiting for the owner; released / kept: answered; parent_review: sent to the parent owner after the deadline; reclaimed: the released money moved.',
  );
export type ReclaimNoticeStatus = z.infer<typeof ReclaimNoticeStatus>;

export const ReclaimChoice = z
  .enum(['release_all', 'release_part', 'keep'])
  .describe('Release the proposed amount, release a different amount, or keep it with a reason.');
export type ReclaimChoice = z.infer<typeof ReclaimChoice>;

export const ReclaimCriteria = named(
  'ReclaimCriteria',
  z
    .object({
      minUnusedBps: z
        .int()
        .min(0)
        .max(10_000)
        .describe('Forecast unused must be above this share of authorized (basis points).'),
      minUnused: Money.describe(
        'Forecast unused must also be above this amount, in the reporting currency.',
      ),
      maxDaysLeft: z.int().min(1).max(366).describe('Fewer than this many days left in the year.'),
    })
    .strict(),
);
export type ReclaimCriteria = z.infer<typeof ReclaimCriteria>;

export const CreateReclaimCampaignRequest = named(
  'CreateReclaimCampaignRequest',
  z
    .object({
      name: z.string().trim().min(1).max(120),
      fiscalYearId: Id,
      criteria: ReclaimCriteria,
      respondBy: IsoDate.describe('Last day owners can answer.'),
    })
    .strict(),
);
export type CreateReclaimCampaignRequest = z.infer<typeof CreateReclaimCampaignRequest>;

export const ReclaimCandidate = named(
  'ReclaimCandidate',
  z
    .object({
      budgetId: Id,
      budgetName: z.string(),
      budgetCode: z.string().nullable(),
      ownerName: z.string().nullable(),
      legalEntityId: Id,
      legalEntityCode: z.string(),
      authorized: Money,
      available: Money,
      forecastUnused: Money.describe('Run-rate forecast of what lapses at year end.'),
      proposed: Money.describe('What the notice asks the owner to release.'),
      floor: Money.describe('Allocated out + held + encumbered + actual.'),
      maxReclaimable: Money.describe('Authorized minus the floor.'),
    })
    .strict(),
);
export type ReclaimCandidate = z.infer<typeof ReclaimCandidate>;

export const ReclaimCandidateList = named(
  'ReclaimCandidateList',
  z
    .object({
      items: z.array(ReclaimCandidate),
      daysLeft: z.int(),
      excludedFrozenOrZero: z.int(),
      excludedPendingCarry: z.int(),
    })
    .strict(),
);
export type ReclaimCandidateList = z.infer<typeof ReclaimCandidateList>;

export const ReclaimNotice = named(
  'ReclaimNotice',
  z
    .object({
      id: Id,
      campaignId: Id,
      campaignName: z.string(),
      budgetId: Id,
      budgetName: z.string(),
      budgetCode: z.string().nullable(),
      ownerName: z.string().nullable(),
      parentBudgetName: z.string().nullable(),
      parentOwnerName: z.string().nullable(),
      legalEntityId: Id,
      legalEntityCode: z.string(),
      forecastUnused: Money,
      proposed: Money,
      released: Money,
      kept: Money,
      status: ReclaimNoticeStatus,
      choice: ReclaimChoice.nullable(),
      reason: z.string().nullable(),
      plan: z.string().nullable(),
      respondedAs: z.enum(['owner', 'parent_owner']).nullable(),
      respondedByName: z.string().nullable(),
      respondedAt: IsoDateTime.nullable(),
      respondBy: IsoDate,
      overdue: z.boolean().describe('The deadline passed with no answer.'),
      yearEnd: IsoDate,
      available: Money.describe('Available now, under the budget rules.'),
      floor: Money.describe('The floor now: allocated out + held + encumbered + actual.'),
      maxReclaimable: Money.describe('The most that can be reclaimed now.'),
      pendingRequests: Money.describe(
        'Pending (pre-encumbered) requests on the budget: listed, never part of the floor.',
      ),
      leftOut: z
        .boolean()
        .describe(
          'Released, but left out when its legal entity was redistributed: the money stayed with the budget.',
        ),
      remindersSent: z
        .array(z.enum(['two_days', 'one_day']))
        .describe('Deadline reminders already sent to the owner (2 days and 1 day before).'),
      canRespond: z.boolean(),
      canEscalate: z.boolean(),
    })
    .strict(),
);
export type ReclaimNotice = z.infer<typeof ReclaimNotice>;

export const ReclaimNoticeList = named(
  'ReclaimNoticeList',
  z.object({ items: z.array(ReclaimNotice) }).strict(),
);
export type ReclaimNoticeList = z.infer<typeof ReclaimNoticeList>;

export const ReclaimTargetSuggestion = named(
  'ReclaimTargetSuggestion',
  z
    .object({
      budgetId: Id,
      budgetName: z.string(),
      need: Money,
      reason: z.string().describe('Why it needs money, in one sentence.'),
    })
    .strict(),
);

export const ReclaimLeg = named(
  'ReclaimLeg',
  z
    .object({
      sourceBudgetId: Id,
      sourceBudgetName: z.string(),
      destination: z.enum(['reallocation', 'parent']),
      targetBudgetId: Id,
      targetBudgetName: z.string(),
      amount: Money,
      journalId: Id.nullable(),
    })
    .strict(),
);
export type ReclaimLeg = z.infer<typeof ReclaimLeg>;

export const ReclaimExecution = named(
  'ReclaimExecution',
  z
    .object({
      id: Id,
      campaignId: Id,
      legalEntityId: Id,
      legalEntityCode: z.string(),
      pool: Money,
      allocated: Money,
      remainder: Money,
      legs: z.array(ReclaimLeg),
      journalIds: z.array(Id),
      reasonCode: z.string(),
      reason: z.string(),
      executedByName: z.string().nullable(),
      executedAt: IsoDateTime,
    })
    .strict(),
);
export type ReclaimExecution = z.infer<typeof ReclaimExecution>;

export const ReclaimPool = named(
  'ReclaimPool',
  z
    .object({
      legalEntityId: Id,
      legalEntityCode: z.string(),
      released: Money,
      sourceCount: z.int(),
      executionId: Id.nullable(),
      suggestedTargets: z.array(ReclaimTargetSuggestion),
    })
    .strict(),
);
export type ReclaimPool = z.infer<typeof ReclaimPool>;

export const ReclaimCampaign = named(
  'ReclaimCampaign',
  z
    .object({
      id: Id,
      name: z.string(),
      fiscalYearId: Id,
      status: ReclaimCampaignStatus,
      startedOn: IsoDate,
      respondBy: IsoDate,
      criteria: ReclaimCriteria,
      candidates: z.int(),
      answered: z.int(),
      released: z.array(Money).describe('Released so far, one amount per currency.'),
      redistributed: z.array(Money).describe('Moved by pool executions, one amount per currency.'),
    })
    .strict(),
);
export type ReclaimCampaign = z.infer<typeof ReclaimCampaign>;

export const ReclaimCampaignList = named(
  'ReclaimCampaignList',
  z
    .object({
      items: z.array(ReclaimCampaign),
      canManage: z.boolean(),
    })
    .strict(),
);
export type ReclaimCampaignList = z.infer<typeof ReclaimCampaignList>;

export const ReclaimCampaignDetail = named(
  'ReclaimCampaignDetail',
  z
    .object({
      campaign: ReclaimCampaign,
      notices: z.array(ReclaimNotice),
      pools: z.array(ReclaimPool),
      executions: z.array(ReclaimExecution),
      canManage: z.boolean(),
      canRedistribute: z.boolean(),
    })
    .strict(),
);
export type ReclaimCampaignDetail = z.infer<typeof ReclaimCampaignDetail>;

export const RespondReclaimNoticeRequest = named(
  'RespondReclaimNoticeRequest',
  z
    .object({
      choice: ReclaimChoice,
      amountMinor: z
        .int()
        .positive()
        .optional()
        .describe('For release_part: the amount released, in the budget currency.'),
      reason: Reason.optional().describe('Required to keep the money.'),
      plan: Reason.optional().describe('Required to keep the money: what it is planned for.'),
    })
    .strict(),
);
export type RespondReclaimNoticeRequest = z.infer<typeof RespondReclaimNoticeRequest>;

export const EscalateReclaimNoticeRequest = named(
  'EscalateReclaimNoticeRequest',
  z.object({ reason: Reason }).strict(),
);
export type EscalateReclaimNoticeRequest = z.infer<typeof EscalateReclaimNoticeRequest>;

const PoolTarget = z.object({ budgetId: Id, amountMinor: z.int().positive() }).strict();

export const ReclaimPoolPreviewRequest = named(
  'ReclaimPoolPreviewRequest',
  z
    .object({
      legalEntityId: Id,
      currency: CurrencyCode,
      targets: z.array(PoolTarget).max(50),
      excludeBudgetIds: z
        .array(Id)
        .max(50)
        .optional()
        .describe(
          'Released budgets to leave out of this redistribution (for example one set to zero since): nothing moves for them.',
        ),
    })
    .strict(),
);
export type ReclaimPoolPreviewRequest = z.infer<typeof ReclaimPoolPreviewRequest>;

export const ReclaimSourceImpact = named(
  'ReclaimSourceImpact',
  z
    .object({
      budgetId: Id,
      budgetName: z.string(),
      released: Money,
      authorizedBefore: Money,
      authorizedAfter: Money,
      floor: Money,
      maxReclaimable: Money,
      pendingRequests: Money.describe('Pre-encumbered requests: listed, never part of the floor.'),
      withinFloor: z.boolean(),
    })
    .strict(),
);
export type ReclaimSourceImpact = z.infer<typeof ReclaimSourceImpact>;

export const ReclaimPoolPreview = named(
  'ReclaimPoolPreview',
  z
    .object({
      legalEntityId: Id,
      legalEntityCode: z.string(),
      pool: Money,
      allocated: Money,
      remainder: Money,
      legs: z.array(ReclaimLeg),
      sources: z.array(ReclaimSourceImpact),
      excluded: z
        .array(z.object({ budgetId: Id, budgetName: z.string(), released: Money }).strict())
        .describe('Released budgets left out of this redistribution.'),
      canConfirm: z.boolean(),
      blockedReason: z.string().nullable(),
    })
    .strict(),
);
export type ReclaimPoolPreview = z.infer<typeof ReclaimPoolPreview>;

export const ExecuteReclaimPoolRequest = named(
  'ExecuteReclaimPoolRequest',
  z
    .object({
      legalEntityId: Id,
      currency: CurrencyCode,
      targets: z.array(PoolTarget).max(50),
      excludeBudgetIds: z
        .array(Id)
        .max(50)
        .optional()
        .describe(
          'Released budgets to leave out of this redistribution (for example one set to zero since): nothing moves for them.',
        ),
      reasonCode: ReasonCode,
      reason: Reason,
      confirmedFloors: z
        .array(z.object({ budgetId: Id, floorMinor: z.int().min(0) }).strict())
        .describe('The floor of each source from the preview the user confirmed.'),
    })
    .strict(),
);
export type ExecuteReclaimPoolRequest = z.infer<typeof ExecuteReclaimPoolRequest>;

export const RunReclaimRemindersRequest = named(
  'RunReclaimRemindersRequest',
  z
    .object({
      asOf: IsoDate.optional().describe('The day to send reminders for; today when omitted.'),
    })
    .strict(),
);
export type RunReclaimRemindersRequest = z.infer<typeof RunReclaimRemindersRequest>;

export const ReclaimReminderRun = named(
  'ReclaimReminderRun',
  z
    .object({
      asOf: IsoDate,
      queued: z.boolean().describe('The worker sends the reminders that are due on this day.'),
    })
    .strict(),
);
export type ReclaimReminderRun = z.infer<typeof ReclaimReminderRun>;

// Burn-rate alerts ------------------------------------------------------------------------------

export const BurnRateLevel = z
  .enum(['ahead', 'well_ahead'])
  .describe('ahead: spend at or above 110% of phased to date; well_ahead: at or above 125%.');
export type BurnRateLevel = z.infer<typeof BurnRateLevel>;

export const BurnRateRun = named(
  'BurnRateRun',
  z
    .object({
      id: Id,
      asOf: IsoDate,
      status: z.enum(['queued', 'completed', 'failed']),
      trigger: z.enum(['manual', 'nightly']),
      evaluatedCount: z.int(),
      alertsRaised: z.int(),
      createdAt: IsoDateTime,
      completedAt: IsoDateTime.nullable(),
    })
    .strict(),
);
export type BurnRateRun = z.infer<typeof BurnRateRun>;

export const CreateBurnRateRunRequest = named(
  'CreateBurnRateRunRequest',
  z
    .object({
      asOf: IsoDate.optional().describe('The date to measure spend at; today when omitted.'),
    })
    .strict(),
);
export type CreateBurnRateRunRequest = z.infer<typeof CreateBurnRateRunRequest>;

export const BurnRateAlert = named(
  'BurnRateAlert',
  z
    .object({
      id: Id,
      budgetId: Id,
      budgetName: z.string(),
      fiscalPeriodId: Id,
      level: BurnRateLevel,
      burnBps: z.int().describe('Actual spend against phased to date, in basis points.'),
      spent: Money,
      phased: Money,
      asOf: IsoDate,
      runId: Id,
      createdAt: IsoDateTime,
    })
    .strict(),
);
export type BurnRateAlert = z.infer<typeof BurnRateAlert>;

export const BurnRateAlertList = named(
  'BurnRateAlertList',
  z.object({ items: z.array(BurnRateAlert) }).strict(),
);
export type BurnRateAlertList = z.infer<typeof BurnRateAlertList>;

export const BurnRateAlertQuery = z
  .object({ budgetId: Id.optional(), runId: Id.optional() })
  .strict();

export const reclaimEndpoints = {
  listReclaimCampaigns: {
    operationId: 'listReclaimCampaigns',
    method: 'get',
    path: '/api/reclaim/campaigns',
    summary: 'Reclaim campaigns, newest first',
    tags: ['reclaim'],
    auth: true,
    response: { status: 200, schema: ReclaimCampaignList },
    errors: [401, 403],
  },
  previewReclaimCampaign: {
    operationId: 'previewReclaimCampaign',
    method: 'post',
    path: '/api/reclaim/campaigns/preview',
    summary: 'Budgets that meet the criteria, with the proposed amounts (writes nothing)',
    tags: ['reclaim'],
    auth: true,
    body: CreateReclaimCampaignRequest,
    response: { status: 200, schema: ReclaimCandidateList },
    errors: [400, 401, 403, 404, 422],
  },
  createReclaimCampaign: {
    operationId: 'createReclaimCampaign',
    method: 'post',
    path: '/api/reclaim/campaigns',
    summary: 'Start a campaign and send a notice to the owner of every candidate (audited)',
    tags: ['reclaim'],
    auth: true,
    idempotent: true,
    body: CreateReclaimCampaignRequest,
    response: { status: 201, schema: ReclaimCampaignDetail },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getReclaimCampaign: {
    operationId: 'getReclaimCampaign',
    method: 'get',
    path: '/api/reclaim/campaigns/{campaignId}',
    summary: 'A campaign with its notices, released pools per legal entity and executions',
    tags: ['reclaim'],
    auth: true,
    params: CampaignParams,
    response: { status: 200, schema: ReclaimCampaignDetail },
    errors: [400, 401, 403, 404],
  },
  previewReclaimPool: {
    operationId: 'previewReclaimPool',
    method: 'post',
    path: '/api/reclaim/campaigns/{campaignId}/pools/preview',
    summary: 'Impact preview of redistributing one legal entity pool (writes nothing)',
    tags: ['reclaim'],
    auth: true,
    params: CampaignParams,
    body: ReclaimPoolPreviewRequest,
    response: { status: 200, schema: ReclaimPoolPreview },
    errors: [400, 401, 403, 404, 409, 422],
  },
  executeReclaimPool: {
    operationId: 'executeReclaimPool',
    method: 'post',
    path: '/api/reclaim/campaigns/{campaignId}/pools/execution',
    summary: 'Post one legal entity pool: reductions to the targets and the remainder to parents',
    tags: ['reclaim'],
    auth: true,
    idempotent: true,
    params: CampaignParams,
    body: ExecuteReclaimPoolRequest,
    response: { status: 201, schema: ReclaimExecution },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listMyReclaimNotices: {
    operationId: 'listMyReclaimNotices',
    method: 'get',
    path: '/api/reclaim/notices',
    summary: 'Notices waiting for me, as the owner or (after the deadline) the parent owner',
    tags: ['reclaim'],
    auth: true,
    response: { status: 200, schema: ReclaimNoticeList },
    errors: [401],
  },
  getReclaimNotice: {
    operationId: 'getReclaimNotice',
    method: 'get',
    path: '/api/reclaim/notices/{noticeId}',
    summary: 'One notice with the budget figures as they stand now',
    tags: ['reclaim'],
    auth: true,
    params: NoticeParams,
    response: { status: 200, schema: ReclaimNotice },
    errors: [400, 401, 403, 404],
  },
  respondReclaimNotice: {
    operationId: 'respondReclaimNotice',
    method: 'post',
    path: '/api/reclaim/notices/{noticeId}/response',
    summary: 'Release all, release part or keep the money (owner; parent owner after escalation)',
    tags: ['reclaim'],
    auth: true,
    idempotent: true,
    params: NoticeParams,
    body: RespondReclaimNoticeRequest,
    response: { status: 200, schema: ReclaimNotice },
    errors: [400, 401, 403, 404, 409, 422],
  },
  escalateReclaimNotice: {
    operationId: 'escalateReclaimNotice',
    method: 'post',
    path: '/api/reclaim/notices/{noticeId}/escalation',
    summary: 'After the deadline, send an unanswered notice to the parent owner for a decision',
    tags: ['reclaim'],
    auth: true,
    idempotent: true,
    params: NoticeParams,
    body: EscalateReclaimNoticeRequest,
    response: { status: 200, schema: ReclaimNotice },
    errors: [400, 401, 403, 404, 409, 422],
  },
  runReclaimReminders: {
    operationId: 'runReclaimReminders',
    method: 'post',
    path: '/api/reclaim/reminder-runs',
    summary: 'Queue the deadline reminders due on a day (the worker also runs them nightly)',
    tags: ['reclaim'],
    auth: true,
    idempotent: true,
    body: RunReclaimRemindersRequest,
    response: { status: 202, schema: ReclaimReminderRun },
    errors: [400, 401, 403],
  },
  createBurnRateRun: {
    operationId: 'createBurnRateRun',
    method: 'post',
    path: '/api/burn-rate/runs',
    summary: 'Queue a burn-rate check; the worker alerts owners whose spend runs ahead of phasing',
    tags: ['reclaim'],
    auth: true,
    idempotent: true,
    body: CreateBurnRateRunRequest,
    response: { status: 202, schema: BurnRateRun },
    errors: [400, 401, 403, 422],
  },
  getBurnRateRun: {
    operationId: 'getBurnRateRun',
    method: 'get',
    path: '/api/burn-rate/runs/{runId}',
    summary: 'A burn-rate run and how many alerts it raised',
    tags: ['reclaim'],
    auth: true,
    params: RunParams,
    response: { status: 200, schema: BurnRateRun },
    errors: [400, 401, 403, 404],
  },
  listBurnRateAlerts: {
    operationId: 'listBurnRateAlerts',
    method: 'get',
    path: '/api/burn-rate/alerts',
    summary: 'Burn-rate alerts on the budgets I can read, newest first',
    tags: ['reclaim'],
    auth: true,
    query: BurnRateAlertQuery,
    response: { status: 200, schema: BurnRateAlertList },
    errors: [400, 401],
  },
} as const satisfies Record<string, Endpoint>;
