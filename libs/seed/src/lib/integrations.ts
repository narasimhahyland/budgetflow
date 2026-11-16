import { seedId } from './ids';

/**
 * Phase 12 seed (prefix 90): connected ERP, card, expense, HR, calendar and identity systems in Mock
 * mode against the local mock providers, one planning connection whose credentials have expired, the
 * mappings those connectors need, a scoped API key for an intranet widget and a webhook endpoint
 * pointed at the mock receiver.
 *
 * Everything here is fictional. The credentials are dev-only placeholders, never real secrets: they
 * are accepted once, encrypted at rest and referenced by id, exactly like a real one would be.
 */
export const P12_IDS = {
  connections: {
    erpnext: seedId('90000000', 1),
    ramp: seedId('90000000', 2),
    concur: seedId('90000000', 3),
    hrFile: seedId('90000000', 4),
    outlook: seedId('90000000', 5),
    scim: seedId('90000000', 6),
    adaptivePlanning: seedId('90000000', 7),
  },
  secrets: {
    erpnext: seedId('90000000', 11),
    ramp: seedId('90000000', 12),
    concur: seedId('90000000', 13),
    hrFile: seedId('90000000', 14),
    outlook: seedId('90000000', 15),
    scim: seedId('90000000', 16),
    adaptivePlanning: seedId('90000000', 17),
    intranetWidgetKey: seedId('90000000', 18),
    financeHubWebhook: seedId('90000000', 19),
  },
  apiKeys: {
    intranetWidget: seedId('90000000', 20),
  },
  webhookEndpoints: {
    financeHub: seedId('90000000', 21),
  },
} as const;

/**
 * Dev-only placeholder credentials for the mock providers. The mock accepts any bearer token except
 * one containing "expired", which is how the Adaptive Planning connection shows "Needs attention".
 */
export const P12_PLACEHOLDER_CREDENTIALS = {
  erpnext: 'mock-erpnext-dev-only-0001',
  ramp: 'mock-ramp-dev-only-0001',
  concur: 'mock-concur-dev-only-0001',
  hrFile: 'mock-hr-file-dev-only-0001',
  outlook: 'mock-outlook-dev-only-0001',
  scim: 'mock-scim-dev-only-0001',
  adaptivePlanning: 'mock-adaptive-expired-dev-only-0001',
} as const;

export interface SeedConnection {
  id: string;
  secretId: string;
  provider: string;
  category: string;
  displayName: string;
  mode: 'mock';
  status: 'connected' | 'needs_attention';
  attention: string | null;
  accountRef: string | null;
  credential: string;
  settings: Record<string, unknown>;
  schedules: {
    object: string;
    direction: 'inbound' | 'outbound';
    everyMinutes: number;
    mode: 'full' | 'incremental';
    dedupeKey: string;
    paused: boolean;
  }[];
}

const schedule = (
  object: string,
  everyMinutes: number,
  mode: 'full' | 'incremental' = 'incremental',
) => ({
  object,
  direction: 'inbound' as const,
  everyMinutes,
  mode,
  dedupeKey: 'source_ref',
  paused: false,
});

export const P12_CONNECTIONS: SeedConnection[] = [
  {
    id: P12_IDS.connections.erpnext,
    secretId: P12_IDS.secrets.erpnext,
    provider: 'erpnext',
    category: 'erp',
    displayName: 'ERPNext',
    mode: 'mock',
    status: 'connected',
    attention: null,
    accountRef: 'hyland-books',
    credential: P12_PLACEHOLDER_CREDENTIALS.erpnext,
    settings: { webhooksEnabled: true },
    schedules: [schedule('gl_lines', 1440)],
  },
  {
    id: P12_IDS.connections.ramp,
    secretId: P12_IDS.secrets.ramp,
    provider: 'ramp',
    category: 'cards',
    displayName: 'Ramp',
    mode: 'mock',
    status: 'connected',
    attention: null,
    accountRef: 'hyland-cards',
    // Card-limit push changes spending power outside BudgetFlow, so it starts off (096).
    settings: { cardLimitPush: false },
    credential: P12_PLACEHOLDER_CREDENTIALS.ramp,
    schedules: [schedule('transactions', 60)],
  },
  {
    id: P12_IDS.connections.concur,
    secretId: P12_IDS.secrets.concur,
    provider: 'concur',
    category: 'expense',
    displayName: 'Concur',
    mode: 'mock',
    status: 'connected',
    attention: null,
    accountRef: 'hyland-travel',
    credential: P12_PLACEHOLDER_CREDENTIALS.concur,
    settings: { expenseHandoff: true },
    schedules: [schedule('expense_lines', 120)],
  },
  {
    id: P12_IDS.connections.hrFile,
    secretId: P12_IDS.secrets.hrFile,
    provider: 'hr_file',
    category: 'hr',
    displayName: 'HR file import',
    mode: 'mock',
    status: 'connected',
    attention: null,
    accountRef: 'hyland-people',
    credential: P12_PLACEHOLDER_CREDENTIALS.hrFile,
    settings: { snapshotAfterSync: true },
    schedules: [schedule('workers', 1440, 'full')],
  },
  {
    id: P12_IDS.connections.outlook,
    secretId: P12_IDS.secrets.outlook,
    provider: 'outlook',
    category: 'calendar',
    displayName: 'Microsoft Outlook',
    mode: 'mock',
    status: 'connected',
    attention: null,
    accountRef: 'events@example.test',
    credential: P12_PLACEHOLDER_CREDENTIALS.outlook,
    settings: { organizerAsSender: false },
    schedules: [schedule('calendar_responses', 15)],
  },
  {
    id: P12_IDS.connections.scim,
    secretId: P12_IDS.secrets.scim,
    provider: 'scim',
    category: 'identity',
    displayName: 'SCIM provisioning',
    mode: 'mock',
    status: 'connected',
    attention: null,
    accountRef: null,
    credential: P12_PLACEHOLDER_CREDENTIALS.scim,
    settings: { holdOwnerDeactivations: false },
    schedules: [],
  },
  {
    id: P12_IDS.connections.adaptivePlanning,
    secretId: P12_IDS.secrets.adaptivePlanning,
    provider: 'adaptive_planning',
    category: 'planning',
    displayName: 'Adaptive Planning',
    mode: 'mock',
    status: 'needs_attention',
    attention: '401 Unauthorized: check the client secret',
    accountRef: 'hyland-fpa',
    credential: P12_PLACEHOLDER_CREDENTIALS.adaptivePlanning,
    settings: {},
    schedules: [],
  },
];

/**
 * Mappings the connectors need. "Remote - Europe" is deliberately left unmapped so the HR sync shows
 * the mapping-gap state from 093, and "Wellness - other" is unmapped so an expense line waits as a
 * mapping error in the retry queue (100).
 */
export const P12_MAPPINGS: {
  connectionId: string;
  kind: string;
  externalValue: string;
  internalValue: string;
}[] = [
  {
    connectionId: P12_IDS.connections.hrFile,
    kind: 'hr_field',
    externalValue: 'Bengaluru',
    internalValue: 'BLR',
  },
  {
    connectionId: P12_IDS.connections.hrFile,
    kind: 'hr_field',
    externalValue: 'Hyderabad',
    internalValue: 'HYD',
  },
  {
    connectionId: P12_IDS.connections.hrFile,
    kind: 'hr_field',
    externalValue: 'New York',
    internalValue: 'NYC',
  },
  {
    connectionId: P12_IDS.connections.hrFile,
    kind: 'hr_field',
    externalValue: 'Berlin',
    internalValue: 'BER',
  },
  {
    connectionId: P12_IDS.connections.concur,
    kind: 'expense_type',
    externalValue: 'Meals - team',
    internalValue: 'TEAM-LUNCH',
  },
  {
    connectionId: P12_IDS.connections.concur,
    kind: 'expense_type',
    externalValue: 'Entertainment - client',
    internalValue: 'ENTERTAINMENT',
  },
];

/**
 * Expiry of every seeded credential (the API key here, the ecosystem connections in ./ecosystem): a
 * fixed instant rather than "now + N days". The expiry renders as an absolute date (screens 101,
 * 092a/092b), and the relative-time mask hides its glyphs but not its width, so a real-time value
 * reflowed those tables from one day to the next. A pinned "now + N days" would not do either: the API
 * checks expiry against real time (Date.now(), SQL now()), so every seeded credential would lapse on
 * one fixed real date. Far in the future, the credentials stay active on every real date.
 */
export const SEED_CREDENTIAL_EXPIRES_AT = '2099-12-31T12:00:00Z';

/** The scoped key the intranet budget widget uses; read-only, expiring, owned by a named person. */
export const P12_API_KEY = {
  id: P12_IDS.apiKeys.intranetWidget,
  name: 'Intranet budget widget',
  scopes: ['budgets.read', 'events.read'],
  expiresAt: SEED_CREDENTIAL_EXPIRES_AT,
  rateLimitPerMinute: 120,
} as const;

/** The webhook endpoint the finance hub subscribes with, pointed at the mock receiver. */
export const P12_WEBHOOK_ENDPOINT = {
  id: P12_IDS.webhookEndpoints.financeHub,
  description: 'Finance hub: control changes and threshold alerts',
  events: ['budget.frozen', 'budget.reduced', 'budget.set_to_zero', 'budget.threshold_crossed'],
  path: '/receiver/hook',
} as const;
