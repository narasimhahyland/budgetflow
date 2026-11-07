import { seedId } from './ids';

/**
 * Phase 16 seed (prefix 93): the ecosystem surfaces as a company that has started using them would
 * have them. The BI connector on with two datasets, the connector for AI assistants on with its
 * read-only tools, one no-code platform allowed and the rest not, three marketplace partners (two
 * enabled against approved vendors, one paused awaiting its vendor link) and two embeddable widgets.
 *
 * Everything is fictional. No connection token is written here: the seed generates one at run time
 * and keeps only its hash, exactly as the API does, so nothing in this repository is a usable
 * credential. Dates are relative to the seed run, so the data never drifts into the past.
 */
export const P16_IDS = {
  vendors: {
    cityQuest: seedId('93000000', 1),
    freshPlate: seedId('93000000', 2),
    kindlyGifts: seedId('93000000', 3),
  },
  partners: {
    cityQuest: seedId('93000000', 11),
    freshPlate: seedId('93000000', 12),
    kindlyGifts: seedId('93000000', 13),
  },
  widgets: {
    teamBudget: seedId('93000000', 21),
    upcomingEvents: seedId('93000000', 22),
  },
  connections: {
    analystPowerBi: seedId('93000000', 31),
    organizerAssistant: seedId('93000000', 32),
    organizerAutomation: seedId('93000000', 33),
  },
} as const;

/** Vendors the marketplace partners are linked to; without an approved vendor an offer never shows. */
export const P16_PARTNER_VENDORS = [
  {
    id: P16_IDS.vendors.cityQuest,
    name: 'CityQuest Experiences',
    status: 'preferred',
    category: 'activities',
    country: 'IN',
    erpVendorId: 'V-20044',
  },
  {
    id: P16_IDS.vendors.freshPlate,
    name: 'Fresh Plate Catering',
    status: 'approved',
    category: 'catering',
    country: 'IN',
    erpVendorId: 'V-20048',
  },
  {
    id: P16_IDS.vendors.kindlyGifts,
    name: 'Kindly Gifts',
    status: 'approved',
    category: 'gifts',
    country: 'IN',
    erpVendorId: 'V-20052',
  },
] as const;

export interface SeedPartner {
  id: string;
  name: string;
  slug: string;
  categories: string[];
  cities: string[];
  vendorId: string | null;
  status: 'enabled' | 'paused';
}

/**
 * Two partners ready to take bookings and one paused: the paused one is how the "offers hidden,
 * existing bookings continue" state is visible without anyone having to break something first.
 */
export const P16_PARTNERS: SeedPartner[] = [
  {
    id: P16_IDS.partners.cityQuest,
    name: 'CityQuest Experiences',
    slug: 'cityquest',
    categories: ['experiences'],
    cities: ['Bengaluru', 'Hyderabad'],
    vendorId: P16_IDS.vendors.cityQuest,
    status: 'enabled',
  },
  {
    id: P16_IDS.partners.freshPlate,
    name: 'Fresh Plate Catering',
    slug: 'fresh-plate',
    categories: ['catering'],
    cities: ['Hyderabad'],
    vendorId: P16_IDS.vendors.freshPlate,
    status: 'enabled',
  },
  {
    id: P16_IDS.partners.kindlyGifts,
    name: 'Kindly Gifts',
    slug: 'kindly-gifts',
    categories: ['gifts_and_kits'],
    cities: ['Bengaluru', 'Hyderabad', 'New York'],
    vendorId: null,
    status: 'paused',
  },
];

export interface SeedWidget {
  id: string;
  name: string;
  kind: 'team_budget' | 'upcoming_events';
  allowedOrigins: string[];
  showAmounts: boolean;
  eventCount: number;
}

/**
 * Both widgets name exact sites. `.test` is reserved for exactly this (RFC 6761), so nothing here
 * resolves to a real address.
 */
export const P16_WIDGETS: SeedWidget[] = [
  {
    id: P16_IDS.widgets.teamBudget,
    name: 'Intranet: your team budget',
    kind: 'team_budget',
    allowedOrigins: ['https://intranet.example.test'],
    showAmounts: true,
    eventCount: 3,
  },
  {
    id: P16_IDS.widgets.upcomingEvents,
    name: 'HR portal: upcoming events',
    kind: 'upcoming_events',
    allowedOrigins: ['https://hr.example.test', 'https://intranet.example.test'],
    showAmounts: false,
    eventCount: 3,
  },
];

/** Surface configuration the seed writes: what a company that has adopted these would have on. */
export const P16_SURFACES = {
  bi: { enabled: true, datasets: ['budgets', 'company_rollup', 'ledger_summary'] },
  assistants: {
    enabled: true,
    tools: [
      'list_my_budgets',
      'get_budget_balance',
      'list_my_requests',
      'get_request_status',
      'list_waiting_approvals',
      'search_events',
    ],
    /** Named apps only: "any assistant that can sign in" is available but not the seeded choice. */
    allowedApps: ['bf-demo-assistant'],
  },
  /** Zapier allowed, the other three not: every platform starts Not allowed until someone decides. */
  automations: { enabled: true, platforms: ['zapier'] },
  marketplace: { enabled: true },
} as const;

export interface SeedEcosystemConnection {
  id: string;
  kind: 'bi' | 'assistant' | 'automation';
  /** Seed user id; the runner resolves the person and their identity provider subject. */
  userId: string;
  clientKey: string;
  label: string;
  grants: string[];
  consentText: string;
  lifetimeDays: number;
}

export const P16_CONNECTIONS: SeedEcosystemConnection[] = [
  {
    id: P16_IDS.connections.analystPowerBi,
    kind: 'bi',
    userId: 'analyst',
    clientKey: 'power_bi',
    label: 'Finance modelling workbook',
    grants: ['budgets', 'company_rollup'],
    consentText: 'Power BI reads the datasets you chose, with your own access.',
    lifetimeDays: 90,
  },
  {
    id: P16_IDS.connections.organizerAssistant,
    kind: 'assistant',
    userId: 'event-organizer',
    clientKey: 'bf-demo-assistant',
    label: 'My desktop assistant',
    grants: ['list_my_budgets', 'get_budget_balance', 'list_waiting_approvals', 'search_events'],
    consentText:
      'Your AI assistant wants to read budgets, requests, approvals and events you can see in BudgetFlow. It cannot approve or change anything.',
    lifetimeDays: 30,
  },
  {
    id: P16_IDS.connections.organizerAutomation,
    kind: 'automation',
    userId: 'event-organizer',
    clientKey: 'zapier',
    label: 'Event request intake form',
    grants: ['budget.balance.read', 'request.draft.create'],
    consentText:
      'The platform wants to read budgets you can see and create drafts as you. It cannot approve, submit or move money.',
    lifetimeDays: 90,
  },
];
