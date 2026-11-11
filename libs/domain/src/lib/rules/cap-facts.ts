import { splitEvenly } from '../money/split';

/**
 * Per-employee annual benefit cap and annual gift cap facts (gap A2). Pure: the API reads each live
 * request's consumption from the ledger (pre-encumbered + encumbered + actual, in the reporting
 * currency at the locked plan rate) and the cap settings from policy, and this module turns them into
 * the facts the rules evaluator reads. Rules decide; nothing here blocks or warns on its own.
 */

/** One request's live consumption and who benefits from it. */
export interface BenefitSpend {
  requestId: string;
  /** Employees who receive the benefit, as recorded on the request. */
  recipientIds: readonly string[];
  /** People outside the company who share it (clients, guests); their shares count for nobody. */
  nonEmployeeCount: number;
  /** Live consumption in the reporting currency, minor units. */
  reportingMinor: number;
}

export interface EmployeeCapPolicy {
  annualCapMinor: number;
  includedCategories: readonly string[];
  warnAtPct: number;
  blockAtPct: number;
}

export interface GiftCapPolicy {
  annualCapMinor: number;
  /** The spend type gifts are requested under. */
  giftSpendType: string;
}

/**
 * Each employee's share of each spend, split evenly with the largest-remainder method so the shares of
 * one request sum exactly to it. Recipients are ordered by id and come before the non-employee shares,
 * so a leftover minor unit always lands on an employee (never under-counting a cap).
 */
export function benefitByPerson(spends: readonly BenefitSpend[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const s of spends) {
    const recipients = [...new Set(s.recipientIds)].sort();
    if (!recipients.length || s.reportingMinor === 0) continue;
    const parts = recipients.length + Math.max(0, s.nonEmployeeCount);
    const split = splitEvenly(s.reportingMinor, parts);
    if (!split.ok) continue;
    recipients.forEach((p, i) => totals.set(p, (totals.get(p) ?? 0) + split.value[i]));
  }
  return totals;
}

/** The point at which the cap blocks: the annual cap scaled by the block percentage. */
export function capBlockLimit(policy: Pick<EmployeeCapPolicy, 'annualCapMinor' | 'blockAtPct'>) {
  return Math.floor((policy.annualCapMinor * policy.blockAtPct) / 100);
}

export interface CapFactsInput {
  spendType: string;
  /** Recipients named on the request being decided. */
  recipientIds: readonly string[];
  nonEmployeeCount: number;
  /** The request being decided, in the reporting currency. */
  amountReportingMinor: number;
  alcoholReportingMinor: number;
  /** Live employee-benefit spends this fiscal year (included categories), including this request. */
  benefitSpends: readonly BenefitSpend[];
  /** Live gift spends this fiscal year, including this request. */
  giftSpends: readonly BenefitSpend[];
  /** The requester's live consumption over the recent window, including this request. */
  requesterRecentTotalMinor: number;
  intercompany: boolean;
  employeeCap: EmployeeCapPolicy;
  giftCap: GiftCapPolicy;
}

export interface CapFacts {
  employee_ytd_benefit_minor: number;
  employee_cap_remaining_minor: number;
  employee_cap_used_pct: number;
  gift_value_minor: number;
  gift_ytd_minor: number;
  gift_annual_cap_remaining_minor: number;
  alcohol_amount_minor: number;
  non_employee_count: number;
  is_intercompany: boolean;
  requester_recent_total_minor: number;
  /** The recipient nearest their cap (the one the facts describe), or null when none applies. */
  capPersonId: string | null;
  giftPersonId: string | null;
}

/** The recipient with the highest total, ties broken by id so the outcome is deterministic. */
function highest(totals: Map<string, number>, ids: readonly string[]) {
  let best: { id: string; minor: number } | null = null;
  for (const id of [...new Set(ids)].sort()) {
    const minor = totals.get(id) ?? 0;
    if (!best || minor > best.minor) best = { id, minor };
  }
  return best;
}

/** Facts that make no cap apply, for requests outside the cap categories and for simulation defaults. */
export function neutralCapFacts(
  employeeCap: Pick<EmployeeCapPolicy, 'annualCapMinor' | 'blockAtPct'> | null = null,
  giftCapMinor: number | null = null,
): CapFacts {
  return {
    employee_ytd_benefit_minor: 0,
    employee_cap_remaining_minor: employeeCap
      ? capBlockLimit(employeeCap)
      : Number.MAX_SAFE_INTEGER,
    employee_cap_used_pct: 0,
    gift_value_minor: 0,
    gift_ytd_minor: 0,
    gift_annual_cap_remaining_minor: giftCapMinor ?? Number.MAX_SAFE_INTEGER,
    alcohol_amount_minor: 0,
    non_employee_count: 0,
    is_intercompany: false,
    requester_recent_total_minor: 0,
    capPersonId: null,
    giftPersonId: null,
  };
}

/**
 * Builds the cap facts for one request. The employee figures describe the request's recipient with
 * the highest year-to-date benefit (this request included); remaining is the block limit minus that,
 * so exactly at the cap leaves 0 and one minor unit above leaves -1. Requests outside the cap
 * categories, or naming no recipient, carry neutral employee figures.
 */
export function capFacts(input: CapFactsInput): CapFacts {
  const facts = neutralCapFacts(input.employeeCap, input.giftCap.annualCapMinor);
  facts.alcohol_amount_minor = Math.max(0, input.alcoholReportingMinor);
  facts.non_employee_count = Math.max(0, input.nonEmployeeCount);
  facts.is_intercompany = input.intercompany;
  facts.requester_recent_total_minor = input.requesterRecentTotalMinor;

  const included = input.employeeCap.includedCategories.some(
    (c) => c.toLowerCase() === input.spendType.toLowerCase(),
  );
  if (included && input.recipientIds.length) {
    const top = highest(benefitByPerson(input.benefitSpends), input.recipientIds);
    if (top) {
      facts.capPersonId = top.id;
      facts.employee_ytd_benefit_minor = top.minor;
      facts.employee_cap_remaining_minor = capBlockLimit(input.employeeCap) - top.minor;
      facts.employee_cap_used_pct =
        input.employeeCap.annualCapMinor > 0
          ? Math.floor((top.minor * 100) / input.employeeCap.annualCapMinor)
          : 0;
    }
  }

  if (input.spendType.toLowerCase() === input.giftCap.giftSpendType.toLowerCase()) {
    const parts = input.recipientIds.length + facts.non_employee_count;
    if (parts > 0) {
      const split = splitEvenly(input.amountReportingMinor, parts);
      facts.gift_value_minor = split.ok ? split.value[0] : 0;
    }
    if (input.recipientIds.length) {
      const top = highest(benefitByPerson(input.giftSpends), input.recipientIds);
      if (top) {
        facts.giftPersonId = top.id;
        facts.gift_ytd_minor = top.minor;
        facts.gift_annual_cap_remaining_minor = input.giftCap.annualCapMinor - top.minor;
      }
    }
  }
  return facts;
}

/** The cap facts as the evaluator reads them (without the person ids, which are for display). */
export function capRuleFacts(c: CapFacts): Omit<CapFacts, 'capPersonId' | 'giftPersonId'> {
  const { capPersonId: _person, giftPersonId: _gift, ...facts } = c;
  return facts;
}
