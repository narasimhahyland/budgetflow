import { BUDGETS, COST_CENTERS, seedId, TENANTS } from './ids';
import { HYLAND_ENTITIES } from './org';

/**
 * Phase 6 fixtures (all fictional): events and commitments the actuals feeds match against, a mapping
 * rule, and the ERP and card feeds the seed imports. Prefixes: 77 events and rules, 78 commitments,
 * 79 contributions. Commitments are test fixtures until the Phase 5 commitment API is merged.
 */
const T = TENANTS.acme;

export const ACTUALS_EVENTS = {
  bengaluruAnnualDay: seedId('77000000', 1),
  hyderabadHackWeek: seedId('77000000', 2),
  newYorkOffsite: seedId('77000000', 3),
} as const;

export const actualsEventsData = [
  {
    id: ACTUALS_EVENTS.bengaluruAnnualDay,
    tenantId: T,
    name: 'Bengaluru Annual Day 2026',
    eventType: 'celebration',
    status: 'in_progress' as const,
    organizer: 'location-manager' as const,
    legalEntityId: HYLAND_ENTITIES.india,
    costCenterId: COST_CENTERS.bengaluru,
    eventCode: 'BLR-ANNUAL-26',
    budgetId: BUDGETS.bengaluru,
    currency: 'INR',
    estimateMinor: 45_000_000,
  },
  {
    id: ACTUALS_EVENTS.hyderabadHackWeek,
    tenantId: T,
    name: 'Hyderabad Hack Week',
    eventType: 'team_building',
    status: 'completed' as const,
    organizer: 'regional-manager' as const,
    legalEntityId: HYLAND_ENTITIES.india,
    costCenterId: COST_CENTERS.hyderabad,
    eventCode: 'HYD-HACK-26',
    budgetId: BUDGETS.india,
    currency: 'INR',
    estimateMinor: 15_000_000,
  },
  {
    id: ACTUALS_EVENTS.newYorkOffsite,
    tenantId: T,
    name: 'New York Team Offsite',
    eventType: 'offsite',
    status: 'completed' as const,
    organizer: 'budget-owner' as const,
    legalEntityId: HYLAND_ENTITIES.us,
    costCenterId: COST_CENTERS.newYork,
    eventCode: 'NYC-OFFSITE-26',
    budgetId: BUDGETS.unitedStates,
    currency: 'USD',
    estimateMinor: 900_000,
  },
] as const;

export const ACTUALS_COMMITMENTS = {
  annualDayCatering: seedId('78000000', 1),
  annualDayVenue: seedId('78000000', 2),
  hackWeekVenue: seedId('78000000', 3),
  hackWeekTravel: seedId('78000000', 4),
  offsiteVenue: seedId('78000000', 5),
  offsiteCatering: seedId('78000000', 6),
  annualDayPrints: seedId('78000000', 7),
} as const;

/** Vendor names resolved to the Phase 3 vendor master by the seed runner. */
export const actualsCommitmentsData = [
  {
    id: ACTUALS_COMMITMENTS.annualDayCatering,
    budgetId: BUDGETS.bengaluru,
    eventId: ACTUALS_EVENTS.bengaluruAnnualDay,
    legalEntityId: HYLAND_ENTITIES.india,
    costCenterId: COST_CENTERS.bengaluru,
    vendor: 'Spice Route Caterers',
    glAccount: '6100',
    description: 'Annual Day catering for 180 guests',
    serviceStart: '2026-11-03',
    serviceEnd: '2026-11-03',
    amountMinor: 12_450_000,
    currency: 'INR',
    nonRefundableDepositMinor: 0,
  },
  {
    id: ACTUALS_COMMITMENTS.annualDayVenue,
    budgetId: BUDGETS.bengaluru,
    eventId: ACTUALS_EVENTS.bengaluruAnnualDay,
    legalEntityId: HYLAND_ENTITIES.india,
    costCenterId: COST_CENTERS.bengaluru,
    vendor: 'Deccan Event Studio',
    glAccount: '6100',
    description: 'Annual Day venue hire (deposit due now)',
    serviceStart: '2026-12-05',
    serviceEnd: '2026-12-06',
    amountMinor: 20_000_000,
    currency: 'INR',
    nonRefundableDepositMinor: 6_000_000,
  },
  {
    id: ACTUALS_COMMITMENTS.annualDayPrints,
    budgetId: BUDGETS.bengaluru,
    eventId: ACTUALS_EVENTS.bengaluruAnnualDay,
    legalEntityId: HYLAND_ENTITIES.india,
    costCenterId: COST_CENTERS.bengaluru,
    vendor: null,
    glAccount: '6100',
    description: 'Banners and printed programmes',
    serviceStart: '2026-11-02',
    serviceEnd: '2026-11-02',
    amountMinor: 1_850_000,
    currency: 'INR',
    nonRefundableDepositMinor: 0,
  },
  {
    id: ACTUALS_COMMITMENTS.hackWeekVenue,
    budgetId: BUDGETS.india,
    eventId: ACTUALS_EVENTS.hyderabadHackWeek,
    legalEntityId: HYLAND_ENTITIES.india,
    costCenterId: COST_CENTERS.hyderabad,
    vendor: 'Garden City Catering Co.',
    glAccount: '6100',
    description: 'Hack Week meals and venue',
    serviceStart: '2026-10-19',
    serviceEnd: '2026-10-23',
    amountMinor: 8_500_000,
    currency: 'INR',
    nonRefundableDepositMinor: 0,
  },
  {
    id: ACTUALS_COMMITMENTS.hackWeekTravel,
    budgetId: BUDGETS.india,
    eventId: ACTUALS_EVENTS.hyderabadHackWeek,
    legalEntityId: HYLAND_ENTITIES.india,
    costCenterId: COST_CENTERS.hyderabad,
    vendor: null,
    glAccount: '6140',
    description: 'Hack Week team travel',
    serviceStart: '2026-10-19',
    serviceEnd: '2026-10-23',
    amountMinor: 4_000_000,
    currency: 'INR',
    nonRefundableDepositMinor: 0,
  },
  {
    id: ACTUALS_COMMITMENTS.offsiteVenue,
    budgetId: BUDGETS.unitedStates,
    eventId: ACTUALS_EVENTS.newYorkOffsite,
    legalEntityId: HYLAND_ENTITIES.us,
    costCenterId: COST_CENTERS.newYork,
    vendor: 'Lakeside Banquets',
    glAccount: '6100',
    description: 'Offsite venue and AV',
    serviceStart: '2026-10-15',
    serviceEnd: '2026-10-16',
    amountMinor: 480_000,
    currency: 'USD',
    nonRefundableDepositMinor: 0,
  },
  {
    id: ACTUALS_COMMITMENTS.offsiteCatering,
    budgetId: BUDGETS.unitedStates,
    eventId: null,
    legalEntityId: HYLAND_ENTITIES.us,
    costCenterId: COST_CENTERS.newYork,
    vendor: 'Harbor View Hotel Group',
    glAccount: '6100',
    description: 'Quarterly team lunch (no invoice received)',
    serviceStart: '2026-09-25',
    serviceEnd: '2026-09-25',
    amountMinor: 200_000,
    currency: 'USD',
    nonRefundableDepositMinor: 0,
  },
] as const;

/** Commitment reference as BudgetFlow shows it (CMT- and the last 8 characters of the id). */
export const commitmentReference = (id: string): string => `CMT-${id.slice(-8).toUpperCase()}`;

export const ACTUALS_MAPPING_RULE = seedId('77000000', 100);

const R = commitmentReference;

/** ERP export for November 2026 (Hyland India and US entities). */
export const ERP_FEED_NOV_2026 = {
  fileName: 'erp-actuals-2026-11.csv',
  source: 'erp' as const,
  content: [
    'source_ref,transaction_date,amount,currency,legal_entity,cost_center,gl_account,event_code,vendor,memo,reference,original_ref,kind',
    `ERP-2611-0001,2026-11-03,124500.00,INR,HYL-IN,CC-IN-BLR-200,6100,BLR-ANNUAL-26,Spice Route Caterers,Annual Day catering invoice,${R(ACTUALS_COMMITMENTS.annualDayCatering)},,charge`,
    'ERP-2611-0002,2026-11-02,18350.00,INR,HYL-IN,CC-IN-BLR-200,6100,BLR-ANNUAL-26,,Banners and programmes,,,charge',
    'ERP-2611-0003,2026-11-02,52000.00,INR,HYL-IN,CC-IN-HYD-210,6100,HYD-HACK-26,Garden City Catering Co.,Hack Week meals (first invoice),,,charge',
    'ERP-2611-0004,2026-11-03,47500.00,INR,HYL-IN,CC-IN-HYD-210,6140,HYD-HACK-26,,Hack Week team travel,,,charge',
    `ERP-2611-0005,2026-11-02,4800.00,USD,HYL-US,CC-US-NYC-300,6100,NYC-OFFSITE-26,Lakeside Banquets,Offsite venue and AV,${R(ACTUALS_COMMITMENTS.offsiteVenue)},,charge`,
    'ERP-2611-0006,2026-11-04,-2500.00,INR,HYL-IN,CC-IN-BLR-200,6100,BLR-ANNUAL-26,Spice Route Caterers,Credit note for unused desserts,,ERP-2611-0001,credit_note',
    'ERP-2611-0007,2026-11-04,60000.00,INR,HYL-IN,CC-IN-BLR-200,6100,,Deccan Event Studio,Venue deposit,,,charge',
    'ERP-2611-0008,2026-11-03,18940.00,INR,HYL-IN,CC-IN-HYD-210,6140,,City Cabs,Airport transfers,,,charge',
    'ERP-2611-0009,2026-11-04,640.00,USD,HYL-US,CC-US-NYC-300,6100,NYC-OFFSITE-26,Northside Print,Offsite name badges,,,charge',
  ].join('\n'),
};

/** Corporate card feed: one line repeats an ERP line (cross-source duplicate, flagged before matching). */
export const CARD_FEED_NOV_2026 = {
  fileName: 'card-transactions-2026-11.csv',
  source: 'card' as const,
  content: [
    'transaction_id,date,amount,currency,entity,cost_center,account,event,merchant,description,card_program',
    'CARD-88120,2026-11-03,18940.00,INR,HYL-IN,CC-IN-HYD-210,6140,,City Cabs,Airport transfers,India corporate card',
    'CARD-88121,2026-11-02,4600.00,EUR,HYL-DE,,6100,,Canal Events BV,Hack week venue Berlin,Europe corporate card',
  ].join('\n'),
};
