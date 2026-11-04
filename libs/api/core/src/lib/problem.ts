import type { ProblemCode } from '@bf/contracts';
import type { DomainError, DomainErrorCode, ErrorParams } from '@bf/domain';

/** An RFC 9457 problem with a stable code and a plain-English detail. Thrown by API code, rendered by ProblemFilter. */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    readonly detail: string,
    readonly params?: ErrorParams,
    readonly errors?: { path: string; message: string }[],
  ) {
    super(detail);
  }

  static notFound(what = 'resource'): ApiProblem {
    return new ApiProblem(404, 'NOT_FOUND', `The ${what} does not exist or you cannot see it.`);
  }

  static forbidden(detail = 'You do not have permission to do this.'): ApiProblem {
    return new ApiProblem(403, 'FORBIDDEN', detail);
  }
}

const UNPROCESSABLE: readonly DomainErrorCode[] = [
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
  'NOT_A_CHILD',
  'PERIOD_NOT_FOUND',
  'REASON_REQUIRED',
  'REDUCTION_DESTINATION_REQUIRED',
  'IMPACT_PREVIEW_REQUIRED',
  'CONTRIBUTION_AMOUNT_INVALID',
  'ROOT_REQUIRES_PLAN_VERSION',
  'AMOUNT_ROUNDS_TO_ZERO',
  'MANUAL_JOURNAL_NEEDS_COUNTER_ACCOUNT',
  'ACCOUNTING_DATE_OUTSIDE_FISCAL_YEAR',
  'ORG_HIERARCHY_INVALID',
  'IMPORT_INVALID',
];

/** Domain failures become problems: 422 for invalid input, 409 for conflicts with current state. */
export function domainProblem(error: DomainError): ApiProblem {
  const status = UNPROCESSABLE.includes(error.code) ? 422 : 409;
  return new ApiProblem(status, error.code, error.message, error.params);
}

/** Unwraps a domain result or throws its problem. */
export function unwrap<T>(r: { ok: true; value: T } | { ok: false; error: DomainError }): T {
  if (!r.ok) throw domainProblem(r.error);
  return r.value;
}
