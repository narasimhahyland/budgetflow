import { BUDGETS, ORG_UNITS, seedId } from './ids';
import { P4_BUDGETS } from './budgets';

/**
 * Phase 15 fixtures (id prefix 92): a what-if scenario waiting to be promoted, two wallet programmes
 * with a claim mid-review, the recognition award types a location offers with a manager allowance,
 * and two thank-you notes for an organizer. All fictional.
 *
 * Every date here is relative to the moment the seed runs (`daysAgo`, `quarterKey`), because a
 * hard-coded future timestamp drifts out of its window as real time passes and quietly breaks the
 * screens that filter on "this quarter" or "the last 30 days". The seed passes the API's clock as
 * `now` (`nowUtc` from `@bf/api/core`), so under a pinned clock these line up with what the API and
 * the scenarios treat as today; the defaults stay `new Date()` for callers that have no clock.
 */
export const P15_IDS = {
  scenarioEuropeToIndia: seedId('92000000', 1),
  scenarioChangeReduceEurope: seedId('92000000', 2),
  scenarioChangeFreezeBerlin: seedId('92000000', 3),
  walletProgramWellbeing: seedId('92000000', 4),
  walletProgramLearning: seedId('92000000', 5),
  awardTypeThankYou: seedId('92000000', 6),
  awardTypeSpot: seedId('92000000', 7),
  awardTypePeer: seedId('92000000', 8),
  awardTypePausedRecognition: seedId('92000000', 9),
  allowanceBengaluruQuarter: seedId('92000000', 10),
  thankNoteDiwali: seedId('92000000', 11),
  thankNoteOffsite: seedId('92000000', 12),
} as const;

/** A date `n` days before today, as `YYYY-MM-DD`. */
export const daysAgo = (n: number, now = new Date()): string =>
  new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);

/** A timestamp `n` days before now. */
export const momentsAgo = (n: number, now = new Date()): Date =>
  new Date(now.getTime() - n * 86_400_000);

/** The current quarter as the recognition allowance names it, e.g. `FY2026-Q4`. */
export const quarterKey = (now = new Date()): string =>
  `FY${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;

export interface SeedWalletProgram {
  id: string;
  key: string;
  name: string;
  kind: 'wellbeing' | 'learning';
  fundingBudgetId: string;
  yearlyAllowanceMinor: number;
  categories: string[];
  taxable: boolean;
  carryUnused: boolean;
  /** Seed user id of the People Ops reviewer for the programme. */
  reviewerUserId: string;
}

/**
 * Two programmes funded from real, active budgets, so a claim actually pre-encumbers something. The
 * allowance is a per-person cap; the budget behind it is what really limits the programme.
 */
export const P15_WALLET_PROGRAMS: readonly SeedWalletProgram[] = [
  {
    id: P15_IDS.walletProgramWellbeing,
    key: 'feel_good',
    name: 'Feel Good wellbeing',
    kind: 'wellbeing',
    fundingBudgetId: BUDGETS.bengaluru,
    yearlyAllowanceMinor: 30_000,
    categories: ['Gym and fitness', 'Mental health apps', 'Wellbeing classes'],
    taxable: false,
    carryUnused: false,
    reviewerUserId: 'location-manager',
  },
  {
    id: P15_IDS.walletProgramLearning,
    key: 'learning',
    name: 'Learning',
    kind: 'learning',
    fundingBudgetId: BUDGETS.hyderabad,
    yearlyAllowanceMinor: 100_000,
    categories: ['Courses', 'Books', 'Conference tickets'],
    taxable: true,
    carryUnused: true,
    reviewerUserId: 'regional-manager',
  },
];

export interface SeedAwardType {
  id: string;
  kind: 'thank_you' | 'spot' | 'peer' | 'team';
  name: string;
  locationOrgUnitId: string | null;
  amountMinor: number | null;
  needsApproval: boolean;
  fundingBudgetId: string | null;
  active: boolean;
}

/**
 * What Bengaluru offers. The thank-you note has no amount and no budget, which is why it keeps
 * working when a Recognition budget is frozen; the paused US type demonstrates exactly that state.
 */
export const P15_AWARD_TYPES: readonly SeedAwardType[] = [
  {
    id: P15_IDS.awardTypeThankYou,
    kind: 'thank_you',
    name: 'Thank-you note',
    locationOrgUnitId: null,
    amountMinor: null,
    needsApproval: false,
    fundingBudgetId: null,
    active: true,
  },
  {
    id: P15_IDS.awardTypeSpot,
    kind: 'spot',
    name: 'Spot award',
    locationOrgUnitId: ORG_UNITS.bengaluru,
    amountMinor: 5_000,
    needsApproval: false,
    fundingBudgetId: BUDGETS.bengaluru,
    active: true,
  },
  {
    id: P15_IDS.awardTypePeer,
    kind: 'peer',
    name: 'Peer award',
    locationOrgUnitId: ORG_UNITS.bengaluru,
    amountMinor: 2_500,
    needsApproval: true,
    fundingBudgetId: BUDGETS.bengaluru,
    active: true,
  },
  {
    id: P15_IDS.awardTypePausedRecognition,
    kind: 'spot',
    name: 'Spot award (United States)',
    locationOrgUnitId: ORG_UNITS.newYork,
    amountMinor: 5_000,
    needsApproval: false,
    // US Recognition is frozen in the Phase 4 seed, so this type shows the frozen-funding state.
    fundingBudgetId: P4_BUDGETS.usRecognition,
    active: true,
  },
];

/** The manager allowance Bengaluru's location manager has for the current quarter. */
export const P15_ALLOWANCE = {
  id: P15_IDS.allowanceBengaluruQuarter,
  managerUserId: 'location-manager',
  fundingBudgetId: BUDGETS.bengaluru,
  grantedMinor: 50_000,
  reason: 'Quarterly recognition allowance for the Bengaluru office',
} as const;

/**
 * A scenario leadership is still thinking about: cut Europe by 20% and move it to India, and freeze
 * Berlin while the decision is made. It is a draft, so nothing in it has moved any money.
 */
export const P15_SCENARIO = {
  id: P15_IDS.scenarioEuropeToIndia,
  name: 'Europe -20% to fund India festivals',
  note: 'Modelling a mid-year reallocation before the November leadership review.',
  authorUserId: 'finance-admin',
  collaboratorUserIds: ['ceo', 'finance-controller'],
  changes: [
    {
      id: P15_IDS.scenarioChangeReduceEurope,
      kind: 'reduce' as const,
      budgetId: BUDGETS.europe,
      percentBps: 2_000,
      destination: 'reallocation' as const,
      destinationBudgetId: BUDGETS.india,
      position: 0,
    },
    {
      id: P15_IDS.scenarioChangeFreezeBerlin,
      kind: 'freeze' as const,
      budgetId: P4_BUDGETS.berlin,
      position: 1,
    },
  ],
} as const;

/** Thank-you notes on the organizer's profile. No money is attached to a note. */
export const P15_THANK_NOTES: readonly {
  id: string;
  organizerUserId: string;
  authorUserId: string;
  note: string;
  daysAgo: number;
}[] = [
  {
    id: P15_IDS.thankNoteDiwali,
    organizerUserId: 'event-organizer',
    authorUserId: 'employee',
    note: 'Thank you for the Diwali celebration, my family loved it.',
    daysAgo: 12,
  },
  {
    id: P15_IDS.thankNoteOffsite,
    organizerUserId: 'event-organizer',
    authorUserId: 'budget-owner',
    note: 'Ran a smooth offsite on a tight budget.',
    daysAgo: 4,
  },
];
