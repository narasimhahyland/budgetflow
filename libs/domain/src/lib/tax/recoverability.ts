import { defineMachine } from '../state-machine';
import { divRoundHalfEven } from '../money/rate';
import { err, ok, type Result } from '../result';

/**
 * Tax-aware consumption (screen 080g). Tax the legal entity can recover (input GST or VAT) never uses
 * budget; tax it cannot recover does. Rules by legal entity, spend category and attendee type say
 * which share of a tax amount is recoverable. Pure: the API loads the rules in force on the
 * accounting date and posts only the net amount plus the non-recoverable tax to the budget buckets.
 */

export const ATTENDEE_TYPES = ['employees', 'clients', 'mixed', 'any'] as const;
export type AttendeeType = (typeof ATTENDEE_TYPES)[number];

/** Category wildcard: the rule applies to every spend category of the entity. */
export const ANY_CATEGORY = '*';

export const FULL_SHARE_BPS = 10_000;

export interface TaxRule {
  id: string;
  legalEntityId: string;
  /** Spend category (request spend type) or `*`. */
  categoryCode: string;
  attendeeType: AttendeeType;
  taxCode: string;
  /** Recoverable share in basis points (0-10000); null when proportional to employees present. */
  recoverableBps: number | null;
  proportional: boolean;
}

export interface Attendance {
  employees: number;
  others: number;
}

/**
 * Employees only, clients only or a mix, from who attended. Unknown attendance reads as `any`: only
 * rules for any attendees apply to it, so a rule that depends on who was there (staff entertainment
 * recoverable, client entertainment not) never gives tax back on spend whose attendance is unknown.
 */
export function attendeeTypeOf(a: Attendance | null | undefined): AttendeeType {
  if (!a || a.employees + a.others === 0) return 'any';
  if (a.others > 0 && a.employees > 0) return 'mixed';
  if (a.others > 0) return 'clients';
  return 'employees';
}

export interface TaxRuleQuery {
  legalEntityId: string;
  categoryCode: string;
  /** `any` when attendance is unknown: then only rules for any attendees match. */
  attendeeType: AttendeeType;
}

/**
 * The rule that applies: the entity's rule for the exact category beats the `*` category, and the
 * exact attendee type beats `any`. Category specificity wins over attendee specificity. Null when
 * no rule covers the spend (the caller then treats the whole tax as non-recoverable).
 */
export function selectTaxRule(rules: readonly TaxRule[], q: TaxRuleQuery): TaxRule | null {
  const score = (r: TaxRule): number => {
    if (r.legalEntityId !== q.legalEntityId) return -1;
    const cat = r.categoryCode === q.categoryCode ? 2 : r.categoryCode === ANY_CATEGORY ? 0 : -1;
    const att = r.attendeeType === q.attendeeType ? 1 : r.attendeeType === 'any' ? 0 : -1;
    if (cat < 0 || att < 0) return -1;
    return cat * 2 + att;
  };
  let best: TaxRule | null = null;
  let bestScore = -1;
  for (const r of [...rules].sort((a, b) => a.id.localeCompare(b.id))) {
    const s = score(r);
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  return best;
}

/** The recoverable share a rule gives for an attendance, in basis points. */
export function recoverableShareBps(rule: TaxRule | null, attendance: Attendance | null): number {
  if (!rule) return 0;
  if (rule.proportional) {
    const employees = attendance?.employees ?? 0;
    const total = employees + (attendance?.others ?? 0);
    // Nobody recorded: nothing shows the spend was for staff, so none of the tax is recovered.
    if (total === 0) return 0;
    return Number(divRoundHalfEven(BigInt(employees) * BigInt(FULL_SHARE_BPS), BigInt(total)));
  }
  return rule.recoverableBps ?? 0;
}

export interface TaxSplit {
  taxCode: string;
  ruleId: string | null;
  shareBps: number;
  netMinor: number;
  taxMinor: number;
  recoverableMinor: number;
  nonRecoverableMinor: number;
  /** What the budget uses: the net amount plus the tax that cannot be recovered. */
  consumptionMinor: number;
  /** The tax rate implied by the amounts, in basis points of the net amount. */
  rateBps: number;
}

/**
 * Splits a tax amount into its recoverable and non-recoverable parts. The recoverable part is the
 * tax times the share, rounded half-even once; the non-recoverable part is the rest, so the two
 * always sum to the tax exactly. Amounts may be negative (refunds, credit notes): signs follow the tax.
 */
export function splitTax(input: {
  netMinor: number;
  taxMinor: number;
  rule: TaxRule | null;
  attendance?: Attendance | null;
}): Result<TaxSplit> {
  const { netMinor, taxMinor } = input;
  if (!Number.isSafeInteger(netMinor) || !Number.isSafeInteger(taxMinor))
    return err('AMOUNT_NOT_SAFE_INTEGER', 'Amounts must be whole minor units.');
  if (taxMinor !== 0 && netMinor !== 0 && Math.sign(taxMinor) !== Math.sign(netMinor))
    return err('VALIDATION_FAILED', 'The tax has the same sign as the amount.', {
      field: 'tax',
    });
  const shareBps = recoverableShareBps(input.rule, input.attendance ?? null);
  if (!Number.isInteger(shareBps) || shareBps < 0 || shareBps > FULL_SHARE_BPS)
    return err('VALIDATION_FAILED', 'Recoverable share must be 0-100%.', { field: 'share' });
  const recoverableMinor = Number(
    divRoundHalfEven(BigInt(taxMinor) * BigInt(shareBps), BigInt(FULL_SHARE_BPS)),
  );
  const nonRecoverableMinor = taxMinor - recoverableMinor;
  const rateBps =
    netMinor === 0
      ? 0
      : Number(divRoundHalfEven(BigInt(Math.abs(taxMinor)) * 10_000n, BigInt(Math.abs(netMinor))));
  return ok({
    taxCode: input.rule?.taxCode ?? 'NONE',
    ruleId: input.rule?.id ?? null,
    shareBps,
    netMinor,
    taxMinor,
    recoverableMinor,
    nonRecoverableMinor,
    consumptionMinor: netMinor + nonRecoverableMinor,
    rateBps,
  });
}

/**
 * The same split from a gross amount (card and ERP lines carry the amount including tax): the net
 * is the gross less the tax, and the budget uses the gross less the recoverable tax.
 */
export function splitGross(input: {
  grossMinor: number;
  taxMinor: number;
  rule: TaxRule | null;
  attendance?: Attendance | null;
}): Result<TaxSplit> {
  if (Math.abs(input.taxMinor) > Math.abs(input.grossMinor))
    return err('VALIDATION_FAILED', 'The tax cannot be more than the amount.', { field: 'tax' });
  return splitTax({
    netMinor: input.grossMinor - input.taxMinor,
    taxMinor: input.taxMinor,
    rule: input.rule,
    attendance: input.attendance,
  });
}

/**
 * The consumption for part of a taxed amount (partial approval, counter-offer): the net part plus
 * the same proportion of the non-recoverable tax, half-even; the whole net gives the whole consumption.
 */
export function consumptionForNet(split: TaxSplit, netPartMinor: number): number {
  if (netPartMinor === split.netMinor) return split.consumptionMinor;
  if (split.netMinor === 0) return netPartMinor;
  return (
    netPartMinor +
    Number(
      divRoundHalfEven(
        BigInt(split.nonRecoverableMinor) * BigInt(netPartMinor),
        BigInt(split.netMinor),
      ),
    )
  );
}

/**
 * The split for part of the net (a partial approval or counter-offer): tax, recoverable and
 * non-recoverable parts scale with the net, half-even, so consumption equals `consumptionForNet`.
 */
export function scaleSplit(split: TaxSplit, netPartMinor: number): TaxSplit {
  if (netPartMinor === split.netMinor) return split;
  const scale = (v: number) =>
    split.netMinor === 0
      ? 0
      : Number(divRoundHalfEven(BigInt(v) * BigInt(netPartMinor), BigInt(split.netMinor)));
  const nonRecoverableMinor = scale(split.nonRecoverableMinor);
  const recoverableMinor = scale(split.recoverableMinor);
  return {
    ...split,
    netMinor: netPartMinor,
    taxMinor: recoverableMinor + nonRecoverableMinor,
    recoverableMinor,
    nonRecoverableMinor,
    consumptionMinor: netPartMinor + nonRecoverableMinor,
  };
}

/** A refund or reversal of part of a taxed line takes the same share of its recoverable tax. */
export function recoverableForPart(
  original: { grossMinor: number; recoverableMinor: number },
  partGrossMinor: number,
): number {
  if (original.grossMinor === 0) return 0;
  if (Math.abs(partGrossMinor) === Math.abs(original.grossMinor))
    return Math.sign(partGrossMinor) * Math.sign(original.grossMinor) * original.recoverableMinor;
  return Number(
    divRoundHalfEven(
      BigInt(original.recoverableMinor) * BigInt(partGrossMinor),
      BigInt(original.grossMinor),
    ),
  );
}

// Rule sets ---------------------------------------------------------------------------------------

export const TAX_RULE_SET_STATUSES = [
  'draft',
  'pending_approval',
  'returned',
  'published',
  'superseded',
] as const;
export type TaxRuleSetStatus = (typeof TAX_RULE_SET_STATUSES)[number];

/**
 * Draft → submitted to the tax approver → published (effective from a date) or returned with
 * comments (editable again). A published version is immutable; a later published version supersedes it.
 */
export const taxRuleSetMachine = defineMachine<
  TaxRuleSetStatus,
  'submit' | 'publish' | 'return' | 'supersede'
>({
  name: 'tax rule set',
  transitions: [
    { from: ['draft', 'returned'], event: 'submit', to: 'pending_approval' },
    { from: 'pending_approval', event: 'publish', to: 'published' },
    { from: 'pending_approval', event: 'return', to: 'returned' },
    { from: 'published', event: 'supersede', to: 'superseded' },
  ],
});

export type DraftTaxRule = Omit<TaxRule, 'id'> & { id?: string };

/**
 * Validates a draft rule set: shares 0-100% (or proportional), and no two rules covering the same
 * entity, category and attendee type. Messages name the entity code and category for the screen.
 */
export function validateTaxRules(
  rules: readonly DraftTaxRule[],
  labels: { entityCode(id: string): string; categoryName(code: string): string },
): Result<true> {
  const seen = new Map<string, number>();
  for (const [i, r] of rules.entries()) {
    if (!r.proportional) {
      if (
        r.recoverableBps === null ||
        !Number.isInteger(r.recoverableBps) ||
        r.recoverableBps < 0 ||
        r.recoverableBps > FULL_SHARE_BPS
      )
        return err('VALIDATION_FAILED', 'Recoverable share must be 0-100%.', {
          field: `rules.${i}.recoverableBps`,
        });
    } else if (r.recoverableBps !== null) {
      return err(
        'VALIDATION_FAILED',
        'A proportional rule takes its share from the employees present, not a fixed share.',
        { field: `rules.${i}.recoverableBps` },
      );
    }
    if (!r.taxCode.trim())
      return err('VALIDATION_FAILED', 'Each rule needs a tax code.', {
        field: `rules.${i}.taxCode`,
      });
    const key = `${r.legalEntityId}|${r.categoryCode}|${r.attendeeType}`;
    if (seen.has(key)) {
      const who = r.attendeeType === 'any' ? 'any attendees' : r.attendeeType;
      const cat =
        r.categoryCode === ANY_CATEGORY ? 'all categories' : labels.categoryName(r.categoryCode);
      return err(
        'VALIDATION_FAILED',
        `Two rules cover ${labels.entityCode(r.legalEntityId)}, ${cat}, ${who}.`,
        { field: `rules.${i}`, other: seen.get(key)! },
      );
    }
    seen.set(key, i);
  }
  return ok(true);
}

/** Plain-English effect of a rule on the budget, as the rules table shows it. */
export function budgetEffectOf(
  rule: Pick<TaxRule, 'recoverableBps' | 'proportional' | 'taxCode'>,
): string {
  const code = rule.taxCode.toUpperCase();
  const tax = code.startsWith('GST')
    ? 'GST'
    : code.startsWith('VAT')
      ? 'VAT'
      : code.startsWith('SALES')
        ? 'sales tax'
        : 'tax';
  if (rule.proportional) return `Budget uses the ${tax} on the share of non-employees`;
  if ((rule.recoverableBps ?? 0) >= FULL_SHARE_BPS) return `Budget uses amount without ${tax}`;
  if ((rule.recoverableBps ?? 0) <= 0) return `Budget uses amount plus ${tax}`;
  return `Budget uses amount plus the non-recoverable ${tax}`;
}
