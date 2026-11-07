import {
  ASSISTANT_TOOLS,
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  BI_DATASETS,
  NO_CODE_PLATFORMS,
  type AssistantTool,
  type AutomationAction,
  type AutomationTrigger,
  type BiDataset,
  type NoCodePlatform,
} from '@bf/contracts';
import type { Action } from '@bf/domain';

/** Lifetimes and caps the specs fix (092a, 092b, 092c). They are limits, not preferences. */
export const ECOSYSTEM_LIMITS = {
  biConnectionLifetimeDays: 90,
  biRefreshesPerDay: 8,
  biMaxRowsPerRequest: 1_000,
  assistantConnectionLifetimeDays: 30,
  assistantMaxRecordsPerCall: 50,
  automationConnectionLifetimeDays: 90,
  /** One minute of calls any single external connection may make, whatever surface it is. */
  callsPerMinute: 60,
  expiringSoonDays: 7,
} as const;

export const MCP_PROTOCOL_VERSION = '2025-06-18';

/** The sentence every external surface carries, so no integrator has to infer the boundary. */
export const NEVER_DOES = [
  'It cannot approve, reject, submit, apply a control or move money.',
  'It never shows more than the person who connected it can see in BudgetFlow.',
] as const;

// BI datasets (092a) --------------------------------------------------------------------------------

export interface BiDatasetDefinition {
  dataset: BiDataset;
  title: string;
  description: string;
  /** The action a reader must hold for the records behind the dataset. */
  action: Action;
  fields: readonly { name: string; description: string }[];
}

const MONEY_NOTE = 'Integer minor units of the row currency.';

export const BI_DATASET_CATALOG: readonly BiDatasetDefinition[] = [
  {
    dataset: 'budgets',
    title: 'Budgets',
    description:
      'One row per budget the connecting person may read, with the app definition of every bucket.',
    action: 'budget.read',
    fields: [
      { name: 'budgetId', description: 'Budget identifier.' },
      { name: 'name', description: 'Budget name.' },
      { name: 'parentId', description: 'Parent budget, empty for a root.' },
      { name: 'ownerName', description: 'Owner display name; no email address.' },
      { name: 'status', description: 'Budget status.' },
      { name: 'categoryCode', description: 'Spend category.' },
      { name: 'currency', description: 'Budget currency, ISO 4217.' },
      { name: 'authorizedMinor', description: MONEY_NOTE },
      { name: 'allocatedOutMinor', description: MONEY_NOTE },
      { name: 'heldMinor', description: MONEY_NOTE },
      { name: 'preEncumberedMinor', description: `Pending. ${MONEY_NOTE}` },
      { name: 'encumberedMinor', description: `Committed. ${MONEY_NOTE}` },
      { name: 'actualMinor', description: MONEY_NOTE },
      {
        name: 'availableUnderRulesMinor',
        description: 'Available under this budget rules, the definition the app shows.',
      },
      {
        name: 'utilizationBps',
        description: 'Utilization in basis points of the authorized amount.',
      },
      { name: 'fiscalYearLabel', description: 'Fiscal year of the budget.' },
    ],
  },
  {
    dataset: 'company_rollup',
    title: 'Company roll-up',
    description:
      'One row per root budget with company-wide Available, where a child allocation is counted once.',
    action: 'budget.read',
    fields: [
      { name: 'budgetId', description: 'Root budget identifier.' },
      { name: 'name', description: 'Root budget name.' },
      { name: 'currency', description: 'Budget currency, ISO 4217.' },
      { name: 'authorizedMinor', description: MONEY_NOTE },
      {
        name: 'availableCompanyWideMinor',
        description:
          'Available, company-wide: authorized less held, pending, committed and actual over the whole subtree.',
      },
      { name: 'childCount', description: 'Budgets directly under this root.' },
    ],
  },
  {
    dataset: 'ledger_summary',
    title: 'Ledger summary',
    description:
      'Posted amounts by budget, accounting period and bucket. Single lines stay in BudgetFlow.',
    action: 'ledger.read',
    fields: [
      { name: 'budgetId', description: 'Budget identifier.' },
      { name: 'budgetName', description: 'Budget name.' },
      { name: 'accountingPeriodId', description: 'Accounting period of the postings.' },
      { name: 'bucket', description: 'Ledger bucket the amount sits in.' },
      { name: 'currency', description: 'Budget currency, ISO 4217.' },
      { name: 'amountMinor', description: `Net posted to the bucket. ${MONEY_NOTE}` },
      { name: 'lineCount', description: 'Ledger lines behind the amount.' },
    ],
  },
  {
    dataset: 'events',
    title: 'Events',
    description: 'Events funded from budgets the connecting person may read.',
    action: 'event.read',
    fields: [
      { name: 'eventId', description: 'Event identifier.' },
      { name: 'eventCode', description: 'Event reference.' },
      { name: 'name', description: 'Event name.' },
      { name: 'status', description: 'Event status.' },
      { name: 'startDate', description: 'First day of the event.' },
      { name: 'endDate', description: 'Last day of the event.' },
      { name: 'currency', description: 'Event currency, ISO 4217.' },
      { name: 'estimateMinor', description: MONEY_NOTE },
    ],
  },
  {
    dataset: 'requests',
    title: 'Requests',
    description: 'Spending requests on budgets the connecting person may read, with their status.',
    action: 'budget.read',
    fields: [
      { name: 'requestId', description: 'Request identifier.' },
      { name: 'ref', description: 'Request reference.' },
      { name: 'budgetId', description: 'Budget the request draws on.' },
      { name: 'status', description: 'Request status.' },
      { name: 'kind', description: 'Request kind.' },
      { name: 'categoryCode', description: 'Spend category.' },
      { name: 'currency', description: 'Request currency, ISO 4217.' },
      { name: 'amountMinor', description: MONEY_NOTE },
      { name: 'createdAt', description: 'When the request was raised, UTC.' },
    ],
  },
];

export const biDataset = (dataset: BiDataset): BiDatasetDefinition =>
  BI_DATASET_CATALOG.find((d) => d.dataset === dataset)!;

/** Datasets a tenant gets when the connector is first enabled: the budget views, nothing personal. */
export const DEFAULT_BI_DATASETS: readonly BiDataset[] = ['budgets', 'company_rollup'];

// Assistant tools (092c) -----------------------------------------------------------------------------

export interface AssistantToolDefinition {
  tool: AssistantTool;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const noArgs = { type: 'object', properties: {}, additionalProperties: false } as const;
const stringArg = (name: string, description: string, required = true) => ({
  type: 'object',
  properties: { [name]: { type: 'string', description } },
  ...(required ? { required: [name] } : {}),
  additionalProperties: false,
});

export const ASSISTANT_TOOL_CATALOG: readonly AssistantToolDefinition[] = [
  {
    tool: 'list_my_budgets',
    title: 'List my budgets',
    description:
      'Budgets you own or can see, each with Available under this budget rules. Read-only.',
    inputSchema: stringArg('search', 'Optional text to match in the budget name.', false),
  },
  {
    tool: 'get_budget_balance',
    title: 'Get a budget balance',
    description:
      'Authorized, pending, committed, actual and available for one budget you can see. Read-only.',
    inputSchema: stringArg('budgetId', 'Identifier of the budget.'),
  },
  {
    tool: 'list_my_requests',
    title: 'List my requests',
    description: 'Spending requests you raised or can see, with their status. Read-only.',
    inputSchema: noArgs,
  },
  {
    tool: 'get_request_status',
    title: 'Get a request status',
    description: 'Where one request has got to. Read-only.',
    inputSchema: stringArg('ref', 'Request reference, for example REQ-2026-0418.'),
  },
  {
    tool: 'list_waiting_approvals',
    title: 'List approvals waiting for me',
    description:
      'Approvals assigned to you, with title, amount and when they are due. It cannot decide any of them.',
    inputSchema: noArgs,
  },
  {
    tool: 'search_events',
    title: 'Search events',
    description: 'Events you can see, with their dates and status. Read-only.',
    inputSchema: stringArg('search', 'Optional text to match in the event name.', false),
  },
];

export const assistantTool = (tool: AssistantTool): AssistantToolDefinition =>
  ASSISTANT_TOOL_CATALOG.find((t) => t.tool === tool)!;

/** Every tool is on when the connector is first enabled: all six only read. */
export const DEFAULT_ASSISTANT_TOOLS: readonly AssistantTool[] = ASSISTANT_TOOLS;

export const ASSISTANT_CONSENT_TEXT =
  'Your AI assistant wants to read budgets, requests, approvals and events you can see in BudgetFlow. It cannot approve or change anything.';

/** The neutral wording of 011a: a miss never tells an assistant whether a record exists. */
export const OUT_OF_SCOPE_NOTICE = 'Not found in budgets you can see.';

// No-code automations (092b) --------------------------------------------------------------------------

export const NO_CODE_PLATFORM_TITLES: Record<NoCodePlatform, string> = {
  zapier: 'Zapier',
  make: 'Make',
  power_automate: 'Microsoft Power Automate',
  workato: 'Workato',
};

export interface AutomationActionDefinition {
  action: AutomationAction;
  title: string;
  description: string;
}

export const AUTOMATION_ACTION_CATALOG: readonly AutomationActionDefinition[] = [
  {
    action: 'budget.balance.read',
    title: 'Look up a budget balance',
    description:
      'Reads Available under this budget rules for a budget the connected person can see.',
  },
  {
    action: 'request.draft.create',
    title: 'Create a draft request',
    description:
      'Creates a Draft that stays a Draft until the person opens and submits it in BudgetFlow.',
  },
];

export const AUTOMATION_TRIGGER_TITLES: Record<AutomationTrigger, string> = {
  'budget.threshold_reached': 'Budget threshold reached',
  'budget.frozen': 'Budget frozen',
  'budget.reduced': 'Budget reduced',
  'budget.set_to_zero': 'Budget set to zero',
  'request.submitted': 'Request submitted',
  'request.decided': 'Request decided',
  'contribution.decided': 'Inter-Director Budget Contribution Request decided',
  'event.approved': 'Event approved',
  'event.closed': 'Event closed',
  'actual.matched': 'Actual matched',
  'period.closed': 'Accounting period closed',
};

export const AUTOMATION_CONSENT_TEXT =
  'The platform wants to read budgets you can see and create drafts as you. It cannot approve, submit or move money.';

// Assertions the module relies on ----------------------------------------------------------------------

/** Keeps the catalogues and the contract enums from drifting apart as either side is extended. */
export const CATALOG_COVERAGE = {
  datasets: BI_DATASETS.length === BI_DATASET_CATALOG.length,
  tools: ASSISTANT_TOOLS.length === ASSISTANT_TOOL_CATALOG.length,
  actions: AUTOMATION_ACTIONS.length === AUTOMATION_ACTION_CATALOG.length,
  triggers: AUTOMATION_TRIGGERS.every((t) => t in AUTOMATION_TRIGGER_TITLES),
  platforms: NO_CODE_PLATFORMS.every((p) => p in NO_CODE_PLATFORM_TITLES),
} as const;
