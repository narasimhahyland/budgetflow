import { z } from 'zod';
import { CurrencyCode, Id, IsoDate, IsoDateTime, Money } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

/**
 * Phase 13, the AI layer (screens 011a, 016b, 017c, 022d, 061f, 069a, 080f, 113a, 121a).
 *
 * AI suggests; people decide. Nothing in this domain posts to the ledger, approves a request, moves
 * budget or changes a control. A suggestion carries what it proposes and why; a person then applies it
 * through the same authorized command they would have used unaided (the allocation grid, the match
 * endpoint, reduce, revise), and records the outcome here so an auditor can reconstruct the decision.
 */

// Features, channels and shared output ------------------------------------------------------------

export const AI_FEATURES = [
  'ask',
  'ask_chat',
  'outlook',
  'allocation_suggestions',
  'policy_explain',
  'matching',
  'extraction',
  'anomaly_flags',
  // Phase 15 additions to the same surface: drafted narratives (011b) and the planning copilot (045b).
  'leadership_summary',
  'variance_commentary',
] as const;
export const AiFeature = z
  .enum(AI_FEATURES)
  .describe('An AI surface with its own switch, evaluation set and accuracy threshold (113a).');
export type AiFeature = z.infer<typeof AiFeature>;

/** `feature_flags` key behind a feature switch, e.g. `ai.matching`. */
export const aiFeatureFlagKey = (feature: AiFeature): string => `ai.${feature}`;

/** Features that move or explain the numbers finance is accountable for: a Finance Admin confirms them. */
export const AI_FINANCE_FEATURES: readonly AiFeature[] = [
  'matching',
  'extraction',
  'anomaly_flags',
  'outlook',
  // A drafted narrative quotes the figures the board reads, so finance confirms it too.
  'leadership_summary',
  'variance_commentary',
];

export const AiChannel = z
  .enum(['web', 'mobile', 'slack', 'teams', 'system'])
  .describe('Where the request came from (061f covers slack and teams).');
export type AiChannel = z.infer<typeof AiChannel>;

export const AiConfidence = z
  .enum(['high', 'medium', 'low'])
  .describe('Confidence in words; a bare score is never shown.');
export type AiConfidence = z.infer<typeof AiConfidence>;

export const AI_OUTCOMES = [
  'answered',
  'suggested',
  'accepted',
  'dismissed',
  'rejected',
  'refused_out_of_scope',
  'refused_action',
  'discarded_unreliable',
  'disabled',
  'rate_limited',
  'failed',
] as const;
export const AiOutcome = z
  .enum(AI_OUTCOMES)
  .describe('What happened to one AI call, or what a person later did with its suggestion.');
export type AiOutcome = z.infer<typeof AiOutcome>;

export const AI_SOURCE_TYPES = [
  'budget',
  'event',
  'request',
  'commitment',
  'actual',
  'document',
  'rule',
  'policy',
  'headcount_snapshot',
  'prior_year_budget',
  'participation',
  // Phase 15: the closed-period snapshot a leadership summary quotes, and the survey behind a pulse.
  'period_snapshot',
  'survey',
] as const;

export const AiSourceRef = named(
  'AiSourceRef',
  z
    .object({
      type: z.enum(AI_SOURCE_TYPES),
      id: z.string().describe('Record id; the viewer may read every record listed here.'),
      label: z.string().describe('Plain name of the record, safe for the viewer to see.'),
    })
    .strict()
    .describe('A record the answer was built from. Only records the viewer may read appear.'),
);
export type AiSourceRef = z.infer<typeof AiSourceRef>;

export const AiFigure = named(
  'AiFigure',
  z
    .object({
      key: z.string().describe('Stable key, e.g. `authorized`, `available`, `committed`.'),
      label: z.string(),
      amount: Money,
      source: AiSourceRef.describe('The record the figure was read from.'),
    })
    .strict()
    .describe(
      'A figure read from the reconciled ledger read models and rendered by BudgetFlow. The model never computes or restates a figure.',
    ),
);
export type AiFigure = z.infer<typeof AiFigure>;

export const AiProvenance = named(
  'AiProvenance',
  z
    .object({
      suggestionId: Id.nullable().describe(
        'Set when the output proposes something a person applies.',
      ),
      queryLogId: Id.describe('The append-only ai_query_log row for this call (113a).'),
      provider: z.string().describe('Provider id, e.g. `fake` for functional runs and CI.'),
      modelId: z.string(),
      modelVersion: z.string(),
      generatedAt: IsoDateTime,
      latencyMs: z.int().min(0),
    })
    .strict()
    .describe(
      'Where an AI output came from. Carried into the audit entry of any change it leads to.',
    ),
);
export type AiProvenance = z.infer<typeof AiProvenance>;

export const AiRefusal = named(
  'AiRefusal',
  z
    .object({
      kind: z.enum(['out_of_scope', 'action', 'unreliable', 'not_covered', 'other_person']),
      message: z
        .string()
        .describe('Plain-English refusal; never confirms a record the asker cannot see.'),
      redirect: z
        .object({
          label: z.string(),
          resourceType: z.string(),
          resourceId: Id.nullable(),
        })
        .strict()
        .nullable()
        .describe('The screen and record where a person can do this themselves.'),
    })
    .strict()
    .describe(
      'Why the assistant did not answer. An action request is always redirected, never performed.',
    ),
);
export type AiRefusal = z.infer<typeof AiRefusal>;

// 011a / 061f ask ---------------------------------------------------------------------------------

export const AskRequest = named(
  'AskRequest',
  z
    .object({
      question: z.string().trim().min(1).max(500),
      channel: AiChannel.default('web'),
      conversationId: Id.optional(),
      context: z
        .object({ type: z.enum(['budget', 'event', 'request', 'report']), id: Id })
        .strict()
        .optional()
        .describe('The record the panel was opened from (011a context chip).'),
    })
    .strict(),
);
export type AskRequest = z.infer<typeof AskRequest>;

export const AskAnswer = named(
  'AskAnswer',
  z
    .object({
      conversationId: Id,
      turnId: Id,
      outcome: AiOutcome,
      answer: z
        .string()
        .nullable()
        .describe('Plain-English answer, null when refused or discarded.'),
      why: z
        .array(z.string())
        .describe('One or two sentences with the key facts behind the answer.'),
      figures: z.array(AiFigure),
      sources: z.array(AiSourceRef),
      followUps: z.array(z.string()),
      confidence: AiConfidence.nullable(),
      refusal: AiRefusal.nullable(),
      asOf: IsoDateTime.describe('When the ledger figures were read.'),
      provenance: AiProvenance,
    })
    .strict()
    .describe('An answer built only from records the asker may read, with every figure traceable.'),
);
export type AskAnswer = z.infer<typeof AskAnswer>;

export const AiConversation = named(
  'AiConversation',
  z
    .object({
      id: Id,
      title: z.string(),
      channel: AiChannel,
      turnCount: z.int().min(0),
      startedAt: IsoDateTime,
      lastAskedAt: IsoDateTime,
    })
    .strict()
    .describe("One asker's conversation, private to them and kept 30 days."),
);
export type AiConversation = z.infer<typeof AiConversation>;

export const AiConversationList = named(
  'AiConversationList',
  z.object({ items: z.array(AiConversation) }).strict(),
);
export type AiConversationList = z.infer<typeof AiConversationList>;

export const AiConversationTurn = named(
  'AiConversationTurn',
  z
    .object({
      id: Id,
      askedAt: IsoDateTime,
      question: z.string(),
      answer: z.string().nullable(),
      outcome: AiOutcome,
    })
    .strict(),
);
export type AiConversationTurn = z.infer<typeof AiConversationTurn>;

export const AiConversationDetail = named(
  'AiConversationDetail',
  z.object({ conversation: AiConversation, turns: z.array(AiConversationTurn) }).strict(),
);
export type AiConversationDetail = z.infer<typeof AiConversationDetail>;

// 069a policy assistant ---------------------------------------------------------------------------

export const PolicyExplainRequest = named(
  'PolicyExplainRequest',
  z
    .object({
      channel: AiChannel.default('web'),
      requestId: Id.optional().describe(
        'Explain the rules outcome on this request (the asker must be able to read it).',
      ),
      question: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .optional()
        .describe('An "is this allowed?" question.'),
    })
    .strict()
    .refine((v) => Boolean(v.requestId) || Boolean(v.question), {
      message: 'Give a requestId, a question, or both.',
    }),
);
export type PolicyExplainRequest = z.infer<typeof PolicyExplainRequest>;

export const PolicyOption = named(
  'PolicyOption',
  z
    .object({
      label: z
        .string()
        .describe('A compliant option, e.g. "Reduce alcohol to GBP 150.00 or less".'),
      resourceType: z.string().nullable(),
      resourceId: Id.nullable(),
    })
    .strict()
    .describe('Only options that comply, or the exception path. Never a way around a control.'),
);
export type PolicyOption = z.infer<typeof PolicyOption>;

export const PolicyExplanation = named(
  'PolicyExplanation',
  z
    .object({
      outcome: z.enum(['allowed', 'needs_approval', 'blocked', 'not_covered']),
      headline: z.string().describe('The rules engine outcome, unchanged by AI.'),
      explanation: z
        .string()
        .nullable()
        .describe('The same outcome in plain English (AI); null when AI is off.'),
      facts: z
        .array(z.object({ label: z.string(), value: z.string() }).strict())
        .describe('The facts the rules engine used.'),
      options: z.array(PolicyOption),
      sources: z.array(AiSourceRef),
      confidence: AiConfidence.nullable(),
      refusal: AiRefusal.nullable(),
      provenance: AiProvenance,
    })
    .strict()
    .describe(
      'The rules engine decides; the assistant only explains. The outcome is never changed here.',
    ),
);
export type PolicyExplanation = z.infer<typeof PolicyExplanation>;

// 022d suggested allocations ----------------------------------------------------------------------

export const AllocationWeights = named(
  'AllocationWeights',
  z
    .object({
      headcountPct: z.int().min(0).max(100),
      priorUsePct: z.int().min(0).max(100),
      participationPct: z.int().min(0).max(100),
    })
    .strict()
    .refine((w) => w.headcountPct + w.priorUsePct + w.participationPct === 100, {
      message: 'Weights must total 100.',
    })
    .describe('How the split is weighted. The model proposes them; the owner may change them.'),
);
export type AllocationWeights = z.infer<typeof AllocationWeights>;

export const AllocationSuggestionRequest = named(
  'AllocationSuggestionRequest',
  z
    .object({
      parentBudgetId: Id,
      amount: Money.optional().describe("Defaults to the parent's available under its own rules."),
      childBudgetIds: z.array(Id).max(50).optional(),
      weights: AllocationWeights.optional(),
    })
    .strict(),
);
export type AllocationSuggestionRequest = z.infer<typeof AllocationSuggestionRequest>;

export const AllocationSuggestionLine = named(
  'AllocationSuggestionLine',
  z
    .object({
      budgetId: Id,
      budgetName: z.string(),
      eligibleHeadcount: z.int().min(0),
      priorUseBps: z.int().min(0).nullable(),
      participationBps: z.int().min(0).nullable(),
      currentAllocation: Money,
      suggested: Money,
      change: Money,
      why: z.string(),
    })
    .strict(),
);
export type AllocationSuggestionLine = z.infer<typeof AllocationSuggestionLine>;

export const AllocationSuggestion = named(
  'AllocationSuggestion',
  z
    .object({
      parentBudgetId: Id,
      amount: Money,
      weights: AllocationWeights,
      weightsReason: z.string().nullable(),
      roundingMinor: z
        .int()
        .min(1)
        .describe('Suggestions are rounded to this; the remainder goes to the largest line.'),
      lines: z.array(AllocationSuggestionLine),
      excluded: z
        .array(z.object({ budgetId: Id, budgetName: z.string(), reason: z.string() }).strict())
        .describe('Children left out, e.g. driven by headcount (22a).'),
      total: Money.describe('Always equal to `amount`; a suggestion never exceeds the parent.'),
      sources: z.array(AiSourceRef),
      confidence: AiConfidence,
      notes: z.array(z.string()),
      provenance: AiProvenance,
    })
    .strict()
    .describe(
      'A reproducible split: amounts are computed from the weights and the facts, never written by the model. Nothing is saved until the owner submits it through the allocation commands.',
    ),
);
export type AllocationSuggestion = z.infer<typeof AllocationSuggestion>;

// 016b spending outlook and nudges ----------------------------------------------------------------

export const OutlookCategory = z.enum([
  'likely_overspend',
  'likely_unused',
  'on_track',
  'no_history',
]);

export const OutlookDriver = named(
  'OutlookDriver',
  z.object({ label: z.string(), detail: z.string() }).strict(),
);
export type OutlookDriver = z.infer<typeof OutlookDriver>;

export const BudgetOutlook = named(
  'BudgetOutlook',
  z
    .object({
      id: Id,
      budgetId: Id,
      budgetName: z.string(),
      ownerName: z.string().nullable(),
      asOfDate: IsoDate,
      currency: CurrencyCode,
      authorized: Money,
      toDate: Money.describe('Actual plus committed to date, from the ledger read models.'),
      likely: Money.nullable(),
      low: Money.nullable(),
      high: Money.nullable(),
      gap: Money.nullable().describe('Signed gap to authorized: positive is likely unused.'),
      category: OutlookCategory,
      confidence: AiConfidence.nullable(),
      drivers: z.array(OutlookDriver),
      sources: z.array(AiSourceRef),
      nudge: z
        .object({
          message: z.string(),
          suggestionId: Id,
          actions: z.array(PolicyOption),
          sentAt: IsoDateTime.nullable(),
          snoozedUntil: IsoDate.nullable(),
        })
        .strict()
        .nullable()
        .describe(
          'Only raised for owners and co-owners, above the gap settings, once per 14 days.',
        ),
      modelId: z.string(),
      modelVersion: z.string(),
    })
    .strict()
    .describe(
      'A statistical range with model-written driver sentences. The range never mixes with actual or committed, and nothing is reduced or released automatically.',
    ),
);
export type BudgetOutlook = z.infer<typeof BudgetOutlook>;

export const OutlookList = named(
  'OutlookList',
  z
    .object({
      asOfDate: IsoDate,
      summary: z
        .object({
          likelyOverspend: z.int().min(0),
          likelyUnused: z.int().min(0),
          onTrack: z.int().min(0),
          noHistory: z.int().min(0),
          overspendTotal: Money,
          unusedTotal: Money,
        })
        .strict(),
      items: z.array(BudgetOutlook).describe('Ordered by category, then budget name, then id.'),
    })
    .strict(),
);
export type OutlookList = z.infer<typeof OutlookList>;

export const OutlookRunRequest = named(
  'OutlookRunRequest',
  z
    .object({
      asOfDate: IsoDate.optional(),
      budgetIds: z.array(Id).max(200).optional(),
    })
    .strict(),
);
export type OutlookRunRequest = z.infer<typeof OutlookRunRequest>;

// 080f transaction matching -----------------------------------------------------------------------

export const AiMatchSuggestionTarget = named(
  'AiMatchSuggestionTarget',
  z
    .object({
      targetType: z.enum(['commitment', 'budget']),
      targetId: Id,
      targetLabel: z.string(),
      budgetId: Id,
      budgetName: z.string(),
      confidence: AiConfidence,
      reasons: z.array(z.string()),
    })
    .strict(),
);
export type AiMatchSuggestionTarget = z.infer<typeof AiMatchSuggestionTarget>;

export const AiMatchSuggestion = named(
  'AiMatchSuggestion',
  z
    .object({
      id: Id,
      actualId: Id,
      source: z.string(),
      merchant: z.string().nullable(),
      memo: z.string().nullable(),
      postedDate: IsoDate,
      transactionAmount: Money,
      budgetAmount: Money.describe('At the locked plan rate; FX never consumes budget.'),
      suggested: AiMatchSuggestionTarget,
      candidates: z.array(AiMatchSuggestionTarget).describe('Ranked alternatives, best first.'),
      status: z.enum(['open', 'accepted', 'rejected', 'dismissed', 'stale']),
      decisionReason: z.string().nullable(),
      /**
       * The body a person submits to POST /api/actuals/{actualId}/matches to apply this suggestion.
       * The AI layer never calls it: the person does, under their own `actuals.manage` check.
       */
      applyWith: z
        .object({
          endpoint: z.literal('matchActual'),
          actualId: Id,
          /** Exactly the `MatchActualRequest` parts of the normal match endpoint. */
          parts: z.array(
            z
              .object({
                commitmentId: Id.optional(),
                budgetId: Id.optional(),
                amountMinor: z.int().positive().optional(),
              })
              .strict(),
          ),
        })
        .strict(),
      sources: z.array(AiSourceRef),
      provenance: AiProvenance,
    })
    .strict()
    .describe(
      'A ranked suggestion for an unmatched spend line. Nothing is matched until a person applies it.',
    ),
);
export type AiMatchSuggestion = z.infer<typeof AiMatchSuggestion>;

export const AiMatchSuggestionList = named(
  'AiMatchSuggestionList',
  z
    .object({
      items: z.array(AiMatchSuggestion).describe('Ordered by confidence, then merchant, then id.'),
      acceptedLast30Days: z.int().min(0),
      shownLast30Days: z.int().min(0),
    })
    .strict(),
);
export type AiMatchSuggestionList = z.infer<typeof AiMatchSuggestionList>;

export const AiMatchSuggestionRunRequest = named(
  'AiMatchSuggestionRunRequest',
  z.object({ actualIds: z.array(Id).max(200).optional() }).strict(),
);
export type AiMatchSuggestionRunRequest = z.infer<typeof AiMatchSuggestionRunRequest>;

// 017c anomaly flags ------------------------------------------------------------------------------

export const ANOMALY_KINDS = [
  'possible_split',
  'possible_duplicate',
  'receipt_reused',
  'unusual_cost_per_head',
  'unusual_vendor',
] as const;
export const AnomalyKind = z.enum(ANOMALY_KINDS);
export type AnomalyKind = z.infer<typeof AnomalyKind>;

export const AnomalyFlag = named(
  'AnomalyFlag',
  z
    .object({
      id: Id,
      kind: AnomalyKind,
      confidence: AiConfidence,
      stage: z.enum(['before_approval', 'after_approval']),
      subjectType: z.enum(['request', 'actual', 'document']),
      subjectId: Id,
      subjectLabel: z.string(),
      budgetId: Id.nullable(),
      budgetName: z.string().nullable(),
      amount: Money.nullable(),
      finding: z.string().describe('What was found, in one plain sentence.'),
      evidence: z
        .array(z.object({ label: z.string(), value: z.string() }).strict())
        .describe(
          'Deterministic features behind the flag; figures come from the records, not the model.',
        ),
      sources: z.array(AiSourceRef),
      status: z.enum(['open', 'acknowledged', 'resolved']),
      resolutionReasonCode: z.string().nullable(),
      resolutionReason: z.string().nullable(),
      raisedAt: IsoDateTime,
      provenance: AiProvenance,
    })
    .strict()
    .describe('Advisory only: a flag never blocks, holds, approves or rejects anything.'),
);
export type AnomalyFlag = z.infer<typeof AnomalyFlag>;

export const AnomalyFlagList = named(
  'AnomalyFlagList',
  z
    .object({
      items: z.array(AnomalyFlag).describe('Ordered by raised time, then subject label, then id.'),
      pausedKinds: z
        .array(
          z.object({ kind: AnomalyKind, precisionBps: z.int(), thresholdBps: z.int() }).strict(),
        )
        .describe(
          'Kinds whose measured precision fell below their threshold; they raise no new flags.',
        ),
    })
    .strict(),
);
export type AnomalyFlagList = z.infer<typeof AnomalyFlagList>;

export const AnomalyScanRequest = named(
  'AnomalyScanRequest',
  z.object({ kinds: z.array(AnomalyKind).optional() }).strict(),
);
export type AnomalyScanRequest = z.infer<typeof AnomalyScanRequest>;

// 121a receipt and quote extraction ---------------------------------------------------------------

export const ExtractionRequest = named(
  'ExtractionRequest',
  z
    .object({
      documentId: Id,
      kind: z.enum(['receipt', 'quote']),
      channel: AiChannel.default('web'),
    })
    .strict(),
);
export type ExtractionRequest = z.infer<typeof ExtractionRequest>;

export const ExtractedField = named(
  'ExtractedField',
  z
    .object({
      field: z.string(),
      label: z.string(),
      value: z
        .string()
        .nullable()
        .describe('Null when the model was not confident: never guessed.'),
      amount: Money.nullable(),
      confidence: AiConfidence.nullable(),
      needsCheck: z.boolean(),
    })
    .strict(),
);
export type ExtractedField = z.infer<typeof ExtractedField>;

export const ExtractionResult = named(
  'ExtractionResult',
  z
    .object({
      id: Id,
      documentId: Id,
      kind: z.enum(['receipt', 'quote']),
      readable: z.boolean(),
      message: z.string().nullable(),
      fields: z.array(ExtractedField).describe('Ordered by field name.'),
      droppedFields: z
        .array(z.string())
        .describe(
          'Fields the extractor read and discarded (card digits, contact details, signatures).',
        ),
      status: z.enum(['open', 'accepted', 'dismissed']),
      confirmedFields: z.record(z.string(), z.string()).nullable(),
      sources: z.array(AiSourceRef),
      provenance: AiProvenance,
    })
    .strict()
    .describe(
      'Extraction prefills a form. Only values a person confirms are saved, through the normal upload command.',
    ),
);
export type ExtractionResult = z.infer<typeof ExtractionResult>;

// Human decisions on suggestions ------------------------------------------------------------------

export const AiSuggestionDecisionRequest = named(
  'AiSuggestionDecisionRequest',
  z
    .object({
      decision: z.enum(['accepted', 'rejected', 'dismissed']),
      reasonCode: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$/)
        .optional(),
      reason: z.string().trim().min(1).max(500).optional(),
      /**
       * Required for `accepted`: the record the person created or changed through the normal command.
       * The API verifies that change really happened before it records the acceptance.
       */
      appliedResourceType: z.enum(['actual', 'budget', 'document', 'request', 'none']).optional(),
      appliedResourceId: Id.optional(),
      confirmedFields: z
        .record(z.string(), z.string())
        .optional()
        .describe('Extraction only: the values the person confirmed.'),
    })
    .strict(),
);
export type AiSuggestionDecisionRequest = z.infer<typeof AiSuggestionDecisionRequest>;

export const AiSuggestionDecision = named(
  'AiSuggestionDecision',
  z
    .object({
      suggestionId: Id,
      feature: AiFeature,
      status: z.enum(['open', 'accepted', 'rejected', 'dismissed', 'stale']),
      decidedByName: z.string().nullable(),
      decidedAt: IsoDateTime,
      appliedResourceType: z.string().nullable(),
      appliedResourceId: Id.nullable(),
      auditEventId: Id.describe('The single hash-chained audit entry this decision wrote.'),
      queryLogId: Id,
    })
    .strict(),
);
export type AiSuggestionDecision = z.infer<typeof AiSuggestionDecision>;

export const AiFeedbackRequest = named(
  'AiFeedbackRequest',
  z
    .object({
      rating: z.enum(['helpful', 'not_helpful']),
      reasonCode: z.string().max(50).optional(),
    })
    .strict(),
);
export type AiFeedbackRequest = z.infer<typeof AiFeedbackRequest>;

// 113a settings, query log and accuracy -----------------------------------------------------------

export const AiFeatureState = named(
  'AiFeatureState',
  z
    .object({
      feature: AiFeature,
      flagKey: z.string(),
      title: z.string(),
      appearsOn: z.string(),
      enabled: z.boolean(),
      pendingFinanceConfirmation: z.boolean(),
      needsFinanceConfirmation: z.boolean(),
      /** The exact field names this feature sends to the model; the turn-on dialog shows them (113a). */
      dataSent: z.array(z.string()),
      neverDoes: z.array(z.string()),
      lastChangedByName: z.string().nullable(),
      lastChangedAt: IsoDateTime.nullable(),
    })
    .strict(),
);
export type AiFeatureState = z.infer<typeof AiFeatureState>;

export const AiSettings = named(
  'AiSettings',
  z
    .object({
      questionsPerPersonPerHour: z.int().min(10).max(200),
      conversationHistoryDays: z.int().min(7).max(90),
      nudgeMinimumAmount: Money,
      nudgeMinimumPct: z.int().min(1).max(100),
      nudgeFrequencyDays: z.int().min(1).max(90),
      showFlagsToApprovers: z.boolean(),
    })
    .strict(),
);
export type AiSettings = z.infer<typeof AiSettings>;

export const AiProviderStatus = named(
  'AiProviderStatus',
  z
    .object({
      configured: z.boolean(),
      provider: z.string(),
      modelId: z.string(),
      modelVersion: z.string(),
      note: z
        .string()
        .describe(
          'Provider keys are held in the server environment and never shown or stored here.',
        ),
    })
    .strict(),
);
export type AiProviderStatus = z.infer<typeof AiProviderStatus>;

export const AiSettingsView = named(
  'AiSettingsView',
  z
    .object({
      features: z.array(AiFeatureState).describe('Ordered by title, then feature key.'),
      settings: AiSettings,
      provider: AiProviderStatus,
      canManage: z.boolean(),
      canConfirmFinance: z.boolean(),
    })
    .strict(),
);
export type AiSettingsView = z.infer<typeof AiSettingsView>;

export const AiFeatureSwitchRequest = named(
  'AiFeatureSwitchRequest',
  z.object({ enabled: z.boolean() }).strict(),
);
export type AiFeatureSwitchRequest = z.infer<typeof AiFeatureSwitchRequest>;

export const AiQueryLogEntry = named(
  'AiQueryLogEntry',
  z
    .object({
      id: Id,
      occurredAt: IsoDateTime,
      feature: AiFeature,
      channel: AiChannel,
      actorName: z.string().nullable(),
      actorPersonId: Id.nullable(),
      outcome: AiOutcome,
      /** The authorization that was applied before anything was retrieved. */
      scope: z
        .object({
          action: z.string(),
          scope: z.enum(['tenant', 'owned', 'self', 'none']),
          consideredCount: z.int().min(0),
          permittedCount: z.int().min(0),
        })
        .strict(),
      recordsUsed: z.int().min(0),
      factRefs: z.array(AiSourceRef).describe('Exactly the records the model saw, ids only.'),
      sentFields: z
        .array(z.string())
        .describe('The field names sent to the model; nothing else was sent.'),
      modelId: z.string(),
      modelVersion: z.string(),
      latencyMs: z.int().min(0),
      suggestionId: Id.nullable(),
      appliedResourceType: z.string().nullable(),
      appliedResourceId: Id.nullable(),
      auditEventId: Id.nullable(),
    })
    .strict()
    .describe(
      'Append-only. Records who asked what feature over which records, what came out, and what a person later confirmed. Never the question or answer text.',
    ),
);
export type AiQueryLogEntry = z.infer<typeof AiQueryLogEntry>;

export const AiQueryLogList = named(
  'AiQueryLogList',
  z
    .object({
      items: z.array(AiQueryLogEntry).describe('Newest first, then feature, then id.'),
      nextCursor: z.string().nullable(),
    })
    .strict(),
);
export type AiQueryLogList = z.infer<typeof AiQueryLogList>;

export const AI_EVAL_METRICS = [
  'cites_only_permitted_records',
  'refuses_out_of_scope',
  'figures_traceable',
  'schema_valid',
  'no_workaround_advice',
  'high_confidence_precision',
  'field_accuracy',
  'flag_precision',
  'split_totals_exactly',
  'range_contains_likely',
] as const;
export const AiEvalMetric = z.enum(AI_EVAL_METRICS);

export const AiEvaluationResult = named(
  'AiEvaluationResult',
  z
    .object({
      id: Id,
      feature: AiFeature,
      fixtureSet: z.string(),
      metric: AiEvalMetric,
      kind: z.string().nullable().describe('Per anomaly kind, where the threshold is per kind.'),
      thresholdBps: z.int().min(0).max(10_000),
      resultBps: z.int().min(0).max(10_000),
      passed: z.boolean(),
      cases: z.int().min(0),
      failures: z.array(z.string()).describe('Case names that failed, ordered by name.'),
      provider: z.string(),
      modelId: z.string(),
      modelVersion: z.string(),
      runAt: IsoDateTime,
    })
    .strict(),
);
export type AiEvaluationResult = z.infer<typeof AiEvaluationResult>;

export const AiEvaluationRunRequest = named(
  'AiEvaluationRunRequest',
  z.object({ feature: AiFeature.optional() }).strict(),
);
export type AiEvaluationRunRequest = z.infer<typeof AiEvaluationRunRequest>;

export const AiAccuracyView = named(
  'AiAccuracyView',
  z
    .object({
      results: z.array(AiEvaluationResult).describe('Ordered by feature, then metric, then kind.'),
      allPassed: z.boolean(),
    })
    .strict(),
);
export type AiAccuracyView = z.infer<typeof AiAccuracyView>;

// Endpoints ---------------------------------------------------------------------------------------

const SuggestionParams = z.object({ suggestionId: Id }).strict();
const ConversationParams = z.object({ conversationId: Id }).strict();
const FeatureParams = z.object({ feature: AiFeature }).strict();

export const aiEndpoints = {
  askBudgetFlow: {
    operationId: 'askBudgetFlow',
    method: 'post',
    path: '/api/ai/ask',
    summary: 'Ask a plain-language question, answered only from records the asker may read',
    tags: ['ai'],
    auth: true,
    body: AskRequest,
    response: { status: 200, schema: AskAnswer },
    errors: [400, 401, 403, 409, 422, 429],
  },
  listAiConversations: {
    operationId: 'listAiConversations',
    method: 'get',
    path: '/api/ai/conversations',
    summary: "The asker's own conversations of the last 30 days",
    tags: ['ai'],
    auth: true,
    response: { status: 200, schema: AiConversationList },
    errors: [401, 403],
  },
  getAiConversation: {
    operationId: 'getAiConversation',
    method: 'get',
    path: '/api/ai/conversations/{conversationId}',
    summary: 'One conversation with its turns (readable only by the asker)',
    tags: ['ai'],
    auth: true,
    params: ConversationParams,
    response: { status: 200, schema: AiConversationDetail },
    errors: [401, 403, 404],
  },
  deleteAiConversation: {
    operationId: 'deleteAiConversation',
    method: 'delete',
    path: '/api/ai/conversations/{conversationId}',
    summary: 'Delete a conversation and its turns',
    tags: ['ai'],
    auth: true,
    idempotent: true,
    params: ConversationParams,
    response: { status: 200, schema: AiConversationList },
    errors: [401, 403, 404, 409, 422],
  },
  explainPolicy: {
    operationId: 'explainPolicy',
    method: 'post',
    path: '/api/ai/policy-explain',
    summary: "Explain the rules engine's outcome in plain English, or answer 'is this allowed?'",
    tags: ['ai'],
    auth: true,
    body: PolicyExplainRequest,
    response: { status: 200, schema: PolicyExplanation },
    errors: [400, 401, 403, 404, 409, 422],
  },
  suggestAllocation: {
    operationId: 'suggestAllocation',
    method: 'post',
    path: '/api/ai/allocation-suggestion',
    summary:
      'Suggest a split among child budgets (a draft the owner submits through the allocation commands)',
    tags: ['ai'],
    auth: true,
    body: AllocationSuggestionRequest,
    response: { status: 200, schema: AllocationSuggestion },
    errors: [400, 401, 403, 404, 409, 422],
  },
  runAiOutlook: {
    operationId: 'runAiOutlook',
    method: 'post',
    path: '/api/ai/outlook/run',
    summary: 'Compute spending outlook snapshots for budgets the caller may read',
    tags: ['ai'],
    auth: true,
    body: OutlookRunRequest,
    response: { status: 200, schema: OutlookList },
    errors: [400, 401, 403, 409, 422],
  },
  listAiOutlook: {
    operationId: 'listAiOutlook',
    method: 'get',
    path: '/api/ai/outlook',
    summary: 'Spending outlook and nudges for budgets the caller may read',
    tags: ['ai'],
    auth: true,
    query: z
      .object({ category: OutlookCategory.optional(), ownedOnly: z.coerce.boolean().optional() })
      .strict(),
    response: { status: 200, schema: OutlookList },
    errors: [400, 401, 403],
  },
  getBudgetOutlook: {
    operationId: 'getBudgetOutlook',
    method: 'get',
    path: '/api/ai/outlook/{budgetId}',
    summary: 'Outlook, drivers, sources and nudge for one budget',
    tags: ['ai'],
    auth: true,
    params: z.object({ budgetId: Id }).strict(),
    response: { status: 200, schema: BudgetOutlook },
    errors: [400, 401, 403, 404],
  },
  runMatchSuggestions: {
    operationId: 'runMatchSuggestions',
    method: 'post',
    path: '/api/ai/matching-suggestions/run',
    summary:
      'Rank candidate targets for unmatched spend lines (suggestions only, nothing is matched)',
    tags: ['ai'],
    auth: true,
    body: AiMatchSuggestionRunRequest,
    response: { status: 200, schema: AiMatchSuggestionList },
    errors: [400, 401, 403, 409, 422],
  },
  listMatchSuggestions: {
    operationId: 'listMatchSuggestions',
    method: 'get',
    path: '/api/ai/matching-suggestions',
    summary: 'Matching suggestions waiting for a person',
    tags: ['ai'],
    auth: true,
    query: z
      .object({ status: z.enum(['open', 'accepted', 'rejected', 'dismissed', 'stale']).optional() })
      .strict(),
    response: { status: 200, schema: AiMatchSuggestionList },
    errors: [400, 401, 403],
  },
  runAnomalyScan: {
    operationId: 'runAnomalyScan',
    method: 'post',
    path: '/api/ai/anomaly-flags/scan',
    summary: 'Raise advisory anomaly flags (never blocks, holds, approves or rejects)',
    tags: ['ai'],
    auth: true,
    body: AnomalyScanRequest,
    response: { status: 200, schema: AnomalyFlagList },
    errors: [400, 401, 403, 409, 422],
  },
  listAnomalyFlags: {
    operationId: 'listAnomalyFlags',
    method: 'get',
    path: '/api/ai/anomaly-flags',
    summary: 'Anomaly flags queue',
    tags: ['ai'],
    auth: true,
    query: z
      .object({
        status: z.enum(['open', 'acknowledged', 'resolved']).optional(),
        kind: AnomalyKind.optional(),
      })
      .strict(),
    response: { status: 200, schema: AnomalyFlagList },
    errors: [400, 401, 403],
  },
  extractDocument: {
    operationId: 'extractDocument',
    method: 'post',
    path: '/api/ai/extractions',
    summary: 'Read merchant, date, total and tax from a verified receipt or quote',
    tags: ['ai'],
    auth: true,
    body: ExtractionRequest,
    response: { status: 200, schema: ExtractionResult },
    errors: [400, 401, 403, 404, 409, 422],
  },
  decideAiSuggestion: {
    operationId: 'decideAiSuggestion',
    method: 'post',
    path: '/api/ai/suggestions/{suggestionId}/decision',
    summary: 'Record that a person accepted, rejected or dismissed a suggestion',
    tags: ['ai'],
    auth: true,
    idempotent: true,
    params: SuggestionParams,
    body: AiSuggestionDecisionRequest,
    response: { status: 201, schema: AiSuggestionDecision },
    errors: [400, 401, 403, 404, 409, 422],
  },
  rateAiSuggestion: {
    operationId: 'rateAiSuggestion',
    method: 'post',
    path: '/api/ai/suggestions/{suggestionId}/feedback',
    summary: 'Rate an AI output helpful or not helpful',
    tags: ['ai'],
    auth: true,
    params: SuggestionParams,
    body: AiFeedbackRequest,
    response: { status: 200, schema: AiQueryLogEntry },
    errors: [400, 401, 403, 404, 422],
  },
  getAiSettings: {
    operationId: 'getAiSettings',
    method: 'get',
    path: '/api/ai/settings',
    summary: 'AI feature switches, settings and the read-only provider status (113a)',
    tags: ['ai'],
    auth: true,
    response: { status: 200, schema: AiSettingsView },
    errors: [401, 403],
  },
  updateAiSettings: {
    operationId: 'updateAiSettings',
    method: 'put',
    path: '/api/ai/settings',
    summary: 'Change the AI limits and nudge settings',
    tags: ['ai'],
    auth: true,
    idempotent: true,
    body: AiSettings,
    response: { status: 200, schema: AiSettingsView },
    errors: [400, 401, 403, 409, 422],
  },
  switchAiFeature: {
    operationId: 'switchAiFeature',
    method: 'post',
    path: '/api/ai/features/{feature}/switch',
    summary: 'Turn an AI feature on or off (finance features stay pending until Finance confirms)',
    tags: ['ai'],
    auth: true,
    idempotent: true,
    params: FeatureParams,
    body: AiFeatureSwitchRequest,
    response: { status: 201, schema: AiSettingsView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  confirmAiFinanceFeature: {
    operationId: 'confirmAiFinanceFeature',
    method: 'post',
    path: '/api/ai/features/{feature}/finance-confirmation',
    summary: 'Finance Admin confirms a pending finance-affecting AI feature',
    tags: ['ai'],
    auth: true,
    idempotent: true,
    params: FeatureParams,
    response: { status: 201, schema: AiSettingsView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listAiQueryLog: {
    operationId: 'listAiQueryLog',
    method: 'get',
    path: '/api/ai/query-log',
    summary: 'The append-only AI query log (113a)',
    tags: ['ai'],
    auth: true,
    query: z
      .object({
        feature: AiFeature.optional(),
        outcome: AiOutcome.optional(),
        suggestionId: Id.optional(),
        cursor: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .strict(),
    response: { status: 200, schema: AiQueryLogList },
    errors: [400, 401, 403],
  },
  runAiEvaluations: {
    operationId: 'runAiEvaluations',
    method: 'post',
    path: '/api/ai/evaluations/run',
    summary: 'Run the per-feature evaluation sets against the configured provider',
    tags: ['ai'],
    auth: true,
    body: AiEvaluationRunRequest,
    response: { status: 200, schema: AiAccuracyView },
    errors: [400, 401, 403, 409, 422],
  },
  getAiAccuracy: {
    operationId: 'getAiAccuracy',
    method: 'get',
    path: '/api/ai/accuracy',
    summary: 'Latest evaluation result per feature and metric against its threshold',
    tags: ['ai'],
    auth: true,
    response: { status: 200, schema: AiAccuracyView },
    errors: [401, 403],
  },
} as const satisfies Record<string, Endpoint>;
