import { resolveRuleConflicts, RULE_EFFECTS, type RuleEffect, type RuleMatch } from './conflict';

export type FactKey =
  | 'amount_reporting_minor'
  | 'amount_budget_minor'
  | 'amount_per_person_minor'
  | 'remaining_pct'
  | 'category'
  | 'spend_type'
  | 'location'
  | 'legal_entity'
  | 'requester_role'
  | 'seniority'
  | 'employee_count'
  | 'vendor_status'
  | 'attendee_type'
  | 'alcohol_requested'
  | 'is_cash_equivalent';

export type ConditionOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in';

export interface ConditionLeaf {
  kind?: 'leaf';
  fact: FactKey;
  op: ConditionOperator;
  value: string | number | boolean | readonly string[] | readonly number[];
}

export interface ConditionGroup {
  kind?: 'group';
  logic: 'and' | 'or';
  conditions: readonly ConditionLeaf[];
}

export interface RuleActionDef {
  effect: RuleEffect;
  approvers?: readonly string[];
  mode?: 'sequential' | 'parallel';
  notifyAudience?: readonly ('requester' | 'approver' | 'owner' | 'finance')[];
  requireReceiptAboveMinor?: number;
  message?: string;
}

export interface RuleScopeDef {
  orgUnitIds?: readonly string[];
  legalEntityCodes?: readonly string[];
  requestKinds?: readonly string[];
}

export interface EvaluableRule {
  id: string;
  code: string;
  name: string;
  version: number;
  priority: number;
  effect: RuleEffect;
  conditions: ConditionGroup;
  actions: readonly RuleActionDef[];
  scope: RuleScopeDef;
  explanation: string;
  validFrom: string;
  validTo: string | null;
}

export interface EvaluationFacts {
  amount_reporting_minor: number;
  amount_budget_minor: number;
  amount_per_person_minor: number;
  remaining_pct: number;
  category: string;
  spend_type: string;
  location: string;
  legal_entity: string;
  requester_role: string;
  seniority: number;
  employee_count: number;
  vendor_status: string;
  attendee_type: string;
  alcohol_requested: boolean;
  is_cash_equivalent: boolean;
  org_unit_ids?: readonly string[];
  request_kind?: string;
  date?: string;
}

export interface EvaluatedConditionCheck {
  fact: FactKey;
  op: ConditionOperator;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

export interface EvaluatedRuleMatch extends RuleMatch {
  ruleCode: string;
  ruleName: string;
  matchedFacts: Record<string, unknown>;
}

export interface EvaluationResult {
  effect: RuleEffect | 'none';
  requiredApprovers: string[];
  decisive: EvaluatedRuleMatch | null;
  matches: EvaluatedRuleMatch[];
  explanation: string;
}

export function isRuleEffectiveOn(
  rule: Pick<EvaluableRule, 'validFrom' | 'validTo'>,
  date: string,
): boolean {
  return rule.validFrom <= date && (rule.validTo === null || date <= rule.validTo);
}

export function isRuleInScope(scope: RuleScopeDef, facts: EvaluationFacts): boolean {
  if (scope.legalEntityCodes?.length) {
    const match = scope.legalEntityCodes.some(
      (c) => c.toLowerCase() === facts.legal_entity.toLowerCase() || c === '*',
    );
    if (!match) return false;
  }
  if (scope.requestKinds?.length && facts.request_kind) {
    const match = scope.requestKinds.some(
      (k) => k.toLowerCase() === facts.request_kind!.toLowerCase() || k === '*',
    );
    if (!match) return false;
  }
  if (scope.orgUnitIds?.length && facts.org_unit_ids?.length) {
    const match = scope.orgUnitIds.some((id) => facts.org_unit_ids!.includes(id));
    if (!match) return false;
  }
  return true;
}

export function evaluateLeaf(leaf: ConditionLeaf, facts: EvaluationFacts): EvaluatedConditionCheck {
  const actual = facts[leaf.fact];
  const expected = leaf.value;
  let passed = false;

  switch (leaf.op) {
    case 'eq':
      passed =
        typeof actual === 'string' && typeof expected === 'string'
          ? actual.toLowerCase() === expected.toLowerCase()
          : actual === expected;
      break;
    case 'neq':
      passed =
        typeof actual === 'string' && typeof expected === 'string'
          ? actual.toLowerCase() !== expected.toLowerCase()
          : actual !== expected;
      break;
    case 'gt':
      passed = typeof actual === 'number' && typeof expected === 'number' && actual > expected;
      break;
    case 'gte':
      passed = typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
      break;
    case 'lt':
      passed = typeof actual === 'number' && typeof expected === 'number' && actual < expected;
      break;
    case 'lte':
      passed = typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
      break;
    case 'in':
      if (Array.isArray(expected)) {
        passed = expected.some((item) =>
          typeof actual === 'string' && typeof item === 'string'
            ? actual.toLowerCase() === item.toLowerCase()
            : actual === item,
        );
      }
      break;
    case 'not_in':
      if (Array.isArray(expected)) {
        passed = !expected.some((item) =>
          typeof actual === 'string' && typeof item === 'string'
            ? actual.toLowerCase() === item.toLowerCase()
            : actual === item,
        );
      }
      break;
  }

  return { fact: leaf.fact, op: leaf.op, expected, actual, passed };
}

export function evaluateConditionGroup(
  group: ConditionGroup,
  facts: EvaluationFacts,
): { matched: boolean; checks: EvaluatedConditionCheck[] } {
  if (!group.conditions.length) return { matched: true, checks: [] };
  const checks = group.conditions.map((c) => evaluateLeaf(c, facts));
  const matched =
    group.logic === 'or' ? checks.some((c) => c.passed) : checks.every((c) => c.passed);
  return { matched, checks };
}

/**
 * Pure deterministic rule evaluation: filters by effective date and scope, evaluates condition ASTs,
 * and resolves conflicts via `resolveRuleConflicts` (block > freeze > union of required approvals >
 * warn > auto-approve; ties broken by priority, then rule code/id).
 */
export function evaluateRules(
  rules: readonly EvaluableRule[],
  facts: EvaluationFacts,
): EvaluationResult {
  const date = facts.date ?? '2026-11-16';
  const rawMatches: EvaluatedRuleMatch[] = [];

  for (const r of rules) {
    if (!isRuleEffectiveOn(r, date)) continue;
    if (!isRuleInScope(r.scope, facts)) continue;
    const { matched, checks } = evaluateConditionGroup(r.conditions, facts);
    if (!matched) continue;
    const approvers = r.actions.flatMap((a) => a.approvers ?? []);
    const matchedFacts: Record<string, unknown> = {};
    for (const c of checks) {
      if (c.passed) matchedFacts[c.fact] = c.actual;
    }
    rawMatches.push({
      ruleId: r.code || r.id,
      ruleCode: r.code,
      ruleName: r.name,
      version: r.version,
      priority: r.priority,
      effect: r.effect,
      approvers,
      explanation: r.explanation,
      matchedFacts,
    });
  }

  const res = resolveRuleConflicts(rawMatches);
  const byKey = new Map(rawMatches.map((m) => [`${m.ruleId}:${m.version}`, m]));
  const sortedMatches = res.matches.map((m) => byKey.get(`${m.ruleId}:${m.version}`)!);
  const decisive = res.decisive
    ? byKey.get(`${res.decisive.ruleId}:${res.decisive.version}`)!
    : null;

  const explanation = decisive
    ? decisive.explanation
    : 'No policy rules blocked or restricted this request; standard hierarchy routing applies.';

  return {
    effect: res.effect,
    requiredApprovers: res.requiredApprovers,
    decisive,
    matches: sortedMatches,
    explanation,
  };
}

/** What each outcome does, phrased to drop into a sentence about two rules disagreeing. */
const EFFECT_TEXT: Record<RuleEffect, string> = {
  block: 'block the request',
  freeze: 'hold the request until the budget is available again',
  require_approval: 'send the request for approval',
  warn: 'let the request through with a warning',
  auto_approve: 'let the request through with no approval step',
};

export interface DetectedConflict {
  otherRule: EvaluableRule;
  winningEffect: RuleEffect;
  reason: string;
  blocking: boolean;
}

/**
 * Whether two condition sets can both match the same request on the facts they share. Rules that
 * name no fact in common are not compared: precedence (block > freeze > approvals > warn >
 * auto-approve) already resolves them, and treating them as conflicts would flag every pair.
 */
function factsOverlap(a: ConditionGroup, b: ConditionGroup): boolean {
  const byFactA = new Map(a.conditions.map((c) => [c.fact, c]));
  const shared = b.conditions.filter((c) => byFactA.has(c.fact));
  if (shared.length === 0) return false;
  for (const cb of shared) {
    const ca = byFactA.get(cb.fact);
    if (!ca) continue;
    if (
      ca.op === 'eq' &&
      cb.op === 'eq' &&
      String(ca.value).toLowerCase() !== String(cb.value).toLowerCase()
    ) {
      return false;
    }
    if (ca.op === 'in' && cb.op === 'in' && Array.isArray(ca.value) && Array.isArray(cb.value)) {
      const setA = new Set(ca.value.map((x) => String(x).toLowerCase()));
      const overlap = cb.value.some((x) => setA.has(String(x).toLowerCase()));
      if (!overlap) return false;
    }
    if (ca.op === 'eq' && cb.op === 'in' && Array.isArray(cb.value)) {
      const match = cb.value.some(
        (x) => String(x).toLowerCase() === String(ca.value).toLowerCase(),
      );
      if (!match) return false;
    }
    if (cb.op === 'eq' && ca.op === 'in' && Array.isArray(ca.value)) {
      const match = ca.value.some(
        (x) => String(x).toLowerCase() === String(cb.value).toLowerCase(),
      );
      if (!match) return false;
    }
  }
  return true;
}

function scopesOverlap(a: RuleScopeDef, b: RuleScopeDef): boolean {
  if (a.legalEntityCodes?.length && b.legalEntityCodes?.length) {
    const setA = new Set(a.legalEntityCodes.map((x) => x.toLowerCase()));
    if (!b.legalEntityCodes.some((x) => setA.has(x.toLowerCase()) || x === '*' || setA.has('*')))
      return false;
  }
  if (a.orgUnitIds?.length && b.orgUnitIds?.length) {
    const setA = new Set(a.orgUnitIds);
    if (!b.orgUnitIds.some((x) => setA.has(x))) return false;
  }
  return true;
}

/**
 * Detects conflicts between a candidate draft rule and active rules where scopes and conditions
 * overlap but outcomes contradict (for example, an active rule blocks/freezes while the draft
 * routes for approval or auto-approves, or two rules have identical priority with different effects).
 */
export function detectRuleConflicts(
  candidate: EvaluableRule,
  activeRules: readonly EvaluableRule[],
): DetectedConflict[] {
  const conflicts: DetectedConflict[] = [];
  for (const other of activeRules) {
    if (other.id === candidate.id || other.code === candidate.code) continue;
    if (!scopesOverlap(candidate.scope, other.scope)) continue;

    const candRank = RULE_EFFECTS.indexOf(candidate.effect);
    const otherRank = RULE_EFFECTS.indexOf(other.effect);
    if (candRank === otherRank && candidate.priority !== other.priority) continue;

    // Two rules contend either because they share facts, or because they sit at the same priority
    // with different outcomes, where the tie-break would otherwise decide the outcome by rule code.
    const samePriority = candidate.priority === other.priority && candidate.effect !== other.effect;
    if (!samePriority && !factsOverlap(candidate.conditions, other.conditions)) continue;

    // A conflict occurs when one rule blocks/freezes a scope that the other rule tries to route for approval or auto-approve,
    // or when both share the exact same priority.
    const RestrictiveVsPermissive =
      (other.effect === 'block' || other.effect === 'freeze') &&
      (candidate.effect === 'require_approval' || candidate.effect === 'auto_approve');
    const PermissiveVsRestrictive =
      (candidate.effect === 'block' || candidate.effect === 'freeze') &&
      other.effect === 'auto_approve';
    const SamePriorityCollision =
      candidate.priority === other.priority && candidate.effect !== other.effect;

    if (RestrictiveVsPermissive || PermissiveVsRestrictive || SamePriorityCollision) {
      const winningEffect = candRank <= otherRank ? candidate.effect : other.effect;
      const mine = EFFECT_TEXT[candidate.effect];
      const theirs = EFFECT_TEXT[other.effect];
      const reason = SamePriorityCollision
        ? `${other.code} ${other.name} has the same priority (${candidate.priority}) but a different outcome: it would ${theirs} while ${candidate.code} would ${mine}. Give one of them a higher priority so the outcome is never decided by chance.`
        : `${other.code} ${other.name} (priority ${other.priority}) would ${theirs} where ${candidate.code} would ${mine}. The stricter outcome wins, so BudgetFlow would ${EFFECT_TEXT[winningEffect]}.`;
      conflicts.push({
        otherRule: other,
        winningEffect,
        reason,
        blocking: true,
      });
    }
  }
  return conflicts;
}

export interface ThresholdBandDef {
  minMinor: number;
  maxMinor: number | null;
  approvers: readonly string[];
}

/** Validates that threshold table bands are contiguous, non-overlapping and cover from 0 upward. */
export function validateThresholdBands(
  bands: readonly ThresholdBandDef[],
): { valid: true } | { valid: false; errors: string[] } {
  if (!bands.length) return { valid: false, errors: ['Add at least one threshold band.'] };
  const sorted = [...bands].sort((a, b) => a.minMinor - b.minMinor);
  const errors: string[] = [];

  if (sorted[0].minMinor !== 0) {
    errors.push('The first band must start at USD 0.00.');
  }

  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (b.maxMinor !== null && b.maxMinor <= b.minMinor) {
      errors.push(`Band ${i + 1} maximum must be greater than its minimum.`);
    }
    if (i > 0) {
      const prev = sorted[i - 1];
      if (prev.maxMinor === null) {
        errors.push(`Band ${i} is unbounded; no band can follow it.`);
      } else if (b.minMinor > prev.maxMinor + 1) {
        const gapFrom = ((prev.maxMinor + 1) / 100).toFixed(2);
        const gapTo = ((b.minMinor - 1) / 100).toFixed(2);
        errors.push(`No band covers USD ${gapFrom} to USD ${gapTo}.`);
      } else if (b.minMinor <= prev.maxMinor) {
        const overlapAt = (b.minMinor / 100).toFixed(2);
        errors.push(`Band ${i + 1} overlaps with band ${i} at USD ${overlapAt}.`);
      }
    }
  }

  return errors.length ? { valid: false, errors } : { valid: true };
}
