import { LEGAL_ENTITIES, seedId } from './ids';
import { HYLAND_ENTITIES } from './org';

/**
 * Gap B3 seed (decision D3): fictional tax recoverability rules and benefit-in-kind thresholds.
 * They are placeholders for the tax approver to review, not tax advice; finance enters real rates.
 */
export const TAX_SEED = {
  ruleSetId: seedId('94000000', 1),
  effectiveFrom: '2026-01-01',
} as const;

type SeedRule = [
  entity: string,
  category: string,
  attendee: 'employees' | 'clients' | 'mixed' | 'any',
  taxCode: string,
  recoverableBps: number | null,
  proportional: boolean,
];

/** Recoverable share per entity, spend category and attendee type. */
export const TAX_SEED_RULES: SeedRule[] = [
  // India GST: staff food and gifts are blocked credits whoever attends; training and conferences
  // recover in full.
  [HYLAND_ENTITIES.india, 'employee_events', 'any', 'GST-18', 0, false],
  [HYLAND_ENTITIES.india, 'team_lunch', 'any', 'GST-18', 0, false],
  [HYLAND_ENTITIES.india, 'recognition', 'any', 'GST-18', 0, false],
  [HYLAND_ENTITIES.india, 'training', 'any', 'GST-18', 10000, false],
  [HYLAND_ENTITIES.india, 'conferences', 'any', 'GST-18', 10000, false],
  // UK VAT: staff entertainment recovers, client entertainment does not, mixed in proportion.
  [HYLAND_ENTITIES.uk, 'employee_events', 'employees', 'VAT-20', 10000, false],
  [HYLAND_ENTITIES.uk, 'employee_events', 'clients', 'VAT-20', 0, false],
  [HYLAND_ENTITIES.uk, 'employee_events', 'mixed', 'VAT-20', null, true],
  [HYLAND_ENTITIES.uk, 'team_lunch', 'employees', 'VAT-20', 10000, false],
  [HYLAND_ENTITIES.uk, 'team_lunch', 'mixed', 'VAT-20', null, true],
  [HYLAND_ENTITIES.uk, 'training', 'any', 'VAT-20', 10000, false],
  // Germany VAT: staff events and training recover.
  [HYLAND_ENTITIES.germany, 'employee_events', 'employees', 'VAT-19', 10000, false],
  [HYLAND_ENTITIES.germany, 'training', 'any', 'VAT-19', 10000, false],
  // US sales tax is never recoverable.
  [HYLAND_ENTITIES.us, '*', 'any', 'SALES-TAX', 0, false],
];

export const taxSeedRuleId = (i: number) => seedId('94000000', 100 + i);

export const BENEFIT_THRESHOLD_SEED = [
  {
    id: seedId('95000000', 1),
    code: 'UK-ANNUAL-FUNCTIONS',
    name: 'UK annual staff functions',
    jurisdiction: 'GB',
    legalEntityIds: [HYLAND_ENTITIES.uk],
    benefitTypes: ['employee_events'],
    limitMinor: 15000,
    currency: 'GBP',
    basis: 'per_year' as const,
    maxOccasions: null,
    periodStartMonth: 4,
    periodStartDay: 6,
    exceeded: 'whole' as const,
  },
  {
    id: seedId('95000000', 2),
    code: 'DE-COMPANY-EVENTS',
    name: 'Germany company events',
    jurisdiction: 'DE',
    legalEntityIds: [] as string[],
    benefitTypes: ['employee_events'],
    limitMinor: 11000,
    currency: 'EUR',
    basis: 'per_event' as const,
    maxOccasions: 2,
    periodStartMonth: 1,
    periodStartDay: 1,
    exceeded: 'excess' as const,
  },
  {
    id: seedId('95000000', 3),
    code: 'HYL-ANNUAL-CAP',
    name: 'Per-employee annual cap (FY2026)',
    jurisdiction: 'GROUP',
    legalEntityIds: [
      LEGAL_ENTITIES.acmeUs,
      LEGAL_ENTITIES.acmeIndia,
      LEGAL_ENTITIES.acmeEurope,
      HYLAND_ENTITIES.uk,
    ],
    benefitTypes: ['team_lunch', 'recognition'],
    limitMinor: 30000,
    currency: 'USD',
    basis: 'per_year' as const,
    maxOccasions: null,
    periodStartMonth: 1,
    periodStartDay: 1,
    exceeded: 'not_reportable' as const,
  },
];

const P = (n: number) => seedId('40000000', 100 + n);

/** Fictional benefits recorded by finance (through the real command), dated inside FY2026. */
export const BENEFIT_ENTRY_SEED = [
  {
    key: 'b3-1',
    personId: P(50),
    entryDate: '2026-07-10',
    benefitType: 'employee_events',
    amountMinor: 14250,
    currency: 'GBP',
    description: 'London summer social (share per attendee)',
  },
  {
    key: 'b3-2',
    personId: P(51),
    entryDate: '2026-07-10',
    benefitType: 'employee_events',
    amountMinor: 9800,
    currency: 'GBP',
    description: 'London summer social (share per attendee)',
  },
  {
    key: 'b3-3',
    personId: P(51),
    entryDate: '2026-10-02',
    benefitType: 'employee_events',
    amountMinor: 7000,
    currency: 'GBP',
    description: 'London quarter-end dinner (share per attendee)',
  },
  {
    key: 'b3-4',
    personId: P(16),
    entryDate: '2026-08-14',
    benefitType: 'team_lunch',
    amountMinor: 1770000,
    currency: 'INR',
    description: 'Bengaluru team lunch (share per attendee)',
  },
  {
    key: 'b3-5',
    personId: P(27),
    entryDate: '2026-09-18',
    benefitType: 'recognition',
    amountMinor: 28800,
    currency: 'USD',
    description: 'Westlake service award',
  },
] as const;
