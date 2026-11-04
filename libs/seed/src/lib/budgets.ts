import { BUDGETS, COST_CENTERS, LEGAL_ENTITIES, ORG_UNITS, seedId, TENANTS } from './ids';
import type { SeedUserId } from './roles';

/**
 * Phase 4 demo budgets (prefix 71), all USD. Built through the real commands with fixed idempotency
 * keys: a frozen and a zeroed budget, Hyderabad on the per-head driver, a central contingency reserve,
 * pending increase and release requests, limits and phasing, so every Phase 4 screen state has data.
 */
export const P4_BUDGETS = {
  newYork: seedId('71000000', 1),
  usRecognition: seedId('71000000', 2),
  berlin: seedId('71000000', 3),
  europeWellbeing: seedId('71000000', 4),
  contingency: seedId('71000000', 5),
} as const;

/** Fictional per-head program rate: USD 15.00 per eligible head. */
export const PER_HEAD_RATE_MINOR = 1_500;

/** Defaults for the Phase 1 program templates (codes seeded in Phase 1). */
export const TEMPLATE_DEFAULTS: Record<string, Record<string, unknown>> = {
  'PER-HEAD-ENGAGEMENT': {
    description: 'Team engagement funded per eligible head from the HR headcount import.',
    rateMinor: PER_HEAD_RATE_MINOR,
    eligibleTypes: ['employee', 'intern'],
    prorate: true,
    categoryCode: 'employee_events',
    alertThresholdsPct: [50, 80, 100],
  },
  FESTIVAL: {
    description: 'One-off festival celebrations per location.',
    categoryCode: 'employee_events',
    budgetType: 'event',
    alertThresholdsPct: [80, 100],
  },
  OFFSITE: {
    description: 'Team offsites with a fixed amount per team.',
    categoryCode: 'employee_events',
    budgetType: 'event',
  },
  WELLBEING: {
    description: 'Wellbeing sessions per eligible head.',
    rateMinor: 1_000,
    eligibleTypes: ['employee'],
    prorate: true,
    categoryCode: 'wellbeing',
  },
  RECOGNITION: {
    description: 'Recognition awards per eligible head.',
    rateMinor: 800,
    eligibleTypes: ['employee', 'intern'],
    prorate: false,
    categoryCode: 'recognition',
  },
};

type P4Step =
  | {
      kind: 'create';
      id: string;
      as: SeedUserId;
      parentId: string;
      name: string;
      code: string;
      legalEntityId: string;
      costCenterId?: string;
      orgUnitId?: string;
      owner: SeedUserId;
      categoryCode?: string;
      budgetType?: 'operating' | 'event' | 'contingency';
    }
  | { kind: 'allocate'; as: SeedUserId; parentId: string; childId: string; amountMinor: number }
  | {
      kind: 'transfer';
      as: SeedUserId;
      fromId: string;
      toId: string;
      amountMinor: number;
      reason: string;
    }
  | { kind: 'per_head'; as: SeedUserId; parentId: string; childId: string }
  | { kind: 'freeze'; as: SeedUserId; id: string; reasonCode: string; reason: string }
  | { kind: 'zero'; as: SeedUserId; id: string; code: string; reasonCode: string; reason: string }
  | { kind: 'increase'; as: SeedUserId; id: string; amountMinor: number; reason: string }
  | {
      kind: 'release';
      as: SeedUserId;
      reserveId: string;
      toId: string;
      amountMinor: number;
      reason: string;
    }
  | { kind: 'phase'; as: SeedUserId; id: string }
  | { kind: 'limits'; as: SeedUserId; id: string };

export const p4Steps: P4Step[] = [
  {
    kind: 'create',
    id: P4_BUDGETS.contingency,
    as: 'ceo',
    parentId: BUDGETS.employeeExperience,
    name: 'Central Contingency Reserve',
    code: 'EX-RESERVE',
    legalEntityId: LEGAL_ENTITIES.acmeUs,
    costCenterId: COST_CENTERS.hq,
    owner: 'finance-admin',
    budgetType: 'contingency',
  },
  {
    kind: 'transfer',
    as: 'ceo',
    fromId: BUDGETS.unitedStates,
    toId: P4_BUDGETS.contingency,
    amountMinor: 300_000,
    reason: 'Fund the central contingency reserve',
  },
  {
    kind: 'create',
    id: P4_BUDGETS.newYork,
    as: 'budget-owner',
    parentId: BUDGETS.unitedStates,
    name: 'New York Events',
    code: 'EX-US-NYC',
    legalEntityId: LEGAL_ENTITIES.acmeUs,
    costCenterId: COST_CENTERS.newYork,
    orgUnitId: ORG_UNITS.newYork,
    owner: 'budget-owner',
    categoryCode: 'employee_events',
  },
  {
    kind: 'allocate',
    as: 'budget-owner',
    parentId: BUDGETS.unitedStates,
    childId: P4_BUDGETS.newYork,
    amountMinor: 1_500_000,
  },
  {
    kind: 'create',
    id: P4_BUDGETS.usRecognition,
    as: 'budget-owner',
    parentId: BUDGETS.unitedStates,
    name: 'US Recognition',
    code: 'EX-US-REC',
    legalEntityId: LEGAL_ENTITIES.acmeUs,
    costCenterId: COST_CENTERS.newYork,
    orgUnitId: ORG_UNITS.newYork,
    owner: 'budget-owner',
    categoryCode: 'recognition',
  },
  {
    kind: 'allocate',
    as: 'budget-owner',
    parentId: BUDGETS.unitedStates,
    childId: P4_BUDGETS.usRecognition,
    amountMinor: 500_000,
  },
  {
    kind: 'freeze',
    as: 'budget-owner',
    id: P4_BUDGETS.usRecognition,
    reasonCode: 'FRZ-POLICY',
    reason: 'Recognition policy under review',
  },
  {
    kind: 'create',
    id: P4_BUDGETS.berlin,
    as: 'department-head',
    parentId: BUDGETS.europe,
    name: 'Berlin Events',
    code: 'EX-EU-BER',
    legalEntityId: LEGAL_ENTITIES.acmeEurope,
    costCenterId: COST_CENTERS.berlin,
    orgUnitId: ORG_UNITS.berlin,
    owner: 'department-head',
    categoryCode: 'employee_events',
  },
  {
    kind: 'allocate',
    as: 'department-head',
    parentId: BUDGETS.europe,
    childId: P4_BUDGETS.berlin,
    amountMinor: 800_000,
  },
  {
    kind: 'create',
    id: P4_BUDGETS.europeWellbeing,
    as: 'department-head',
    parentId: BUDGETS.europe,
    name: 'Europe Wellbeing',
    code: 'EX-EU-WELL',
    legalEntityId: LEGAL_ENTITIES.acmeEurope,
    costCenterId: COST_CENTERS.berlin,
    orgUnitId: ORG_UNITS.europe,
    owner: 'department-head',
    categoryCode: 'wellbeing',
  },
  {
    kind: 'allocate',
    as: 'department-head',
    parentId: BUDGETS.europe,
    childId: P4_BUDGETS.europeWellbeing,
    amountMinor: 400_000,
  },
  {
    kind: 'zero',
    as: 'department-head',
    id: P4_BUDGETS.europeWellbeing,
    code: 'EX-EU-WELL',
    reasonCode: 'RED-REPRIORITIZE',
    reason: 'Wellbeing moves to the global program',
  },
  { kind: 'per_head', as: 'regional-manager', parentId: BUDGETS.india, childId: BUDGETS.hyderabad },
  {
    kind: 'increase',
    as: 'location-manager',
    id: BUDGETS.bengaluru,
    amountMinor: 200_000,
    reason: 'Diwali celebration for the whole office',
  },
  {
    kind: 'release',
    as: 'finance-admin',
    reserveId: P4_BUDGETS.contingency,
    toId: BUDGETS.europe,
    amountMinor: 150_000,
    reason: 'Unplanned team offsite after a reorganization',
  },
  { kind: 'phase', as: 'regional-manager', id: BUDGETS.india },
  { kind: 'limits', as: 'regional-manager', id: BUDGETS.bengaluru },
];

/** Bengaluru limits: per-person cap by location, a soft per-event cap and a category cap. */
export const BENGALURU_LIMITS = [
  {
    kind: 'per_person' as const,
    categoryCode: null,
    orgUnitId: ORG_UNITS.bengaluru,
    amountMinor: 2_500,
    mode: 'hard' as const,
  },
  {
    kind: 'per_event' as const,
    categoryCode: null,
    orgUnitId: null,
    amountMinor: 500_000,
    mode: 'soft' as const,
  },
  {
    kind: 'category' as const,
    categoryCode: 'employee_events',
    orgUnitId: null,
    amountMinor: 1_000_000,
    mode: 'hard' as const,
  },
];

export const P4_TENANT = TENANTS.acme;
