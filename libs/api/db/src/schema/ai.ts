import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { budgets } from './budgets';
import { appNow, ccy, createdAt, day, minor, pk, tenantRef, ts, updatedAt } from './_columns';
import { people } from './org';
import { tenants } from './tenancy';

/**
 * Phase 13, the AI layer. Nothing here authorizes anything: a suggestion records what the model
 * proposed and why, a person applies it through the normal command, and the query log keeps the
 * audit trail of who asked what, under which authorization scope, and what they later confirmed.
 */

/**
 * Append-only record of every AI call and every human decision that followed one (113a). Never holds
 * the question, the answer or personal data: only ids, field names, outcome, model and latency.
 */
export const aiQueryLog = pgTable(
  'ai_query_log',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    occurredAt: ts('occurred_at').notNull().default(appNow),
    feature: text('feature').notNull(),
    channel: text('channel').notNull(),
    actorPersonId: uuid('actor_person_id').references(() => people.id),
    actorSubject: text('actor_subject'),
    outcome: text('outcome').notNull(),
    /** The action asked of PolicyService before anything was retrieved, and the scope it granted. */
    scopeAction: text('scope_action').notNull(),
    scopeKind: text('scope_kind').notNull(),
    consideredCount: integer('considered_count').notNull().default(0),
    permittedCount: integer('permitted_count').notNull().default(0),
    /** Exactly the records the model saw, as `{type,id,label}` references. */
    factRefs: jsonb('fact_refs').notNull().default([]),
    /** The field names sent to the model. Nothing outside this list left the server. */
    sentFields: text('sent_fields').array().notNull().default([]),
    provider: text('provider').notNull(),
    modelId: text('model_id').notNull(),
    modelVersion: text('model_version').notNull(),
    latencyMs: integer('latency_ms').notNull().default(0),
    suggestionId: uuid('suggestion_id'),
    appliedResourceType: text('applied_resource_type'),
    appliedResourceId: uuid('applied_resource_id'),
    auditEventId: uuid('audit_event_id'),
  },
  (t) => [
    index('ai_query_log_tenant_time').on(t.tenantId, t.occurredAt, t.id),
    index('ai_query_log_feature').on(t.tenantId, t.feature, t.outcome),
    index('ai_query_log_suggestion').on(t.tenantId, t.suggestionId),
  ],
);

/** What a model proposed, with its status. A suggestion is never itself authorization to change anything. */
export const aiSuggestions = pgTable(
  'ai_suggestions',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    feature: text('feature').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    budgetId: uuid('budget_id').references(() => budgets.id),
    confidence: text('confidence').notNull(),
    scoreBps: integer('score_bps').notNull().default(0),
    /** The proposal itself: figures are copies of reconciled read-model values, never model arithmetic. */
    payload: jsonb('payload').notNull().default({}),
    sources: jsonb('sources').notNull().default([]),
    provider: text('provider').notNull(),
    modelId: text('model_id').notNull(),
    modelVersion: text('model_version').notNull(),
    status: text('status').notNull().default('open'),
    createdByPersonId: uuid('created_by_person_id').references(() => people.id),
    decidedByPersonId: uuid('decided_by_person_id').references(() => people.id),
    decidedAt: ts('decided_at'),
    decisionReasonCode: text('decision_reason_code'),
    decisionReason: text('decision_reason'),
    appliedResourceType: text('applied_resource_type'),
    appliedResourceId: uuid('applied_resource_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ai_suggestions_subject').on(t.tenantId, t.feature, t.subjectType, t.subjectId),
    index('ai_suggestions_status').on(t.tenantId, t.feature, t.status),
    index('ai_suggestions_budget').on(t.tenantId, t.budgetId),
  ],
);

/** A person's own question thread (011a). Readable only by the asker; kept for the retention days in 113a. */
export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    personId: uuid('person_id').references(() => people.id),
    actorSubject: text('actor_subject').notNull(),
    title: text('title').notNull(),
    channel: text('channel').notNull(),
    startedAt: ts('started_at').notNull().default(appNow),
    lastAskedAt: ts('last_asked_at').notNull().default(appNow),
  },
  (t) => [index('ai_conversations_person').on(t.tenantId, t.actorSubject, t.lastAskedAt)],
);

export const aiConversationTurns = pgTable(
  'ai_conversation_turns',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    actorSubject: text('actor_subject').notNull(),
    askedAt: ts('asked_at').notNull().default(appNow),
    question: text('question').notNull(),
    answer: text('answer'),
    outcome: text('outcome').notNull(),
    queryLogId: uuid('query_log_id'),
  },
  (t) => [index('ai_conversation_turns_conversation').on(t.tenantId, t.conversationId, t.askedAt)],
);

/**
 * Spending outlook per budget and as-of date (016b). The range comes from a statistical model over
 * ledger history; the language model only writes the driver sentences from those numbers.
 */
export const aiOutlookSnapshots = pgTable(
  'ai_outlook_snapshots',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id),
    asOfDate: day('as_of_date').notNull(),
    currency: ccy('currency').notNull(),
    authorizedMinor: minor('authorized_minor').notNull(),
    toDateMinor: minor('to_date_minor').notNull(),
    likelyMinor: minor('likely_minor'),
    lowMinor: minor('low_minor'),
    highMinor: minor('high_minor'),
    gapMinor: minor('gap_minor'),
    category: text('category').notNull(),
    confidence: text('confidence'),
    drivers: jsonb('drivers').notNull().default([]),
    sources: jsonb('sources').notNull().default([]),
    modelId: text('model_id').notNull(),
    modelVersion: text('model_version').notNull(),
    suggestionId: uuid('suggestion_id').references(() => aiSuggestions.id),
    nudgeSentAt: ts('nudge_sent_at'),
    snoozedUntil: day('snoozed_until'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ai_outlook_budget_as_of').on(t.tenantId, t.budgetId, t.asOfDate),
    index('ai_outlook_category').on(t.tenantId, t.category),
  ],
);

/** Per-feature evaluation runs against the configured provider, measured against a threshold (113a). */
export const aiEvaluationRuns = pgTable(
  'ai_evaluation_runs',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    feature: text('feature').notNull(),
    fixtureSet: text('fixture_set').notNull(),
    metric: text('metric').notNull(),
    kind: text('kind'),
    thresholdBps: integer('threshold_bps').notNull(),
    resultBps: integer('result_bps').notNull(),
    passed: boolean('passed').notNull(),
    cases: integer('cases').notNull().default(0),
    failures: jsonb('failures').notNull().default([]),
    provider: text('provider').notNull(),
    modelId: text('model_id').notNull(),
    modelVersion: text('model_version').notNull(),
    runAt: ts('run_at').notNull().default(appNow),
  },
  (t) => [index('ai_evaluation_runs_feature').on(t.tenantId, t.feature, t.metric, t.runAt)],
);

/**
 * Gap B9: one AI scan run executed by the worker (016b outlook, 017c anomaly flags). The nightly run
 * is unique per tenant, feature and date, so a redelivered or replayed job finds its run and does
 * nothing more. A run only writes suggestions and snapshots; never a ledger line, approval or rule.
 */
export const aiScanRuns = pgTable(
  'ai_scan_runs',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    feature: text('feature').notNull(),
    runDate: day('run_date').notNull(),
    trigger: text('trigger').notNull(),
    status: text('status').notNull().default('queued'),
    skipReason: text('skip_reason'),
    /** Manual runs limited to some budgets; null scans every budget of the tenant. */
    budgetIds: uuid('budget_ids').array(),
    evaluatedCount: integer('evaluated_count').notNull().default(0),
    resultCount: integer('result_count').notNull().default(0),
    modelCalls: integer('model_calls').notNull().default(0),
    failedModelCalls: integer('failed_model_calls').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    requestedByPersonId: uuid('requested_by_person_id').references(() => people.id),
    createdAt: createdAt(),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
  },
  (t) => [
    uniqueIndex('ai_scan_runs_nightly')
      .on(t.tenantId, t.feature, t.runDate)
      .where(sql`${t.trigger} = 'nightly'`),
    index('ai_scan_runs_tenant').on(t.tenantId, t.feature, t.runDate, t.createdAt),
  ],
);

/**
 * Answers people reported from 011a with "Report a problem" (113a, Query log > Reported answers).
 * Text is kept only when the reporter chose "Include my question and the answer", and the nightly
 * job removes it after 90 days; the report itself (reason, status, review note) stays.
 */
export const aiReportedAnswers = pgTable(
  'ai_reported_answers',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    reportedAt: ts('reported_at').notNull().default(appNow),
    reporterPersonId: uuid('reporter_person_id').references(() => people.id),
    reporterSubject: text('reporter_subject').notNull(),
    turnId: uuid('turn_id').notNull(),
    queryLogId: uuid('query_log_id'),
    feature: text('feature').notNull(),
    channel: text('channel').notNull(),
    reason: text('reason').notNull(),
    note: text('note'),
    includesText: boolean('includes_text').notNull(),
    question: text('question'),
    answer: text('answer'),
    textExpiresAt: ts('text_expires_at').notNull(),
    textRemovedAt: ts('text_removed_at'),
    status: text('status').notNull().default('new'),
    reviewNote: text('review_note'),
    reviewedByPersonId: uuid('reviewed_by_person_id').references(() => people.id),
    reviewedAt: ts('reviewed_at'),
  },
  (t) => [
    uniqueIndex('ai_reported_answers_turn').on(t.tenantId, t.turnId),
    index('ai_reported_answers_status').on(t.tenantId, t.status, t.reportedAt),
  ],
);
