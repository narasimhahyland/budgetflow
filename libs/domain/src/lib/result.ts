/**
 * Typed results for business outcomes. Domain functions never throw for business failures;
 * they return `{ ok: false, error }` with a stable code and a plain-English message.
 */
export const DOMAIN_ERROR_CODES = [
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
  'LIMIT_EXCEEDED',
  'HEADCOUNT_MISSING',
  'VERSION_CONFLICT',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];
export type ErrorParams = Record<string, string | number | boolean | null>;

export interface DomainError {
  code: DomainErrorCode;
  message: string;
  params?: ErrorParams;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = <T = never>(
  code: DomainErrorCode,
  message: string,
  params?: ErrorParams,
): Result<T> => ({
  ok: false,
  error: params ? { code, message, params } : { code, message },
});

/** Narrowing helper for chained checks. */
export function isErr<T>(r: Result<T>): r is { ok: false; error: DomainError } {
  return !r.ok;
}
