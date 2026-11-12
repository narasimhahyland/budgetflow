import type { rules, ruleVersions } from '@bf/api/db';
import type { ConditionGroup, RuleAction, RuleScope, RuleVersionView } from '@bf/contracts';
import type { EvaluableRule, RuleEffect } from '@bf/domain';

export type RuleRow = typeof rules.$inferSelect;
export type RuleVersionRow = typeof ruleVersions.$inferSelect;

const EMPTY_CONDITIONS: ConditionGroup = { kind: 'group', logic: 'and', conditions: [] };

export const conditionsOf = (row: RuleVersionRow): ConditionGroup => {
  const raw = row.conditions as Partial<ConditionGroup> | null;
  if (!raw || !Array.isArray(raw.conditions)) return EMPTY_CONDITIONS;
  return { kind: 'group', logic: raw.logic ?? 'and', conditions: raw.conditions };
};

export const actionsOf = (row: RuleVersionRow): RuleAction[] => {
  const raw = row.actions as RuleAction[] | null;
  return Array.isArray(raw) && raw.length ? raw : [{ effect: row.effect as RuleEffect }];
};

export const scopeOf = (row: RuleVersionRow): RuleScope => (row.scope as RuleScope | null) ?? {};

/** Database rows become the framework-free shape the evaluator in libs/domain understands. */
export function toEvaluable(rule: RuleRow, version: RuleVersionRow): EvaluableRule {
  return {
    id: rule.id,
    code: rule.code,
    name: rule.name,
    version: version.version,
    priority: version.priority,
    effect: version.effect as RuleEffect,
    conditions: conditionsOf(version),
    actions: actionsOf(version),
    scope: scopeOf(version),
    explanation: version.explanation,
    validFrom: version.validFrom,
    validTo: version.validTo,
  };
}

export function toVersionView(
  version: RuleVersionRow,
  names: Map<string, string>,
  matchCount30d: number,
): RuleVersionView {
  return {
    id: version.id,
    ruleId: version.ruleId,
    version: version.version,
    status: version.status as RuleVersionView['status'],
    priority: version.priority,
    effect: version.effect as RuleEffect,
    conditions: conditionsOf(version),
    actions: actionsOf(version),
    scope: scopeOf(version),
    explanation: version.explanation,
    validFrom: version.validFrom,
    validTo: version.validTo,
    publishedAt: version.publishedAt?.toISOString() ?? null,
    publishedByName: version.publishedBy ? (names.get(version.publishedBy) ?? null) : null,
    createdByName: version.createdBy ? (names.get(version.createdBy) ?? null) : null,
    createdAt: version.createdAt.toISOString(),
    matchCount30d,
  };
}

const usd = (minor: number) =>
  `USD ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const FACT_LABELS: Record<string, string> = {
  amount_reporting_minor: 'Amount (reporting currency)',
  amount_budget_minor: 'Amount (budget currency)',
  amount_per_person_minor: 'Amount per person',
  remaining_pct: 'Remaining budget',
  category: 'Category',
  spend_type: 'Spend type',
  location: 'Location',
  legal_entity: 'Legal entity',
  requester_role: 'Requester role',
  seniority: 'Seniority',
  employee_count: 'Number of people',
  vendor_status: 'Vendor status',
  attendee_type: 'Attendee type',
  alcohol_requested: 'Alcohol requested',
  is_cash_equivalent: 'Cash equivalent',
  employee_ytd_benefit_minor: 'Employee benefit this year',
  employee_cap_remaining_minor: 'Employee annual cap left',
  employee_cap_used_pct: 'Employee annual cap used',
  gift_value_minor: 'Gift value per recipient',
  gift_ytd_minor: 'Gifts to the recipient this year',
  gift_annual_cap_remaining_minor: 'Annual gift cap left',
  alcohol_amount_minor: 'Alcohol amount',
  non_employee_count: 'People outside the company',
  is_intercompany: 'Crosses legal entities',
  requester_recent_total_minor: 'Requester total in the last 30 days',
};

const OP_LABELS: Record<string, string> = {
  eq: 'is',
  neq: 'is not',
  gt: 'is above',
  gte: 'is at least',
  lt: 'is below',
  lte: 'is at most',
  in: 'is one of',
  not_in: 'is not one of',
};

const MONEY_FACTS = new Set([
  'amount_reporting_minor',
  'amount_budget_minor',
  'amount_per_person_minor',
  'employee_ytd_benefit_minor',
  'employee_cap_remaining_minor',
  'gift_value_minor',
  'gift_ytd_minor',
  'gift_annual_cap_remaining_minor',
  'alcohol_amount_minor',
  'requester_recent_total_minor',
]);

export const factLabel = (fact: string): string => FACT_LABELS[fact] ?? fact;

/** Formats a fact value the way the rules screens show it, so copy stays plain English. */
export function formatFactValue(fact: string, value: unknown): string {
  if (value === null || value === undefined) return 'not set';
  if (Array.isArray(value)) return value.map((v) => formatFactValue(fact, v)).join(', ');
  if (MONEY_FACTS.has(fact) && typeof value === 'number') return usd(value);
  if ((fact === 'remaining_pct' || fact === 'employee_cap_used_pct') && typeof value === 'number')
    return `${value}%`;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value).replace(/_/g, ' ');
}

export function conditionText(leaf: { fact: string; op: string; value: unknown }): string {
  return `${factLabel(leaf.fact)} ${OP_LABELS[leaf.op] ?? leaf.op} ${formatFactValue(leaf.fact, leaf.value)}`;
}

export function scopeSummary(scope: RuleScope): string {
  const parts: string[] = [];
  if (scope.legalEntityCodes?.length) parts.push(scope.legalEntityCodes.join(', '));
  if (scope.requestKinds?.length) parts.push(`${scope.requestKinds.join(', ')} requests`);
  if (scope.orgUnitIds?.length) parts.push(`${scope.orgUnitIds.length} locations`);
  return parts.length ? parts.join(' · ') : 'All locations and entities';
}

/** Must read the same as the labels on the rules screens, because both reach the same people. */
export const EFFECT_LABELS: Record<RuleEffect, string> = {
  block: 'Block',
  freeze: 'Hold',
  require_approval: 'Needs approval',
  warn: 'Warn',
  auto_approve: 'Goes through',
};

const APPROVER_LABELS: Record<string, string> = {
  budget_owner: 'budget owner',
  parent_owner: 'parent budget owner',
  finance_controller: 'Finance Controller',
  finance_review: 'Finance Controller',
  giving_director: 'giving director',
  executive: 'CEO',
  ceo: 'CEO',
  tax_approver: 'tax approver',
};

export const approverLabel = (key: string): string =>
  APPROVER_LABELS[key] ?? key.replace(/[_-]/g, ' ');
