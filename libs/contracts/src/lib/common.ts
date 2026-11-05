import { z } from 'zod';
import { named } from './registry';

export const Id = z.uuid().describe('Opaque identifier (UUID).');
export const IsoDate = z.iso.date().describe('Calendar date, ISO 8601 (YYYY-MM-DD).');
export const IsoDateTime = z.iso
  .datetime({ offset: false })
  .describe('Timestamp, ISO 8601 in UTC.');

export const CurrencyCode = named(
  'CurrencyCode',
  z
    .string()
    .regex(/^[A-Z]{3}$/)
    .describe('ISO 4217 currency code.'),
);

export const Money = named(
  'Money',
  z
    .object({
      amountMinor: z
        .int()
        .describe(
          'Amount in integer minor units of the currency (cents for USD, yen for JPY, fils for KWD).',
        ),
      currency: CurrencyCode,
    })
    .strict()
    .describe('A money amount in integer minor units with its ISO 4217 code.'),
);
export type Money = z.infer<typeof Money>;

export const RATE_TYPES = ['plan', 'spot', 'month_end', 'monthly_average'] as const;
export const RateType = z
  .enum(RATE_TYPES)
  .describe(
    'Exchange-rate type. Budget control always uses the plan rate locked for the fiscal year.',
  );

export const AppliedRate = named(
  'AppliedRate',
  z
    .object({
      type: RateType,
      from: CurrencyCode,
      to: CurrencyCode,
      value: z
        .string()
        .regex(/^\d+\.\d{12}$/)
        .describe('Cross rate with 12 decimals; amounts were converted with exactly this value.'),
      rateIds: z
        .array(Id)
        .describe('Source exchange-rate rows (empty when no conversion was needed).'),
    })
    .strict()
    .describe('The exchange rate applied to convert a transaction amount.'),
);

export const BUDGET_BUCKETS = [
  'authorized',
  'allocated_out',
  'held',
  'pre_encumbered',
  'encumbered',
  'actual',
  'accrued',
] as const;
export const COUNTER_ACCOUNTS = [
  'plan_funding',
  'savings',
  'obligations',
  'earmark_reserve',
  'fx_variance',
  'intercompany_due_from',
  'intercompany_due_to',
] as const;
export const LedgerAccount = z
  .enum([...BUDGET_BUCKETS, ...COUNTER_ACCOUNTS])
  .describe('Budget bucket or tenant-level counter account.');
export const ConsumingBucket = z.enum([
  'allocated_out',
  'held',
  'pre_encumbered',
  'encumbered',
  'actual',
]);

export const BUDGET_STATUSES = [
  'draft',
  'submitted',
  'pending_approval',
  'approved',
  'active',
  'partially_allocated',
  'fully_allocated',
  'frozen',
  'reduced',
  'set_to_zero',
  'exhausted',
  'expired',
  'closed',
  'revised',
  'cancelled',
] as const;
export const BudgetStatus = z.enum(BUDGET_STATUSES).describe('Budget lifecycle state (all 15).');
export const BudgetType = z.enum(['operating', 'event', 'shared_event', 'contingency']);
export const ControlMode = z.enum(['hard', 'soft', 'track']);

export const ROLE_IDS = [
  'super-admin',
  'org-admin',
  'ceo',
  'finance-admin',
  'finance-controller',
  'budget-owner',
  'department-head',
  'regional-manager',
  'location-manager',
  'event-organizer',
  'employee',
  'auditor',
  'integration-admin',
  'analyst',
] as const;
export const RoleId = z.enum(ROLE_IDS);

export const PROBLEM_CODES = [
  // Platform
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'TENANT_REQUIRED',
  'TENANT_NOT_MEMBER',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_IN_PROGRESS',
  'CONFLICT',
  'INTERNAL_ERROR',
  // Domain (libs/domain DOMAIN_ERROR_CODES)
  'VALIDATION_FAILED',
  'UNKNOWN_CURRENCY',
  'CURRENCY_MISMATCH',
  'AMOUNT_NOT_SAFE_INTEGER',
  'AMOUNT_NOT_POSITIVE',
  'RATE_INVALID',
  'RATE_MISSING',
  'JOURNAL_UNBALANCED',
  'JOURNAL_TOO_FEW_LINES',
  'JOURNAL_LINE_INVALID',
  'MANUAL_JOURNAL_BUCKET_NOT_ALLOWED',
  'OVER_ALLOCATION',
  'INSUFFICIENT_AVAILABLE',
  'NOT_A_CHILD',
  'ALREADY_REVERSED',
  'CANNOT_REVERSE_REVERSAL',
  'REVERSAL_WOULD_OVERDRAW',
  'PERIOD_NOT_FOUND',
  'PERIOD_CLOSED',
  'NO_OPEN_PERIOD',
  'INVALID_TRANSITION',
  'BUDGET_NOT_ACTIVE',
  'BUDGET_FROZEN',
  'BUDGET_SET_TO_ZERO',
  'BUDGET_EXHAUSTED',
  'BUDGET_EXPIRED',
  'BUDGET_CLOSED',
  'BUDGET_CANCELLED',
  'REASON_REQUIRED',
  'REDUCTION_DESTINATION_REQUIRED',
  'REDUCTION_BELOW_FLOOR',
  'IMPACT_PREVIEW_REQUIRED',
  'DOA_LIMIT_EXCEEDED',
  'DOA_NO_AUTHORITY',
  'SELF_APPROVAL',
  'APPROVER_IS_BENEFICIARY',
  'APPROVER_IS_ATTENDEE',
  'DELEGATION_NOT_ACTIVE',
  'CONTRIBUTION_AMOUNT_INVALID',
  'INTERCOMPANY_BLOCKED',
  'FUNDING_CAP_EXCEEDED',
  'ACTUAL_ALREADY_MATCHED',
  'EVENT_HAS_UNMATCHED_ACTUALS',
  'EVENT_MISSING_RECHARGE',
  'ROOT_REQUIRES_PLAN_VERSION',
  'AMOUNT_ROUNDS_TO_ZERO',
  'NEGATIVE_BUCKET_BALANCE',
  'MANUAL_JOURNAL_NEEDS_COUNTER_ACCOUNT',
  'ACCOUNTING_DATE_OUTSIDE_FISCAL_YEAR',
  'EFFECTIVE_DATE_CONFLICT',
  'ORG_HIERARCHY_INVALID',
  'ORG_UNIT_HAS_CHILDREN',
  'PLAN_RATE_LOCKED',
  'IMPORT_INVALID',
  'DUPLICATE_CODE',
  'TRANSFER_INVALID',
  'REQUEST_ALREADY_DECIDED',
  'PHASING_TOTAL_MISMATCH',
  'PLAN_VERSION_NOT_EDITABLE',
  'PLAN_REVISION_REQUIRED',
  'PLAN_SIGNOFF_REQUIRED',
  'LIMIT_EXCEEDED',
  'HEADCOUNT_MISSING',
  'VERSION_CONFLICT',
  // Phase 5: approvals, email links, events, contributions, documents
  'APPROVAL_NOT_ASSIGNED',
  'APPROVAL_NOT_PENDING',
  'APPROVAL_LINK_INVALID',
  'APPROVAL_LINK_USED',
  'APPROVAL_LINK_EXPIRED',
  'APPROVAL_LINK_STALE',
  'CONFLICT_ATTESTATION_REQUIRED',
  'REQUEST_ON_HOLD',
  'TRANSFER_NOT_ALLOWED',
  'EVENT_NOT_FUNDED',
  'DOCUMENT_TYPE_NOT_ALLOWED',
  'DOCUMENT_TOO_LARGE',
  'DOCUMENT_NOT_UPLOADED',
  'DOCUMENT_STORE_UNAVAILABLE',
  // Actuals and accounting (P6)
  'MATCH_OVER_TOLERANCE',
  'EVENT_HAS_OPEN_COMMITMENTS',
  'TIEOUT_SIGNED_OFF',
  'TIEOUT_SIGNOFF_BLOCKED',
  'SIGNOFF_BY_PREPARER',
  'IMPORT_ALREADY_UPLOADED',
  'IMPORT_ALREADY_POSTED',
  'ACTUAL_ENTITY_MISMATCH',
  'ACTUAL_DUPLICATE_FLAGGED',
  'COMMITMENT_NOT_OPEN',
  // Rules engine, workflows, delegation hygiene and notifications (P7)
  'SELF_DELEGATION',
  'DELEGATION_TOO_LONG',
  'DELEGATION_EXCEEDS_DOA',
  'CIRCULAR_DELEGATION',
  'ALREADY_REVOKED',
  'RULE_CONFLICT',
  'RULE_NOT_EDITABLE',
  'RULE_VERSION_NOT_FOUND',
  'THRESHOLD_BANDS_INVALID',
  'WORKFLOW_ROUTE_INVALID',
  'DOA_VERSION_SELF_APPROVAL',
  'DOA_VERSION_NOT_SUBMITTED',
  'EXCEPTION_ALREADY_RESOLVED',
  'COUNTER_OFFER_NOT_OPEN',
  'NO_COUNTER_OFFER',
  'COUNTER_OFFER_EXPIRED',
] as const;
export const ProblemCode = z.enum(PROBLEM_CODES);
export type ProblemCode = z.infer<typeof ProblemCode>;

export const ProblemDetails = named(
  'ProblemDetails',
  z
    .object({
      type: z.string().describe('URI identifying the problem type.'),
      title: z.string(),
      status: z.int(),
      code: ProblemCode.describe('Stable machine-readable code; the UI branches on it.'),
      detail: z.string().describe('Plain-English explanation safe to show to the user.'),
      instance: z.string().optional(),
      params: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional(),
      errors: z
        .array(z.object({ path: z.string(), message: z.string() }).strict())
        .optional()
        .describe('Field-level validation errors (dot paths).'),
    })
    .strict()
    .describe('RFC 9457 problem details.'),
);
export type ProblemDetails = z.infer<typeof ProblemDetails>;

export const CursorQuery = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();
