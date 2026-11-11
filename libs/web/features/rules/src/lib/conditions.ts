import type { ConditionLeaf, Money } from '@bf/contracts';
import { formatMoney } from '@bf/web/ui';

const FACT_LABELS: Record<string, string> = {
  amount_reporting_minor: 'Amount',
  amount_budget_minor: 'Amount in the budget currency',
  amount_per_person_minor: 'Amount per person',
  remaining_pct: 'Budget left',
  category: 'Category',
  spend_type: 'Spend type',
  location: 'Location',
  legal_entity: 'Legal entity',
  requester_role: 'Requester',
  seniority: 'Seniority',
  employee_count: 'Number of people',
  vendor_status: 'Vendor',
  attendee_type: 'Attendees',
  alcohol_requested: 'Alcohol',
  is_cash_equivalent: 'Cash or gift card',
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
]);

export const moneyText = (m: Money | null | undefined): string =>
  m ? formatMoney(m.amountMinor, m.currency) : '—';

// Money facts are evaluated in the reporting currency (USD for this tenant); the condition carries
// minor units only, so the code is fixed here rather than read from the rule.
const usd = (minor: number) => formatMoney(minor, 'USD');

export function factValueText(fact: string, value: unknown): string {
  if (value === null || value === undefined) return 'not set';
  if (Array.isArray(value)) return value.map((v) => factValueText(fact, v)).join(', ');
  if (MONEY_FACTS.has(fact) && typeof value === 'number') return usd(value);
  if (fact === 'remaining_pct' && typeof value === 'number') return `${value}%`;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value).replace(/_/g, ' ');
}

/** One condition as a sentence, so the builder reads the same way the policy does. */
export const conditionText = (c: ConditionLeaf): string =>
  `${FACT_LABELS[c.fact] ?? c.fact} ${OP_LABELS[c.op] ?? c.op} ${factValueText(c.fact, c.value)}`;

export const factLabel = (fact: string): string => FACT_LABELS[fact] ?? fact;
