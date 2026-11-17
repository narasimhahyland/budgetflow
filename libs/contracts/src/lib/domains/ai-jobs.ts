import { z } from 'zod';
import { Id, IsoDate, IsoDateTime } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';
import { AiChannel, AiFeature } from './ai';

/**
 * Gap B9: the nightly AI scans (016b outlook, 017c anomaly flags) and the reported answers of
 * 113a. A scan only suggests: it writes outlook snapshots and advisory flags, never a ledger line,
 * an approval or a rule. A reported answer is feedback a person chose to send, never an action.
 */

// Nightly scans -----------------------------------------------------------------------------------

export const AI_SCAN_FEATURES = ['outlook', 'anomaly_flags'] as const;
export const AiScanFeature = z
  .enum(AI_SCAN_FEATURES)
  .describe('An AI feature that also runs as a nightly scan in the worker.');
export type AiScanFeature = z.infer<typeof AiScanFeature>;

export const AI_SCAN_STATUSES = ['queued', 'retrying', 'completed', 'skipped', 'failed'] as const;
export const AiScanStatus = z
  .enum(AI_SCAN_STATUSES)
  .describe(
    'queued: waiting for the worker; retrying: the model was unreachable, the worker tries again with backoff; ' +
      'completed; skipped: the feature is switched off for the company; failed: every retry failed and the job is in the dead-letter queue.',
  );
export type AiScanStatus = z.infer<typeof AiScanStatus>;

export const AiScanRun = named(
  'AiScanRun',
  z
    .object({
      id: Id,
      feature: AiScanFeature,
      runDate: IsoDate.describe(
        'The night the scan is for; one nightly run per company, feature and date.',
      ),
      trigger: z.enum(['nightly', 'manual']),
      status: AiScanStatus,
      skipReason: z.enum(['feature_off', 'provider_not_configured']).nullable(),
      scopeCount: z
        .int()
        .min(0)
        .nullable()
        .describe('Budgets the run was limited to (manual runs); null for the whole company.'),
      evaluatedCount: z
        .int()
        .min(0)
        .describe('Budgets measured (outlook) or records checked (flags).'),
      resultCount: z
        .int()
        .min(0)
        .describe(
          'Outlook snapshots written, or anomaly flags raised or refreshed (a flag a person decided keeps its status).',
        ),
      modelCalls: z.int().min(0),
      failedModelCalls: z.int().min(0),
      attempts: z.int().min(0),
      error: z.string().nullable().describe('Plain-English reason of the last failed attempt.'),
      requestedByName: z.string().nullable(),
      createdAt: IsoDateTime,
      completedAt: IsoDateTime.nullable(),
    })
    .strict()
    .describe('One AI scan executed by the worker.'),
);
export type AiScanRun = z.infer<typeof AiScanRun>;

export const AiScanRunList = named(
  'AiScanRunList',
  z
    .object({
      items: z.array(AiScanRun).describe('Newest run date first, then newest created.'),
      latestCompleted: z
        .array(AiScanRun)
        .describe(
          'Per feature the caller may read, the latest completed run (what the screens show).',
        ),
    })
    .strict(),
);
export type AiScanRunList = z.infer<typeof AiScanRunList>;

export const AiScanRunRequest = named(
  'AiScanRunRequest',
  z
    .object({
      feature: AiScanFeature,
      budgetIds: z
        .array(Id)
        .min(1)
        .max(50)
        .optional()
        .describe(
          'Limit a manual run to these budgets. Without it the request queues (or returns) the nightly run of tonight. Runs are always for today (UTC).',
        ),
    })
    .strict(),
);
export type AiScanRunRequest = z.infer<typeof AiScanRunRequest>;

// Reported answers (011a "Report a problem", 113a sub-tab) ----------------------------------------

export const AI_REPORT_REASONS = ['wrong_figure', 'missing_data', 'not_my_scope', 'other'] as const;
export const AiReportReason = z.enum(AI_REPORT_REASONS);
export type AiReportReason = z.infer<typeof AiReportReason>;

export const AiReportStatus = z.enum(['new', 'reviewed']);
export type AiReportStatus = z.infer<typeof AiReportStatus>;

export const AiReportAnswerRequest = named(
  'AiReportAnswerRequest',
  z
    .object({
      turnId: Id.describe('The answer being reported; it must be one of the reporter’s own turns.'),
      reason: AiReportReason,
      note: z.string().trim().max(500).optional(),
      includeText: z
        .boolean()
        .describe('"Include my question and the answer": only then is any text kept (90 days).'),
    })
    .strict(),
);
export type AiReportAnswerRequest = z.infer<typeof AiReportAnswerRequest>;

export const AiReviewReportRequest = named(
  'AiReviewReportRequest',
  z
    .object({
      note: z.string().trim().min(1).max(500).describe('What the reviewer found or did.'),
    })
    .strict(),
);
export type AiReviewReportRequest = z.infer<typeof AiReviewReportRequest>;

export const AiReportedAnswer = named(
  'AiReportedAnswer',
  z
    .object({
      id: Id,
      reportedAt: IsoDateTime,
      reporterName: z.string().nullable(),
      feature: AiFeature,
      channel: AiChannel,
      reason: AiReportReason,
      note: z.string().nullable().describe('The reporter’s own note.'),
      includesText: z.boolean(),
      question: z
        .string()
        .nullable()
        .describe('Only when the reporter included it, and until it expires.'),
      answer: z.string().nullable(),
      recordsUsed: z.int().min(0),
      queryLogId: Id.nullable(),
      modelId: z.string().nullable(),
      modelVersion: z.string().nullable(),
      status: AiReportStatus,
      reviewNote: z.string().nullable(),
      reviewedByName: z.string().nullable(),
      reviewedAt: IsoDateTime.nullable(),
      textExpiresAt: IsoDateTime.describe('Question and answer text are removed after 90 days.'),
    })
    .strict(),
);
export type AiReportedAnswer = z.infer<typeof AiReportedAnswer>;

export const AiReportedAnswerList = named(
  'AiReportedAnswerList',
  z
    .object({
      items: z.array(AiReportedAnswer).describe('Newest first.'),
      canReview: z.boolean().describe('Whether the caller may mark reports reviewed.'),
      counts: z.object({ new: z.int().min(0), reviewed: z.int().min(0) }).strict(),
    })
    .strict(),
);
export type AiReportedAnswerList = z.infer<typeof AiReportedAnswerList>;

// Endpoints ---------------------------------------------------------------------------------------

const ReportParams = z.object({ reportId: Id }).strict();

export const aiJobsEndpoints = {
  listAiScanRuns: {
    operationId: 'listAiScanRuns',
    method: 'get',
    path: '/api/ai/scan-runs',
    summary: 'Nightly and manual AI scan runs of the company, and the latest completed per feature',
    tags: ['ai'],
    auth: true,
    query: z
      .object({
        feature: AiScanFeature.optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
      })
      .strict(),
    response: { status: 200, schema: AiScanRunList },
    errors: [400, 401, 403],
  },
  requestAiScanRun: {
    operationId: 'requestAiScanRun',
    method: 'post',
    path: '/api/ai/scan-runs',
    summary:
      "Queue the night's scan now (or return it when it exists), or a manual run on some budgets",
    tags: ['ai'],
    auth: true,
    idempotent: true,
    body: AiScanRunRequest,
    response: { status: 202, schema: AiScanRun },
    errors: [400, 401, 403, 409, 422],
  },
  getAiScanRun: {
    operationId: 'getAiScanRun',
    method: 'get',
    path: '/api/ai/scan-runs/{runId}',
    summary: 'One AI scan run',
    tags: ['ai'],
    auth: true,
    params: z.object({ runId: Id }).strict(),
    response: { status: 200, schema: AiScanRun },
    errors: [401, 403, 404],
  },
  reportAiAnswer: {
    operationId: 'reportAiAnswer',
    method: 'post',
    path: '/api/ai/reported-answers',
    summary: 'Report a problem with one of your own answers (011a)',
    tags: ['ai'],
    auth: true,
    idempotent: true,
    body: AiReportAnswerRequest,
    response: { status: 201, schema: AiReportedAnswer },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listAiReportedAnswers: {
    operationId: 'listAiReportedAnswers',
    method: 'get',
    path: '/api/ai/reported-answers',
    summary: 'Answers people reported (113a, Query log > Reported answers)',
    tags: ['ai'],
    auth: true,
    query: z.object({ status: AiReportStatus.optional() }).strict(),
    response: { status: 200, schema: AiReportedAnswerList },
    errors: [400, 401, 403],
  },
  reviewAiReportedAnswer: {
    operationId: 'reviewAiReportedAnswer',
    method: 'post',
    path: '/api/ai/reported-answers/{reportId}/review',
    summary: 'Mark a reported answer reviewed, with a note (audited)',
    tags: ['ai'],
    auth: true,
    idempotent: true,
    params: ReportParams,
    body: AiReviewReportRequest,
    response: { status: 200, schema: AiReportedAnswer },
    errors: [400, 401, 403, 404, 409, 422],
  },
} as const satisfies Record<string, Endpoint>;
