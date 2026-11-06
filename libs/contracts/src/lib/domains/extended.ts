/**
 * Extended product features (Phase 15): what-if reallocation scenarios (031a), auto-drafted
 * leadership summaries and variance commentary (011b), outcome linkage (015c), participation
 * leaderboards (122a), wellbeing and learning wallets (120b), recognition awards (120a) and
 * organizer thank-you notes (122b).
 *
 * Three shapes repeat because the product repeats them: a private projection that never touches the
 * ledger (`ScenarioImpact`), drafted text that a person has to approve before it counts
 * (`SummarySection`, `VarianceCommentary`), and an aggregate that is suppressed rather than shown
 * when the group behind it is too small to protect the people in it (`SuppressibleFigure`).
 */
import { z } from 'zod';
import { Id, IsoDate, IsoDateTime, Money } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';
import { AiProvenance, AiSourceRef } from './ai';

const Reason = z.string().trim().min(1).max(500);
const Note = z.string().trim().min(1).max(2000);
const Name = z.string().trim().min(1).max(120);

const ScenarioParams = z.object({ scenarioId: Id }).strict();
const ScenarioChangeParams = z.object({ scenarioId: Id, changeId: Id }).strict();
const SummaryParams = z.object({ summaryId: Id }).strict();
const SummarySectionParams = z
  .object({ summaryId: Id, sectionKey: z.enum(['headline', 'variances', 'risks', 'engagement']) })
  .strict();
const CommentaryParams = z.object({ commentaryId: Id }).strict();
const ClaimParams = z.object({ claimId: Id }).strict();
const AwardParams = z.object({ awardId: Id }).strict();
const PersonParams = z.object({ personId: Id }).strict();

// What-if reallocation scenarios (031a) -------------------------------------------------------

export const SCENARIO_STATUSES = ['draft', 'promoted', 'archived'] as const;
export const ScenarioStatus = z
  .enum(SCENARIO_STATUSES)
  .describe('A scenario is a private projection until it is promoted into real control actions.');
export type ScenarioStatus = z.infer<typeof ScenarioStatus>;

export const SCENARIO_CHANGE_KINDS = ['reduce', 'transfer', 'freeze', 'set_to_zero'] as const;
export const ScenarioChangeKind = z
  .enum(SCENARIO_CHANGE_KINDS)
  .describe('The real action this modelled change becomes on promotion (026, 025, 027, 028).');
export type ScenarioChangeKind = z.infer<typeof ScenarioChangeKind>;

export const ScenarioDestination = z
  .enum(['parent', 'savings', 'reallocation'])
  .describe('Where the cut money goes when the change is promoted.');
export type ScenarioDestination = z.infer<typeof ScenarioDestination>;

export const ScenarioChange = named(
  'ScenarioChange',
  z
    .object({
      id: Id,
      kind: ScenarioChangeKind,
      budgetId: Id,
      budgetName: z.string(),
      /** Reduce and transfer: the amount modelled. Null for freeze and set to zero. */
      amount: Money.nullable(),
      /** Reduce: given as a percentage of authorized instead of an amount. */
      percentBps: z.int().min(1).max(10_000).nullable(),
      destination: ScenarioDestination.nullable(),
      destinationBudgetId: Id.nullable(),
      destinationBudgetName: z.string().nullable(),
      cascade: z.boolean(),
      position: z.int().describe('Order the change was added in.'),
      /** Set once the scenario is promoted: the real action this change became. */
      promotion: z
        .object({
          status: z.enum(['pending', 'applied', 'failed']),
          appliedAt: IsoDateTime.nullable(),
          journalId: Id.nullable(),
          auditEventId: Id.nullable(),
          problemCode: z.string().nullable(),
          problemDetail: z.string().nullable(),
        })
        .strict()
        .nullable(),
    })
    .strict()
    .describe(
      'One modelled change. Modelling it moves no money; promoting it runs the real command.',
    ),
);
export type ScenarioChange = z.infer<typeof ScenarioChange>;

export const ScenarioChangeImpact = named(
  'ScenarioChangeImpact',
  z
    .object({
      changeId: Id,
      budgetId: Id,
      budgetName: z.string(),
      kind: ScenarioChangeKind,
      currentAuthorized: Money,
      /** Committed + actual + what children keep: the real `validateReduction` floor. */
      floor: Money,
      reduction: Money,
      newAuthorized: Money,
      availableBefore: Money,
      availableAfter: Money,
      maxReduction: Money,
      /** Pending requests that would no longer fit, most recent first (`unfitRequestIds`). */
      unfitRequestIds: z.array(Id),
      blocked: z.boolean(),
      problemCode: z.string().nullable(),
      problemDetail: z.string().nullable(),
    })
    .strict()
    .describe(
      'What one modelled change would do, computed by the same domain checks as the real action.',
    ),
);
export type ScenarioChangeImpact = z.infer<typeof ScenarioChangeImpact>;

export const ScenarioAtRisk = named(
  'ScenarioAtRisk',
  z
    .object({
      budgetId: Id,
      budgetName: z.string(),
      /** Already committed on the budget; commitments stay protected and can complete. */
      committed: Money,
      openCommitmentCount: z.int(),
      pendingRequestCount: z.int(),
      eventNames: z.array(z.string()).describe('Events funded from this budget, by name.'),
    })
    .strict()
    .describe('Events and commitments a modelled change would put at risk.'),
);
export type ScenarioAtRisk = z.infer<typeof ScenarioAtRisk>;

export const ScenarioFairnessRow = named(
  'ScenarioFairnessRow',
  z
    .object({
      budgetId: Id,
      budgetName: z.string(),
      eligibleHeadcount: z.int(),
      perHeadBefore: Money.nullable(),
      perHeadAfter: Money.nullable(),
    })
    .strict()
    .describe('Spend per eligible head before and after the modelled changes (15a).'),
);
export type ScenarioFairnessRow = z.infer<typeof ScenarioFairnessRow>;

export const ScenarioImpact = named(
  'ScenarioImpact',
  z
    .object({
      scenarioId: Id,
      computedAt: IsoDateTime,
      baselineAt: IsoDateTime,
      /** True when the ledger moved since the baseline was taken; recalculate before promoting. */
      stale: z.boolean(),
      ledgerWritesSinceBaseline: z.int(),
      companyAvailableBefore: Money,
      companyAvailableAfter: Money,
      changes: z.array(ScenarioChangeImpact),
      atRisk: z.array(ScenarioAtRisk),
      fairness: z.array(ScenarioFairnessRow),
      blocked: z.boolean(),
      blockingReasons: z.array(z.string()),
    })
    .strict()
    .describe(
      'A private projection of the scenario against the live ledger. Computing it writes nothing: no journal, no balance change, no budget status change.',
    ),
);
export type ScenarioImpact = z.infer<typeof ScenarioImpact>;

export const Scenario = named(
  'Scenario',
  z
    .object({
      id: Id,
      name: z.string(),
      note: z.string().nullable(),
      status: ScenarioStatus,
      baselineAt: IsoDateTime,
      createdByName: z.string().nullable(),
      collaboratorNames: z.array(z.string()),
      changes: z.array(ScenarioChange),
      promotedAt: IsoDateTime.nullable(),
      createdAt: IsoDateTime,
      updatedAt: IsoDateTime,
    })
    .strict()
    .describe('A what-if scenario, private to its author and named collaborators until promotion.'),
);
export type Scenario = z.infer<typeof Scenario>;

export const ScenarioList = named('ScenarioList', z.object({ items: z.array(Scenario) }).strict());
export type ScenarioList = z.infer<typeof ScenarioList>;

export const CreateScenarioRequest = named(
  'CreateScenarioRequest',
  z
    .object({
      name: Name,
      note: Note.optional(),
      collaboratorPersonIds: z.array(Id).max(10).optional(),
    })
    .strict(),
);
export type CreateScenarioRequest = z.infer<typeof CreateScenarioRequest>;

export const AddScenarioChangeRequest = named(
  'AddScenarioChangeRequest',
  z
    .object({
      kind: ScenarioChangeKind,
      budgetId: Id,
      amountMinor: z.int().positive().optional(),
      percentBps: z.int().min(1).max(10_000).optional(),
      destination: ScenarioDestination.optional(),
      destinationBudgetId: Id.optional(),
      cascade: z.boolean().optional(),
    })
    .strict()
    .describe('Add a modelled change. Nothing is posted; the impact is recomputed read-only.'),
);
export type AddScenarioChangeRequest = z.infer<typeof AddScenarioChangeRequest>;

export const PromoteScenarioRequest = named(
  'PromoteScenarioRequest',
  z
    .object({
      reasonCode: z.string().trim().min(1).max(40),
      reason: Reason,
      /** The impact the promoter reviewed; a stale baseline is refused (`SCENARIO_BASELINE_STALE`). */
      baselineAt: IsoDateTime,
    })
    .strict()
    .describe(
      'Promote every modelled change into the real control command it represents. Each runs its own authorization check, reason, preview and audit entry; there is no privileged apply path.',
    ),
);
export type PromoteScenarioRequest = z.infer<typeof PromoteScenarioRequest>;

export const ArchiveScenarioRequest = named(
  'ArchiveScenarioRequest',
  z.object({ reason: Reason }).strict(),
);
export type ArchiveScenarioRequest = z.infer<typeof ArchiveScenarioRequest>;

export const ScenarioComparison = named(
  'ScenarioComparison',
  z
    .object({
      computedAt: IsoDateTime,
      /** Today plus up to three scenarios, in request order. */
      columns: z.array(
        z
          .object({
            scenarioId: Id.nullable(),
            label: z.string(),
            status: ScenarioStatus.nullable(),
          })
          .strict(),
      ),
      rows: z.array(
        z
          .object({
            budgetId: Id,
            budgetName: z.string(),
            /** One cell per column, aligned by index. */
            authorized: z.array(Money),
            available: z.array(Money),
            atRiskCommitted: z.array(Money),
            perHead: z.array(Money.nullable()),
          })
          .strict(),
      ),
    })
    .strict()
    .describe('Today and up to three scenarios side by side (031a compare).'),
);
export type ScenarioComparison = z.infer<typeof ScenarioComparison>;

// Leadership summary and variance commentary (011b) ---------------------------------------------

export const SUMMARY_SECTION_KEYS = ['headline', 'variances', 'risks', 'engagement'] as const;
export const SummarySectionKey = z.enum(SUMMARY_SECTION_KEYS);
export type SummarySectionKey = z.infer<typeof SummarySectionKey>;

export const SUMMARY_STATUSES = ['ai_draft', 'edited', 'approved'] as const;
export const SummaryStatus = z
  .enum(SUMMARY_STATUSES)
  .describe('Drafted text is never published: it is an AI draft until a person approves it.');
export type SummaryStatus = z.infer<typeof SummaryStatus>;

export const SummaryFigure = named(
  'SummaryFigure',
  z
    .object({
      token: z.string().describe('Placeholder in the section text, `{{figure:<token>}}`.'),
      label: z.string(),
      value: Money.nullable(),
      /** Percentages and counts the ledger produced, in basis points or whole units. */
      numericValue: z.number().nullable(),
      unit: z.enum(['money', 'percent_bps', 'count', 'rating_milli']),
      source: AiSourceRef,
    })
    .strict()
    .describe(
      'A figure the summary quotes. The value comes from a reconciled read model and BudgetFlow renders it; the model never writes or recomputes a number.',
    ),
);
export type SummaryFigure = z.infer<typeof SummaryFigure>;

export const SummarySection = named(
  'SummarySection',
  z
    .object({
      key: SummarySectionKey,
      title: z.string(),
      /** Sentences with `{{figure:<token>}}` placeholders; every figure is rendered by BudgetFlow. */
      text: z.string(),
      figures: z.array(SummaryFigure),
      sources: z.array(AiSourceRef),
      edited: z.boolean(),
      /** Approval needs every section opened by the author (011b "AI draft" state). */
      reviewed: z.boolean(),
      generatedAt: IsoDateTime.nullable(),
    })
    .strict(),
);
export type SummarySection = z.infer<typeof SummarySection>;

export const LeadershipSummary = named(
  'LeadershipSummary',
  z
    .object({
      id: Id,
      periodId: Id,
      periodLabel: z.string(),
      /** `closed` summaries quote a closed-period snapshot; `open` drafts can never be approved. */
      periodState: z.enum(['closed', 'open']),
      snapshotTakenAt: IsoDateTime.nullable(),
      status: SummaryStatus,
      version: z.int(),
      authorName: z.string().nullable(),
      approvedByName: z.string().nullable(),
      approvedAt: IsoDateTime.nullable(),
      sections: z.array(SummarySection),
      provenance: AiProvenance.nullable(),
      createdAt: IsoDateTime,
      updatedAt: IsoDateTime,
    })
    .strict()
    .describe(
      'A leadership summary. Approved summaries are immutable; a new version is a new copy.',
    ),
);
export type LeadershipSummary = z.infer<typeof LeadershipSummary>;

export const LeadershipSummaryList = named(
  'LeadershipSummaryList',
  z.object({ items: z.array(LeadershipSummary) }).strict(),
);
export type LeadershipSummaryList = z.infer<typeof LeadershipSummaryList>;

export const DraftSummaryRequest = named(
  'DraftSummaryRequest',
  z
    .object({
      periodId: Id,
      /** Drafting an open period is allowed and labelled; it can never be approved. */
      allowOpenPeriod: z.boolean().optional(),
    })
    .strict(),
);
export type DraftSummaryRequest = z.infer<typeof DraftSummaryRequest>;

export const EditSummarySectionRequest = named(
  'EditSummarySectionRequest',
  z
    .object({
      text: z.string().trim().min(1).max(4000),
      markReviewed: z.boolean().optional(),
    })
    .strict()
    .describe(
      'Replace a section with the author\u2019s own words. Figure placeholders that stay in the text keep their ledger values; a number typed in free text is the author\u2019s, not the model\u2019s.',
    ),
);
export type EditSummarySectionRequest = z.infer<typeof EditSummarySectionRequest>;

export const RegenerateSectionRequest = named(
  'RegenerateSectionRequest',
  z.object({ reason: Reason.optional() }).strict(),
);
export type RegenerateSectionRequest = z.infer<typeof RegenerateSectionRequest>;

export const ApproveSummaryRequest = named(
  'ApproveSummaryRequest',
  z
    .object({
      /** The approver states that they read the text; approval is refused without it. */
      attested: z.literal(true),
      note: Note.optional(),
    })
    .strict(),
);
export type ApproveSummaryRequest = z.infer<typeof ApproveSummaryRequest>;

export const VARIANCE_COMMENTARY_STATUSES = ['draft', 'submitted'] as const;
export const VarianceCommentaryStatus = z.enum(VARIANCE_COMMENTARY_STATUSES);
export type VarianceCommentaryStatus = z.infer<typeof VarianceCommentaryStatus>;

export const VarianceDriver = named(
  'VarianceDriver',
  z
    .object({
      label: z.string(),
      amount: Money,
      source: AiSourceRef,
    })
    .strict()
    .describe('A real commitment, event or request behind part of the variance.'),
);
export type VarianceDriver = z.infer<typeof VarianceDriver>;

export const VarianceCommentary = named(
  'VarianceCommentary',
  z
    .object({
      id: Id,
      budgetId: Id,
      budgetName: z.string(),
      forecastSnapshotId: Id.nullable(),
      status: VarianceCommentaryStatus,
      text: z.string(),
      drivers: z.array(VarianceDriver),
      /** Variance the drivers do not explain; the draft leaves an `[Explain: ...]` note for it. */
      unexplained: Money.nullable(),
      hasPlaceholder: z.boolean(),
      draftedWithAi: z.boolean(),
      attested: z.boolean(),
      provenance: AiProvenance.nullable(),
      authorName: z.string().nullable(),
      submittedAt: IsoDateTime.nullable(),
      createdAt: IsoDateTime,
      updatedAt: IsoDateTime,
    })
    .strict()
    .describe(
      'An owner\u2019s variance commentary. A draft with an unreplaced `[Explain]` note cannot be submitted, and the owner attests it is their explanation.',
    ),
);
export type VarianceCommentary = z.infer<typeof VarianceCommentary>;

export const DraftCommentaryRequest = named(
  'DraftCommentaryRequest',
  z.object({ budgetId: Id, forecastSnapshotId: Id.optional() }).strict(),
);
export type DraftCommentaryRequest = z.infer<typeof DraftCommentaryRequest>;

export const SubmitCommentaryRequest = named(
  'SubmitCommentaryRequest',
  z
    .object({
      text: z.string().trim().min(1).max(4000),
      /** "This is my explanation": the owner owns the words, drafted or not. */
      attested: z.literal(true),
    })
    .strict(),
);
export type SubmitCommentaryRequest = z.infer<typeof SubmitCommentaryRequest>;

// Outcome linkage (015c) and participation (122a) -----------------------------------------------

export const SuppressibleFigure = named(
  'SuppressibleFigure',
  z
    .object({
      /** Null when the group behind the figure is too small to show safely. */
      valueMilli: z.number().nullable(),
      groupSize: z.int(),
      suppressed: z.boolean(),
      suppressionReason: z.string().nullable(),
    })
    .strict()
    .describe(
      'An aggregate with the size of the group behind it. Groups under the privacy threshold are suppressed, never shown: survey figures need 5 responses, retention figures 10 people.',
    ),
);
export type SuppressibleFigure = z.infer<typeof SuppressibleFigure>;

export const OutcomeCategoryRow = named(
  'OutcomeCategoryRow',
  z
    .object({
      categoryCode: z.string(),
      categoryName: z.string(),
      eventCount: z.int(),
      costPerAttendee: Money.nullable(),
      attendanceRateBps: z.int().nullable(),
      pulse: SuppressibleFigure,
      responseCount: z.int(),
    })
    .strict(),
);
export type OutcomeCategoryRow = z.infer<typeof OutcomeCategoryRow>;

export const RetentionBandRow = named(
  'RetentionBandRow',
  z
    .object({
      band: z.enum(['none', 'one_to_two', 'three_or_more']),
      bandLabel: z.string(),
      retention: SuppressibleFigure,
    })
    .strict(),
);
export type RetentionBandRow = z.infer<typeof RetentionBandRow>;

export const OutcomeLinkage = named(
  'OutcomeLinkage',
  z
    .object({
      asOf: IsoDateTime,
      fiscalYearId: Id,
      /** Shown on every view: these figures are association, not cause. */
      associationNote: z.string(),
      /** The privacy thresholds this response applied, so a reader can see them. */
      thresholds: z.object({ surveyResponses: z.int(), retentionGroup: z.int() }).strict(),
      averagePulse: SuppressibleFigure,
      enps: SuppressibleFigure,
      reachBps: z.int().nullable(),
      categories: z.array(OutcomeCategoryRow),
      /** Empty when the viewer's role does not include retention (Regional Managers). */
      retentionBands: z.array(RetentionBandRow),
      retentionAvailable: z.boolean(),
      enoughData: z.boolean(),
    })
    .strict()
    .describe(
      'Engagement outcomes at company and region level. No individual response, attendance record or employment date is ever returned.',
    ),
);
export type OutcomeLinkage = z.infer<typeof OutcomeLinkage>;

export const ParticipationRankRow = named(
  'ParticipationRankRow',
  z
    .object({
      orgUnitId: Id,
      name: z.string(),
      rank: z.int().nullable(),
      eligibleHeadcount: z.int(),
      turnoutBps: z.int().nullable(),
      eventsHeld: z.int(),
      ranked: z.boolean(),
      notRankedReason: z.string().nullable(),
    })
    .strict(),
);
export type ParticipationRankRow = z.infer<typeof ParticipationRankRow>;

export const ParticipationLeaderboard = named(
  'ParticipationLeaderboard',
  z
    .object({
      asOf: IsoDateTime,
      period: z.enum(['month', 'quarter', 'year']),
      note: z.string().describe('Ranked by turnout. Spending never counts.'),
      minimumGroupSize: z.int(),
      locations: z.array(ParticipationRankRow),
      teams: z.array(ParticipationRankRow),
    })
    .strict()
    .describe(
      'Turnout ranking by office and team. No money is read or ranked, and individual employees are never ranked.',
    ),
);
export type ParticipationLeaderboard = z.infer<typeof ParticipationLeaderboard>;

// Wellbeing and learning wallets (120b) ----------------------------------------------------------

export const WALLET_CLAIM_STATUSES = [
  'submitted',
  'approved',
  'paid',
  'returned',
  'cancelled',
] as const;
export const WalletClaimStatus = z.enum(WALLET_CLAIM_STATUSES);
export type WalletClaimStatus = z.infer<typeof WalletClaimStatus>;

export const WalletProgram = named(
  'WalletProgram',
  z
    .object({
      id: Id,
      key: z.string(),
      name: z.string(),
      kind: z.enum(['wellbeing', 'learning']),
      fundingBudgetId: Id,
      fundingBudgetName: z.string(),
      fundingBudgetStatus: z.string(),
      yearlyAllowance: Money,
      fiscalYearId: Id,
      categories: z.array(z.string()),
      /** Contractors and interns are not eligible by default, matching per-head eligibility. */
      eligibleEmploymentTypes: z.array(z.enum(['employee', 'contractor', 'intern'])),
      receiptRequired: z.boolean(),
      taxable: z.boolean(),
      /** Lapse at year end unless the program carries unused allowance (087c). */
      carryUnused: z.boolean(),
      reviewerPersonId: Id.nullable(),
      reviewerName: z.string().nullable(),
      active: z.boolean(),
    })
    .strict()
    .describe(
      'A wallet program. The allowance is capacity inside a funding budget, not money held outside the ledger.',
    ),
);
export type WalletProgram = z.infer<typeof WalletProgram>;

export const WalletProgramList = named(
  'WalletProgramList',
  z.object({ items: z.array(WalletProgram) }).strict(),
);
export type WalletProgramList = z.infer<typeof WalletProgramList>;

export const UpsertWalletProgramRequest = named(
  'UpsertWalletProgramRequest',
  z
    .object({
      key: z
        .string()
        .regex(/^[a-z][a-z0-9_]*$/)
        .max(40),
      name: Name,
      kind: z.enum(['wellbeing', 'learning']),
      fundingBudgetId: Id,
      yearlyAllowanceMinor: z.int().positive(),
      categories: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
      eligibleEmploymentTypes: z
        .array(z.enum(['employee', 'contractor', 'intern']))
        .min(1)
        .optional(),
      taxable: z.boolean().optional(),
      carryUnused: z.boolean().optional(),
      reviewerPersonId: Id.optional(),
      active: z.boolean().optional(),
      reason: Reason,
    })
    .strict(),
);
export type UpsertWalletProgramRequest = z.infer<typeof UpsertWalletProgramRequest>;

export const Wallet = named(
  'Wallet',
  z
    .object({
      id: Id,
      programId: Id,
      programName: z.string(),
      programKind: z.enum(['wellbeing', 'learning']),
      personId: Id,
      fiscalYearId: Id,
      /** Full yearly amount and the prorated amount for a joiner, by whole months. */
      allowance: Money,
      proratedAllowance: Money,
      /** Submitted plus approved plus paid: everything the wallet has already spoken for. */
      consumed: Money,
      balance: Money,
      categories: z.array(z.string()),
      receiptRequired: z.boolean(),
      fundingFrozen: z.boolean(),
      lapsesOn: IsoDate.nullable(),
      closed: z.boolean(),
    })
    .strict(),
);
export type Wallet = z.infer<typeof Wallet>;

export const WalletClaim = named(
  'WalletClaim',
  z
    .object({
      id: Id,
      walletId: Id,
      programName: z.string(),
      personId: Id,
      personName: z.string(),
      category: z.string(),
      merchant: z.string(),
      /** What the employee paid, in the transaction currency. */
      amount: Money,
      /** The same spend in the funding budget's currency at the locked plan rate. */
      budgetAmount: Money,
      claimDate: IsoDate,
      note: z.string().nullable(),
      documentId: Id.nullable(),
      status: WalletClaimStatus,
      commitmentId: Id.nullable(),
      journalIds: z.array(Id),
      reviewerName: z.string().nullable(),
      decidedAt: IsoDateTime.nullable(),
      decisionReason: z.string().nullable(),
      paidVia: z.enum(['expense', 'payroll']).nullable(),
      paidAt: IsoDateTime.nullable(),
      taxable: z.boolean(),
      createdAt: IsoDateTime,
    })
    .strict()
    .describe(
      'A wallet claim. Submission pre-encumbers the funding budget, approval encumbers it and payment turns it into an actual, like any other spend.',
    ),
);
export type WalletClaim = z.infer<typeof WalletClaim>;

export const WalletOverview = named(
  'WalletOverview',
  z
    .object({
      wallets: z.array(Wallet),
      claims: z.array(WalletClaim),
    })
    .strict(),
);
export type WalletOverview = z.infer<typeof WalletOverview>;

export const WalletClaimList = named(
  'WalletClaimList',
  z.object({ items: z.array(WalletClaim) }).strict(),
);
export type WalletClaimList = z.infer<typeof WalletClaimList>;

export const CreateWalletClaimRequest = named(
  'CreateWalletClaimRequest',
  z
    .object({
      walletId: Id,
      category: z.string().trim().min(1).max(60),
      merchant: z.string().trim().min(1).max(160),
      amountMinor: z.int().positive(),
      currency: z.string().length(3),
      claimDate: IsoDate,
      documentId: Id.optional(),
      note: Note.optional(),
    })
    .strict(),
);
export type CreateWalletClaimRequest = z.infer<typeof CreateWalletClaimRequest>;

export const WalletClaimDecisionRequest = named(
  'WalletClaimDecisionRequest',
  z
    .object({
      decision: z.enum(['approve', 'return']),
      reason: Reason,
    })
    .strict(),
);
export type WalletClaimDecisionRequest = z.infer<typeof WalletClaimDecisionRequest>;

export const PayWalletClaimRequest = named(
  'PayWalletClaimRequest',
  z.object({ via: z.enum(['expense', 'payroll']), reason: Reason }).strict(),
);
export type PayWalletClaimRequest = z.infer<typeof PayWalletClaimRequest>;

// Recognition awards (120a) and organizer recognition (122b) --------------------------------------

export const RECOGNITION_AWARD_STATUSES = [
  'pending_approval',
  'awarded',
  'redeemed',
  'cancelled',
] as const;
export const RecognitionAwardStatus = z.enum(RECOGNITION_AWARD_STATUSES);
export type RecognitionAwardStatus = z.infer<typeof RecognitionAwardStatus>;

export const RECOGNITION_AWARD_KINDS = ['thank_you', 'spot', 'peer', 'team'] as const;
export const RecognitionAwardKind = z
  .enum(RECOGNITION_AWARD_KINDS)
  .describe('Thank-you notes move no money; spot, peer and team awards are fixed amounts.');
export type RecognitionAwardKind = z.infer<typeof RecognitionAwardKind>;

export const RecognitionAwardType = named(
  'RecognitionAwardType',
  z
    .object({
      id: Id,
      kind: RecognitionAwardKind,
      name: z.string(),
      locationOrgUnitId: Id.nullable(),
      locationName: z.string().nullable(),
      amount: Money.nullable(),
      needsApproval: z.boolean(),
      fundingBudgetId: Id.nullable(),
      fundingBudgetName: z.string().nullable(),
      fundingFrozen: z.boolean(),
      active: z.boolean(),
    })
    .strict(),
);
export type RecognitionAwardType = z.infer<typeof RecognitionAwardType>;

export const RecognitionAllowance = named(
  'RecognitionAllowance',
  z
    .object({
      id: Id,
      managerPersonId: Id,
      managerName: z.string(),
      fundingBudgetId: Id,
      fundingBudgetName: z.string(),
      periodKey: z.string().describe('Quarter the allowance covers, `FY2026-Q4`.'),
      granted: Money,
      used: Money,
      remaining: Money,
    })
    .strict()
    .describe(
      'A manager\u2019s quarterly recognition allowance: a cap on what they may give, granted by the Recognition budget owner. The money itself is committed award by award.',
    ),
);
export type RecognitionAllowance = z.infer<typeof RecognitionAllowance>;

export const RecognitionAward = named(
  'RecognitionAward',
  z
    .object({
      id: Id,
      kind: RecognitionAwardKind,
      awardTypeId: Id.nullable(),
      typeName: z.string(),
      giverPersonId: Id,
      giverName: z.string(),
      recipientPersonId: Id,
      recipientName: z.string(),
      message: z.string(),
      valueTag: z.enum(['customer_focus', 'teamwork', 'ownership', 'learning']).nullable(),
      visibility: z.enum(['public', 'private']),
      amount: Money.nullable(),
      status: RecognitionAwardStatus,
      fundingBudgetId: Id.nullable(),
      commitmentId: Id.nullable(),
      journalIds: z.array(Id),
      approverName: z.string().nullable(),
      decidedAt: IsoDateTime.nullable(),
      rewardChoice: z.enum(['payroll', 'partner_catalogue']).nullable(),
      redeemedAt: IsoDateTime.nullable(),
      /** Soft: the recipient passes the yearly per-person cap, so the award is a taxable benefit. */
      capWarning: z.string().nullable(),
      createdAt: IsoDateTime,
    })
    .strict(),
);
export type RecognitionAward = z.infer<typeof RecognitionAward>;

export const RecognitionFeed = named(
  'RecognitionFeed',
  z
    .object({
      items: z.array(RecognitionAward),
      allowances: z.array(RecognitionAllowance),
      awardTypes: z.array(RecognitionAwardType),
    })
    .strict(),
);
export type RecognitionFeed = z.infer<typeof RecognitionFeed>;

export const GiveRecognitionRequest = named(
  'GiveRecognitionRequest',
  z
    .object({
      awardTypeId: Id,
      recipientPersonId: Id,
      message: z.string().trim().min(20).max(500),
      valueTag: z.enum(['customer_focus', 'teamwork', 'ownership', 'learning']).optional(),
      visibility: z.enum(['public', 'private']).optional(),
    })
    .strict(),
);
export type GiveRecognitionRequest = z.infer<typeof GiveRecognitionRequest>;

export const RecognitionDecisionRequest = named(
  'RecognitionDecisionRequest',
  z.object({ decision: z.enum(['approve', 'cancel']), reason: Reason }).strict(),
);
export type RecognitionDecisionRequest = z.infer<typeof RecognitionDecisionRequest>;

export const RedeemRecognitionRequest = named(
  'RedeemRecognitionRequest',
  z
    .object({ rewardChoice: z.enum(['payroll', 'partner_catalogue']) })
    .strict()
    .describe('Rewards go through payroll or an approved partner; there is no cash or gift card.'),
);
export type RedeemRecognitionRequest = z.infer<typeof RedeemRecognitionRequest>;

export const GrantRecognitionAllowanceRequest = named(
  'GrantRecognitionAllowanceRequest',
  z
    .object({
      managerPersonId: Id,
      fundingBudgetId: Id,
      periodKey: z.string().regex(/^FY\d{4}-Q[1-4]$/),
      amountMinor: z.int().positive(),
      reason: Reason,
    })
    .strict(),
);
export type GrantRecognitionAllowanceRequest = z.infer<typeof GrantRecognitionAllowanceRequest>;

export const OrganizerThankNote = named(
  'OrganizerThankNote',
  z
    .object({
      id: Id,
      organizerPersonId: Id,
      organizerName: z.string(),
      authorName: z.string(),
      eventId: Id.nullable(),
      eventName: z.string().nullable(),
      note: z.string(),
      visibility: z.enum(['public', 'private']),
      hidden: z.boolean(),
      createdAt: IsoDateTime,
    })
    .strict(),
);
export type OrganizerThankNote = z.infer<typeof OrganizerThankNote>;

export const OrganizerRecognition = named(
  'OrganizerRecognition',
  z
    .object({
      personId: Id,
      personName: z.string(),
      visibleToColleagues: z.boolean(),
      eventsOrganised: z.int(),
      colleaguesReached: z.int(),
      /** Only events with at least 5 survey responses count, matching the survey privacy rule. */
      averagePulse: SuppressibleFigure,
      notes: z.array(OrganizerThankNote),
      thankNoteCount: z.int(),
    })
    .strict(),
);
export type OrganizerRecognition = z.infer<typeof OrganizerRecognition>;

export const SayThanksRequest = named(
  'SayThanksRequest',
  z
    .object({
      organizerPersonIds: z.array(Id).min(1).max(10),
      eventId: Id.optional(),
      note: z.string().trim().min(10).max(300),
      showOnProfile: z.boolean().optional(),
    })
    .strict(),
);
export type SayThanksRequest = z.infer<typeof SayThanksRequest>;

// Endpoints ---------------------------------------------------------------------------------------

export const extendedEndpoints = {
  listScenarios: {
    operationId: 'listScenarios',
    method: 'get',
    path: '/api/scenarios',
    summary: 'What-if scenarios the caller authored or collaborates on',
    tags: ['scenarios'],
    auth: true,
    query: z.object({ status: ScenarioStatus.optional() }).strict(),
    response: { status: 200, schema: ScenarioList },
    errors: [400, 401, 403],
  },
  createScenario: {
    operationId: 'createScenario',
    method: 'post',
    path: '/api/scenarios',
    summary: 'Create a private what-if scenario',
    tags: ['scenarios'],
    auth: true,
    idempotent: true,
    body: CreateScenarioRequest,
    response: { status: 201, schema: Scenario },
    errors: [400, 401, 403, 409, 422],
  },
  getScenario: {
    operationId: 'getScenario',
    method: 'get',
    path: '/api/scenarios/{scenarioId}',
    summary: 'One scenario with its modelled changes',
    tags: ['scenarios'],
    auth: true,
    params: ScenarioParams,
    response: { status: 200, schema: Scenario },
    errors: [400, 401, 403, 404],
  },
  addScenarioChange: {
    operationId: 'addScenarioChange',
    method: 'post',
    path: '/api/scenarios/{scenarioId}/changes',
    summary: 'Model a reduction, transfer, freeze or set-to-zero (posts nothing)',
    tags: ['scenarios'],
    auth: true,
    idempotent: true,
    params: ScenarioParams,
    body: AddScenarioChangeRequest,
    response: { status: 201, schema: Scenario },
    errors: [400, 401, 403, 404, 409, 422],
  },
  removeScenarioChange: {
    operationId: 'removeScenarioChange',
    method: 'delete',
    path: '/api/scenarios/{scenarioId}/changes/{changeId}',
    summary: 'Remove a modelled change',
    tags: ['scenarios'],
    auth: true,
    idempotent: true,
    params: ScenarioChangeParams,
    response: { status: 200, schema: Scenario },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getScenarioImpact: {
    operationId: 'getScenarioImpact',
    method: 'get',
    path: '/api/scenarios/{scenarioId}/impact',
    summary: 'Recompute the scenario against the live ledger, read-only',
    tags: ['scenarios'],
    auth: true,
    params: ScenarioParams,
    response: { status: 200, schema: ScenarioImpact },
    errors: [400, 401, 403, 404],
  },
  compareScenarios: {
    operationId: 'compareScenarios',
    method: 'get',
    path: '/api/scenarios/compare',
    summary: 'Today and up to three scenarios side by side',
    tags: ['scenarios'],
    auth: true,
    query: z.object({ ids: z.string().max(200) }).strict(),
    response: { status: 200, schema: ScenarioComparison },
    errors: [400, 401, 403, 404, 422],
  },
  promoteScenario: {
    operationId: 'promoteScenario',
    method: 'post',
    path: '/api/scenarios/{scenarioId}/promote',
    summary: 'Promote the scenario into the real control actions',
    tags: ['scenarios'],
    auth: true,
    idempotent: true,
    params: ScenarioParams,
    body: PromoteScenarioRequest,
    response: { status: 201, schema: Scenario },
    errors: [400, 401, 403, 404, 409, 422],
  },
  archiveScenario: {
    operationId: 'archiveScenario',
    method: 'post',
    path: '/api/scenarios/{scenarioId}/archive',
    summary: 'Archive a scenario (read-only, can be duplicated)',
    tags: ['scenarios'],
    auth: true,
    idempotent: true,
    params: ScenarioParams,
    body: ArchiveScenarioRequest,
    response: { status: 201, schema: Scenario },
    errors: [400, 401, 403, 404, 409, 422],
  },

  listLeadershipSummaries: {
    operationId: 'listLeadershipSummaries',
    method: 'get',
    path: '/api/insights/summaries',
    summary: 'Leadership summaries by period',
    tags: ['insights'],
    auth: true,
    query: z.object({ status: SummaryStatus.optional() }).strict(),
    response: { status: 200, schema: LeadershipSummaryList },
    errors: [400, 401, 403],
  },
  draftLeadershipSummary: {
    operationId: 'draftLeadershipSummary',
    method: 'post',
    path: '/api/insights/summaries',
    summary: 'Draft a leadership summary from the period snapshot',
    tags: ['insights'],
    auth: true,
    idempotent: true,
    body: DraftSummaryRequest,
    response: { status: 201, schema: LeadershipSummary },
    errors: [400, 401, 403, 404, 409, 422, 503],
  },
  getLeadershipSummary: {
    operationId: 'getLeadershipSummary',
    method: 'get',
    path: '/api/insights/summaries/{summaryId}',
    summary: 'One leadership summary with its sections and figures',
    tags: ['insights'],
    auth: true,
    params: SummaryParams,
    response: { status: 200, schema: LeadershipSummary },
    errors: [400, 401, 403, 404],
  },
  editSummarySection: {
    operationId: 'editSummarySection',
    method: 'put',
    path: '/api/insights/summaries/{summaryId}/sections/{sectionKey}',
    summary: 'Replace or mark reviewed one section of a draft',
    tags: ['insights'],
    auth: true,
    idempotent: true,
    params: SummarySectionParams,
    body: EditSummarySectionRequest,
    response: { status: 200, schema: LeadershipSummary },
    errors: [400, 401, 403, 404, 409, 422],
  },
  regenerateSummarySection: {
    operationId: 'regenerateSummarySection',
    method: 'post',
    path: '/api/insights/summaries/{summaryId}/sections/{sectionKey}/regenerate',
    summary: 'Redraft one section, replacing the author\u2019s edits in it',
    tags: ['insights'],
    auth: true,
    idempotent: true,
    params: SummarySectionParams,
    body: RegenerateSectionRequest,
    response: { status: 201, schema: LeadershipSummary },
    errors: [400, 401, 403, 404, 409, 422, 503],
  },
  approveLeadershipSummary: {
    operationId: 'approveLeadershipSummary',
    method: 'post',
    path: '/api/insights/summaries/{summaryId}/approve',
    summary: 'Approve a reviewed summary and freeze its text',
    tags: ['insights'],
    auth: true,
    idempotent: true,
    params: SummaryParams,
    body: ApproveSummaryRequest,
    response: { status: 201, schema: LeadershipSummary },
    errors: [400, 401, 403, 404, 409, 422],
  },
  draftVarianceCommentary: {
    operationId: 'draftVarianceCommentary',
    method: 'post',
    path: '/api/insights/commentary',
    summary: 'Draft an owner\u2019s variance commentary from real drivers',
    tags: ['insights'],
    auth: true,
    idempotent: true,
    body: DraftCommentaryRequest,
    response: { status: 201, schema: VarianceCommentary },
    errors: [400, 401, 403, 404, 409, 422, 503],
  },
  submitVarianceCommentary: {
    operationId: 'submitVarianceCommentary',
    method: 'post',
    path: '/api/insights/commentary/{commentaryId}/submit',
    summary: 'Submit the owner\u2019s commentary as their own explanation',
    tags: ['insights'],
    auth: true,
    idempotent: true,
    params: CommentaryParams,
    body: SubmitCommentaryRequest,
    response: { status: 201, schema: VarianceCommentary },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getOutcomeLinkage: {
    operationId: 'getOutcomeLinkage',
    method: 'get',
    path: '/api/insights/outcomes',
    summary: 'Pulse, eNPS and retention against participation, at group level only',
    tags: ['insights'],
    auth: true,
    query: z.object({ fiscalYearId: Id.optional(), regionOrgUnitId: Id.optional() }).strict(),
    response: { status: 200, schema: OutcomeLinkage },
    errors: [400, 401, 403, 404],
  },
  getParticipationLeaderboard: {
    operationId: 'getParticipationLeaderboard',
    method: 'get',
    path: '/api/insights/participation-leaderboard',
    summary: 'Turnout ranking by office and team (no spending)',
    tags: ['insights'],
    auth: true,
    query: z
      .object({
        period: z.enum(['month', 'quarter', 'year']).optional(),
        locationOrgUnitId: Id.optional(),
      })
      .strict(),
    response: { status: 200, schema: ParticipationLeaderboard },
    errors: [400, 401, 403, 404],
  },

  listWalletPrograms: {
    operationId: 'listWalletPrograms',
    method: 'get',
    path: '/api/wallets/programs',
    summary: 'Wallet programs and their funding budgets',
    tags: ['wallets'],
    auth: true,
    response: { status: 200, schema: WalletProgramList },
    errors: [400, 401, 403],
  },
  upsertWalletProgram: {
    operationId: 'upsertWalletProgram',
    method: 'put',
    path: '/api/wallets/programs',
    summary: 'Create or change a wallet program',
    tags: ['wallets'],
    auth: true,
    idempotent: true,
    body: UpsertWalletProgramRequest,
    response: { status: 200, schema: WalletProgram },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getMyWallets: {
    operationId: 'getMyWallets',
    method: 'get',
    path: '/api/wallets',
    summary: 'The caller\u2019s own wallets and claim history',
    tags: ['wallets'],
    auth: true,
    response: { status: 200, schema: WalletOverview },
    errors: [400, 401, 403],
  },
  createWalletClaim: {
    operationId: 'createWalletClaim',
    method: 'post',
    path: '/api/wallets/claims',
    summary: 'Claim from a wallet (pre-encumbers the funding budget)',
    tags: ['wallets'],
    auth: true,
    idempotent: true,
    body: CreateWalletClaimRequest,
    response: { status: 201, schema: WalletClaim },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listWalletClaims: {
    operationId: 'listWalletClaims',
    method: 'get',
    path: '/api/wallets/claims',
    summary: 'Claim review queue for program reviewers',
    tags: ['wallets'],
    auth: true,
    query: z.object({ status: WalletClaimStatus.optional(), programId: Id.optional() }).strict(),
    response: { status: 200, schema: WalletClaimList },
    errors: [400, 401, 403],
  },
  decideWalletClaim: {
    operationId: 'decideWalletClaim',
    method: 'post',
    path: '/api/wallets/claims/{claimId}/decision',
    summary: 'Approve or return a claim',
    tags: ['wallets'],
    auth: true,
    idempotent: true,
    params: ClaimParams,
    body: WalletClaimDecisionRequest,
    response: { status: 201, schema: WalletClaim },
    errors: [400, 401, 403, 404, 409, 422],
  },
  payWalletClaim: {
    operationId: 'payWalletClaim',
    method: 'post',
    path: '/api/wallets/claims/{claimId}/pay',
    summary: 'Record the claim as paid through expenses or payroll',
    tags: ['wallets'],
    auth: true,
    idempotent: true,
    params: ClaimParams,
    body: PayWalletClaimRequest,
    response: { status: 201, schema: WalletClaim },
    errors: [400, 401, 403, 404, 409, 422],
  },

  getRecognitionFeed: {
    operationId: 'getRecognitionFeed',
    method: 'get',
    path: '/api/recognition',
    summary: 'Recognition feed, award types and the caller\u2019s allowance',
    tags: ['recognition'],
    auth: true,
    query: z.object({ scope: z.enum(['all', 'mine']).optional() }).strict(),
    response: { status: 200, schema: RecognitionFeed },
    errors: [400, 401, 403],
  },
  grantRecognitionAllowance: {
    operationId: 'grantRecognitionAllowance',
    method: 'post',
    path: '/api/recognition/allowances',
    summary: 'Grant a manager their quarterly recognition allowance',
    tags: ['recognition'],
    auth: true,
    idempotent: true,
    body: GrantRecognitionAllowanceRequest,
    response: { status: 201, schema: RecognitionAllowance },
    errors: [400, 401, 403, 404, 409, 422],
  },
  giveRecognition: {
    operationId: 'giveRecognition',
    method: 'post',
    path: '/api/recognition/awards',
    summary: 'Give a thank-you note or a monetary award',
    tags: ['recognition'],
    auth: true,
    idempotent: true,
    body: GiveRecognitionRequest,
    response: { status: 201, schema: RecognitionAward },
    errors: [400, 401, 403, 404, 409, 422],
  },
  decideRecognitionAward: {
    operationId: 'decideRecognitionAward',
    method: 'post',
    path: '/api/recognition/awards/{awardId}/decision',
    summary: 'Approve or cancel an award waiting for a manager',
    tags: ['recognition'],
    auth: true,
    idempotent: true,
    params: AwardParams,
    body: RecognitionDecisionRequest,
    response: { status: 201, schema: RecognitionAward },
    errors: [400, 401, 403, 404, 409, 422],
  },
  redeemRecognitionAward: {
    operationId: 'redeemRecognitionAward',
    method: 'post',
    path: '/api/recognition/awards/{awardId}/redeem',
    summary: 'Choose payroll or the partner catalogue and record the actual',
    tags: ['recognition'],
    auth: true,
    idempotent: true,
    params: AwardParams,
    body: RedeemRecognitionRequest,
    response: { status: 201, schema: RecognitionAward },
    errors: [400, 401, 403, 404, 409, 422],
  },
  sayThanksToOrganizers: {
    operationId: 'sayThanksToOrganizers',
    method: 'post',
    path: '/api/recognition/thanks',
    summary: 'Leave a thank-you note for event organizers (no money)',
    tags: ['recognition'],
    auth: true,
    idempotent: true,
    body: SayThanksRequest,
    response: { status: 201, schema: OrganizerRecognition },
    errors: [400, 401, 403, 404, 409, 422],
  },
  getOrganizerRecognition: {
    operationId: 'getOrganizerRecognition',
    method: 'get',
    path: '/api/recognition/organizers/{personId}',
    summary: 'An organizer\u2019s events, reach, feedback and thank-you notes',
    tags: ['recognition'],
    auth: true,
    params: PersonParams,
    response: { status: 200, schema: OrganizerRecognition },
    errors: [400, 401, 403, 404],
  },
} as const satisfies Record<string, Endpoint>;
