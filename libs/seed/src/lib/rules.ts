import { BUDGETS, DOA_MATRIX, ORG_UNITS, seedId, TENANTS } from './ids';
import { HYLAND_ENTITIES } from './org';
import { userById, type SeedUserId } from './roles';

/**
 * Phase 7 fixtures (all fictional): the published policy rules behind the engine, the conflicting
 * draft that demonstrates conflict detection, approval routing per request kind, a delegation-of-
 * authority version awaiting approval, and the post-spend exception queue.
 * Id prefixes: 80 rules, 81 rule versions, 82 workflow templates, 83 DoA v2 and its limits,
 * 84 post-spend exceptions.
 */
const T = TENANTS.acme;

export const P7_RULES = {
  blockedVendor: seedId('80000000', 3),
  frozenBudget: seedId('80000000', 5),
  cashEquivalent: seedId('80000000', 7),
  overBudget: seedId('80000000', 9),
  eventThresholds: seedId('80000000', 12),
  perHeadLimits: seedId('80000000', 14),
  smallWellbeing: seedId('80000000', 19),
  giftCap: seedId('80000000', 24),
  clientEntertainment: seedId('80000000', 25),
  alcohol: seedId('80000000', 26),
  splitPurchase: seedId('80000000', 28),
  contributionThresholds: seedId('80000000', 30),
} as const;

export const P7_DOA_V2 = seedId('83000000', 2);

type Leaf = {
  fact: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in';
  value: string | number | boolean | string[] | number[];
};

interface RuleSeed {
  id: string;
  code: string;
  name: string;
  family: string;
  templateCode: string | null;
  /** Published versions in order; the last one becomes the active version. */
  versions: {
    version: number;
    priority: number;
    effect: 'block' | 'freeze' | 'require_approval' | 'warn' | 'auto_approve';
    conditions: Leaf[];
    logic?: 'and' | 'or';
    approvers?: string[];
    scope?: { legalEntityCodes?: string[]; orgUnitIds?: string[]; requestKinds?: string[] };
    explanation: string;
    validFrom: string;
    validTo?: string | null;
  }[];
  /** An unpublished draft; `conflicts` marks the one that must be resolved before publishing. */
  draft?: RuleSeed['versions'][number] & { conflicts?: boolean };
  publishedBy: SeedUserId;
}

export const P7_RULE_SEEDS: RuleSeed[] = [
  {
    id: P7_RULES.blockedVendor,
    code: 'R-03',
    name: 'Blocked vendors cannot be used',
    family: 'vendor_control',
    templateCode: 'TPL-VENDOR-CONTROLS',
    publishedBy: 'finance-admin',
    versions: [
      {
        version: 1,
        priority: 900,
        effect: 'block',
        conditions: [{ fact: 'vendor_status', op: 'eq', value: 'blocked' }],
        explanation:
          'This vendor is blocked. Choose another vendor, or ask Finance to review the block before spending.',
        validFrom: '2026-01-01',
      },
    ],
  },
  {
    id: P7_RULES.frozenBudget,
    code: 'R-05',
    name: 'Frozen budgets hold new spending',
    family: 'budget_controls',
    templateCode: null,
    publishedBy: 'finance-admin',
    versions: [
      {
        version: 1,
        priority: 880,
        effect: 'freeze',
        conditions: [{ fact: 'remaining_pct', op: 'lte', value: 0 }],
        explanation:
          'This budget has nothing left. Requests wait until the owner adds funds or the freeze is lifted.',
        validFrom: '2026-01-01',
      },
    ],
  },
  {
    id: P7_RULES.cashEquivalent,
    code: 'R-07',
    name: 'Cash and gift cards are never allowed',
    family: 'gifts_entertainment',
    templateCode: 'TPL-GIFTS-ENT',
    publishedBy: 'finance-admin',
    versions: [
      {
        version: 1,
        priority: 950,
        effect: 'block',
        conditions: [{ fact: 'is_cash_equivalent', op: 'eq', value: true }],
        explanation:
          'Cash, gift cards and vouchers count as pay and are never allowed. Choose a non-cash gift instead.',
        validFrom: '2026-01-01',
      },
    ],
  },
  {
    id: P7_RULES.overBudget,
    code: 'R-09',
    name: 'Spending beyond what is left needs Finance',
    family: 'over_budget',
    templateCode: null,
    publishedBy: 'finance-controller',
    versions: [
      {
        version: 1,
        priority: 700,
        effect: 'require_approval',
        conditions: [{ fact: 'remaining_pct', op: 'lt', value: 5 }],
        approvers: ['parent_owner', 'finance_controller'],
        explanation:
          'Less than 5% of this budget is left, so the parent owner and the Finance Controller both sign off.',
        validFrom: '2026-01-01',
      },
    ],
  },
  {
    id: P7_RULES.eventThresholds,
    code: 'R-12',
    name: 'Event approval thresholds',
    family: 'approval_thresholds',
    templateCode: null,
    publishedBy: 'finance-admin',
    versions: [
      {
        version: 1,
        priority: 600,
        effect: 'require_approval',
        conditions: [{ fact: 'amount_reporting_minor', op: 'gt', value: 100_000 }],
        approvers: ['budget_owner', 'parent_owner'],
        explanation: 'Events above USD 1,000.00 need the parent budget owner.',
        validFrom: '2026-01-01',
        validTo: '2026-03-31',
      },
      {
        version: 2,
        priority: 600,
        effect: 'require_approval',
        conditions: [{ fact: 'amount_reporting_minor', op: 'gt', value: 75_000 }],
        approvers: ['budget_owner', 'parent_owner'],
        explanation: 'Events above USD 750.00 need the parent budget owner.',
        validFrom: '2026-04-01',
        validTo: '2026-06-30',
      },
      {
        version: 3,
        priority: 600,
        effect: 'require_approval',
        conditions: [
          { fact: 'spend_type', op: 'in', value: ['employee_events', 'team_lunch', 'offsite'] },
          { fact: 'amount_reporting_minor', op: 'gt', value: 50_000 },
        ],
        approvers: ['budget_owner', 'parent_owner'],
        explanation:
          'Events above USD 500.00 need the budget owner and the parent budget owner, following the approval threshold table.',
        validFrom: '2026-07-01',
      },
    ],
    // Version 4 auto-approves what the frozen-budget rule blocks: publishing is blocked until resolved.
    draft: {
      version: 4,
      priority: 880,
      effect: 'auto_approve',
      conditions: [
        { fact: 'spend_type', op: 'in', value: ['employee_events', 'team_lunch', 'offsite'] },
        { fact: 'amount_reporting_minor', op: 'lte', value: 120_000 },
      ],
      explanation:
        'Proposed: events up to USD 1,200.00 go through without an approval step when the budget has room.',
      validFrom: '2027-01-01',
      conflicts: true,
    },
  },
  {
    id: P7_RULES.perHeadLimits,
    code: 'R-14',
    name: 'Per-person limits by location',
    family: 'spending_limits',
    templateCode: 'TPL-PER-HEAD-ENGAGEMENT',
    publishedBy: 'finance-admin',
    versions: [
      {
        version: 1,
        priority: 500,
        effect: 'warn',
        conditions: [{ fact: 'amount_per_person_minor', op: 'gt', value: 958 }],
        scope: { orgUnitIds: [ORG_UNITS.bengaluru, ORG_UNITS.hyderabad] },
        explanation:
          'This is above the USD 9.58 per person meal limit for this location. Add a short note explaining why.',
        validFrom: '2026-01-01',
      },
    ],
  },
  {
    id: P7_RULES.smallWellbeing,
    code: 'R-19',
    name: 'Small wellbeing spend goes through',
    family: 'spending_limits',
    templateCode: null,
    publishedBy: 'finance-admin',
    versions: [
      {
        version: 1,
        priority: 200,
        effect: 'auto_approve',
        conditions: [
          { fact: 'category', op: 'eq', value: 'wellbeing' },
          { fact: 'amount_reporting_minor', op: 'lte', value: 2_500 },
        ],
        explanation:
          'Wellbeing items up to USD 25.00 go through without an approval step while the budget has room.',
        validFrom: '2026-01-01',
      },
    ],
  },
  {
    id: P7_RULES.giftCap,
    code: 'R-24',
    name: 'Gifts capped per recipient',
    family: 'gifts_entertainment',
    templateCode: 'TPL-GIFTS-ENT',
    publishedBy: 'finance-admin',
    versions: [
      {
        version: 1,
        priority: 650,
        effect: 'require_approval',
        conditions: [
          { fact: 'category', op: 'eq', value: 'gifts' },
          { fact: 'amount_per_person_minor', op: 'gt', value: 7_500 },
        ],
        approvers: ['budget_owner', 'finance_controller'],
        explanation:
          'Gifts above USD 75.00 per recipient need the Finance Controller as well as the budget owner.',
        validFrom: '2026-01-01',
      },
    ],
  },
  {
    id: P7_RULES.clientEntertainment,
    code: 'R-25',
    name: 'Client entertainment per attendee',
    family: 'gifts_entertainment',
    templateCode: 'TPL-GIFTS-ENT',
    publishedBy: 'finance-admin',
    versions: [
      {
        version: 1,
        priority: 640,
        effect: 'require_approval',
        conditions: [
          { fact: 'attendee_type', op: 'eq', value: 'client' },
          { fact: 'amount_per_person_minor', op: 'gt', value: 12_000 },
        ],
        approvers: ['budget_owner', 'finance_controller'],
        explanation:
          'Client entertainment above USD 120.00 per attendee needs the Finance Controller; it posts to the client GL account.',
        validFrom: '2026-01-01',
      },
    ],
  },
  {
    id: P7_RULES.alcohol,
    code: 'R-26',
    name: 'Alcohol only at approved events',
    family: 'gifts_entertainment',
    templateCode: 'TPL-ALCOHOL-EVENTS',
    publishedBy: 'finance-admin',
    versions: [
      {
        version: 1,
        priority: 860,
        effect: 'require_approval',
        conditions: [{ fact: 'alcohol_requested', op: 'eq', value: true }],
        approvers: ['parent_owner'],
        explanation:
          'Alcohol is allowed only at approved events, up to USD 20.00 per attendee, with the parent owner signing off.',
        validFrom: '2026-01-01',
      },
    ],
  },
  {
    id: P7_RULES.contributionThresholds,
    code: 'R-30',
    name: 'Contribution approval thresholds',
    family: 'approval_thresholds',
    templateCode: null,
    publishedBy: 'finance-admin',
    versions: [
      {
        version: 1,
        priority: 620,
        effect: 'require_approval',
        conditions: [{ fact: 'amount_reporting_minor', op: 'gt', value: 1_000_000 }],
        scope: { requestKinds: ['contribution'] },
        approvers: ['giving_director', 'finance_controller'],
        explanation:
          'An Inter-Director Budget Contribution Request above USD 10,000.00 needs the Finance Controller as well as the giving director.',
        validFrom: '2026-01-01',
      },
    ],
  },
  {
    id: P7_RULES.splitPurchase,
    code: 'R-28',
    name: 'Possible split purchases are flagged',
    family: 'detection',
    templateCode: 'TPL-SPLIT-DUPLICATE',
    publishedBy: 'finance-controller',
    versions: [
      {
        version: 1,
        priority: 300,
        effect: 'warn',
        conditions: [{ fact: 'amount_reporting_minor', op: 'gte', value: 45_000 }],
        scope: { requestKinds: ['spending'] },
        explanation:
          'This is just under an approval threshold and the same requester raised a similar request this week. Finance reviews it after the spend.',
        validFrom: '2026-02-01',
      },
    ],
  },
];

/** Approval routing per request kind; the spending route is the one screen 070 opens on. */
export const P7_WORKFLOW_ROUTES = [
  {
    id: seedId('82000000', 1),
    requestKind: 'spending',
    steps: [
      {
        stepNo: 1,
        label: 'Budget owner',
        resolver: 'budget_owner',
        mode: 'sequential',
        groupRule: 'any_one',
        conditionLabel: 'Always (skipped when the requester is the owner)',
        amountAboveMinor: null,
        remainingBelowPct: null,
        crossEntityOnly: false,
        fromThresholdTable: true,
        slaBusinessHours: 48,
        applyDoa: true,
      },
      {
        stepNo: 2,
        label: 'Parent budget owner',
        resolver: 'parent_owner',
        mode: 'sequential',
        groupRule: 'any_one',
        conditionLabel: 'Amount above USD 500.00 or remaining after request below 10%',
        amountAboveMinor: 50_000,
        remainingBelowPct: 10,
        crossEntityOnly: false,
        fromThresholdTable: true,
        slaBusinessHours: 48,
        applyDoa: true,
      },
      {
        stepNo: 3,
        label: 'Finance Controller',
        resolver: 'finance_review',
        mode: 'sequential',
        groupRule: 'any_one',
        conditionLabel: 'Amount above USD 5,000.00',
        amountAboveMinor: 500_000,
        remainingBelowPct: null,
        crossEntityOnly: false,
        fromThresholdTable: true,
        slaBusinessHours: 24,
        applyDoa: true,
      },
    ],
  },
  {
    id: seedId('82000000', 2),
    requestKind: 'contribution',
    steps: [
      {
        stepNo: 1,
        label: 'Giving director',
        resolver: 'giving_director',
        mode: 'sequential',
        groupRule: 'any_one',
        conditionLabel: 'Always',
        amountAboveMinor: null,
        remainingBelowPct: null,
        crossEntityOnly: false,
        fromThresholdTable: true,
        slaBusinessHours: 72,
        applyDoa: true,
      },
      {
        stepNo: 2,
        label: 'Tax approver',
        resolver: 'tax_approver',
        mode: 'parallel',
        groupRule: 'any_one',
        conditionLabel: 'Giving and receiving budgets sit in different legal entities',
        amountAboveMinor: null,
        remainingBelowPct: null,
        crossEntityOnly: true,
        fromThresholdTable: false,
        slaBusinessHours: 48,
        applyDoa: true,
      },
    ],
  },
  {
    id: seedId('82000000', 3),
    requestKind: 'over_budget',
    steps: [
      {
        stepNo: 1,
        label: 'Parent budget owner',
        resolver: 'parent_owner',
        mode: 'sequential',
        groupRule: 'any_one',
        conditionLabel: 'Always',
        amountAboveMinor: null,
        remainingBelowPct: null,
        crossEntityOnly: false,
        fromThresholdTable: true,
        slaBusinessHours: 24,
        applyDoa: true,
      },
      {
        stepNo: 2,
        label: 'Finance Controller',
        resolver: 'finance_review',
        mode: 'sequential',
        groupRule: 'any_one',
        conditionLabel: 'Always for over-budget requests',
        amountAboveMinor: null,
        remainingBelowPct: null,
        crossEntityOnly: false,
        fromThresholdTable: false,
        slaBusinessHours: 24,
        applyDoa: true,
      },
    ],
  },
];

/**
 * A delegation-of-authority version waiting for the CEO. Finance submitted it, so screen 070a shows
 * the comparison with the active version and the approve action to someone who did not submit it.
 */
export const P7_DOA_DRAFT = {
  id: P7_DOA_V2,
  version: 2,
  previousVersionId: DOA_MATRIX.acmeV1,
  validFrom: '2027-01-01',
  submittedBy: 'finance-admin' as SeedUserId,
  limits: (
    [
      [null, 'department-head', 'employee_events', null, 3_000_000],
      [null, 'regional-manager', 'employee_events', HYLAND_ENTITIES.india, 2_000_000],
      [null, 'budget-owner', 'employee_events', null, 1_200_000],
      [null, 'location-manager', 'team_lunch', null, 150_000],
      [null, 'location-manager', 'employee_events', null, 500_000],
      [null, 'event-organizer', 'employee_events', null, 100_000],
      [null, 'finance-controller', 'travel', null, 2_500_000],
      [null, 'ceo', 'marketing', null, 50_000_000],
    ] as const
  ).map(([person, role, spendType, legalEntityId, limitMinor], i) => ({
    id: seedId('83000000', 100 + i),
    tenantId: T,
    matrixVersionId: P7_DOA_V2,
    personId: person ? userById(person).personId : null,
    role,
    spendType,
    legalEntityId,
    limitMinor,
    currency: 'USD',
    validFrom: '2027-01-01',
  })),
} as const;

/** The post-spend exception queue on screen 074a: one of each kind that Finance has to decide. */
export const P7_EXCEPTIONS = [
  {
    id: seedId('84000000', 1),
    tenantId: T,
    type: 'alcohol_over_cap',
    status: 'open',
    sourceKind: 'actual',
    sourceRef: 'ACT-00318',
    sourceId: null,
    budgetId: BUDGETS.bengaluru,
    location: 'Bengaluru',
    personName: 'Aarav Nair',
    transactionAmountMinor: 318_000,
    transactionCurrency: 'INR',
    reportingAmountMinor: 3_808,
    reportingCurrency: 'USD',
    ruleCode: 'R-26',
    ruleVersion: 1,
    summary:
      'Alcohol at the Annual Day came to USD 38.08 per attendee against a cap of USD 20.00 for 28 attendees.',
    facts: { attendees: 28, perAttendeeUsdMinor: 3_808, capUsdMinor: 2_000 },
    relatedItems: [],
  },
  {
    id: seedId('84000000', 2),
    tenantId: T,
    type: 'blocked_vendor',
    status: 'open',
    sourceKind: 'actual',
    sourceRef: 'ACT-00402',
    sourceId: null,
    budgetId: BUDGETS.hyderabad,
    location: 'Hyderabad',
    personName: 'Kavya Shah',
    transactionAmountMinor: 1_250_000,
    transactionCurrency: 'INR',
    reportingAmountMinor: 14_970,
    reportingCurrency: 'USD',
    ruleCode: 'R-03',
    ruleVersion: 1,
    summary:
      'Catering was booked with a vendor blocked for a failed food-safety audit. The spend already settled.',
    facts: { vendorStatus: 'blocked', reasonCode: 'VND-AUDIT' },
    relatedItems: [],
  },
  {
    id: seedId('84000000', 3),
    tenantId: T,
    type: 'split_purchase',
    status: 'open',
    sourceKind: 'request',
    sourceRef: 'REQ-00118',
    sourceId: null,
    budgetId: BUDGETS.bengaluru,
    location: 'Bengaluru',
    personName: 'Rohan Desai',
    transactionAmountMinor: 49_500,
    transactionCurrency: 'USD',
    reportingAmountMinor: 49_500,
    reportingCurrency: 'USD',
    ruleCode: 'R-28',
    ruleVersion: 1,
    summary:
      'Three requests to the same vendor within five days total USD 1,480.00, above the USD 500.00 threshold each one stayed under.',
    facts: { windowDays: 5, combinedUsdMinor: 148_000, thresholdUsdMinor: 50_000 },
    relatedItems: [
      {
        ref: 'REQ-00118',
        date: '2026-10-12',
        amount: { amountMinor: 49_500, currency: 'USD' },
        reportingAmount: { amountMinor: 49_500, currency: 'USD' },
        description: 'Team offsite catering, part 1',
      },
      {
        ref: 'REQ-00121',
        date: '2026-10-14',
        amount: { amountMinor: 49_500, currency: 'USD' },
        reportingAmount: { amountMinor: 49_500, currency: 'USD' },
        description: 'Team offsite catering, part 2',
      },
      {
        ref: 'REQ-00126',
        date: '2026-10-16',
        amount: { amountMinor: 49_000, currency: 'USD' },
        reportingAmount: { amountMinor: 49_000, currency: 'USD' },
        description: 'Team offsite catering, part 3',
      },
    ],
  },
  {
    id: seedId('84000000', 4),
    tenantId: T,
    type: 'gifts_over_cap',
    status: 'explained',
    sourceKind: 'actual',
    sourceRef: 'ACT-00455',
    sourceId: null,
    budgetId: BUDGETS.unitedStates,
    location: 'Westlake',
    personName: 'Olivia Grant',
    transactionAmountMinor: 11_000,
    transactionCurrency: 'USD',
    reportingAmountMinor: 11_000,
    reportingCurrency: 'USD',
    ruleCode: 'R-24',
    ruleVersion: 1,
    summary: 'A long-service gift came to USD 110.00 per recipient against the USD 75.00 cap.',
    facts: { perRecipientUsdMinor: 11_000, capUsdMinor: 7_500 },
    relatedItems: [],
    ownerExplanation:
      'Ten-year service award agreed with People Ops before the purchase; the higher amount was approved verbally.',
  },
  {
    id: seedId('84000000', 5),
    tenantId: T,
    type: 'missing_receipt',
    status: 'open',
    sourceKind: 'actual',
    sourceRef: 'ACT-00470',
    sourceId: null,
    budgetId: BUDGETS.europe,
    location: 'London',
    personName: 'Amelia Clarke',
    transactionAmountMinor: 18_400,
    transactionCurrency: 'GBP',
    reportingAmountMinor: 23_368,
    reportingCurrency: 'USD',
    ruleCode: 'R-22',
    ruleVersion: 1,
    summary: 'No itemised receipt was attached for a USD 233.68 team meal.',
    facts: { receiptRequiredAboveUsdMinor: 2_500 },
    relatedItems: [],
  },
];

/** Figures the Phase 7 scenarios and journeys assert against. */
export const P7_SEED = {
  rules: P7_RULES,
  /** R-12 has three published versions; version 3 is active and version 4 is a conflicting draft. */
  conflictingDraftCode: 'R-12',
  conflictsWithCode: 'R-05',
  activeRuleCount: P7_RULE_SEEDS.length,
  openExceptionCount: P7_EXCEPTIONS.filter((e) => e.status === 'open').length,
  doaDraftVersion: P7_DOA_DRAFT.version,
} as const;
