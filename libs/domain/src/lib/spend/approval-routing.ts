import {
  checkApprovalHygiene,
  checkAuthority,
  delegatedLimit,
  resolveLimit,
  type Approver,
  type Delegation,
  type DoaLimit,
} from '../authority/doa';
import { err, ok, type Result } from '../result';

/**
 * Approval routing by hierarchy and delegation of authority (Phase 5; the rules engine and workflow
 * builder in Phase 7 extend it). Ownership never grants authority: each step's approver must pass
 * approval hygiene and hold a DoA limit covering the amount, spend type and legal entity.
 */
export type ApprovalResolver =
  | 'budget_owner'
  | 'parent_owner'
  | 'giving_director'
  | 'finance_review'
  | 'executive';

export interface RouteParty extends Approver {
  budgetId?: string | null;
}

export interface RouteStep {
  stepNo: number;
  personId: string;
  resolver: ApprovalResolver;
  budgetId: string | null;
  limitMinor: number;
  reason: string;
}

export type SkipReason = 'requester' | 'beneficiary' | 'attendee' | 'no_authority' | 'above_limit';

export interface RouteSkip {
  personId: string;
  reason: SkipReason;
  detail: string;
}

export interface ApprovalRoute {
  steps: RouteStep[];
  skipped: RouteSkip[];
  explanation: string[];
}

export interface RouteInput {
  subject: 'request' | 'contribution';
  requesterId: string;
  beneficiaryIds?: readonly string[];
  attendeeIds?: readonly string[];
  /** Amount in the DoA limits' currency, converted by the caller at the locked plan rate. */
  amountMinor: number;
  currency: string;
  spendType: string;
  legalEntityId: string;
  date: string;
  /** Owners of the budget and its ancestors, nearest first. */
  ownerChain: readonly RouteParty[];
  /** Finance reviewers and executives: used when nobody in the chain has authority, and for finance review. */
  financeReviewers: readonly RouteParty[];
  executives: readonly RouteParty[];
  limits: readonly DoaLimit[];
  /** Requests at or above the threshold, or leaving the budget below the remaining percentage, add a finance review step. */
  financeReview?: {
    thresholdMinor: number;
    remainingPctBelow: number;
    remainingPctAfter: number | null;
  };
}

/** Requests from USD 10,000.00 (in the DoA currency) or leaving less than 10% of the budget get a finance review. */
export const FINANCE_REVIEW_THRESHOLD_MINOR = 1_000_000;
export const FINANCE_REVIEW_REMAINING_PCT = 10;

const SKIP_FROM_HYGIENE: Record<string, SkipReason> = {
  SELF_APPROVAL: 'requester',
  APPROVER_IS_BENEFICIARY: 'beneficiary',
  APPROVER_IS_ATTENDEE: 'attendee',
};

function evaluate(
  p: RouteParty,
  input: RouteInput,
): { ok: true; limitMinor: number } | { ok: false; skip: RouteSkip } {
  const hygiene = checkApprovalHygiene({
    approverId: p.personId,
    requesterId: input.requesterId,
    beneficiaryIds: input.beneficiaryIds,
    attendeeIds: input.attendeeIds,
  });
  if (!hygiene.ok) {
    return {
      ok: false,
      skip: {
        personId: p.personId,
        reason: SKIP_FROM_HYGIENE[hygiene.error.code] ?? 'requester',
        detail: hygiene.error.message,
      },
    };
  }
  const auth = checkAuthority(input.limits, p, {
    spendType: input.spendType,
    legalEntityId: input.legalEntityId,
    amountMinor: input.amountMinor,
    currency: input.currency,
    date: input.date,
  });
  if (!auth.ok) {
    return {
      ok: false,
      skip: {
        personId: p.personId,
        reason: auth.error.code === 'DOA_LIMIT_EXCEEDED' ? 'above_limit' : 'no_authority',
        detail: auth.error.message,
      },
    };
  }
  return { ok: true, limitMinor: auth.value.limit.limitMinor };
}

function dedupe(parties: readonly RouteParty[]): RouteParty[] {
  const seen = new Set<string>();
  return parties.filter((p) => (seen.has(p.personId) ? false : (seen.add(p.personId), true)));
}

/**
 * Builds the chain: the nearest owner up the budget hierarchy who passes hygiene and whose DoA limit
 * covers the amount (the requester is skipped, owners below their limit escalate upward), then the
 * executives and finance reviewers if nobody in the chain has authority; plus a finance review step
 * above the amount or remaining-percentage thresholds. Deterministic for the same inputs.
 */
export function buildApprovalRoute(input: RouteInput): Result<ApprovalRoute> {
  const skipped: RouteSkip[] = [];
  const explanation: string[] = [];
  let primary: RouteStep | null = null;
  const chain = dedupe(input.ownerChain);
  for (const [i, p] of chain.entries()) {
    const e = evaluate(p, input);
    if (!e.ok) {
      skipped.push(e.skip);
      continue;
    }
    const first = i === 0;
    primary = {
      stepNo: 1,
      personId: p.personId,
      resolver:
        input.subject === 'contribution'
          ? 'giving_director'
          : first
            ? 'budget_owner'
            : 'parent_owner',
      budgetId: p.budgetId ?? null,
      limitMinor: e.limitMinor,
      reason: first
        ? input.subject === 'contribution'
          ? 'Owner of the giving budget'
          : 'Owner of the budget'
        : 'Next owner up the budget hierarchy with enough delegation of authority',
    };
    break;
  }
  if (!primary) {
    for (const [resolver, parties] of [
      ['executive', input.executives],
      ['finance_review', input.financeReviewers],
    ] as const) {
      for (const p of dedupe(parties)) {
        if (chain.some((c) => c.personId === p.personId)) continue;
        const e = evaluate(p, input);
        if (!e.ok) {
          skipped.push(e.skip);
          continue;
        }
        primary = {
          stepNo: 1,
          personId: p.personId,
          resolver,
          budgetId: null,
          limitMinor: e.limitMinor,
          reason: 'Nobody in the budget hierarchy has enough delegation of authority',
        };
        break;
      }
      if (primary) break;
    }
  }
  if (!primary) {
    return err(
      'DOA_NO_AUTHORITY',
      'Nobody in the approval hierarchy has a delegation-of-authority limit that covers this amount.',
      { amountMinor: input.amountMinor, currency: input.currency, spendType: input.spendType },
    );
  }
  const steps: RouteStep[] = [primary];
  for (const s of skipped) {
    explanation.push(
      s.reason === 'requester'
        ? 'The requester is skipped as an approver.'
        : s.reason === 'above_limit'
          ? 'An approver below the amount was skipped: the step escalates by delegation of authority.'
          : s.reason === 'no_authority'
            ? 'An owner without a delegation-of-authority limit for this spend type was skipped.'
            : 'An approver who benefits from or attends this event was skipped.',
    );
  }
  explanation.push(`${primary.reason}.`);
  const fr = input.financeReview;
  if (input.subject === 'request' && fr) {
    const byAmount = input.amountMinor >= fr.thresholdMinor;
    const byRemaining =
      fr.remainingPctAfter !== null && fr.remainingPctAfter < fr.remainingPctBelow;
    if (byAmount || byRemaining) {
      const reviewer = dedupe(input.financeReviewers).find(
        (p) => p.personId !== primary!.personId && evaluate(p, input).ok,
      );
      if (reviewer) {
        const e = evaluate(reviewer, input) as { ok: true; limitMinor: number };
        const reason = byAmount
          ? 'Finance review: the amount is at or above the finance review threshold'
          : `Finance review: the budget would have less than ${fr.remainingPctBelow}% left`;
        steps.push({
          stepNo: 2,
          personId: reviewer.personId,
          resolver: 'finance_review',
          budgetId: null,
          limitMinor: e.limitMinor,
          reason,
        });
        explanation.push(`${reason}.`);
      }
    }
  }
  return ok({ steps, skipped, explanation });
}

/**
 * Re-checked at decision time under lock: the actor is the step's approver, or an active delegate of
 * the approver (authority capped by the lower of the delegator's own limit, the delegate's own limit
 * if any, and the delegation's cap, within the delegation's dates); hygiene applies to both people;
 * the amount to approve is within the effective limit.
 */
export function checkDecisionAuthority(input: {
  actor: Approver;
  assignee: Approver;
  delegation: Delegation | null;
  requesterId: string;
  beneficiaryIds?: readonly string[];
  attendeeIds?: readonly string[];
  amountMinor: number;
  currency: string;
  spendType: string;
  legalEntityId: string;
  date: string;
  limits: readonly DoaLimit[];
}): Result<{ onBehalfOfPersonId: string | null; effectiveLimitMinor: number }> {
  const acting = input.actor.personId !== input.assignee.personId;
  if (acting && (!input.delegation || input.delegation.delegatePersonId !== input.actor.personId)) {
    return err('APPROVAL_NOT_ASSIGNED', 'This approval is assigned to someone else.');
  }
  const hygiene = checkApprovalHygiene({
    approverId: input.actor.personId,
    requesterId: input.requesterId,
    onBehalfOfId: acting ? input.assignee.personId : null,
    beneficiaryIds: input.beneficiaryIds,
    attendeeIds: input.attendeeIds,
  });
  if (!hygiene.ok) return hygiene;
  const q = {
    spendType: input.spendType,
    legalEntityId: input.legalEntityId,
    currency: input.currency,
    date: input.date,
  };
  const own = checkAuthority(input.limits, input.assignee, { ...q, amountMinor: 0 });
  if (!own.ok) return own;
  let effective = own.value.limit.limitMinor;
  if (acting) {
    const d = delegatedLimit(input.delegation!, effective, input.date);
    if (!d.ok) return d;
    effective = d.value;
    const actorOwn = resolveLimit(input.limits, input.actor, q);
    if (actorOwn) {
      effective = Math.min(effective, actorOwn.limitMinor);
    }
  }
  if (input.amountMinor > effective) {
    return err(
      'DOA_LIMIT_EXCEEDED',
      acting
        ? "The amount is above this delegate's authority (capped by the delegator's limit); approve part or escalate."
        : "The amount is above this approver's delegation-of-authority limit; approve part or escalate.",
      { limitMinor: effective, amountMinor: input.amountMinor, currency: input.currency },
    );
  }
  return ok({
    onBehalfOfPersonId: acting ? input.assignee.personId : null,
    effectiveLimitMinor: effective,
  });
}
