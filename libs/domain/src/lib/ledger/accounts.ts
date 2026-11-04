/**
 * Ledger accounts. Budget buckets belong to one budget; counter accounts are tenant-level
 * counterparts that let every journal balance (debits = credits in transaction and reporting currency).
 *
 * Amounts on lines are signed: debit positive, credit negative. A bucket's balance in its natural
 * sign is `normalSign × Σ amounts`.
 */
export const BUDGET_BUCKETS = [
  'authorized',
  'allocated_out',
  'held',
  'pre_encumbered',
  'encumbered',
  'actual',
  'accrued',
] as const;
export type BudgetBucket = (typeof BUDGET_BUCKETS)[number];

export const COUNTER_ACCOUNTS = [
  'plan_funding',
  'savings',
  'obligations',
  'earmark_reserve',
  'fx_variance',
  'intercompany_due_from',
  'intercompany_due_to',
] as const;
export type CounterAccount = (typeof COUNTER_ACCOUNTS)[number];

export type LedgerAccount = BudgetBucket | CounterAccount;
export const LEDGER_ACCOUNTS: readonly LedgerAccount[] = [...BUDGET_BUCKETS, ...COUNTER_ACCOUNTS];

export function isBudgetBucket(a: string): a is BudgetBucket {
  return (BUDGET_BUCKETS as readonly string[]).includes(a);
}

/** +1 debit-normal, −1 credit-normal. */
export const NORMAL_SIGN: Record<LedgerAccount, 1 | -1> = {
  authorized: -1,
  allocated_out: 1,
  held: 1,
  pre_encumbered: 1,
  encumbered: 1,
  actual: 1,
  accrued: 1,
  plan_funding: 1,
  savings: -1,
  obligations: -1,
  earmark_reserve: -1,
  fx_variance: 1,
  intercompany_due_from: 1,
  intercompany_due_to: -1,
};

/** Buckets that consume a budget's available amount; the control basis picks a subset. Accrued never consumes. */
export const CONSUMING_BUCKETS = [
  'allocated_out',
  'held',
  'pre_encumbered',
  'encumbered',
  'actual',
] as const satisfies readonly BudgetBucket[];
export type ConsumingBucket = (typeof CONSUMING_BUCKETS)[number];
