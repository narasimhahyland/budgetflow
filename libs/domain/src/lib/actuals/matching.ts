import { err, ok, type Result } from '../result';

/** Default tolerance between an actual and the commitment it consumes, in basis points of the commitment. */
export const DEFAULT_MATCH_TOLERANCE_BPS = 100;

/**
 * How an actual fits the remaining encumbrance of a commitment, compared in the budget currency at the
 * locked plan rate:
 * - `exact`: equal; the commitment is consumed.
 * - `under_within_tolerance`: short by no more than the tolerance; consumed, the difference released.
 * - `over_within_tolerance`: above by no more than the tolerance; consumed, the excess is extra actual.
 * - `partial`: short by more than the tolerance; the commitment stays open (partially consumed).
 * - `over_tolerance`: above commitment + tolerance; needs an approved over-budget request.
 */
export type MatchFit =
  | 'exact'
  | 'under_within_tolerance'
  | 'over_within_tolerance'
  | 'partial'
  | 'over_tolerance';

export interface FitResult {
  fit: MatchFit;
  /** Actual minus remaining encumbrance (budget currency). */
  differenceMinor: number;
  toleranceMinor: number;
  /** Encumbrance relieved by this match (never more than remains, so relief reuses posted amounts). */
  reliefMinor: number;
  /** Part of the relief that is released rather than consumed. */
  releasedMinor: number;
  /** Actual above the remaining encumbrance (consumes available). */
  excessMinor: number;
  /** Whether the commitment has nothing left encumbered afterwards. */
  closesCommitment: boolean;
}

export function toleranceOf(commitmentTotalMinor: number, toleranceBps: number): number {
  return Math.floor((Math.max(commitmentTotalMinor, 0) * toleranceBps) / 10_000);
}

/** Classifies a positive actual against a commitment's remaining encumbrance (see `MatchFit`). */
export function classifyFit(input: {
  actualMinor: number;
  remainingMinor: number;
  commitmentTotalMinor: number;
  toleranceBps: number;
  /** Close the commitment even when the actual is short by more than the tolerance (final invoice). */
  final?: boolean;
}): FitResult {
  const tol = toleranceOf(input.commitmentTotalMinor, input.toleranceBps);
  const remaining = Math.max(input.remainingMinor, 0);
  const diff = input.actualMinor - remaining;
  const base = { differenceMinor: diff, toleranceMinor: tol };
  if (diff === 0)
    return {
      ...base,
      fit: 'exact',
      reliefMinor: remaining,
      releasedMinor: 0,
      excessMinor: 0,
      closesCommitment: true,
    };
  if (diff > 0)
    return {
      ...base,
      fit: diff <= tol ? 'over_within_tolerance' : 'over_tolerance',
      reliefMinor: remaining,
      releasedMinor: 0,
      excessMinor: diff,
      closesCommitment: true,
    };
  if (-diff <= tol || input.final)
    return {
      ...base,
      fit: -diff <= tol ? 'under_within_tolerance' : 'partial',
      reliefMinor: remaining,
      releasedMinor: -diff,
      excessMinor: 0,
      closesCommitment: true,
    };
  return {
    ...base,
    fit: 'partial',
    reliefMinor: input.actualMinor,
    releasedMinor: 0,
    excessMinor: 0,
    closesCommitment: false,
  };
}

/**
 * Matched actuals stay within commitment + tolerance; above it the excess needs an approved
 * over-budget request covering at least the excess.
 */
export function checkFit(fit: FitResult, approvedExcessMinor: number): Result<FitResult> {
  if (fit.fit === 'over_tolerance' && approvedExcessMinor < fit.excessMinor) {
    return err(
      'MATCH_OVER_TOLERANCE',
      'The actual is above the commitment plus its tolerance. Request over-budget approval for the difference first.',
      {
        excessMinor: fit.excessMinor,
        toleranceMinor: fit.toleranceMinor,
        approvedExcessMinor,
      },
    );
  }
  return ok(fit);
}

/** An actual is matched at most once: the parts matched never exceed the actual. */
export function checkMatchable(input: {
  matchStatus: 'unmatched' | 'partially_matched' | 'matched' | 'excluded';
  amountMinor: number;
  matchedMinor: number;
  requestedMinor: number;
}): Result<true> {
  if (input.matchStatus === 'matched' || input.matchStatus === 'excluded') {
    return err(
      'ACTUAL_ALREADY_MATCHED',
      input.matchStatus === 'excluded'
        ? 'This actual is marked not budget-relevant.'
        : 'This actual is already fully matched.',
    );
  }
  const left = Math.abs(input.amountMinor) - Math.abs(input.matchedMinor);
  if (input.requestedMinor <= 0 || input.requestedMinor > left) {
    return err(
      'ACTUAL_ALREADY_MATCHED',
      'That is more than is left to match on this actual. Lower the amount.',
      { unmatchedMinor: left, requestedMinor: input.requestedMinor },
    );
  }
  return ok(true);
}

export interface MatchCandidate {
  commitmentId: string;
  reference: string;
  budgetId: string;
  legalEntityId: string;
  eventCode: string | null;
  costCenterId: string | null;
  vendorId: string | null;
  vendorName: string | null;
  glAccountId?: string | null;
  totalMinor: number;
  remainingMinor: number;
}

export interface MappingRuleMatch {
  legalEntityId?: string;
  costCenterId?: string;
  glAccountId?: string;
  eventCode?: string;
  vendorId?: string;
  cardProgram?: string;
  merchantContains?: string;
  memoContains?: string;
}

export interface MappingRule {
  id: string;
  priority: number;
  match: MappingRuleMatch;
  targetBudgetId: string | null;
  targetEventCode: string | null;
}

export interface MatchableLine {
  legalEntityId: string;
  costCenterId: string | null;
  glAccountId: string | null;
  eventCode: string | null;
  vendorId: string | null;
  merchant: string | null;
  memo: string | null;
  reference: string | null;
  cardProgram: string | null;
}

export const MATCH_RULES = [
  'reference',
  'event_cost_center',
  'vendor_amount',
  'mapping_rule',
] as const;
export type MatchRule = (typeof MATCH_RULES)[number];

export interface MatchProposal {
  rule: MatchRule;
  /** 0-100. */
  confidence: number;
  commitmentId: string | null;
  budgetId: string;
  mappingRuleId: string | null;
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

function vendorMatches(line: MatchableLine, c: MatchCandidate): boolean {
  if (line.vendorId && c.vendorId) return line.vendorId === c.vendorId;
  const m = norm(line.merchant);
  const v = norm(c.vendorName);
  return m.length > 3 && v.length > 3 && (m.includes(v) || v.includes(m));
}

export function ruleApplies(rule: MappingRuleMatch, line: MatchableLine): boolean {
  const eq = (a: string | undefined, b: string | null) =>
    a === undefined || (b !== null && a.toLowerCase() === b.toLowerCase());
  const contains = (needle: string | undefined, hay: string | null) =>
    needle === undefined || (hay ?? '').toLowerCase().includes(needle.toLowerCase());
  return (
    eq(rule.legalEntityId, line.legalEntityId) &&
    eq(rule.costCenterId, line.costCenterId) &&
    eq(rule.glAccountId, line.glAccountId) &&
    eq(rule.eventCode, line.eventCode) &&
    eq(rule.vendorId, line.vendorId) &&
    eq(rule.cardProgram, line.cardProgram) &&
    contains(rule.merchantContains, line.merchant) &&
    contains(rule.memoContains, line.memo)
  );
}

/**
 * Auto-match proposal for one charge, in rule order: commitment reference (PO number), event code with
 * cost center, vendor with amount within tolerance, then actual-to-budget mapping rules (entity, cost
 * center, GL, event code, vendor, card program, merchant, memo). Candidates are open commitments in the
 * line's legal entity; `budgetMinorOf` converts the line into a candidate's budget currency at the
 * locked plan rate. Returns null when nothing applies (the line goes to the unmatched queue).
 */
export function proposeMatch(
  line: MatchableLine,
  candidates: readonly MatchCandidate[],
  rules: readonly MappingRule[],
  opts: { toleranceBps: number; budgetMinorOf: (budgetId: string) => number | null },
): MatchProposal | null {
  const inEntity = candidates.filter(
    (c) => c.legalEntityId === line.legalEntityId && c.remainingMinor > 0,
  );
  const distance = (c: MatchCandidate) => {
    const b = opts.budgetMinorOf(c.budgetId);
    return b === null ? Number.MAX_SAFE_INTEGER : Math.abs(b - c.remainingMinor);
  };
  const sameGl = (c: MatchCandidate) =>
    line.glAccountId && c.glAccountId === line.glAccountId ? 0 : 1;
  const best = (list: MatchCandidate[]) =>
    [...list].sort(
      (a, b) =>
        sameGl(a) - sameGl(b) ||
        distance(a) - distance(b) ||
        a.commitmentId.localeCompare(b.commitmentId),
    )[0];
  const proposal = (rule: MatchRule, confidence: number, c: MatchCandidate): MatchProposal => ({
    rule,
    confidence,
    commitmentId: c.commitmentId,
    budgetId: c.budgetId,
    mappingRuleId: null,
  });

  const ref = norm(line.reference);
  if (ref) {
    const byRef = inEntity.filter((c) => norm(c.reference) === ref || norm(c.commitmentId) === ref);
    if (byRef.length > 0) return proposal('reference', 98, best(byRef));
  }
  const code = norm(line.eventCode);
  if (code) {
    const byEvent = inEntity.filter(
      (c) =>
        norm(c.eventCode) === code &&
        (line.costCenterId === null ||
          c.costCenterId === null ||
          c.costCenterId === line.costCenterId),
    );
    const withVendor = byEvent.filter((c) => vendorMatches(line, c));
    if (withVendor.length === 1) return proposal('event_cost_center', 97, withVendor[0]);
    if (byEvent.length === 1) return proposal('event_cost_center', 92, byEvent[0]);
    if (withVendor.length > 1) return proposal('event_cost_center', 80, best(withVendor));
    if (byEvent.length > 1) return proposal('event_cost_center', 70, best(byEvent));
  }
  const byVendor = inEntity.filter((c) => {
    if (!vendorMatches(line, c)) return false;
    const b = opts.budgetMinorOf(c.budgetId);
    return (
      b !== null && Math.abs(b - c.remainingMinor) <= toleranceOf(c.totalMinor, opts.toleranceBps)
    );
  });
  if (byVendor.length > 0)
    return proposal('vendor_amount', byVendor.length === 1 ? 85 : 70, best(byVendor));

  for (const rule of [...rules].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  )) {
    if (!ruleApplies(rule.match, line)) continue;
    if (rule.targetEventCode) {
      const forEvent = inEntity.filter((c) => norm(c.eventCode) === norm(rule.targetEventCode));
      if (forEvent.length > 0)
        return { ...proposal('mapping_rule', 75, best(forEvent)), mappingRuleId: rule.id };
    }
    if (rule.targetBudgetId)
      return {
        rule: 'mapping_rule',
        confidence: 75,
        commitmentId: null,
        budgetId: rule.targetBudgetId,
        mappingRuleId: rule.id,
      };
  }
  return null;
}
