import { BUDGETS, ORG_UNITS, seedId, TENANTS } from './ids';
import { HYLAND_ENTITIES } from './org';
import { userById } from './roles';

/**
 * Phase 5 seed (prefixes 72-73): intercompany policies for entity pairs, one cross-location event
 * with own funds, an approved partial and a pending Inter-Director Budget Contribution Request, a
 * commitment, requests in every state for the organizer, and a delegation. Fictional throughout.
 * Amounts are given in USD and INR; the runner uses the home budget's currency.
 */
const person = (n: number) => seedId('40000000', 100 + n);

export const P5_IDS = {
  policies: { ukToIndiaBlock: seedId('72000000', 1), germanyToIndiaMarkup: seedId('72000000', 2) },
  event: seedId('73000000', 1),
  requests: {
    teamLunch: seedId('73000000', 10),
    snacks: seedId('73000000', 11),
    photoBooth: seedId('73000000', 12),
    decorations: seedId('73000000', 13),
  },
  contributions: {
    approved: seedId('73000000', 20),
    pending: seedId('73000000', 21),
    crossEntity: seedId('73000000', 22),
  },
  delegation: seedId('73000000', 30),
} as const;

export const intercompanyPairPolicies = [
  {
    id: P5_IDS.policies.ukToIndiaBlock,
    tenantId: TENANTS.acme,
    fromLegalEntityId: HYLAND_ENTITIES.uk,
    toLegalEntityId: HYLAND_ENTITIES.india,
    mode: 'block' as const,
    markupBps: 0,
    taxApproverPersonId: null,
    validFrom: '2026-01-01',
  },
  {
    id: P5_IDS.policies.germanyToIndiaMarkup,
    tenantId: TENANTS.acme,
    fromLegalEntityId: HYLAND_ENTITIES.germany,
    toLegalEntityId: HYLAND_ENTITIES.india,
    mode: 'recharge_with_markup' as const,
    markupBps: 500,
    taxApproverPersonId: null,
    validFrom: '2026-01-01',
  },
];

/** Minor units per currency: INR for the Bengaluru story, USD once budgets are held in USD. */
const amount = (usd: number, inr: number) => ({ USD: usd, INR: inr });

export const P5_EVENT = {
  id: P5_IDS.event,
  name: 'Diwali celebration 2026',
  eventType: 'celebration',
  homeBudgetId: BUDGETS.bengaluru,
  organizer: 'event-organizer' as const,
  approver: 'location-manager' as const,
  eventCode: 'EV-2026-DIWALI',
  startsAt: '2026-11-20T05:00:00.000Z',
  endsAt: '2026-11-20T12:30:00.000Z',
  venue: 'Bengaluru office atrium',
  description:
    'Cross-location Diwali celebration for the Bengaluru and Hyderabad teams: lunch, decor and small gifts.',
  locations: [ORG_UNITS.bengaluru, ORG_UNITS.hyderabad],
  toleranceBps: 500,
  ownFunds: amount(300_000, 25_000_000),
  costLines: [
    {
      category: 'venue',
      description: 'Atrium booking and setup',
      quantity: 1,
      unit: amount(144_000, 12_000_000),
    },
    {
      category: 'catering',
      description: 'Festive lunch',
      quantity: 230,
      unit: amount(1_080, 90_000),
    },
    {
      category: 'decor',
      description: 'Lights, rangoli and flowers',
      quantity: 1,
      unit: amount(54_000, 4_500_000),
    },
    {
      category: 'gifts',
      description: 'Sweets boxes',
      quantity: 1,
      unit: amount(33_600, 2_800_000),
    },
  ],
  participants: [
    person(2),
    person(3),
    person(4),
    person(5),
    person(7),
    person(10),
    person(11),
    person(12),
    userById('employee').personId!,
  ],
  contributions: {
    approved: {
      id: P5_IDS.contributions.approved,
      giverBudgetId: BUDGETS.india,
      requested: amount(120_000, 10_000_000),
      approved: amount(90_000, 7_500_000),
      purpose: 'Hyderabad team share of the Diwali celebration (80 attendees).',
    },
    pending: {
      id: P5_IDS.contributions.pending,
      giverBudgetId: BUDGETS.india,
      requested: amount(72_000, 6_000_000),
      purpose: 'Gifts for the Hyderabad attendees added after the RSVP count.',
    },
    /** Germany to India: recharged with the 5% markup under the pair policy. */
    crossEntity: {
      id: P5_IDS.contributions.crossEntity,
      giverBudgetId: BUDGETS.europe,
      giver: 'department-head' as const,
      requested: amount(24_000, 2_000_000),
      purpose: 'Sweets boxes for the Berlin colleagues joining the celebration remotely.',
    },
  },
  commitment: {
    description: 'Venue booking: Bengaluru office atrium',
    amount: amount(144_000, 12_000_000),
  },
};

export const P5_REQUESTS = [
  {
    id: P5_IDS.requests.teamLunch,
    title: 'Team lunch: Platform squad',
    purpose: 'Quarterly lunch for the Platform squad after the release (14 people).',
    spendType: 'team_lunch',
    category: 'team_lunch',
    amount: amount(21_600, 1_800_000),
    outcome: 'pending' as const,
  },
  {
    id: P5_IDS.requests.snacks,
    title: 'Snacks for the planning offsite',
    purpose: 'Snacks and tea for the two-day planning offsite.',
    spendType: 'team_lunch',
    category: 'team_lunch',
    amount: amount(11_400, 950_000),
    outcome: 'approved' as const,
  },
  {
    id: P5_IDS.requests.photoBooth,
    title: 'Photo booth rental',
    purpose: 'Photo booth for the annual day.',
    spendType: 'employee_events',
    category: 'employee_events',
    amount: amount(48_000, 4_000_000),
    outcome: 'rejected' as const,
    reason: 'Covered by the Diwali event budget; no separate booth this year.',
  },
  {
    id: P5_IDS.requests.decorations,
    title: 'Festival decorations',
    purpose: 'Decorations for the Bengaluru office floors.',
    spendType: 'employee_events',
    category: 'employee_events',
    amount: amount(18_000, 1_500_000),
    outcome: 'draft' as const,
  },
];

/** The regional manager delegates approvals to the location manager while travelling (capped at USD 2,000). */
export const P5_DELEGATION = {
  id: P5_IDS.delegation,
  delegator: 'regional-manager' as const,
  delegate: 'location-manager' as const,
  limitMinor: 200_000,
  currency: 'USD',
  validFrom: '2026-11-01',
  validTo: '2026-12-31',
  reason: 'Travelling for the year-end planning cycle',
};
