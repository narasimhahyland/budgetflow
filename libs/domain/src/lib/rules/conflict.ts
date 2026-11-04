/**
 * Rule outcome precedence (Phase 7 builds the evaluator on top): block > freeze > union of required
 * approvals > warn > auto-approve. Ties break by priority, then rule id, so outcomes are deterministic.
 */
export const RULE_EFFECTS = [
  'block',
  'freeze',
  'require_approval',
  'warn',
  'auto_approve',
] as const;
export type RuleEffect = (typeof RULE_EFFECTS)[number];

export interface RuleMatch {
  ruleId: string;
  version: number;
  priority: number;
  effect: RuleEffect;
  approvers?: readonly string[];
  explanation: string;
}

export interface RuleResolution {
  effect: RuleEffect | 'none';
  requiredApprovers: string[];
  decisive: RuleMatch | null;
  matches: RuleMatch[];
}

export function resolveRuleConflicts(matches: readonly RuleMatch[]): RuleResolution {
  const sorted = [...matches].sort(
    (a, b) =>
      RULE_EFFECTS.indexOf(a.effect) - RULE_EFFECTS.indexOf(b.effect) ||
      b.priority - a.priority ||
      a.ruleId.localeCompare(b.ruleId),
  );
  const decisive = sorted[0] ?? null;
  const requiredApprovers = [
    ...new Set(
      sorted.filter((m) => m.effect === 'require_approval').flatMap((m) => m.approvers ?? []),
    ),
  ].sort();
  return { effect: decisive?.effect ?? 'none', requiredApprovers, decisive, matches: sorted };
}
