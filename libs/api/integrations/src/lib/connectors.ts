import type {
  IntegrationCategory,
  IntegrationProvider,
  PushKind,
  SyncDirection,
  SyncObject,
} from '@bf/contracts';

/** The Phase 6 actuals sources a connector can feed; `null` means the object carries no money. */
export type ConnectorSource = 'card' | 'expense' | 'travel' | 'erp' | 'ap';

/**
 * The connector port. Every adapter is the same shape: a list of objects it can exchange, where to
 * find them at the provider, and how one provider record becomes either a canonical actuals line or
 * a plain record. Keeping it declarative means a new connector is data, not a new code path, and the
 * mock provider in `infra/mock-providers` can answer for all of them.
 */

/** Canonical actuals columns (Phase 6 `ACTUAL_IMPORT_FIELDS`); the sync engine writes them as CSV. */
export interface ActualLine {
  source_ref: string;
  transaction_date: string;
  accounting_date?: string;
  amount: string;
  currency: string;
  legal_entity: string;
  cost_center?: string;
  gl_account?: string;
  event_code?: string;
  vendor?: string;
  merchant?: string;
  memo?: string;
  reference?: string;
  original_ref?: string;
  kind?: string;
  card_program?: string;
}

export interface InboundRecord {
  /** Stable id at the provider; the run de-duplicates on it before anything is applied. */
  externalId: string;
  /** Present for money-bearing objects, which always go through the actuals review. */
  actual?: ActualLine;
  /** Everything else (workers, calendar responses, suppliers, plan rows). */
  data?: Record<string, string>;
  /** Set when a value the record needs has no mapping; the record is held back, never guessed. */
  requiresMapping?: { kind: string; value: string };
}

export interface ObjectSpec {
  object: SyncObject;
  direction: SyncDirection;
  /** Path at the provider, relative to the connection's base URL. */
  path: string;
  /** Key holding the array in the provider's envelope, or null when the body is the array. */
  envelope: string | null;
  /** Field the incremental cursor compares against. */
  cursorField: string;
  /** Which actuals source the lines enter the review queue as; null for non-money objects. */
  source: ConnectorSource | null;
  map: (row: Record<string, unknown>, ctx: MappingContext) => InboundRecord;
}

export interface PushSpec {
  kind: PushKind;
  path: string;
  /** Where the provider returns the id it created. */
  externalIdPath: string[];
}

export interface MappingContext {
  /** `${kind}:${externalValue}` to the BudgetFlow value, from `integration_mappings`. */
  mappings: ReadonlyMap<string, string>;
}

export interface ConnectorDefinition {
  provider: IntegrationProvider;
  category: IntegrationCategory;
  displayName: string;
  /** Plain-English list for the hub picker (092). */
  exchanges: string[];
  /** Path used by "Test connection"; a 200 means the credentials work. */
  testPath: string;
  /** Inbound callbacks are verified with HMAC and a timestamp window before any business logic. */
  supportsInboundWebhook: boolean;
  objects: ObjectSpec[];
  pushes: PushSpec[];
}

const text = (row: Record<string, unknown>, key: string): string => {
  const v = key.split('.').reduce<unknown>((acc, k) => (acc as never)?.[k], row);
  return v === null || v === undefined ? '' : String(v);
};

/** Resolves an external value through the connection's mappings; absent means "hold this record". */
const mapped = (
  ctx: MappingContext,
  kind: string,
  value: string,
): { value: string } | { missing: string } => {
  if (!value) return { value: '' };
  const hit = ctx.mappings.get(`${kind}:${value.toLowerCase()}`);
  return hit === undefined ? { missing: value } : { value: hit };
};

/** ERP and planning systems all expose GL lines with the same meaning under different field names. */
const erpLine =
  (fields: {
    id: string;
    date: string;
    amount: string;
    currency: string;
    entity: string;
    costCenter: string;
    account: string;
    eventCode: string;
    vendor: string;
    memo: string;
  }) =>
  (row: Record<string, unknown>): InboundRecord => ({
    externalId: text(row, fields.id),
    actual: {
      source_ref: text(row, fields.id),
      transaction_date: text(row, fields.date),
      accounting_date: text(row, fields.date),
      amount: text(row, fields.amount),
      currency: text(row, fields.currency),
      legal_entity: text(row, fields.entity),
      cost_center: text(row, fields.costCenter),
      gl_account: text(row, fields.account),
      event_code: text(row, fields.eventCode),
      vendor: text(row, fields.vendor),
      memo: text(row, fields.memo),
      kind: 'charge',
    },
  });

const cardLine =
  (fields: {
    id: string;
    date: string;
    amount: string;
    currency: string;
    merchant: string;
    program: string;
  }) =>
  (row: Record<string, unknown>): InboundRecord => ({
    externalId: text(row, fields.id),
    actual: {
      source_ref: text(row, fields.id),
      transaction_date: text(row, fields.date),
      accounting_date: text(row, fields.date),
      amount: text(row, fields.amount),
      currency: text(row, fields.currency),
      legal_entity: text(row, 'entity_code'),
      cost_center: text(row, 'cost_center'),
      gl_account: text(row, 'gl_account'),
      event_code: text(row, 'event_code'),
      merchant: text(row, fields.merchant),
      memo: text(row, 'memo'),
      card_program: text(row, fields.program),
      kind: 'charge',
    },
  });

/** Expense lines carry an expense type that must map to a BudgetFlow category before they are used. */
const expenseLine = (row: Record<string, unknown>, ctx: MappingContext): InboundRecord => {
  const expenseType = text(row, 'ExpenseTypeName');
  const category = mapped(ctx, 'expense_type', expenseType);
  if ('missing' in category) {
    return {
      externalId: text(row, 'ID'),
      requiresMapping: { kind: 'expense_type', value: category.missing },
    };
  }
  return {
    externalId: text(row, 'ID'),
    actual: {
      source_ref: text(row, 'ID'),
      transaction_date: text(row, 'TransactionDate'),
      accounting_date: text(row, 'TransactionDate'),
      amount: text(row, 'TransactionAmount'),
      currency: text(row, 'TransactionCurrencyCode'),
      legal_entity: text(row, 'CompanyCode'),
      cost_center: text(row, 'CostCenter'),
      gl_account: text(row, 'AccountCode'),
      event_code: text(row, 'EventCode'),
      vendor: text(row, 'VendorDescription'),
      memo: text(row, 'Description'),
      reference: text(row, 'CardTransactionId'),
      kind: 'charge',
    },
  };
};

const ERP_PUSHES = (path: string): PushSpec[] => [
  { kind: 'event_code', path, externalIdPath: ['data', 'name'] },
];

export const CONNECTORS: Record<IntegrationProvider, ConnectorDefinition> = {
  erpnext: {
    provider: 'erpnext',
    category: 'erp',
    displayName: 'ERPNext',
    exchanges: [
      'Inbound: GL lines, suppliers',
      'Outbound: event codes as projects',
      'Signed webhooks for near-real-time postings',
    ],
    testPath: '/erpnext/api/resource/Supplier',
    supportsInboundWebhook: true,
    objects: [
      {
        object: 'gl_lines',
        direction: 'inbound',
        path: '/erpnext/api/resource/GL Entry',
        envelope: 'data',
        cursorField: 'posting_date',
        source: 'erp',
        map: erpLine({
          id: 'name',
          date: 'posting_date',
          amount: 'debit',
          currency: 'currency',
          entity: 'company',
          costCenter: 'cost_center',
          account: 'account',
          eventCode: 'project',
          vendor: 'supplier',
          memo: 'remarks',
        }),
      },
      {
        object: 'suppliers',
        direction: 'inbound',
        path: '/erpnext/api/resource/Supplier',
        envelope: 'data',
        cursorField: 'name',
        source: null,
        map: (row) => ({ externalId: text(row, 'name'), data: { name: text(row, 'name') } }),
      },
      {
        object: 'event_codes',
        direction: 'outbound',
        path: '/erpnext/api/resource/Project',
        envelope: null,
        cursorField: '',
        source: null,
        map: (row) => ({ externalId: text(row, 'name') }),
      },
    ],
    pushes: ERP_PUSHES('/erpnext/api/resource/Project'),
  },
  odoo: {
    provider: 'odoo',
    category: 'erp',
    displayName: 'Odoo',
    exchanges: ['Inbound: journal items', 'Outbound: event codes as analytic tags'],
    testPath: '/odoo/jsonrpc/account.move.line',
    supportsInboundWebhook: true,
    objects: [
      {
        object: 'gl_lines',
        direction: 'inbound',
        path: '/odoo/jsonrpc/account.move.line',
        envelope: 'result',
        cursorField: 'date',
        source: 'erp',
        map: erpLine({
          id: 'id',
          date: 'date',
          amount: 'debit',
          currency: 'currency_id',
          entity: 'company_code',
          costCenter: 'analytic_account',
          account: 'account_code',
          eventCode: 'analytic_tag',
          vendor: 'partner_name',
          memo: 'name',
        }),
      },
    ],
    pushes: [
      {
        kind: 'event_code',
        path: '/odoo/jsonrpc/account.analytic.tag',
        externalIdPath: ['result', 'id'],
      },
    ],
  },
  workday_financials: {
    provider: 'workday_financials',
    category: 'erp',
    displayName: 'Workday Financials',
    exchanges: [
      'Inbound: journal lines',
      'Outbound: event codes as worktags',
      'Optional budget check before approving commitments',
    ],
    testPath: '/workday-financials/ccx/api/v1/journalLines',
    supportsInboundWebhook: false,
    objects: [
      {
        object: 'gl_lines',
        direction: 'inbound',
        path: '/workday-financials/ccx/api/v1/journalLines',
        envelope: 'data',
        cursorField: 'accountingDate',
        source: 'erp',
        map: erpLine({
          id: 'journalLineId',
          date: 'accountingDate',
          amount: 'amount',
          currency: 'currency',
          entity: 'company',
          costCenter: 'costCenter',
          account: 'ledgerAccount',
          eventCode: 'worktag',
          vendor: 'supplier',
          memo: 'memo',
        }),
      },
    ],
    pushes: [
      {
        kind: 'event_code',
        path: '/workday-financials/ccx/api/v1/worktags',
        externalIdPath: ['id'],
      },
    ],
  },
  netsuite: {
    provider: 'netsuite',
    category: 'erp',
    displayName: 'NetSuite',
    exchanges: ['Inbound: transactions', 'Outbound: event codes as a custom segment'],
    testPath: '/netsuite/services/rest/record/v1/transaction',
    supportsInboundWebhook: false,
    objects: [
      {
        object: 'gl_lines',
        direction: 'inbound',
        path: '/netsuite/services/rest/record/v1/transaction',
        envelope: 'items',
        cursorField: 'tranDate',
        source: 'erp',
        map: erpLine({
          id: 'tranId',
          date: 'tranDate',
          amount: 'amount',
          currency: 'currency.symbol',
          entity: 'subsidiary.name',
          costCenter: 'department.name',
          account: 'account.acctNumber',
          eventCode: 'custbody_event_code',
          vendor: 'entity.companyName',
          memo: 'memo',
        }),
      },
    ],
    pushes: [
      {
        kind: 'event_code',
        path: '/netsuite/services/rest/record/v1/customsegment',
        externalIdPath: ['id'],
      },
    ],
  },
  adaptive_planning: {
    provider: 'adaptive_planning',
    category: 'planning',
    displayName: 'Adaptive Planning',
    exchanges: [
      'Inbound: the approved plan into root budgets as a new plan version',
      'Outbound: actuals, commitments and the accepted forecast',
    ],
    testPath: '/adaptive/api/v2/plan',
    supportsInboundWebhook: false,
    objects: [
      {
        object: 'plan',
        direction: 'inbound',
        path: '/adaptive/api/v2/plan',
        envelope: 'levels',
        cursorField: 'level',
        source: null,
        map: (row) => ({
          externalId: text(row, 'level'),
          data: { level: text(row, 'level'), amount: text(row, 'amount') },
        }),
      },
      {
        object: 'actuals_export',
        direction: 'outbound',
        path: '/adaptive/api/v2/actuals',
        envelope: null,
        cursorField: '',
        source: null,
        map: (row) => ({ externalId: text(row, 'id') }),
      },
    ],
    pushes: [{ kind: 'event_code', path: '/adaptive/api/v2/actuals', externalIdPath: ['id'] }],
  },
  ramp: {
    provider: 'ramp',
    category: 'cards',
    displayName: 'Ramp',
    exchanges: [
      'Inbound: card transactions',
      'Outbound: spend limits for approved card commitments (suspend and close supported)',
    ],
    testPath: '/ramp/developer/v1/transactions',
    supportsInboundWebhook: true,
    objects: [
      {
        object: 'transactions',
        direction: 'inbound',
        path: '/ramp/developer/v1/transactions',
        envelope: 'data',
        cursorField: 'user_transaction_time',
        source: 'card',
        map: cardLine({
          id: 'id',
          date: 'user_transaction_time',
          amount: 'amount',
          currency: 'currency_code',
          merchant: 'merchant_name',
          program: 'card_program',
        }),
      },
    ],
    pushes: [{ kind: 'card_limit', path: '/ramp/developer/v1/limits', externalIdPath: ['id'] }],
  },
  brex: {
    provider: 'brex',
    category: 'cards',
    displayName: 'Brex',
    exchanges: [
      'Inbound: card transactions',
      'Outbound: spend limits (lowered to the amount spent instead of suspended)',
    ],
    testPath: '/brex/v2/transactions/card/primary',
    supportsInboundWebhook: true,
    objects: [
      {
        object: 'transactions',
        direction: 'inbound',
        path: '/brex/v2/transactions/card/primary',
        envelope: 'items',
        cursorField: 'posted_at_date',
        source: 'card',
        map: cardLine({
          id: 'id',
          date: 'posted_at_date',
          amount: 'amount.amount',
          currency: 'amount.currency',
          merchant: 'merchant.raw_descriptor',
          program: 'card_program',
        }),
      },
    ],
    pushes: [{ kind: 'card_limit', path: '/brex/v2/budgets', externalIdPath: ['id'] }],
  },
  concur: {
    provider: 'concur',
    category: 'expense',
    displayName: 'Concur',
    exchanges: [
      'Inbound: expense entries with event codes and attendees',
      'Outbound: event codes as list values, prefilled expenses',
    ],
    testPath: '/concur/api/v3.0/expense/entries',
    supportsInboundWebhook: true,
    objects: [
      {
        object: 'expense_lines',
        direction: 'inbound',
        path: '/concur/api/v3.0/expense/entries',
        envelope: 'Items',
        cursorField: 'TransactionDate',
        source: 'expense',
        map: expenseLine,
      },
    ],
    pushes: [
      { kind: 'event_code', path: '/concur/api/v3.0/common/listitems', externalIdPath: ['ID'] },
    ],
  },
  navan: {
    provider: 'navan',
    category: 'expense',
    displayName: 'Navan',
    exchanges: [
      'Inbound: every transaction type, with receipts',
      'Outbound: event-code options and coding write-back',
    ],
    // Navan calls run in the worker through NavanClient (OAuth client credentials); see navan/.
    testPath: '/v1/expense/custom-fields',
    supportsInboundWebhook: false,
    objects: [
      {
        object: 'transactions',
        direction: 'inbound',
        path: '/v1/expense/{type}-transactions',
        envelope: 'data',
        cursorField: 'modifiedAt',
        source: 'travel',
        map: (row) => ({ externalId: text(row, 'id') }),
      },
      {
        object: 'users',
        direction: 'inbound',
        path: '/v1/expense/users',
        envelope: 'data',
        cursorField: '',
        source: null,
        map: (row) => ({ externalId: text(row, 'id') }),
      },
      {
        object: 'event_codes',
        direction: 'outbound',
        path: '/v1/expense/custom-fields/{fieldId}/options/batch',
        envelope: null,
        cursorField: '',
        source: null,
        map: (row) => ({ externalId: text(row, 'value') }),
      },
      {
        object: 'cost_centers',
        direction: 'outbound',
        path: '/v1/expense/custom-fields/{fieldId}/options/batch',
        envelope: null,
        cursorField: '',
        source: null,
        map: (row) => ({ externalId: text(row, 'value') }),
      },
      {
        object: 'transactions',
        direction: 'outbound',
        path: '/v1/expense/transactions',
        envelope: null,
        cursorField: '',
        source: null,
        map: (row) => ({ externalId: text(row, 'id') }),
      },
    ],
    // Options are published by the event_codes and cost_centers runs, not as single pushes.
    pushes: [],
  },
  coupa: {
    provider: 'coupa',
    category: 'expense',
    displayName: 'Coupa',
    exchanges: [
      'Inbound: purchase orders and supplier invoices',
      'Outbound: event codes and approved commitment references',
    ],
    testPath: '/coupa/api/purchase_orders',
    supportsInboundWebhook: false,
    objects: [
      {
        object: 'purchase_orders',
        direction: 'inbound',
        path: '/coupa/api/purchase_orders',
        envelope: null,
        cursorField: 'created-at',
        source: null,
        map: (row) => ({
          externalId: text(row, 'id'),
          data: {
            id: text(row, 'id'),
            amount: text(row, 'total'),
            currency: text(row, 'currency.code'),
            supplier: text(row, 'supplier.name'),
            eventCode: text(row, 'event-code'),
            commitmentRef: text(row, 'budgetflow-commitment-ref'),
            description: text(row, 'description'),
          },
        }),
      },
      {
        object: 'supplier_invoices',
        direction: 'inbound',
        path: '/coupa/api/purchase_orders',
        envelope: null,
        cursorField: 'created-at',
        source: 'ap',
        map: erpLine({
          id: 'id',
          date: 'created-at',
          amount: 'total',
          currency: 'currency.code',
          entity: 'company-code',
          costCenter: 'cost-center',
          account: 'account',
          eventCode: 'event-code',
          vendor: 'supplier.name',
          memo: 'description',
        }),
      },
    ],
    pushes: [{ kind: 'event_code', path: '/coupa/api/custom_fields', externalIdPath: ['id'] }],
  },
  hr_file: {
    provider: 'hr_file',
    category: 'hr',
    displayName: 'HR file import',
    exchanges: [
      'Inbound only: workers, locations, cost centers',
      'All-or-nothing per run; a headcount snapshot follows each sync',
    ],
    testPath: '/hr/api/workers',
    supportsInboundWebhook: false,
    objects: [
      {
        object: 'workers',
        direction: 'inbound',
        path: '/hr/api/workers',
        envelope: 'workers',
        cursorField: 'worker_id',
        source: null,
        map: (row, ctx) => {
          const location = mapped(ctx, 'hr_field', text(row, 'location'));
          if ('missing' in location) {
            return {
              externalId: text(row, 'worker_id'),
              requiresMapping: { kind: 'hr_field', value: location.missing },
            };
          }
          return {
            externalId: text(row, 'worker_id'),
            data: {
              workerId: text(row, 'worker_id'),
              locationCode: location.value,
              employmentType: text(row, 'worker_type').toLowerCase(),
              status: text(row, 'status'),
              terminationDate: text(row, 'termination_date'),
            },
          };
        },
      },
    ],
    pushes: [],
  },
  workday_hcm: {
    provider: 'workday_hcm',
    category: 'hr',
    displayName: 'Workday HCM',
    exchanges: ['Inbound only: workers, org units, locations, cost centers'],
    testPath: '/workday-hcm/ccx/api/v1/workers',
    supportsInboundWebhook: false,
    objects: [
      {
        object: 'workers',
        direction: 'inbound',
        path: '/workday-hcm/ccx/api/v1/workers',
        envelope: 'data',
        cursorField: 'worker_id',
        source: null,
        map: (row, ctx) => {
          const location = mapped(ctx, 'hr_field', text(row, 'location'));
          if ('missing' in location) {
            return {
              externalId: text(row, 'worker_id'),
              requiresMapping: { kind: 'hr_field', value: location.missing },
            };
          }
          return {
            externalId: text(row, 'worker_id'),
            data: {
              workerId: text(row, 'worker_id'),
              locationCode: location.value,
              employmentType: text(row, 'worker_type').toLowerCase(),
              status: text(row, 'status'),
              terminationDate: text(row, 'termination_date'),
            },
          };
        },
      },
    ],
    pushes: [],
  },
  outlook: {
    provider: 'outlook',
    category: 'calendar',
    displayName: 'Microsoft Outlook',
    exchanges: [
      'Outbound: invitations from one shared BudgetFlow calendar',
      'Inbound: attendee responses (Tentative counts as no response)',
    ],
    testPath: '/graph/v1.0/shared-calendar/events/responses',
    supportsInboundWebhook: true,
    objects: [
      {
        object: 'calendar_responses',
        direction: 'inbound',
        path: '/graph/v1.0/shared-calendar/events/responses',
        envelope: 'value',
        cursorField: 'at',
        source: null,
        map: (row) => ({
          externalId: text(row, 'id'),
          data: {
            attendee: text(row, 'attendee'),
            response: text(row, 'response'),
            at: text(row, 'at'),
          },
        }),
      },
    ],
    pushes: [],
  },
  google_calendar: {
    provider: 'google_calendar',
    category: 'calendar',
    displayName: 'Google Calendar',
    exchanges: [
      'Outbound: invitations from one shared BudgetFlow calendar',
      'Inbound: attendee responses',
    ],
    testPath: '/gcal/calendar/v3/calendars/budgetflow/events/responses',
    supportsInboundWebhook: true,
    objects: [
      {
        object: 'calendar_responses',
        direction: 'inbound',
        path: '/gcal/calendar/v3/calendars/budgetflow/events/responses',
        envelope: 'items',
        cursorField: 'at',
        source: null,
        map: (row) => ({
          externalId: text(row, 'id'),
          data: {
            attendee: text(row, 'attendee'),
            response: text(row, 'response'),
            at: text(row, 'at'),
          },
        }),
      },
    ],
    pushes: [],
  },
  scim: {
    provider: 'scim',
    category: 'identity',
    displayName: 'SCIM provisioning',
    exchanges: [
      'Inbound only: the identity provider creates, updates and deactivates people',
      'Nothing is ever deleted; open approvals hand over by the delegation-of-authority rules',
    ],
    testPath: '',
    supportsInboundWebhook: false,
    objects: [
      {
        object: 'users',
        direction: 'inbound',
        path: '',
        envelope: null,
        cursorField: '',
        source: null,
        map: (row) => ({ externalId: text(row, 'externalId') }),
      },
    ],
    pushes: [],
  },
};

export const connectorFor = (provider: IntegrationProvider): ConnectorDefinition =>
  CONNECTORS[provider];

export const objectSpec = (
  provider: IntegrationProvider,
  object: SyncObject,
  direction: SyncDirection,
): ObjectSpec | undefined =>
  CONNECTORS[provider].objects.find((o) => o.object === object && o.direction === direction);

/** Picks the array out of the provider's own envelope shape. */
export function recordsFrom(body: unknown, envelope: string | null): Record<string, unknown>[] {
  const raw = envelope ? (body as Record<string, unknown>)?.[envelope] : body;
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
}

const CSV_COLUMNS: (keyof ActualLine)[] = [
  'source_ref',
  'transaction_date',
  'accounting_date',
  'amount',
  'currency',
  'legal_entity',
  'cost_center',
  'gl_account',
  'event_code',
  'vendor',
  'merchant',
  'memo',
  'reference',
  'original_ref',
  'kind',
  'card_program',
];

const csvCell = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** Connector records become the same CSV a person would upload, so one import path serves both. */
export function toActualsCsv(lines: ActualLine[]): string {
  const rows = lines.map((l) => CSV_COLUMNS.map((c) => csvCell(l[c] ?? '')).join(','));
  return [CSV_COLUMNS.join(','), ...rows].join('\n');
}
