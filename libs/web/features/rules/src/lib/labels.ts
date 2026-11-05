import type { RuleEffect, RuleStatus } from '@bf/contracts';

/** Plain-English labels for the rule vocabulary; the API never sends display text for these. */
export const EFFECT_LABELS: Record<RuleEffect, string> = {
  block: 'Block',
  freeze: 'Hold',
  require_approval: 'Needs approval',
  warn: 'Warn',
  auto_approve: 'Goes through',
};

export const EFFECT_HINTS: Record<RuleEffect, string> = {
  block: 'The request cannot go ahead.',
  freeze: 'The request waits until the budget is available again.',
  require_approval: 'The request goes to the approvers this rule names.',
  warn: 'The requester sees a warning and can continue.',
  auto_approve: 'The request goes through without an approval step.',
};

export const STATUS_LABELS: Record<RuleStatus, string> = {
  draft: 'Draft',
  scheduled: 'Starts later',
  active: 'Active',
  expired: 'Replaced',
  retired: 'Retired',
};

/** Maps a rule outcome onto the status-tag tones the rest of the product already uses. */
export const effectTone = (effect: RuleEffect): 'rejected' | 'pending' | 'approved' =>
  effect === 'block' || effect === 'freeze'
    ? 'rejected'
    : effect === 'auto_approve'
      ? 'approved'
      : 'pending';

/** Resolver keys and role ids both appear in approver fields, so one table covers them. */
export const APPROVER_LABELS: Record<string, string> = {
  budget_owner: 'Budget owner',
  parent_owner: 'Parent budget owner',
  finance_controller: 'Finance Controller',
  finance_review: 'Finance Controller',
  giving_director: 'Giving director',
  executive: 'CEO',
  ceo: 'CEO',
  tax_approver: 'Tax approver',
  'finance-admin': 'Finance administrator',
  'finance-controller': 'Finance Controller',
  'budget-owner': 'Budget owner',
  'department-head': 'Department head',
  'regional-manager': 'Regional manager',
  'location-manager': 'Location manager',
  'event-organizer': 'Event organizer',
  'org-admin': 'Organization administrator',
  'integration-admin': 'Integration administrator',
  'super-admin': 'Platform operator',
  employee: 'Employee',
  auditor: 'Auditor',
  analyst: 'Analyst',
};

export const approverLabel = (key: string): string =>
  APPROVER_LABELS[key] ?? key.replace(/[_-]/g, ' ');

/** Spend types and categories are stored as codes; `*` is the wildcard the DoA matrix uses. */
export const spendTypeLabel = (code: string): string => {
  if (code === '*') return 'Any spend type';
  return sentenceCase(code);
};

/** Turns a stored code such as `all_employees` into copy a reader expects. */
export const sentenceCase = (code: string): string => {
  const text = code.replace(/[_-]/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const codeList = (codes: readonly string[]): string =>
  codes.length ? codes.map(sentenceCase).join(', ') : 'Nobody';

export const approverList = (keys: readonly string[]): string =>
  keys.length ? keys.map(approverLabel).join(', ') : 'No extra approver';

/** The policy sections behind screens 071-076, in the order the tabs show them. */
export const POLICY_SECTIONS = [
  { key: 'limits', label: 'Spending limits' },
  { key: 'categories', label: 'What can be bought' },
  { key: 'gifts', label: 'Gifts, entertainment and alcohol' },
  { key: 'locations', label: 'Location settings' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'over-budget', label: 'Going over budget' },
  { key: 'freeze', label: 'Freeze, reduce and set to zero' },
  { key: 'sla', label: 'Response times and notifications' },
] as const;

export type PolicySectionKey = (typeof POLICY_SECTIONS)[number]['key'];
