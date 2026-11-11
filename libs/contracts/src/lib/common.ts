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

/**
 * Forecast methods and statuses. Shared by the forecast cycle (87a) and the forecast and variance
 * report (087), so both name the same thing: a forecast, never an actual and never a posting.
 */
export const FORECAST_METHODS = ['run_rate', 'committed_pipeline', 'owner_input'] as const;
export const ForecastMethod = z
  .enum(FORECAST_METHODS)
  .describe(
    'How the year-end figure was produced: the system run-rate, committed plus pipeline, or the owner\u2019s own number.',
  );
export type ForecastMethod = z.infer<typeof ForecastMethod>;

export const FORECAST_STATUSES = [
  'draft',
  'submitted',
  'commentary_required',
  'accepted',
  'superseded',
] as const;
export const ForecastStatus = z.enum(FORECAST_STATUSES);
export type ForecastStatus = z.infer<typeof ForecastStatus>;

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
export type RoleId = z.infer<typeof RoleId>;

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
  // Phase 8: channels, notifications, comments, chat links
  'NOTIFICATION_REQUIRED',
  'QUIET_HOURS_INVALID',
  'MENTION_NO_ACCESS',
  'COMMENT_EDIT_WINDOW_EXPIRED',
  'COMMENT_THREAD_CLOSED',
  'CHAT_LINK_EMAIL_MISMATCH',
  'CHAT_LINK_INVALID',
  'CHAT_ACCOUNT_NOT_LINKED',
  'CHAT_SIGNATURE_INVALID',
  'CHAT_TIMESTAMP_EXPIRED',
  'CHAT_STEP_UP_REQUIRED',
  'CHAT_INSTALLATION_NOT_CONNECTED',
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
  // Event depth (P9)
  'EVENT_DATE_IN_CLOSED_PERIOD',
  'VENDOR_NOT_APPROVED',
  'VENDOR_BLOCKED',
  'EXCEEDS_EVENT_AVAILABLE',
  'QUOTE_EXPIRED',
  'SHARE_EXCEEDS_CONTRIBUTION',
  'RSVP_CLOSED',
  'ATTENDANCE_NOT_FINAL',
  'SURVEY_ALREADY_ANSWERED',
  'SURVEY_NOT_OPEN',
  // Integrations, connectors and the public API (P12)
  'INTEGRATION_NOT_CONNECTED',
  'INTEGRATION_ALREADY_CONNECTED',
  'INTEGRATION_TEST_FAILED',
  'CONNECTOR_OBJECT_UNSUPPORTED',
  'OUTBOUND_HOST_NOT_ALLOWED',
  'MAPPING_MISSING',
  'MESSAGE_NOT_RETRYABLE',
  'PUSH_NOT_ENABLED',
  'PLAN_IMPORT_BLOCKED',
  'DUPLICATE_ALREADY_RESOLVED',
  'WEBHOOK_SIGNATURE_INVALID',
  'WEBHOOK_TIMESTAMP_EXPIRED',
  'WEBHOOK_REPLAYED',
  'WEBHOOK_URL_NOT_HTTPS',
  'API_KEY_INVALID',
  'API_KEY_EXPIRED',
  'API_KEY_REVOKED',
  'API_KEY_SCOPE_MISSING',
  'API_KEY_IP_NOT_ALLOWED',
  'RATE_LIMIT_EXCEEDED',
  // Period close, year end and roll-forward (P11)
  'PERIOD_CLOSE_BLOCKED',
  'CHECK_NOT_ACKNOWLEDGEABLE',
  'CONFIRMATION_MISMATCH',
  'SAME_PERSON_APPROVAL',
  'REOPEN_ALREADY_REQUESTED',
  'REOPEN_NOT_PENDING',
  'YEAR_END_NOT_READY',
  'YEAR_END_ALREADY_EXECUTED',
  'YEAR_END_DRY_RUN_REQUIRED',
  'ROLLOVER_POLICY_MISSING',
  'CARRY_TARGET_MISSING',
  // Forecast cycles (87a) and the board and FP&A pack (16a)
  'FORECAST_COMMENTARY_REQUIRED',
  'FORECAST_AMOUNT_REQUIRED',
  'FORECAST_CYCLE_CLOSED',
  'FORECAST_ALREADY_ACCEPTED',
  'FORECAST_SUPERSEDED',
  'FORECAST_NOT_SUBMITTED',
  'FORECAST_CYCLE_ALREADY_OPEN',
  'FORECAST_NOT_IN_SCOPE',
  'BOARD_PACK_NOT_READY',
  'REPORT_EXPORT_NO_FILE',
  'REPORT_EXPORT_EXPIRED',
  'BOARD_PACK_NO_SNAPSHOT',
  // AI layer (P13). AI suggests; people decide: none of these ever authorize a financial action.
  'AI_FEATURE_DISABLED',
  'AI_PROVIDER_NOT_CONFIGURED',
  'AI_UNAVAILABLE',
  'AI_OUTPUT_DISCARDED',
  'AI_SUGGESTION_NOT_OPEN',
  'AI_SUGGESTION_NOT_APPLIED',
  'AI_FINANCE_CONFIRMATION_REQUIRED',
  'AI_FLAG_KIND_PAUSED',
  // Administration and experience (P14)
  'FLAG_UNKNOWN',
  'FLAG_DEPENDENCY_MISSING',
  'FLAG_CHANGE_PENDING',
  'FLAG_ROLLOUT_INVALID',
  'FEATURE_DISABLED',
  'RETENTION_CATEGORY_LOCKED',
  'RETENTION_BELOW_MINIMUM',
  'RETENTION_PERIOD_INVALID',
  'RETENTION_DRY_RUN_REQUIRED',
  'RETENTION_SCOPE_WIDENED',
  'LEGAL_HOLD_NOT_PENDING',
  'LEGAL_HOLD_NOT_ACTIVE',
  'LEGAL_HOLD_SCOPE_INVALID',
  'CHANGE_NOT_PENDING',
  'SELF_ROLE_GRANT',
  'PRIVILEGE_ESCALATION',
  'ROLE_ALREADY_GRANTED',
  'ROLE_NOT_GRANTED',
  'SESSION_LIMITS_INVALID',
  'DOCUMENT_RULES_INVALID',
  'BRANDING_INVALID',
  'MAINTENANCE_WINDOW_INVALID',
  'NOTICE_NOT_SCHEDULED',
  'INVITE_ROLE_NOT_ALLOWED',
  // Extended product features (P15). Scenarios model, they never post; drafted text never publishes
  // itself; wallet and recognition money follows the same ledger rules as any other spend.
  'SCENARIO_NOT_EDITABLE',
  'SCENARIO_CHANGE_INVALID',
  'SCENARIO_BASELINE_STALE',
  'SCENARIO_IMPACT_BLOCKED',
  'SUMMARY_PERIOD_NOT_CLOSED',
  'SUMMARY_SECTION_UNREVIEWED',
  'SUMMARY_ALREADY_APPROVED',
  'COMMENTARY_PLACEHOLDER_PRESENT',
  'COMMENTARY_ALREADY_SUBMITTED',
  'OUTCOME_DATA_INSUFFICIENT',
  'WALLET_PROGRAM_INVALID',
  'WALLET_NOT_ELIGIBLE',
  'WALLET_BALANCE_EXCEEDED',
  'WALLET_CLAIM_NOT_OPEN',
  'WALLET_RECEIPT_REQUIRED',
  'WALLET_CATEGORY_NOT_ALLOWED',
  'RECOGNITION_TYPE_INACTIVE',
  'RECOGNITION_SELF_AWARD',
  'RECOGNITION_ALLOWANCE_EXCEEDED',
  'RECOGNITION_AWARD_NOT_OPEN',
  // Ecosystem surfaces (P16). Every one of these refuses before any tenant data is read.
  'ECOSYSTEM_SURFACE_DISABLED',
  'ECOSYSTEM_CONNECTION_INVALID',
  'ECOSYSTEM_CONNECTION_EXPIRED',
  'ECOSYSTEM_CONNECTION_REVOKED',
  'ECOSYSTEM_GRANT_MISSING',
  'BI_DATASET_DISABLED',
  'BI_REFRESH_LIMIT_REACHED',
  'ASSISTANT_APP_NOT_ALLOWED',
  'ASSISTANT_TOOL_DISABLED',
  'AUTOMATION_PLATFORM_NOT_ALLOWED',
  'WIDGET_ORIGIN_NOT_ALLOWED',
  'WIDGET_PAUSED',
  'PARTNER_PAUSED',
  'PARTNER_VENDOR_NOT_APPROVED',
  'OFFER_NOT_AVAILABLE',
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
