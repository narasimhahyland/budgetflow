import { seedId, TENANTS } from './ids';
import { P5_IDS } from './events';

/**
 * Phase 13 fixtures (id prefix 91): the AI feature switches for the local stack and demo, the AI
 * settings of 113a, and two receipt files plus one vendor quote the offline recorded provider has
 * recorded answers for. All fictional.
 */
export const P13_IDS = {
  receiptCafeMocha: seedId('91000000', 1),
  receiptWestlakeHotel: seedId('91000000', 2),
  quoteDeccanKitchen: seedId('91000000', 3),
} as const;

/**
 * Features start off in a new deployment; the seed turns them on so the local stack and the demo
 * show them. Ask in Slack and Teams stays off: it needs the chat app (061e) to be connected first.
 */
export const AI_SEED_FEATURES: readonly { key: string; enabled: boolean }[] = [
  { key: 'ai.allocation_suggestions', enabled: true },
  { key: 'ai.anomaly_flags', enabled: true },
  { key: 'ai.ask', enabled: true },
  { key: 'ai.ask_chat', enabled: false },
  { key: 'ai.extraction', enabled: true },
  // Phase 15 drafting features; drafted text still needs a person to approve it before it counts.
  { key: 'ai.leadership_summary', enabled: true },
  { key: 'ai.matching', enabled: true },
  { key: 'ai.outlook', enabled: true },
  { key: 'ai.policy_explain', enabled: true },
  { key: 'ai.variance_commentary', enabled: true },
];

/** 113a settings card: question limit, history retention and the nudge thresholds. */
export const AI_SEED_SETTINGS = {
  questionsPerPersonPerHour: 50,
  conversationHistoryDays: 30,
  nudgeMinimumAmount: { amountMinor: 50_000, currency: 'USD' },
  nudgeMinimumPct: 10,
  nudgeFrequencyDays: 14,
  showFlagsToApprovers: true,
} as const;

/**
 * Files the recorded provider has readings for. The content is never stored: only the file name, which is what
 * the recorded answers are keyed on, so extraction is reproducible with no object storage involved.
 */
export const AI_SEED_DOCUMENTS = [
  {
    id: P13_IDS.receiptCafeMocha,
    tenantId: TENANTS.acme,
    ownerType: 'request',
    ownerId: P5_IDS.requests.teamLunch,
    kind: 'receipt',
    fileName: 'receipt-cafe-mocha.pdf',
    contentType: 'application/pdf',
    sizeBytes: 48_120,
    sha256: '91a13000000000000000000000000000000000000000000000000000000000a1',
    storageKey: 'seed/p13/receipt-cafe-mocha.pdf',
    status: 'available',
  },
  {
    id: P13_IDS.receiptWestlakeHotel,
    tenantId: TENANTS.acme,
    ownerType: 'request',
    ownerId: P5_IDS.requests.teamLunch,
    kind: 'receipt',
    fileName: 'receipt-westlake-hotel.pdf',
    contentType: 'application/pdf',
    sizeBytes: 51_300,
    sha256: '91a13000000000000000000000000000000000000000000000000000000000a2',
    storageKey: 'seed/p13/receipt-westlake-hotel.pdf',
    status: 'available',
  },
  {
    id: P13_IDS.quoteDeccanKitchen,
    tenantId: TENANTS.acme,
    ownerType: 'request',
    ownerId: P5_IDS.requests.teamLunch,
    kind: 'quotation',
    fileName: 'quote-deccan-kitchen.pdf',
    contentType: 'application/pdf',
    sizeBytes: 96_440,
    sha256: '91a13000000000000000000000000000000000000000000000000000000000a3',
    storageKey: 'seed/p13/quote-deccan-kitchen.pdf',
    status: 'available',
  },
] as const;
