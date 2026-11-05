import { err, ok, type Result } from '../result';

/**
 * Period close readiness. Hard checks (tie-out signed off, journals balanced, the nightly ledger
 * check clean, the audit chain verified) block the close and cannot be acknowledged; soft checks
 * (imports, unmatched actuals, accruals, prepaids, commitment hygiene) pass or are acknowledged with
 * a reason. The close itself is refused by `closeReadiness`; nothing posts to a closed period
 * because the database refuses it (`app_reject_closed_period`).
 */
export const CLOSE_CHECK_CODES = [
  'gl_tieout_signed_off',
  'journals_balanced',
  'ledger_check_clean',
  'audit_chain_verified',
  'actuals_imported',
  'unmatched_actuals_cleared',
  'accruals_reviewed',
  'prepaids_recognized',
  'commitments_accrued',
] as const;
export type CloseCheckCode = (typeof CLOSE_CHECK_CODES)[number];

export const HARD_CLOSE_CHECKS: readonly CloseCheckCode[] = [
  'gl_tieout_signed_off',
  'journals_balanced',
  'ledger_check_clean',
  'audit_chain_verified',
];

export const closeCheckKind = (code: CloseCheckCode): 'hard' | 'soft' =>
  HARD_CLOSE_CHECKS.includes(code) ? 'hard' : 'soft';

export interface CloseCheckState {
  code: CloseCheckCode;
  status: 'pass' | 'warn' | 'fail';
  /** A soft check the Finance Controller accepted with a reason. */
  acknowledged: boolean;
}

export interface EntityChecklist {
  legalEntityCode: string;
  checks: readonly CloseCheckState[];
}

/** True when this check stops the close right now. */
export function isBlocking(check: CloseCheckState): boolean {
  if (closeCheckKind(check.code) === 'hard') return check.status === 'fail';
  return check.status === 'fail' && !check.acknowledged;
}

/**
 * Whether the period may close: every entity's hard checks pass and every failing soft check is
 * acknowledged. Returns the blocking entity and check in the message so the UI can name them.
 */
export function closeReadiness(entities: readonly EntityChecklist[]): Result<true> {
  const blocking = entities.flatMap((e) =>
    e.checks.filter(isBlocking).map((c) => `${e.legalEntityCode} ${c.code.replace(/_/g, ' ')}`),
  );
  if (blocking.length === 0) return ok(true);
  return err(
    'PERIOD_CLOSE_BLOCKED',
    `${blocking.length} check${blocking.length === 1 ? '' : 's'} must pass or be acknowledged before this period closes: ${blocking.join('; ')}.`,
    { blocking: blocking.join('; '), count: blocking.length },
  );
}

/** A soft check can be acknowledged; a hard check never can. */
export function canAcknowledge(code: CloseCheckCode): Result<true> {
  if (closeCheckKind(code) === 'hard') {
    return err(
      'CHECK_NOT_ACKNOWLEDGEABLE',
      `${code.replace(/_/g, ' ')} is a hard check: fix it, it cannot be acknowledged.`,
      { code },
    );
  }
  return ok(true);
}

/** The phrase a close request must repeat, for example `CLOSE OCT 2026`. */
export const closeConfirmationFor = (periodLabel: string): string =>
  `CLOSE ${periodLabel.toUpperCase()}`;

/** The phrase a year-end execution must repeat, for example `RUN YEAR END FY2026`. */
export const yearEndConfirmationFor = (fiscalYearLabel: string): string =>
  `RUN YEAR END ${fiscalYearLabel.toUpperCase()}`;

/** Typed confirmations are exact matches (trimmed); a mismatch is never a partial action. */
export function requireConfirmation(typed: string, expected: string): Result<true> {
  if (typed.trim() !== expected) {
    return err('CONFIRMATION_MISMATCH', `Type ${expected} exactly to confirm.`, { expected });
  }
  return ok(true);
}

/**
 * Break-glass hygiene: reopening or unlocking a period needs two different people. The requester
 * never decides their own request, whatever their role.
 */
export function requireSecondPerson(
  requestedByPersonId: string | null,
  decidedByPersonId: string | null,
): Result<true> {
  if (requestedByPersonId && decidedByPersonId && requestedByPersonId === decidedByPersonId) {
    return err(
      'SAME_PERSON_APPROVAL',
      'A reopen needs two different people: ask another Finance Admin to decide.',
    );
  }
  return ok(true);
}
