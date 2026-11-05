import { z } from 'zod';
import { CurrencyCode, CursorQuery, Id, IsoDate, IsoDateTime, Money, RateType } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

// Actuals and accounting (Phase 6) ---------------------------------------------------------------
// File imports with auto-match, the unmatched queue, matching to commitments and budgets at the
// locked plan rate (FX effect separate), mapping rules, commitment hygiene, accruals, prepaids, GL
// tie-out with monthly sign-off, and event reconciliation and close.

export const ACTUAL_SOURCES = ['file', 'card', 'expense', 'travel', 'erp', 'ap', 'manual'] as const;
export const ActualSource = z.enum(ACTUAL_SOURCES).describe('Where the actual came from.');
export const ActualKind = z
  .enum(['charge', 'refund', 'credit_note', 'reversal'])
  .describe(
    'Charges are positive; refunds and credit notes negative; reversals undo an earlier line.',
  );
export const ActualMatchStatus = z.enum(['unmatched', 'partially_matched', 'matched', 'excluded']);
export const MatchRuleName = z
  .enum([
    'reference',
    'event_cost_center',
    'vendor_amount',
    'mapping_rule',
    'original_reference',
    'manual',
  ])
  .describe('Which rule proposed or made the match.');
export const MatchFitName = z
  .enum([
    'exact',
    'under_within_tolerance',
    'over_within_tolerance',
    'partial',
    'over_tolerance',
    'direct',
    'refund',
  ])
  .describe(
    'How the actual fits the commitment at the locked plan rate: exact, within tolerance (difference released or added), partial (commitment stays open), over tolerance (needs over-budget approval), direct budget charge, or refund.',
  );
const Period = z.object({ id: Id, label: z.string() }).strict();
const Reason = z.string().trim().min(5).max(1000);
const ReasonCode = z.string().trim().min(1).max(50);
const MonthKey = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe('Calendar month YYYY-MM; resolved to the legal entity’s fiscal period containing it.');

// Imports ---------------------------------------------------------------------------------------
const ActualImportIssue = z
  .object({ line: z.int(), field: z.string().nullable(), message: z.string() })
  .strict();

export const ImportSummary = named(
  'ImportSummary',
  z
    .object({
      linesRead: z.int(),
      imported: z.int(),
      rejected: z.int(),
      duplicatesSkipped: z.int(),
      crossSourceDuplicates: z.int(),
      autoMatched: z.int().describe('Exact matches.'),
      partiallyMatched: z
        .int()
        .describe('Matched within tolerance or as part of a commitment (commitment stays open).'),
      unmatched: z.int(),
      matchRateBps: z.int().describe('Auto-match rate in basis points of imported lines.'),
      reportingCurrency: CurrencyCode,
      reportingTotalMinor: z
        .int()
        .describe('Imported lines in the reporting currency at the locked plan rate.'),
      byCurrency: z.array(
        z
          .object({
            currency: CurrencyCode,
            lines: z.int(),
            transactionMinor: z.int(),
            planRate: z
              .string()
              .nullable()
              .describe('Units of the currency per one reporting unit.'),
            reportingMinor: z.int(),
          })
          .strict(),
      ),
      rules: z.array(z.object({ rule: MatchRuleName, lines: z.int() }).strict()),
      posted: z
        .object({
          matched: z.int(),
          toQueue: z.int(),
          journals: z.int(),
          period: Period.nullable(),
        })
        .strict()
        .nullable(),
    })
    .strict(),
);

export const ImportBatch = named(
  'ImportBatch',
  z
    .object({
      id: Id,
      source: ActualSource,
      fileName: z.string(),
      status: z.enum(['review', 'posted', 'discarded']),
      lineCount: z.int(),
      importedCount: z.int(),
      rejectedCount: z.int(),
      duplicateCount: z.int(),
      columnMapping: z.record(z.string(), z.string().nullable()),
      summary: ImportSummary,
      issues: z.array(ActualImportIssue),
      createdAt: IsoDateTime,
      createdByName: z.string().nullable(),
      postedAt: IsoDateTime.nullable(),
      postedByName: z.string().nullable(),
    })
    .strict(),
);
export type ImportBatch = z.infer<typeof ImportBatch>;

export const ImportBatchList = named(
  'ImportBatchList',
  z.object({ items: z.array(ImportBatch) }).strict(),
);

export const UploadActualsImportRequest = named(
  'UploadActualsImportRequest',
  z
    .object({
      source: ActualSource,
      fileName: z.string().trim().min(1).max(200),
      content: z.string().min(1).max(2_000_000).describe('CSV text with a header row.'),
      columnMapping: z
        .record(z.string(), z.string().max(100))
        .optional()
        .describe(
          'Canonical field → source header; unmapped fields fall back to common header names.',
        ),
      toleranceBps: z
        .int()
        .min(0)
        .max(1000)
        .optional()
        .describe('Match tolerance (default 100 = 1%).'),
    })
    .strict(),
);

// Actual lines ----------------------------------------------------------------------------------
export const MatchSuggestion = z
  .object({
    rule: MatchRuleName,
    confidence: z.int().min(0).max(100),
    commitmentId: Id.nullable(),
    commitmentReference: z.string().nullable(),
    budgetId: Id,
    budgetName: z.string(),
    fit: MatchFitName.nullable(),
    differenceMinor: z
      .int()
      .nullable()
      .describe('Actual minus remaining encumbrance, budget currency.'),
  })
  .strict();

export const OverBudgetRequest = named(
  'OverBudgetRequest',
  z
    .object({
      id: Id,
      status: z.enum(['pending_approval', 'approved', 'rejected']),
      actualId: Id,
      budgetId: Id,
      budgetName: z.string(),
      commitmentId: Id.nullable(),
      amount: Money.describe('Excess above the commitment and its tolerance (budget currency).'),
      approved: Money.nullable(),
      purpose: z.string(),
      requesterPersonId: Id,
      decidedByPersonId: Id.nullable(),
      decisionReason: z.string().nullable(),
      createdAt: IsoDateTime,
    })
    .strict(),
);
export type OverBudgetRequest = z.infer<typeof OverBudgetRequest>;

export const ActualLine = named(
  'ActualLine',
  z
    .object({
      id: Id,
      batchId: Id.nullable(),
      lineNo: z.int().nullable(),
      source: ActualSource,
      sourceRef: z.string(),
      kind: ActualKind,
      status: ActualMatchStatus,
      transactionDate: IsoDate,
      accountingDate: IsoDate,
      legalEntityId: Id,
      legalEntityCode: z.string(),
      costCenterId: Id.nullable(),
      costCenterCode: z.string().nullable(),
      glAccountId: Id.nullable(),
      glAccountCode: z.string().nullable(),
      eventCode: z.string().nullable(),
      vendorId: Id.nullable(),
      vendorName: z.string().nullable(),
      merchant: z.string().nullable(),
      memo: z.string().nullable(),
      reference: z.string().nullable(),
      originalRef: z.string().nullable(),
      cardProgram: z.string().nullable(),
      transaction: Money.describe('Signed: refunds and credit notes are negative.'),
      reporting: Money.describe(
        'Reporting currency at the locked plan rate (what consumes budget).',
      ),
      planRate: z.string().nullable(),
      actualRate: z.object({ type: RateType, value: z.string() }).strict().nullable(),
      actualReporting: Money.nullable().describe(
        'Reporting currency at the actual (month-end or spot) rate.',
      ),
      fxEffect: Money.describe(
        'Actual rate minus plan rate; reported separately, never consumes budget.',
      ),
      matched: Money.describe('Part of the transaction amount already matched.'),
      budget: Money.nullable().describe('Budget-currency amount once matched.'),
      suggestion: MatchSuggestion.nullable(),
      note: z.string().nullable().describe('Why the line is in the queue.'),
      duplicateOfActualId: Id.nullable(),
      excludedReason: z.string().nullable(),
      overBudgetRequest: OverBudgetRequest.nullable(),
      matchedAt: IsoDateTime.nullable(),
    })
    .strict(),
);
export type ActualLine = z.infer<typeof ActualLine>;

export const ActualsQuery = CursorQuery.extend({
  status: z
    .enum(['queue', 'unmatched', 'partially_matched', 'matched', 'excluded', 'all'])
    .optional()
    .describe('queue = unmatched and partially matched lines from posted batches (default).'),
  batchId: Id.optional(),
  legalEntityId: Id.optional(),
  currency: CurrencyCode.optional(),
  eventCode: z.string().max(50).optional(),
  q: z.string().max(100).optional(),
}).strict();

export const ActualList = named(
  'ActualList',
  z
    .object({
      items: z.array(ActualLine),
      nextCursor: z.string().nullable(),
      counts: z
        .object({ queue: z.int(), matched: z.int(), excluded: z.int(), review: z.int() })
        .strict(),
    })
    .strict(),
);

export const ActualMatchPart = named(
  'ActualMatchPart',
  z
    .object({
      id: Id,
      commitmentId: Id.nullable(),
      commitmentReference: z.string().nullable(),
      budgetId: Id,
      budgetName: z.string(),
      transaction: Money,
      budget: Money.describe('Budget currency at the locked plan rate.'),
      relief: Money.describe('Encumbrance relieved (reuses the amounts posted on the commitment).'),
      released: Money.describe('Part of the relief released back to available.'),
      excess: Money.describe('Above the remaining encumbrance (consumes available).'),
      fit: MatchFitName.nullable(),
      rule: MatchRuleName.nullable(),
      prepaid: z.boolean(),
      journalIds: z.array(Id),
      createdAt: IsoDateTime,
      reversedAt: IsoDateTime.nullable(),
      reversalReason: z.string().nullable(),
    })
    .strict(),
);

export const MatchCandidate = named(
  'MatchCandidate',
  z
    .object({
      commitmentId: Id,
      reference: z.string(),
      description: z.string(),
      budgetId: Id,
      budgetName: z.string(),
      eventCode: z.string().nullable(),
      vendorName: z.string().nullable(),
      total: Money,
      remaining: Money.describe('Still encumbered (budget currency).'),
      actualInBudget: Money.describe(
        'The unmatched part of the actual in the budget currency at plan.',
      ),
      differenceMinor: z.int(),
      toleranceMinor: z.int(),
      fit: MatchFitName,
      confidence: z.int().nullable(),
      rule: MatchRuleName.nullable(),
    })
    .strict(),
);

export const ActualDetail = named(
  'ActualDetail',
  z
    .object({
      actual: ActualLine,
      matches: z.array(ActualMatchPart),
      candidates: z.array(MatchCandidate),
    })
    .strict(),
);
export type ActualDetail = z.infer<typeof ActualDetail>;

export const MatchActualRequest = named(
  'MatchActualRequest',
  z
    .object({
      parts: z
        .array(
          z
            .object({
              commitmentId: Id.optional(),
              budgetId: Id.optional().describe('Charge to a budget directly (no commitment).'),
              amountMinor: z
                .int()
                .positive()
                .optional()
                .describe(
                  'Transaction-currency amount of this part (absolute); default: all that is left.',
                ),
              final: z
                .boolean()
                .optional()
                .describe('Final invoice: release what is left on the commitment.'),
            })
            .strict()
            .refine((p) => Boolean(p.commitmentId) !== Boolean(p.budgetId), {
              message: 'Give a commitment or a budget for each part.',
            }),
        )
        .min(1)
        .max(10),
      prepaid: z
        .object({
          serviceStart: IsoDate,
          serviceEnd: IsoDate,
          nonRefundable: z.boolean().optional(),
        })
        .strict()
        .optional()
        .describe('Deposit or prepayment: consumed in the service period instead of now.'),
      confirmNotDuplicate: z
        .boolean()
        .optional()
        .describe('Required to match a line flagged as a cross-source duplicate.'),
      note: z.string().max(500).optional(),
    })
    .strict(),
);

export const ExcludeActualRequest = named(
  'ExcludeActualRequest',
  z.object({ reason: Reason }).strict().describe('Mark the line not budget-relevant.'),
);

export const UnmatchActualRequest = named(
  'UnmatchActualRequest',
  z.object({ reasonCode: ReasonCode, reason: Reason }).strict(),
);

export const CreateOverBudgetRequest = named(
  'CreateOverBudgetRequest',
  z
    .object({
      commitmentId: Id.optional(),
      budgetId: Id.optional(),
      purpose: Reason,
    })
    .strict()
    .refine((r) => Boolean(r.commitmentId) !== Boolean(r.budgetId), {
      message: 'Give the commitment or the budget the actual should consume.',
    }),
);

export const OverBudgetDecisionRequest = named(
  'OverBudgetDecisionRequest',
  z
    .object({
      decision: z.enum(['approve', 'reject']),
      reason: z.string().trim().max(1000).optional(),
    })
    .strict(),
);

// Mapping rules ---------------------------------------------------------------------------------
export const MappingRuleMatch = z
  .object({
    legalEntityId: Id.optional(),
    costCenterId: Id.optional(),
    glAccountId: Id.optional(),
    eventCode: z.string().trim().min(1).max(50).optional(),
    vendorId: Id.optional(),
    cardProgram: z.string().trim().min(1).max(50).optional(),
    merchantContains: z.string().trim().min(2).max(100).optional(),
    memoContains: z.string().trim().min(2).max(100).optional(),
  })
  .strict();

export const MappingRule = named(
  'MappingRule',
  z
    .object({
      id: Id,
      name: z.string(),
      priority: z.int(),
      active: z.boolean(),
      match: MappingRuleMatch,
      targetBudgetId: Id.nullable(),
      targetBudgetName: z.string().nullable(),
      targetEventId: Id.nullable(),
      targetEventCode: z.string().nullable(),
      createdAt: IsoDateTime,
    })
    .strict(),
);
export type MappingRule = z.infer<typeof MappingRule>;

export const MappingRuleList = named(
  'MappingRuleList',
  z.object({ items: z.array(MappingRule) }).strict(),
);

export const CreateMappingRuleRequest = named(
  'CreateMappingRuleRequest',
  z
    .object({
      name: z.string().trim().min(3).max(120),
      priority: z.int().min(1).max(10_000),
      match: MappingRuleMatch.refine((m) => Object.keys(m).length > 0, {
        message: 'A rule needs at least one condition.',
      }),
      targetBudgetId: Id.optional(),
      targetEventId: Id.optional(),
    })
    .strict()
    .refine((r) => Boolean(r.targetBudgetId) !== Boolean(r.targetEventId), {
      message: 'A rule targets either a budget or an event.',
    }),
);

export const UpdateMappingRuleRequest = named(
  'UpdateMappingRuleRequest',
  z
    .object({
      name: z.string().trim().min(3).max(120).optional(),
      priority: z.int().min(1).max(10_000).optional(),
      active: z.boolean().optional(),
    })
    .strict(),
);

// Commitment hygiene ----------------------------------------------------------------------------
export const AgingBucketName = z.enum(['current', '1-30', '31-60', '61-90', '90+']);

export const CommitmentHygieneItem = named(
  'CommitmentHygieneItem',
  z
    .object({
      id: Id,
      reference: z.string(),
      description: z.string(),
      status: z.string(),
      budgetId: Id,
      budgetName: z.string(),
      legalEntityId: Id,
      eventId: Id.nullable(),
      eventCode: z.string().nullable(),
      vendorName: z.string().nullable(),
      serviceStart: IsoDate.nullable(),
      serviceEnd: IsoDate.nullable(),
      amount: Money.describe('Commitment amount in its own currency.'),
      encumbered: Money.describe(
        'Still encumbered on the budget (budget currency, from the ledger).',
      ),
      encumberedReporting: Money.describe(
        'Still encumbered, in the reporting currency at the locked plan rate.',
      ),
      consumed: Money,
      released: Money,
      fees: Money,
      nonRefundableDeposit: Money,
      accrued: Money,
      prepaid: Money.describe('Deposits matched as prepaids, not yet recognized.'),
      daysPast: z.int(),
      agingBucket: AgingBucketName,
      releasePrompt: z
        .boolean()
        .describe(
          'Past its service end by the prompt window with no accrual: suggest releasing it.',
        ),
      lastActualOn: IsoDate.nullable(),
    })
    .strict(),
);
export type CommitmentHygieneItem = z.infer<typeof CommitmentHygieneItem>;

export const CommitmentHygieneList = named(
  'CommitmentHygieneList',
  z
    .object({
      asOfDate: IsoDate,
      items: z.array(CommitmentHygieneItem),
      totals: z
        .object({
          open: z.int(),
          prompts: z.int(),
          encumbered: Money.describe('Reporting currency at the locked plan rate.'),
          byBucket: z.array(
            z
              .object({
                bucket: AgingBucketName,
                count: z.int(),
                encumberedMinor: z.int().describe('Reporting currency at the locked plan rate.'),
              })
              .strict(),
          ),
        })
        .strict(),
    })
    .strict(),
);

export const CommitmentsQuery = z
  .object({
    status: z.enum(['open', 'all']).optional(),
    budgetId: Id.optional(),
    eventCode: z.string().max(50).optional(),
    asOfDate: IsoDate.optional(),
  })
  .strict();

export const ReleaseCommitmentRequest = named(
  'ReleaseCommitmentRequest',
  z.object({ reasonCode: ReasonCode, reason: Reason }).strict(),
);

export const CancelCommitmentRequest = named(
  'CancelCommitmentRequest',
  z
    .object({
      feeMinor: z
        .int()
        .min(0)
        .describe(
          'Cancellation fee in the budget currency; at least any non-refundable deposit is consumed.',
        ),
      reasonCode: ReasonCode,
      reason: Reason,
    })
    .strict(),
);

// Accruals and prepaids -------------------------------------------------------------------------
export const Accrual = named(
  'Accrual',
  z
    .object({
      id: Id,
      commitmentId: Id,
      commitmentReference: z.string(),
      description: z.string(),
      budgetId: Id,
      budgetName: z.string(),
      amount: Money,
      status: z.enum(['proposed', 'approved', 'posted', 'reversed', 'rejected']),
      accrualDate: IsoDate.nullable(),
      period: Period,
      autoReversePeriod: Period.nullable(),
      journalId: Id.nullable(),
      reversalJournalId: Id.nullable(),
      reversalTrigger: z.enum(['actual', 'period']).nullable(),
      decidedByPersonId: Id.nullable(),
      decidedAt: IsoDateTime.nullable(),
      decisionReason: z.string().nullable(),
      exportedAt: IsoDateTime.nullable(),
      createdAt: IsoDateTime,
    })
    .strict(),
);
export type Accrual = z.infer<typeof Accrual>;

export const AccrualList = named('AccrualList', z.object({ items: z.array(Accrual) }).strict());
export const AccrualsQuery = z
  .object({ status: z.enum(['proposed', 'approved', 'posted', 'reversed', 'rejected']).optional() })
  .strict();
export const AsOfRequest = named(
  'AsOfRequest',
  z
    .object({
      asOfDate: IsoDate,
      budgetId: Id.optional().describe('Limit the run to one budget (default: every budget).'),
    })
    .strict(),
);
export const AccrualRunResponse = named(
  'AccrualRunResponse',
  z.object({ count: z.int(), items: z.array(Accrual) }).strict(),
);
export const RejectAccrualRequest = named(
  'RejectAccrualRequest',
  z.object({ reason: Reason }).strict(),
);
export const FileExport = named(
  'FileExport',
  z
    .object({
      fileName: z.string(),
      contentType: z.literal('text/csv'),
      content: z.string(),
      rows: z.int(),
    })
    .strict(),
);

export const Prepaid = named(
  'Prepaid',
  z
    .object({
      id: Id,
      commitmentId: Id,
      commitmentReference: z.string(),
      actualId: Id.nullable(),
      budgetId: Id.nullable(),
      budgetName: z.string().nullable(),
      amount: Money,
      recognized: Money,
      remaining: Money,
      serviceStart: IsoDate,
      serviceEnd: IsoDate,
      nonRefundable: z.boolean(),
      recognizedThrough: IsoDate.nullable(),
    })
    .strict(),
);
export const PrepaidList = named('PrepaidList', z.object({ items: z.array(Prepaid) }).strict());
export const PrepaidRunResponse = named(
  'PrepaidRunResponse',
  z
    .object({
      count: z.int(),
      recognizedMinor: z.int(),
      currency: CurrencyCode,
      items: z.array(Prepaid),
    })
    .strict(),
);

// GL tie-out ------------------------------------------------------------------------------------
export const TieOutLine = named(
  'TieOutLine',
  z
    .object({
      id: Id,
      costCenterId: Id.nullable(),
      costCenterCode: z.string().nullable(),
      costCenterName: z.string().nullable(),
      glAccountId: Id.nullable(),
      glAccountCode: z.string().nullable(),
      glAccountName: z.string().nullable(),
      gl: Money,
      budgetflow: Money,
      difference: Money.describe('General ledger minus BudgetFlow actuals.'),
      withinTolerance: z.boolean(),
      explanation: z.string().nullable(),
      explainedByName: z.string().nullable(),
      explainedAt: IsoDateTime.nullable(),
      unmatchedActuals: z
        .int()
        .describe('Unmatched actuals for this cost center and account in the period.'),
    })
    .strict(),
);

export const TieOut = named(
  'TieOut',
  z
    .object({
      id: Id,
      legalEntityId: Id,
      legalEntityCode: z.string(),
      legalEntityName: z.string(),
      functionalCurrency: CurrencyCode,
      period: Period.extend({ startDate: IsoDate, endDate: IsoDate }),
      status: z.enum(['draft', 'reconciled', 'exceptions', 'signed_off']),
      currency: CurrencyCode,
      tolerance: Money,
      glTotal: Money,
      budgetflowTotal: Money,
      difference: Money,
      exceptions: z.int(),
      unexplainedExceptions: z.int(),
      unmatchedActuals: z.int(),
      sourceFileName: z.string().nullable(),
      preparedByPersonId: Id.nullable(),
      preparedByName: z.string().nullable(),
      signedOffByPersonId: Id.nullable(),
      signedOffByName: z.string().nullable(),
      signedOffAt: IsoDateTime.nullable(),
      signOffComment: z.string().nullable(),
      createdAt: IsoDateTime,
      lines: z.array(TieOutLine),
    })
    .strict(),
);
export type TieOut = z.infer<typeof TieOut>;

export const TieOutList = named(
  'TieOutList',
  z.object({ month: MonthKey, items: z.array(TieOut) }).strict(),
);
export const GlTieOutQuery = z
  .object({ month: MonthKey.optional(), legalEntityId: Id.optional() })
  .strict();

export const CreateTieOutRequest = named(
  'CreateTieOutRequest',
  z
    .object({
      legalEntityId: Id,
      month: MonthKey,
      toleranceMinor: z.int().min(0).describe('Tolerance in the reporting currency.'),
      fileName: z.string().trim().min(1).max(200),
      content: z
        .string()
        .min(1)
        .max(1_000_000)
        .describe('General ledger balances CSV: cost_center, gl_account, amount, currency.'),
    })
    .strict(),
);

export const TieOutLineDetail = named(
  'TieOutLineDetail',
  z
    .object({
      line: TieOutLine,
      ledgerLines: z.array(
        z
          .object({
            journalId: Id,
            lineId: Id,
            accountingDate: IsoDate,
            actualId: Id.nullable(),
            sourceRef: z.string().nullable(),
            merchant: z.string().nullable(),
            transaction: Money,
            reporting: Money,
          })
          .strict(),
      ),
      unmatchedActuals: z.array(ActualLine),
    })
    .strict(),
);

export const ExplainTieOutLineRequest = named(
  'ExplainTieOutLineRequest',
  z.object({ explanation: Reason }).strict(),
);
export const SignOffTieOutRequest = named(
  'SignOffTieOutRequest',
  z.object({ comment: z.string().trim().max(1000).optional() }).strict(),
);

// Event reconciliation and close ----------------------------------------------------------------
export const EventBlocker = z
  .object({
    code: z.enum([
      'EVENT_HAS_UNMATCHED_ACTUALS',
      'EVENT_MISSING_RECHARGE',
      'EVENT_HAS_OPEN_COMMITMENTS',
      'INVALID_TRANSITION',
    ]),
    message: z.string(),
    count: z.int(),
  })
  .strict();

export const EventReconciliation = named(
  'EventReconciliation',
  z
    .object({
      event: z
        .object({
          id: Id,
          name: z.string(),
          eventCode: z.string(),
          status: z.string(),
          legalEntityId: Id,
          budgetId: Id.nullable(),
          budgetName: z.string().nullable(),
        })
        .strict(),
      actuals: z
        .object({
          matched: z.int(),
          unmatched: z.int(),
          excluded: z.int(),
          matchedReporting: Money,
          unmatchedReporting: Money,
          fxEffect: Money,
        })
        .strict(),
      commitments: z.array(CommitmentHygieneItem),
      contributions: z.array(
        z
          .object({
            id: Id,
            giverBudgetId: Id,
            giverBudgetName: z.string(),
            mode: z.enum(['earmark', 'transfer']),
            status: z.string(),
            approved: Money,
            held: Money.describe('Still earmarked on the giver’s budget.'),
            surplusShare: Money.describe('Returned to this contributor when the event closes.'),
            crossEntity: z.boolean(),
            rechargeStatus: z.string().nullable(),
          })
          .strict(),
      ),
      spent: Money,
      surplus: Money,
      blockers: z.array(EventBlocker),
      canClose: z.boolean(),
      surplusReturns: z.array(
        z
          .object({
            contributionId: Id.nullable(),
            budgetId: Id,
            budgetName: z.string(),
            amount: Money,
            journalId: Id.nullable(),
          })
          .strict(),
      ),
    })
    .strict(),
);
export type EventReconciliation = z.infer<typeof EventReconciliation>;

export const EventReconciliationList = named(
  'EventReconciliationList',
  z
    .object({
      items: z.array(
        z
          .object({
            id: Id,
            name: z.string(),
            eventCode: z.string(),
            status: z.string(),
            unmatchedActuals: z.int(),
            openCommitments: z.int(),
            canClose: z.boolean(),
          })
          .strict(),
      ),
    })
    .strict(),
);

export const CloseEventRequest = named('CloseEventRequest', z.object({ reason: Reason }).strict());

export type ImportBatchList = z.infer<typeof ImportBatchList>;
export type ActualList = z.infer<typeof ActualList>;
export type ActualMatchPart = z.infer<typeof ActualMatchPart>;
export type MatchCandidate = z.infer<typeof MatchCandidate>;
export type MatchActualRequest = z.infer<typeof MatchActualRequest>;
export type MappingRuleList = z.infer<typeof MappingRuleList>;
export type CreateMappingRuleRequest = z.infer<typeof CreateMappingRuleRequest>;
export type CommitmentHygieneList = z.infer<typeof CommitmentHygieneList>;
export type AccrualList = z.infer<typeof AccrualList>;
export type AccrualRunResponse = z.infer<typeof AccrualRunResponse>;
export type FileExport = z.infer<typeof FileExport>;
export type Prepaid = z.infer<typeof Prepaid>;
export type PrepaidList = z.infer<typeof PrepaidList>;
export type PrepaidRunResponse = z.infer<typeof PrepaidRunResponse>;
export type TieOutLine = z.infer<typeof TieOutLine>;
export type TieOutList = z.infer<typeof TieOutList>;
export type CreateTieOutRequest = z.infer<typeof CreateTieOutRequest>;
export type TieOutLineDetail = z.infer<typeof TieOutLineDetail>;
export type EventReconciliationList = z.infer<typeof EventReconciliationList>;
export type UploadActualsImportRequest = z.infer<typeof UploadActualsImportRequest>;
export type ImportSummary = z.infer<typeof ImportSummary>;

// Endpoints -------------------------------------------------------------------------------------
const BatchParams = z.object({ batchId: Id }).strict();
const ActualParams = z.object({ actualId: Id }).strict();
const RuleParams = z.object({ ruleId: Id }).strict();
const CommitmentParams = z.object({ commitmentId: Id }).strict();
const AccrualParams = z.object({ accrualId: Id }).strict();
const TieOutParams = z.object({ tieOutId: Id }).strict();
const TieOutLineParams = z.object({ tieOutId: Id, lineId: Id }).strict();
const EventParams = z.object({ eventId: Id }).strict();
const RequestParams = z.object({ requestId: Id }).strict();
const READ_ERRORS = [400, 401, 403, 404];
const WRITE_ERRORS = [400, 401, 403, 404, 409, 422];
const tags = ['actuals'];

export const actualsEndpoints = {
  uploadActualsImport: {
    operationId: 'uploadActualsImport',
    method: 'post',
    path: '/api/actuals/imports',
    summary:
      'Upload an actuals file: validate, convert at the locked plan rate, flag duplicates and propose matches',
    tags,
    auth: true,
    idempotent: true,
    body: UploadActualsImportRequest,
    response: { status: 201, schema: ImportBatch },
    errors: WRITE_ERRORS,
  },
  listActualsImports: {
    operationId: 'listActualsImports',
    method: 'get',
    path: '/api/actuals/imports',
    summary: 'Recent actuals imports',
    tags,
    auth: true,
    response: { status: 200, schema: ImportBatchList },
    errors: READ_ERRORS,
  },
  getActualsImport: {
    operationId: 'getActualsImport',
    method: 'get',
    path: '/api/actuals/imports/{batchId}',
    summary: 'An import with its review summary',
    tags,
    auth: true,
    params: BatchParams,
    response: { status: 200, schema: ImportBatch },
    errors: READ_ERRORS,
  },
  postActualsImport: {
    operationId: 'postActualsImport',
    method: 'post',
    path: '/api/actuals/imports/{batchId}/post',
    summary: 'Post the matched lines of a reviewed import and send the rest to the unmatched queue',
    tags,
    auth: true,
    idempotent: true,
    params: BatchParams,
    response: { status: 200, schema: ImportBatch },
    errors: WRITE_ERRORS,
  },
  listActuals: {
    operationId: 'listActuals',
    method: 'get',
    path: '/api/actuals',
    summary: 'Actual lines: the unmatched queue by default',
    tags,
    auth: true,
    query: ActualsQuery,
    response: { status: 200, schema: ActualList },
    errors: READ_ERRORS,
  },
  getActual: {
    operationId: 'getActual',
    method: 'get',
    path: '/api/actuals/{actualId}',
    summary: 'An actual with its matches and candidate commitments',
    tags,
    auth: true,
    params: ActualParams,
    response: { status: 200, schema: ActualDetail },
    errors: READ_ERRORS,
  },
  matchActual: {
    operationId: 'matchActual',
    method: 'post',
    path: '/api/actuals/{actualId}/matches',
    summary: 'Match an actual to commitments or budgets (split across several), at most once',
    tags,
    auth: true,
    idempotent: true,
    params: ActualParams,
    body: MatchActualRequest,
    response: { status: 201, schema: ActualDetail },
    errors: WRITE_ERRORS,
  },
  excludeActual: {
    operationId: 'excludeActual',
    method: 'post',
    path: '/api/actuals/{actualId}/exclusion',
    summary: 'Mark an unmatched actual not budget-relevant',
    tags,
    auth: true,
    idempotent: true,
    params: ActualParams,
    body: ExcludeActualRequest,
    response: { status: 200, schema: ActualDetail },
    errors: WRITE_ERRORS,
  },
  unmatchActual: {
    operationId: 'unmatchActual',
    method: 'post',
    path: '/api/actuals/{actualId}/reversals',
    summary:
      'Undo a match with linked reversal journals (never edits); the line returns to the queue',
    tags,
    auth: true,
    idempotent: true,
    params: ActualParams,
    body: UnmatchActualRequest,
    response: { status: 200, schema: ActualDetail },
    errors: WRITE_ERRORS,
  },
  requestOverBudget: {
    operationId: 'requestOverBudget',
    method: 'post',
    path: '/api/actuals/{actualId}/over-budget-requests',
    summary: 'Ask for over-budget approval of the part of an actual above commitment and tolerance',
    tags,
    auth: true,
    idempotent: true,
    params: ActualParams,
    body: CreateOverBudgetRequest,
    response: { status: 201, schema: OverBudgetRequest },
    errors: WRITE_ERRORS,
  },
  decideOverBudgetRequest: {
    operationId: 'decideOverBudgetRequest',
    method: 'post',
    path: '/api/actuals/over-budget-requests/{requestId}/decision',
    summary: 'Approve or reject an over-budget request (DoA limit and approval hygiene apply)',
    tags,
    auth: true,
    idempotent: true,
    params: RequestParams,
    body: OverBudgetDecisionRequest,
    response: { status: 200, schema: OverBudgetRequest },
    errors: WRITE_ERRORS,
  },
  listMappingRules: {
    operationId: 'listMappingRules',
    method: 'get',
    path: '/api/actuals/mapping-rules',
    summary: 'Actual-to-budget mapping rules in priority order',
    tags,
    auth: true,
    response: { status: 200, schema: MappingRuleList },
    errors: READ_ERRORS,
  },
  createMappingRule: {
    operationId: 'createMappingRule',
    method: 'post',
    path: '/api/actuals/mapping-rules',
    summary: 'Add an actual-to-budget mapping rule',
    tags,
    auth: true,
    idempotent: true,
    body: CreateMappingRuleRequest,
    response: { status: 201, schema: MappingRule },
    errors: WRITE_ERRORS,
  },
  updateMappingRule: {
    operationId: 'updateMappingRule',
    method: 'patch',
    path: '/api/actuals/mapping-rules/{ruleId}',
    summary: 'Rename, reprioritize, activate or deactivate a mapping rule',
    tags,
    auth: true,
    idempotent: true,
    params: RuleParams,
    body: UpdateMappingRuleRequest,
    response: { status: 200, schema: MappingRule },
    errors: WRITE_ERRORS,
  },
  listCommitmentHygiene: {
    operationId: 'listCommitmentHygiene',
    method: 'get',
    path: '/api/actuals/commitments',
    summary: 'Open commitments with aging, accruals, deposits and release prompts',
    tags,
    auth: true,
    query: CommitmentsQuery,
    response: { status: 200, schema: CommitmentHygieneList },
    errors: READ_ERRORS,
  },
  releaseCommitment: {
    operationId: 'releaseCommitment',
    method: 'post',
    path: '/api/actuals/commitments/{commitmentId}/release',
    summary: 'Release what is left encumbered on a commitment',
    tags,
    auth: true,
    idempotent: true,
    params: CommitmentParams,
    body: ReleaseCommitmentRequest,
    response: { status: 200, schema: CommitmentHygieneItem },
    errors: WRITE_ERRORS,
  },
  cancelCommitment: {
    operationId: 'cancelCommitment',
    method: 'post',
    path: '/api/actuals/commitments/{commitmentId}/cancellation',
    summary:
      'Cancel a commitment, consuming the cancellation fee (at least any non-refundable deposit)',
    tags,
    auth: true,
    idempotent: true,
    params: CommitmentParams,
    body: CancelCommitmentRequest,
    response: { status: 200, schema: CommitmentHygieneItem },
    errors: WRITE_ERRORS,
  },
  listAccruals: {
    operationId: 'listAccruals',
    method: 'get',
    path: '/api/actuals/accruals',
    summary: 'Accrual proposals and posted accruals',
    tags,
    auth: true,
    query: AccrualsQuery,
    response: { status: 200, schema: AccrualList },
    errors: READ_ERRORS,
  },
  proposeAccruals: {
    operationId: 'proposeAccruals',
    method: 'post',
    path: '/api/actuals/accruals/proposals',
    summary: 'Propose accruals for commitments past their service end with encumbrance left',
    tags,
    auth: true,
    idempotent: true,
    body: AsOfRequest,
    response: { status: 201, schema: AccrualRunResponse },
    errors: WRITE_ERRORS,
  },
  approveAccrual: {
    operationId: 'approveAccrual',
    method: 'post',
    path: '/api/actuals/accruals/{accrualId}/approval',
    summary: 'Approve and post an accrual (never consumes budget; auto-reverses)',
    tags,
    auth: true,
    idempotent: true,
    params: AccrualParams,
    response: { status: 200, schema: Accrual },
    errors: WRITE_ERRORS,
  },
  rejectAccrual: {
    operationId: 'rejectAccrual',
    method: 'post',
    path: '/api/actuals/accruals/{accrualId}/rejection',
    summary: 'Reject an accrual proposal',
    tags,
    auth: true,
    idempotent: true,
    params: AccrualParams,
    body: RejectAccrualRequest,
    response: { status: 200, schema: Accrual },
    errors: WRITE_ERRORS,
  },
  reverseDueAccruals: {
    operationId: 'reverseDueAccruals',
    method: 'post',
    path: '/api/actuals/accruals/auto-reversals',
    summary: 'Auto-reverse posted accruals whose reversal period has started',
    tags,
    auth: true,
    idempotent: true,
    body: AsOfRequest,
    response: { status: 200, schema: AccrualRunResponse },
    errors: WRITE_ERRORS,
  },
  exportAccruals: {
    operationId: 'exportAccruals',
    method: 'post',
    path: '/api/actuals/accruals/exports',
    summary: 'Export posted accruals not yet exported as an ERP journal file (CSV)',
    tags,
    auth: true,
    idempotent: true,
    response: { status: 200, schema: FileExport },
    errors: WRITE_ERRORS,
  },
  listPrepaids: {
    operationId: 'listPrepaids',
    method: 'get',
    path: '/api/actuals/prepaids',
    summary: 'Prepaids and deposits with what is recognized so far',
    tags,
    auth: true,
    response: { status: 200, schema: PrepaidList },
    errors: READ_ERRORS,
  },
  recognizePrepaids: {
    operationId: 'recognizePrepaids',
    method: 'post',
    path: '/api/actuals/prepaids/recognitions',
    summary: 'Consume prepaids for the elapsed part of their service period',
    tags,
    auth: true,
    idempotent: true,
    body: AsOfRequest,
    response: { status: 200, schema: PrepaidRunResponse },
    errors: WRITE_ERRORS,
  },
  listTieOuts: {
    operationId: 'listTieOuts',
    method: 'get',
    path: '/api/actuals/tie-outs',
    summary: 'Latest GL tie-out per legal entity for a month',
    tags,
    auth: true,
    query: GlTieOutQuery,
    response: { status: 200, schema: TieOutList },
    errors: READ_ERRORS,
  },
  createTieOut: {
    operationId: 'createTieOut',
    method: 'post',
    path: '/api/actuals/tie-outs',
    summary: 'Run a GL tie-out from a general ledger balances file',
    tags,
    auth: true,
    idempotent: true,
    body: CreateTieOutRequest,
    response: { status: 201, schema: TieOut },
    errors: WRITE_ERRORS,
  },
  getTieOut: {
    operationId: 'getTieOut',
    method: 'get',
    path: '/api/actuals/tie-outs/{tieOutId}',
    summary: 'A GL tie-out with its rows',
    tags,
    auth: true,
    params: TieOutParams,
    response: { status: 200, schema: TieOut },
    errors: READ_ERRORS,
  },
  getTieOutLine: {
    operationId: 'getTieOutLine',
    method: 'get',
    path: '/api/actuals/tie-outs/{tieOutId}/lines/{lineId}',
    summary: 'Drill down: ledger lines and unmatched actuals behind a tie-out row',
    tags,
    auth: true,
    params: TieOutLineParams,
    response: { status: 200, schema: TieOutLineDetail },
    errors: READ_ERRORS,
  },
  explainTieOutLine: {
    operationId: 'explainTieOutLine',
    method: 'post',
    path: '/api/actuals/tie-outs/{tieOutId}/lines/{lineId}/explanation',
    summary: 'Explain a difference',
    tags,
    auth: true,
    idempotent: true,
    params: TieOutLineParams,
    body: ExplainTieOutLineRequest,
    response: { status: 200, schema: TieOut },
    errors: WRITE_ERRORS,
  },
  signOffTieOut: {
    operationId: 'signOffTieOut',
    method: 'post',
    path: '/api/actuals/tie-outs/{tieOutId}/sign-off',
    summary: 'Monthly sign-off (not by the preparer); locks the tie-out',
    tags,
    auth: true,
    idempotent: true,
    params: TieOutParams,
    body: SignOffTieOutRequest,
    response: { status: 200, schema: TieOut },
    errors: WRITE_ERRORS,
  },
  exportTieOut: {
    operationId: 'exportTieOut',
    method: 'get',
    path: '/api/actuals/tie-outs/{tieOutId}/export',
    summary: 'Export a tie-out (CSV)',
    tags,
    auth: true,
    params: TieOutParams,
    response: { status: 200, schema: FileExport },
    errors: READ_ERRORS,
  },
  listEventReconciliations: {
    operationId: 'listEventReconciliations',
    method: 'get',
    path: '/api/actuals/events',
    summary: 'Events in or near reconciliation with what blocks their close',
    tags,
    auth: true,
    response: { status: 200, schema: EventReconciliationList },
    errors: READ_ERRORS,
  },
  getEventReconciliation: {
    operationId: 'getEventReconciliation',
    method: 'get',
    path: '/api/actuals/events/{eventId}/reconciliation',
    summary: 'Event reconciliation: actuals, commitments, contributions, surplus and blockers',
    tags,
    auth: true,
    params: EventParams,
    response: { status: 200, schema: EventReconciliation },
    errors: READ_ERRORS,
  },
  closeEvent: {
    operationId: 'closeEvent',
    method: 'post',
    path: '/api/actuals/events/{eventId}/close',
    summary: 'Close a reconciled event and return the surplus to each contributor',
    tags,
    auth: true,
    idempotent: true,
    params: EventParams,
    body: CloseEventRequest,
    response: { status: 200, schema: EventReconciliation },
    errors: WRITE_ERRORS,
  },
} as const satisfies Record<string, Endpoint>;
