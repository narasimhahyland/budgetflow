import { err, ok, type Result } from '../result';

/**
 * Delegation of authority: who × spend type × legal entity × limit, versioned and effective-dated.
 * Approval authority is separate from budget ownership. Amounts are compared in the limit's currency,
 * converted by the caller at the locked plan rate.
 */
export interface DoaLimit {
  id: string;
  personId?: string | null;
  role?: string | null;
  /** '*' matches every spend type. */
  spendType: string;
  /** '*' matches every legal entity. */
  legalEntityId: string;
  limitMinor: number;
  currency: string;
  validFrom: string;
  validTo: string | null;
}

export interface Approver {
  personId: string;
  roles: readonly string[];
}

export interface AuthorityQuery {
  spendType: string;
  legalEntityId: string;
  amountMinor: number;
  currency: string;
  date: string;
}

const active = (l: { validFrom: string; validTo: string | null }, date: string) =>
  l.validFrom <= date && (l.validTo === null || date <= l.validTo);

/** Maximum delegation duration in days (062 spec). */
export const MAX_DELEGATION_DAYS = 30;

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Validates out-of-office delegation hygiene:
 * - Cannot delegate to yourself
 * - End date on or after start date, at most 30 days
 * - Cap (if given) cannot exceed the delegator's own DoA limit
 * - No circular delegation or re-delegation (cannot delegate to someone who currently delegates to you,
 *   and a delegate cannot re-delegate)
 */
export function validateDelegationHygiene(input: {
  delegatorPersonId: string;
  delegatePersonId: string;
  validFrom: string;
  validTo: string;
  requestedLimitMinor?: number | null;
  delegatorMaxDoaMinor?: number | null;
  activeDelegations: readonly {
    delegatorPersonId: string;
    delegatePersonId: string;
    validFrom: string;
    validTo: string | null;
  }[];
}): Result<true> {
  if (input.delegatorPersonId === input.delegatePersonId) {
    return err('SELF_DELEGATION', 'Choose someone other than yourself.');
  }
  if (input.validTo < input.validFrom) {
    return err('VALIDATION_FAILED', 'The end date is before the start date.', {
      field: 'validTo',
    });
  }
  const spanDays = daysBetween(input.validFrom, input.validTo);
  if (spanDays > MAX_DELEGATION_DAYS) {
    return err(
      'DELEGATION_TOO_LONG',
      `Delegations can last at most ${MAX_DELEGATION_DAYS} days; longer absences need a DoA change.`,
      { maxDays: MAX_DELEGATION_DAYS, requestedDays: spanDays },
    );
  }
  if (
    input.requestedLimitMinor !== undefined &&
    input.requestedLimitMinor !== null &&
    input.delegatorMaxDoaMinor !== undefined &&
    input.delegatorMaxDoaMinor !== null &&
    input.requestedLimitMinor > input.delegatorMaxDoaMinor
  ) {
    return err(
      'DELEGATION_EXCEEDS_DOA',
      "A delegation cap cannot exceed the delegator's own delegation-of-authority limit.",
      {
        requestedLimitMinor: input.requestedLimitMinor,
        delegatorLimitMinor: input.delegatorMaxDoaMinor,
      },
    );
  }

  // Overlap helper for date ranges
  const overlaps = (aFrom: string, aTo: string | null, bFrom: string, bTo: string) =>
    aFrom <= bTo && (aTo === null || bFrom <= aTo);

  // Check circular delegation / chain: walk from delegatePersonId along overlapping delegations
  const visited = new Set<string>([input.delegatorPersonId]);
  let frontier = [input.delegatePersonId];
  while (frontier.length > 0) {
    const current = frontier.shift()!;
    if (visited.has(current)) {
      return err(
        'CIRCULAR_DELEGATION',
        'Circular delegation is not allowed: this person already delegates approvals to you in that period.',
      );
    }
    visited.add(current);
    for (const d of input.activeDelegations) {
      if (
        d.delegatorPersonId === current &&
        overlaps(d.validFrom, d.validTo, input.validFrom, input.validTo)
      ) {
        frontier.push(d.delegatePersonId);
      }
    }
  }

  return ok(true);
}

/** The most specific applicable limit: person over role, exact spend type and entity over wildcards, then highest. */
export function resolveLimit(
  limits: readonly DoaLimit[],
  approver: Approver,
  q: Omit<AuthorityQuery, 'amountMinor'>,
): DoaLimit | null {
  const candidates = limits.filter(
    (l) =>
      active(l, q.date) &&
      l.currency === q.currency &&
      (l.spendType === '*' || l.spendType === q.spendType) &&
      (l.legalEntityId === '*' || l.legalEntityId === q.legalEntityId) &&
      ((l.personId && l.personId === approver.personId) ||
        (!l.personId && l.role && approver.roles.includes(l.role))),
  );
  const score = (l: DoaLimit) =>
    (l.personId ? 4 : 0) + (l.spendType !== '*' ? 2 : 0) + (l.legalEntityId !== '*' ? 1 : 0);
  candidates.sort(
    (a, b) => score(b) - score(a) || b.limitMinor - a.limitMinor || a.id.localeCompare(b.id),
  );
  return candidates[0] ?? null;
}

/** Passes exactly at the limit; one minor unit above fails. */
export function checkAuthority(
  limits: readonly DoaLimit[],
  approver: Approver,
  q: AuthorityQuery,
): Result<{ limit: DoaLimit }> {
  const limit = resolveLimit(limits, approver, q);
  if (!limit) {
    return err(
      'DOA_NO_AUTHORITY',
      'This approver has no delegation-of-authority limit for this spend type and legal entity.',
      {
        spendType: q.spendType,
        legalEntityId: q.legalEntityId,
      },
    );
  }
  if (q.amountMinor > limit.limitMinor) {
    return err(
      'DOA_LIMIT_EXCEEDED',
      "The amount is above this approver's delegation-of-authority limit; the step escalates.",
      {
        limitMinor: limit.limitMinor,
        amountMinor: q.amountMinor,
        currency: q.currency,
      },
    );
  }
  return ok({ limit });
}

export interface Delegation {
  delegatorPersonId: string;
  delegatePersonId: string;
  limitMinor: number | null;
  currency: string;
  validFrom: string;
  validTo: string;
}

/** A delegate's authority is capped by the delegator's own limit and the delegation's dates. */
export function delegatedLimit(
  delegation: Delegation,
  delegatorLimitMinor: number,
  date: string,
): Result<number> {
  if (!active(delegation, date)) {
    return err('DELEGATION_NOT_ACTIVE', 'This delegation is not active on that date.', {
      validFrom: delegation.validFrom,
      validTo: delegation.validTo,
    });
  }
  return ok(
    delegation.limitMinor === null
      ? delegatorLimitMinor
      : Math.min(delegation.limitMinor, delegatorLimitMinor),
  );
}

/** Approval hygiene: no self-approval; an approver cannot be a beneficiary or an attendee. */
export function checkApprovalHygiene(input: {
  approverId: string;
  requesterId: string;
  onBehalfOfId?: string | null;
  beneficiaryIds?: readonly string[];
  attendeeIds?: readonly string[];
}): Result<true> {
  const actor = input.onBehalfOfId ?? input.approverId;
  if (input.approverId === input.requesterId || actor === input.requesterId)
    return err('SELF_APPROVAL', 'People cannot approve their own requests.');
  if (input.beneficiaryIds?.includes(input.approverId) || input.beneficiaryIds?.includes(actor)) {
    return err(
      'APPROVER_IS_BENEFICIARY',
      'The approver benefits from this request and cannot approve it.',
    );
  }
  if (input.attendeeIds?.includes(input.approverId) || input.attendeeIds?.includes(actor)) {
    return err('APPROVER_IS_ATTENDEE', 'The approver attends this event and cannot approve it.');
  }
  return ok(true);
}
