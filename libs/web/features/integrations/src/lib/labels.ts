import type {
  ApiKeyScope,
  ConnectionStatus,
  IntegrationCategory,
  IntegrationErrorClass,
  IntegrationMode,
  MappingKind,
  SyncDirection,
  SyncObject,
  SyncStatus,
  WebhookEventType,
} from '@bf/contracts';

/** Satori status-tag tones. Every tone is paired with words, never used as the only signal. */
export type Tone = 'info' | 'success' | 'warning' | 'important' | 'neutral';

export const CATEGORY_LABELS: Record<IntegrationCategory, string> = {
  erp: 'ERP and finance',
  planning: 'Planning',
  cards: 'Corporate cards',
  expense: 'Travel, expense and procurement',
  hr: 'HR',
  calendar: 'Calendar',
  identity: 'Identity',
};

/** The order the hub groups categories in, so the tiles never move between loads. */
export const CATEGORY_ORDER: IntegrationCategory[] = [
  'erp',
  'planning',
  'cards',
  'expense',
  'hr',
  'calendar',
  'identity',
];

export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  not_connected: 'Not connected',
  connected: 'Connected',
  needs_attention: 'Needs attention',
  paused: 'Paused',
};

export const CONNECTION_STATUS_TONES: Record<ConnectionStatus, Tone> = {
  not_connected: 'neutral',
  connected: 'success',
  needs_attention: 'important',
  paused: 'neutral',
};

export const MODE_LABELS: Record<IntegrationMode, string> = {
  mock: 'Mock',
  sandbox: 'Sandbox',
  live: 'Live',
};

export const SYNC_OBJECT_LABELS: Record<SyncObject, string> = {
  gl_lines: 'GL lines',
  gl_balances: 'GL balances',
  cost_centers: 'Cost centers',
  suppliers: 'Suppliers',
  transactions: 'Card transactions',
  expense_lines: 'Expense lines',
  purchase_orders: 'Purchase orders',
  supplier_invoices: 'Supplier invoices',
  workers: 'Workers',
  calendar_responses: 'Calendar responses',
  users: 'Users',
  plan: 'Plan',
  event_codes: 'Event codes',
  card_limits: 'Card limits',
  actuals_export: 'Actuals export',
};

export const DIRECTION_LABELS: Record<SyncDirection, string> = {
  inbound: 'Inbound',
  outbound: 'Outbound',
};

export const SYNC_STATUS_LABELS: Record<SyncStatus, string> = {
  running: 'Running',
  succeeded: 'Succeeded',
  partly_succeeded: 'Partly succeeded',
  failed: 'Failed',
};

export const SYNC_STATUS_TONES: Record<SyncStatus, Tone> = {
  running: 'info',
  succeeded: 'success',
  partly_succeeded: 'warning',
  failed: 'important',
};

export const MAPPING_KIND_LABELS: Record<MappingKind, string> = {
  legal_entity: 'Legal entity',
  cost_center: 'Cost center',
  gl_account: 'GL account',
  category: 'Category',
  card_program: 'Card program',
  expense_type: 'Expense type',
  hr_field: 'HR field',
  plan_level: 'Plan level',
  group_role: 'Group to role',
};

export const ERROR_CLASS_LABELS: Record<IntegrationErrorClass, string> = {
  authentication: 'Authentication',
  validation: 'Validation',
  mapping: 'Mapping',
  rate_limit: 'Rate limit',
  provider_unavailable: 'Provider unavailable',
  signature: 'Signature',
};

/** What an API key scope lets a caller do, in the words a reviewer needs to approve it. */
export const SCOPE_LABELS: Record<ApiKeyScope, string> = {
  'budgets.read': 'Read budgets and their balances',
  'ledger.read': 'Read ledger lines',
  'reports.read': 'Run and read reports',
  'events.read': 'Read events',
  'events.write': 'Create and change draft events',
  'actuals.write': 'Feed lines into the actuals review queue',
  'webhooks.manage': 'Manage webhook endpoints',
};

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventType, string> = {
  'budget.frozen': 'Budget frozen',
  'budget.reduced': 'Budget reduced',
  'budget.set_to_zero': 'Budget set to zero',
  'budget.threshold_crossed': 'Budget threshold crossed',
  'request.submitted': 'Request submitted',
  'request.approved': 'Request approved',
  'request.rejected': 'Request rejected',
  'commitment.created': 'Commitment created',
  'commitment.released': 'Commitment released',
  'actual.matched': 'Actual matched',
  'event.approved': 'Event approved',
  'event.closed': 'Event closed',
  'period.closed': 'Accounting period closed',
};

/** A connector is degraded when it cannot do the job it was connected for. */
export const isDegraded = (status: ConnectionStatus): boolean =>
  status === 'needs_attention' || status === 'paused';
