import { z } from 'zod';
import { CurrencyCode, CursorQuery, Id, IsoDate, IsoDateTime, Money } from '../common';
import type { Endpoint } from '../endpoint';
import { named } from '../registry';

// Connectors -----------------------------------------------------------------------------------

export const INTEGRATION_CATEGORIES = [
  'erp',
  'planning',
  'cards',
  'expense',
  'hr',
  'calendar',
  'identity',
] as const;
export const IntegrationCategory = z
  .enum(INTEGRATION_CATEGORIES)
  .describe('Connector family on the integrations hub (092).');

export const INTEGRATION_PROVIDERS = [
  'erpnext',
  'odoo',
  'workday_financials',
  'netsuite',
  'adaptive_planning',
  'ramp',
  'brex',
  'concur',
  'navan',
  'coupa',
  'hr_file',
  'workday_hcm',
  'outlook',
  'google_calendar',
  'scim',
] as const;
export const IntegrationProvider = z
  .enum(INTEGRATION_PROVIDERS)
  .describe('External system BudgetFlow exchanges data with.');
export type IntegrationProvider = z.infer<typeof IntegrationProvider>;

export const INTEGRATION_MODES = ['mock', 'sandbox', 'live'] as const;
export const IntegrationMode = z
  .enum(INTEGRATION_MODES)
  .describe('Mock runs against the local mock provider; sandbox and live call the real system.');

export const CONNECTION_STATUSES = [
  'not_connected',
  'connected',
  'needs_attention',
  'paused',
] as const;
export const ConnectionStatus = z.enum(CONNECTION_STATUSES);

export const SYNC_OBJECTS = [
  'gl_lines',
  'gl_balances',
  'cost_centers',
  'suppliers',
  'transactions',
  'expense_lines',
  'purchase_orders',
  'supplier_invoices',
  'workers',
  'calendar_responses',
  'users',
  'plan',
  'event_codes',
  'card_limits',
  'actuals_export',
] as const;
export const SyncObject = z
  .enum(SYNC_OBJECTS)
  .describe('What a sync run moves, in one direction, for one connector.');
export type SyncObject = z.infer<typeof SyncObject>;

export const SYNC_DIRECTIONS = ['inbound', 'outbound'] as const;
export const SyncDirection = z.enum(SYNC_DIRECTIONS);

export const SYNC_STATUSES = ['running', 'succeeded', 'partly_succeeded', 'failed'] as const;
export const SyncStatus = z.enum(SYNC_STATUSES);

export const ERROR_CLASSES = [
  'authentication',
  'validation',
  'mapping',
  'rate_limit',
  'provider_unavailable',
  'signature',
] as const;
export const IntegrationErrorClass = z
  .enum(ERROR_CLASSES)
  .describe('Why a message failed; signature failures are never retried (100).');

export const MESSAGE_STATUSES = ['retrying', 'dead_letter', 'discarded', 'succeeded'] as const;
export const IntegrationMessageStatus = z.enum(MESSAGE_STATUSES);

export const MAPPING_KINDS = [
  'legal_entity',
  'cost_center',
  'gl_account',
  'category',
  'card_program',
  'expense_type',
  'hr_field',
  'plan_level',
  'group_role',
  'person',
] as const;
export const MappingKind = z.enum(MAPPING_KINDS);

export const SecretReference = named(
  'SecretReference',
  z
    .object({
      secretRef: Id.nullable().describe('Opaque id of the stored credential; never the value.'),
      setAt: IsoDateTime.nullable(),
      setByName: z.string().nullable(),
    })
    .strict()
    .describe('Credentials are write-only: accepted once, encrypted at rest, never returned.'),
);

export const SyncSchedule = named(
  'SyncSchedule',
  z
    .object({
      object: SyncObject,
      direction: SyncDirection,
      everyMinutes: z.int().min(5).max(10_080),
      mode: z.enum(['full', 'incremental']),
      dedupeKey: z.string().max(100),
      paused: z.boolean(),
      nextRunAt: IsoDateTime.nullable(),
    })
    .strict(),
);
export type SyncSchedule = z.infer<typeof SyncSchedule>;

export const ConnectionSummary = named(
  'ConnectionSummary',
  z
    .object({
      id: Id,
      provider: IntegrationProvider,
      category: IntegrationCategory,
      displayName: z.string(),
      status: ConnectionStatus,
      mode: IntegrationMode,
      lastSyncAt: IsoDateTime.nullable(),
      recordsLast24h: z.int(),
      errorsLast24h: z.int(),
      attention: z.string().nullable().describe('One plain-English line for the tile.'),
      pausedByName: z.string().nullable(),
    })
    .strict(),
);
export type ConnectionSummary = z.infer<typeof ConnectionSummary>;

export const IntegrationsHealth = named(
  'IntegrationsHealth',
  z
    .object({
      connected: z.int(),
      needsAttention: z.int(),
      notConnected: z.int(),
      retrying: z.int(),
      deadLetter: z.int(),
    })
    .strict(),
);

export const IntegrationsHub = named(
  'IntegrationsHub',
  z
    .object({
      health: IntegrationsHealth,
      connections: z.array(ConnectionSummary),
      available: z
        .array(
          z
            .object({
              provider: IntegrationProvider,
              category: IntegrationCategory,
              displayName: z.string(),
              exchanges: z.array(z.string()),
            })
            .strict(),
        )
        .describe('Connectors that can still be added (092 picker).'),
      canManage: z.boolean(),
    })
    .strict(),
);
export type IntegrationsHub = z.infer<typeof IntegrationsHub>;

export const MappingEntry = named(
  'MappingEntry',
  z
    .object({
      id: Id,
      kind: MappingKind,
      externalValue: z.string(),
      internalId: Id.nullable(),
      internalValue: z.string().nullable(),
      approved: z.boolean().describe('GL account and legal entity mappings need Finance Admin.'),
    })
    .strict(),
);

export const ConnectionDetail = named(
  'ConnectionDetail',
  z
    .object({
      summary: ConnectionSummary,
      baseUrl: z.string().nullable(),
      accountRef: z.string().nullable().describe('Account or tenant id at the provider.'),
      credential: SecretReference,
      settings: z.record(z.string(), z.unknown()),
      schedules: z.array(SyncSchedule),
      mappings: z.array(MappingEntry),
      objects: z
        .array(z.object({ object: SyncObject, direction: SyncDirection }).strict())
        .describe('What this connector can exchange.'),
      inboundWebhookPath: z
        .string()
        .nullable()
        .describe('Where the provider posts HMAC-signed callbacks.'),
      recordsIn24h: z.int(),
      recordsOut24h: z.int(),
    })
    .strict(),
);
export type ConnectionDetail = z.infer<typeof ConnectionDetail>;

export const ConnectRequest = named(
  'ConnectRequest',
  z
    .object({
      provider: IntegrationProvider,
      mode: IntegrationMode,
      displayName: z.string().trim().min(1).max(120).optional(),
      baseUrl: z.url().max(300).optional(),
      accountRef: z.string().trim().max(120).optional(),
      clientId: z.string().trim().max(200).optional(),
      credential: z
        .string()
        .min(8)
        .max(500)
        .describe('Write-only: encrypted at rest and referenced by id. Never returned or logged.'),
      settings: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
);
export type ConnectRequest = z.infer<typeof ConnectRequest>;

export const UpdateConnectionRequest = named(
  'UpdateConnectionRequest',
  z
    .object({
      displayName: z.string().trim().min(1).max(120).optional(),
      mode: IntegrationMode.optional(),
      paused: z.boolean().optional(),
      settings: z.record(z.string(), z.unknown()).optional(),
      schedules: z
        .array(
          z
            .object({
              object: SyncObject,
              direction: SyncDirection,
              everyMinutes: z.int().min(5).max(10_080),
              mode: z.enum(['full', 'incremental']).optional(),
              paused: z.boolean().optional(),
            })
            .strict(),
        )
        .optional(),
    })
    .strict(),
);
export type UpdateConnectionRequest = z.infer<typeof UpdateConnectionRequest>;

export const ReplaceCredentialRequest = named(
  'ReplaceCredentialRequest',
  z.object({ credential: z.string().min(8).max(500) }).strict(),
);

export const TestConnectionResult = named(
  'TestConnectionResult',
  z
    .object({
      ok: z.boolean(),
      statusCode: z.int().nullable(),
      durationMs: z.int(),
      message: z.string().describe("The provider's message, safe to show; never a credential."),
    })
    .strict(),
);
export type TestConnectionResult = z.infer<typeof TestConnectionResult>;

export const PutMappingsRequest = named(
  'PutMappingsRequest',
  z
    .object({
      entries: z
        .array(
          z
            .object({
              kind: MappingKind,
              externalValue: z.string().trim().min(1).max(200),
              internalId: Id.nullable().optional(),
              internalValue: z.string().trim().max(200).nullable().optional(),
            })
            .strict(),
        )
        .max(500),
    })
    .strict(),
);

// Sync runs (099) ------------------------------------------------------------------------------

export const SyncRunView = named(
  'SyncRunView',
  z
    .object({
      id: Id,
      connectionId: Id,
      provider: IntegrationProvider,
      object: SyncObject,
      direction: SyncDirection,
      mode: IntegrationMode,
      status: SyncStatus,
      startedAt: IsoDateTime,
      finishedAt: IsoDateTime.nullable(),
      durationMs: z.int().nullable(),
      recordsRead: z.int(),
      recordsApplied: z.int(),
      recordsSkippedDuplicate: z.int(),
      recordsFailed: z.int(),
      cursor: z.string().nullable().describe('Watermark used for incremental sync.'),
      idempotencyKey: z.string(),
      importBatchId: Id.nullable().describe('The actuals review batch this run created (080a).'),
      errorSummary: z.string().nullable(),
      triggeredByName: z.string().nullable(),
    })
    .strict(),
);
export type SyncRunView = z.infer<typeof SyncRunView>;

export const SyncRunList = named(
  'SyncRunList',
  z
    .object({
      items: z.array(SyncRunView),
      summary: z
        .object({
          runs24h: z.int(),
          succeeded: z.int(),
          partlySucceeded: z.int(),
          failed: z.int(),
          recordsIn: z.int(),
          recordsOut: z.int(),
        })
        .strict(),
    })
    .strict(),
);

export const SyncRunsQuery = z
  .object({
    connectionId: Id.optional(),
    direction: SyncDirection.optional(),
    object: SyncObject.optional(),
    status: SyncStatus.optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();

export const RunSyncRequest = named(
  'RunSyncRequest',
  z
    .object({
      object: SyncObject,
      direction: SyncDirection.default('inbound'),
      since: IsoDate.optional().describe('Window start; defaults to the stored cursor.'),
    })
    .strict()
    .describe('Run now. Safe to repeat: runs are idempotent per connector, object and window.'),
);
export type RunSyncRequest = z.infer<typeof RunSyncRequest>;

// Errors, retries and the dead letter (100) ------------------------------------------------------

export const IntegrationMessageView = named(
  'IntegrationMessageView',
  z
    .object({
      id: Id,
      connectionId: Id,
      provider: IntegrationProvider,
      direction: SyncDirection,
      item: z.string().describe('What failed, in plain English ("GL line 9001-332").'),
      errorClass: IntegrationErrorClass,
      lastError: z.string(),
      attempts: z.int(),
      maxAttempts: z.int(),
      firstFailedAt: IsoDateTime,
      nextRetryAt: IsoDateTime.nullable(),
      movedToDeadLetterAt: IsoDateTime.nullable(),
      status: IntegrationMessageStatus,
      discardReasonCode: z.string().nullable(),
      discardReason: z.string().nullable(),
      payloadRedacted: z
        .record(z.string(), z.unknown())
        .describe('Tokens, signatures and card numbers are masked before storage.'),
      idempotencyKey: z.string(),
    })
    .strict(),
);
export type IntegrationMessageView = z.infer<typeof IntegrationMessageView>;

export const IntegrationMessageList = named(
  'IntegrationMessageList',
  z
    .object({
      items: z.array(IntegrationMessageView),
      retrying: z.int(),
      deadLetter: z.int(),
    })
    .strict(),
);

export const IntegrationMessagesQuery = z
  .object({
    status: IntegrationMessageStatus.optional(),
    connectionId: Id.optional(),
    direction: SyncDirection.optional(),
    errorClass: IntegrationErrorClass.optional(),
  })
  .strict();

export const RetryMessagesRequest = named(
  'RetryMessagesRequest',
  z
    .object({ ids: z.array(Id).min(1).max(100) })
    .strict()
    .describe('Retry reuses the original idempotency key, so a success never duplicates.'),
);

export const DiscardMessagesRequest = named(
  'DiscardMessagesRequest',
  z
    .object({
      ids: z.array(Id).min(1).max(100),
      reasonCode: z.string().trim().min(2).max(40),
      reason: z.string().trim().min(5).max(500),
    })
    .strict(),
);

export const MessageActionResult = named(
  'MessageActionResult',
  z
    .object({
      succeeded: z.int(),
      stillFailing: z.int(),
      discarded: z.int(),
      items: z.array(IntegrationMessageView),
    })
    .strict(),
);
export type MessageActionResult = z.infer<typeof MessageActionResult>;

// Outbound pushes: event codes and card limits (99b) ----------------------------------------------

export const PUSH_KINDS = ['event_code', 'card_limit', 'cost_center'] as const;
export const PushKind = z.enum(PUSH_KINDS);

export const PushItemView = named(
  'PushItemView',
  z
    .object({
      id: Id,
      connectionId: Id,
      provider: IntegrationProvider,
      kind: PushKind,
      reference: z.string().describe('Event code, cost center code or commitment reference.'),
      amount: Money.nullable(),
      validFrom: IsoDate.nullable(),
      validTo: IsoDate.nullable(),
      status: z
        .enum(['pending', 'pushed', 'failed', 'closed', 'disabled'])
        .describe(
          'Disabled: an option published to the provider and switched off there because its budget no longer accepts spend.',
        ),
      externalId: z.string().nullable(),
      lastError: z.string().nullable(),
      pushedAt: IsoDateTime.nullable(),
    })
    .strict(),
);
export type PushItemView = z.infer<typeof PushItemView>;

export const PushItemList = named(
  'PushItemList',
  z.object({ items: z.array(PushItemView), cardLimitPushEnabled: z.boolean() }).strict(),
);

export const CreatePushRequest = named(
  'CreatePushRequest',
  z
    .object({
      connectionId: Id,
      kind: PushKind,
      eventId: Id.optional(),
      commitmentId: Id.optional(),
    })
    .strict()
    .describe('A card limit never exceeds the approved commitment at the locked plan rate.'),
);
export type CreatePushRequest = z.infer<typeof CreatePushRequest>;

// Navan live integration (16a) ---------------------------------------------------------------------

export const NAVAN_REGIONS = ['us', 'eu'] as const;
export const NavanRegion = z
  .enum(NAVAN_REGIONS)
  .describe('Where the Navan account is hosted; EU accounts send the region header on every call.');
export type NavanRegion = z.infer<typeof NavanRegion>;

export const NavanSettings = named(
  'NavanSettings',
  z
    .object({
      region: NavanRegion.default('us'),
      expenseWrite: z
        .boolean()
        .default(false)
        .describe(
          'The Expense: Write scope was granted to these credentials. Off means read only: no option, coding or write-back call is made.',
        ),
      eventCodeFieldId: z
        .string()
        .trim()
        .max(120)
        .nullable()
        .default(null)
        .describe('The Navan list field BudgetFlow publishes event codes into.'),
      costCenterFieldId: z
        .string()
        .trim()
        .max(120)
        .nullable()
        .default(null)
        .describe('The Navan list field BudgetFlow publishes cost centers into.'),
      systemOfRecord: z
        .boolean()
        .default(false)
        .describe(
          "BudgetFlow is the accounting system of record for Navan spend. Only then does write-back mark transactions as synced; otherwise Navan's ERP sync status is never touched.",
        ),
      pageSize: z.int().min(1).max(500).default(500).describe('Transactions per page (1-500).'),
      writeBatchSize: z
        .int()
        .min(1)
        .max(100)
        .default(100)
        .describe('Transactions per write-back PATCH; Navan accepts at most 100.'),
    })
    .strip()
    .describe('Navan connection settings, kept in the connection settings.'),
);
export type NavanSettings = z.infer<typeof NavanSettings>;

export const NavanCustomField = named(
  'NavanCustomField',
  z
    .object({
      id: z.string(),
      name: z.string(),
      type: z.string().describe('LIST fields take options; other types cannot hold event codes.'),
      optionCount: z.int(),
      usedFor: z
        .enum(['event_code', 'cost_center'])
        .nullable()
        .describe('What BudgetFlow publishes into this field, if anything.'),
    })
    .strict(),
);

export const NavanCustomFieldList = named(
  'NavanCustomFieldList',
  z.object({ items: z.array(NavanCustomField) }).strict(),
);
export type NavanCustomFieldList = z.infer<typeof NavanCustomFieldList>;

// Cross-source duplicates (99a) --------------------------------------------------------------------

export const DuplicateLine = named(
  'DuplicateLine',
  z
    .object({
      actualId: Id,
      source: z.string(),
      sourceRef: z.string(),
      accountingDate: IsoDate,
      transactionAmount: Money,
      reportingAmount: Money,
      merchant: z.string().nullable(),
      personName: z.string().nullable(),
      eventCode: z.string().nullable(),
      matchStatus: z.string(),
    })
    .strict(),
);

export const DuplicateGroupView = named(
  'DuplicateGroupView',
  z
    .object({
      flagId: Id,
      confidence: z.enum(['high', 'medium']),
      pattern: z.string(),
      detectedAt: IsoDateTime,
      status: z.enum(['open', 'acknowledged', 'resolved']),
      facts: z.array(z.string()).describe('Why these look like the same spend.'),
      keptActualId: Id.nullable(),
      resolution: z.enum(['kept_one', 'kept_both']).nullable(),
      resolvedByName: z.string().nullable(),
      lines: z.array(DuplicateLine),
    })
    .strict(),
);
export type DuplicateGroupView = z.infer<typeof DuplicateGroupView>;

export const DuplicateGroupList = named(
  'DuplicateGroupList',
  z.object({ items: z.array(DuplicateGroupView), open: z.int() }).strict(),
);

export const ResolveDuplicateRequest = named(
  'ResolveDuplicateRequest',
  z
    .object({
      resolution: z.enum(['kept_one', 'kept_both']),
      keepActualId: Id.optional().describe('Required for kept_one: the line that stays.'),
      reasonCode: z.string().trim().min(2).max(40),
      reason: z.string().trim().min(5).max(500),
    })
    .strict(),
);
export type ResolveDuplicateRequest = z.infer<typeof ResolveDuplicateRequest>;

// Plan import and export: Adaptive Planning (094a) -------------------------------------------------

export const AdaptivePlanLine = named(
  'AdaptivePlanLine',
  z
    .object({
      level: z.string(),
      rootBudgetId: Id.nullable(),
      rootBudgetName: z.string().nullable(),
      currentAmount: Money.nullable(),
      proposedAmount: Money,
      differenceMinor: z.int(),
      newMoney: z.boolean().describe('Increases to the company total need Finance Admin and CEO.'),
      blockedReason: z
        .string()
        .nullable()
        .describe('A decrease below allocated out + held + encumbered + actual is blocked.'),
      floorAmount: Money.nullable(),
    })
    .strict(),
);

export const AdaptivePlanPreview = named(
  'AdaptivePlanPreview',
  z
    .object({
      connectionId: Id,
      externalVersion: z.string(),
      fiscalYearLabel: z.string(),
      currency: CurrencyCode,
      lines: z.array(AdaptivePlanLine),
      unmappedLevels: z.array(z.string()),
      totalDifferenceMinor: z.int(),
      requiresCeoApproval: z.boolean(),
      blocked: z.boolean(),
    })
    .strict(),
);
export type AdaptivePlanPreview = z.infer<typeof AdaptivePlanPreview>;

export const AdaptivePlanImportRequest = named(
  'AdaptivePlanImportRequest',
  z
    .object({
      externalVersion: z.string().trim().min(1).max(120),
      fiscalYearLabel: z.string().trim().min(4).max(20),
    })
    .strict(),
);

// Identity: SSO and SCIM (098) ----------------------------------------------------------------------

export const ScimTokenView = named(
  'ScimTokenView',
  z
    .object({
      id: Id,
      prefix: z.string(),
      createdAt: IsoDateTime,
      createdByName: z.string().nullable(),
      lastUsedAt: IsoDateTime.nullable(),
      expiresAt: IsoDateTime,
      revokedAt: IsoDateTime.nullable(),
    })
    .strict(),
);

export const ProvisioningLogEntry = named(
  'ProvisioningLogEntry',
  z
    .object({
      id: Id,
      at: IsoDateTime,
      operation: z.enum(['create', 'update', 'deactivate', 'group_change']),
      personName: z.string().nullable(),
      externalId: z.string(),
      result: z.enum(['applied', 'rejected']),
      detail: z.string(),
    })
    .strict(),
);

export const IdentityOverview = named(
  'IdentityOverview',
  z
    .object({
      ssoStatus: z.enum(['connected', 'not_connected']),
      ssoDescription: z.string(),
      scimEndpoint: z.string(),
      tokens: z.array(ScimTokenView),
      holdOwnerDeactivations: z.boolean(),
      log: z.array(ProvisioningLogEntry),
    })
    .strict(),
);
export type IdentityOverview = z.infer<typeof IdentityOverview>;

export const CreateScimTokenRequest = named(
  'CreateScimTokenRequest',
  z.object({ expiresInDays: z.int().min(1).max(365).default(90) }).strict(),
);

export const ScimTokenCreated = named(
  'ScimTokenCreated',
  z
    .object({
      token: ScimTokenView,
      secret: z.string().describe('Shown once. Stored hashed; never retrievable again.'),
    })
    .strict(),
);
export type ScimTokenCreated = z.infer<typeof ScimTokenCreated>;

export const ScimUserRequest = named(
  'ScimUserRequest',
  z
    .object({
      schemas: z.array(z.string()).optional(),
      externalId: z.string().trim().min(1).max(120),
      userName: z.email().max(200),
      displayName: z.string().trim().min(1).max(200).optional(),
      active: z.boolean().default(true),
      groups: z.array(z.object({ value: z.string() }).strict()).optional(),
    })
    .strict()
    .describe('SCIM 2.0 user resource, limited to the fields BudgetFlow uses.'),
);
export type ScimUserRequest = z.infer<typeof ScimUserRequest>;

export const ScimUserResponse = named(
  'ScimUserResponse',
  z
    .object({
      schemas: z.array(z.string()),
      id: Id,
      externalId: z.string(),
      userName: z.string(),
      displayName: z.string().nullable(),
      active: z.boolean(),
      meta: z.object({ resourceType: z.literal('User'), lastModified: IsoDateTime }).strict(),
      budgetflow: z
        .object({
          openApprovals: z
            .int()
            .describe(
              'Tasks the person still holds; they escalate on the next service-level sweep.',
            ),
          endedRoleGrants: z.int().describe('Role grants closed with the membership.'),
          budgetsFlaggedForNewOwner: z
            .int()
            .describe('Ownership is never moved silently; the gap is flagged instead.'),
          held: z.boolean().describe('Deactivation is waiting for an Organization Admin.'),
        })
        .strict()
        .describe('What the deprovisioning rule did; nothing is ever deleted.'),
    })
    .strict(),
);
export type ScimUserResponse = z.infer<typeof ScimUserResponse>;

// API keys and webhooks (101) -----------------------------------------------------------------------

export const API_KEY_SCOPES = [
  'budgets.read',
  'ledger.read',
  'reports.read',
  'events.read',
  'events.write',
  'actuals.write',
  'webhooks.manage',
] as const;
export const ApiKeyScope = z
  .enum(API_KEY_SCOPES)
  .describe(
    'No scope can approve or reject requests, change controls (freeze, reduce, set to zero) or move money.',
  );
export type ApiKeyScope = z.infer<typeof ApiKeyScope>;

export const ApiKeyView = named(
  'ApiKeyView',
  z
    .object({
      id: Id,
      name: z.string(),
      prefix: z.string().describe('Shown in lists and request logs, for example bf_live_3f9a.'),
      scopes: z.array(ApiKeyScope),
      ownerPersonId: Id.nullable(),
      ownerName: z.string().nullable(),
      createdAt: IsoDateTime,
      lastUsedAt: IsoDateTime.nullable(),
      expiresAt: IsoDateTime,
      revokedAt: IsoDateTime.nullable(),
      status: z.enum(['active', 'expiring_soon', 'expired', 'revoked']),
      allowedCidrs: z.array(z.string()),
      rateLimitPerMinute: z.int(),
      rotatedFromId: Id.nullable(),
    })
    .strict(),
);
export type ApiKeyView = z.infer<typeof ApiKeyView>;

export const ApiKeyList = named('ApiKeyList', z.object({ items: z.array(ApiKeyView) }).strict());

export const CreateApiKeyRequest = named(
  'CreateApiKeyRequest',
  z
    .object({
      name: z.string().trim().min(1).max(120),
      ownerPersonId: Id,
      scopes: z.array(ApiKeyScope).min(1),
      expiresInDays: z.int().min(1).max(365).default(90),
      allowedCidrs: z.array(z.string().max(50)).max(20).optional(),
      rateLimitPerMinute: z.int().min(1).max(6000).optional(),
    })
    .strict(),
);
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequest>;

export const ApiKeyCreated = named(
  'ApiKeyCreated',
  z
    .object({
      key: ApiKeyView,
      secret: z.string().describe("Shown once. Copy it now; you won't see it again."),
    })
    .strict(),
);
export type ApiKeyCreated = z.infer<typeof ApiKeyCreated>;

export const RotateApiKeyRequest = named(
  'RotateApiKeyRequest',
  z
    .object({ overlapDays: z.int().min(0).max(30).default(7) })
    .strict()
    .describe('The old key keeps working for the overlap period.'),
);

export const RevokeApiKeyRequest = named(
  'RevokeApiKeyRequest',
  z.object({ confirmName: z.string().trim().min(1).max(120) }).strict(),
);

export const ApiKeyUsage = named(
  'ApiKeyUsage',
  z
    .object({
      perDay: z.array(z.object({ day: IsoDate, calls: z.int() }).strict()),
      recent: z.array(
        z
          .object({
            at: IsoDateTime,
            method: z.string(),
            path: z.string(),
            status: z.int(),
          })
          .strict(),
      ),
    })
    .strict(),
);
export type ApiKeyUsage = z.infer<typeof ApiKeyUsage>;

export const WEBHOOK_EVENT_TYPES = [
  'budget.frozen',
  'budget.reduced',
  'budget.set_to_zero',
  'budget.threshold_crossed',
  'request.submitted',
  'request.approved',
  'request.rejected',
  'commitment.created',
  'commitment.released',
  'actual.matched',
  'event.approved',
  'event.closed',
  'period.closed',
] as const;
export const WebhookEventType = z.enum(WEBHOOK_EVENT_TYPES);
export type WebhookEventType = z.infer<typeof WebhookEventType>;

export const WebhookEndpointView = named(
  'WebhookEndpointView',
  z
    .object({
      id: Id,
      url: z.string(),
      description: z.string().nullable(),
      events: z.array(WebhookEventType),
      status: z.enum(['active', 'failing', 'disabled']),
      lastDeliveryAt: IsoDateTime.nullable(),
      lastStatusCode: z.int().nullable(),
      lastDurationMs: z.int().nullable(),
      successRateBps: z.int().describe('Share of deliveries that succeeded in the last 7 days.'),
      disabledAt: IsoDateTime.nullable(),
      disabledReason: z.string().nullable(),
      secretSetAt: IsoDateTime,
      secretRotatedAt: IsoDateTime.nullable(),
    })
    .strict(),
);
export type WebhookEndpointView = z.infer<typeof WebhookEndpointView>;

export const WebhookEndpointList = named(
  'WebhookEndpointList',
  z
    .object({
      items: z.array(WebhookEndpointView),
      verification: z.string().describe('How receivers verify the BudgetFlow-Signature header.'),
    })
    .strict(),
);

export const CreateWebhookEndpointRequest = named(
  'CreateWebhookEndpointRequest',
  z
    .object({
      url: z.url().max(300).describe('Use an https address.'),
      description: z.string().trim().max(200).optional(),
      events: z.array(WebhookEventType).min(1),
    })
    .strict(),
);
export type CreateWebhookEndpointRequest = z.infer<typeof CreateWebhookEndpointRequest>;

export const UpdateWebhookEndpointRequest = named(
  'UpdateWebhookEndpointRequest',
  z
    .object({
      description: z.string().trim().max(200).optional(),
      events: z.array(WebhookEventType).min(1).optional(),
      enabled: z.boolean().optional().describe('Re-enables an endpoint disabled after failures.'),
    })
    .strict(),
);

export const WebhookEndpointCreated = named(
  'WebhookEndpointCreated',
  z
    .object({
      endpoint: WebhookEndpointView,
      signingSecret: z.string().describe('Shown once; rotation keeps both secrets valid 24 hours.'),
    })
    .strict(),
);
export type WebhookEndpointCreated = z.infer<typeof WebhookEndpointCreated>;

export const WebhookDeliveryView = named(
  'WebhookDeliveryView',
  z
    .object({
      id: Id,
      endpointId: Id,
      eventId: Id,
      eventType: WebhookEventType,
      attempt: z.int(),
      statusCode: z.int().nullable(),
      durationMs: z.int().nullable(),
      status: z.enum(['pending', 'succeeded', 'failed', 'exhausted']),
      nextRetryAt: IsoDateTime.nullable(),
      error: z.string().nullable(),
      payload: z.record(z.string(), z.unknown()),
      createdAt: IsoDateTime,
    })
    .strict(),
);
export type WebhookDeliveryView = z.infer<typeof WebhookDeliveryView>;

export const WebhookDeliveryList = named(
  'WebhookDeliveryList',
  z.object({ items: z.array(WebhookDeliveryView) }).strict(),
);

export const WebhookDeliveriesQuery = z
  .object({ endpointId: Id.optional(), limit: z.coerce.number().int().min(1).max(200).optional() })
  .strict();

export const SendTestPingResult = named(
  'SendTestPingResult',
  z
    .object({
      ok: z.boolean(),
      statusCode: z.int().nullable(),
      durationMs: z.int(),
      message: z.string(),
      deliveryId: Id.nullable(),
    })
    .strict(),
);
export type SendTestPingResult = z.infer<typeof SendTestPingResult>;

// Inbound provider webhooks ---------------------------------------------------------------------

export const InboundWebhookRequest = named(
  'InboundWebhookRequest',
  z
    .object({
      eventId: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe('Provider event id; replays are rejected.'),
      type: z.string().trim().min(1).max(100),
      occurredAt: IsoDateTime.optional(),
      data: z.record(z.string(), z.unknown()).default({}),
    })
    .strict(),
);
export type InboundWebhookRequest = z.infer<typeof InboundWebhookRequest>;

export const InboundWebhookResult = named(
  'InboundWebhookResult',
  z
    .object({
      accepted: z.boolean(),
      replayed: z.boolean(),
      syncRunId: Id.nullable(),
      recordsApplied: z.int(),
    })
    .strict(),
);
export type InboundWebhookResult = z.infer<typeof InboundWebhookResult>;

// Public API v1 (101a) -----------------------------------------------------------------------------

export const PublicApiMeta = named(
  'PublicApiMeta',
  z
    .object({
      version: z.literal('v1'),
      keyPrefix: z.string(),
      scopes: z.array(ApiKeyScope),
      rateLimitPerMinute: z.int(),
      rateLimitRemaining: z.int(),
      tenantId: Id,
      notice: z.string(),
    })
    .strict(),
);
export type PublicApiMeta = z.infer<typeof PublicApiMeta>;

export const PublicBudget = named(
  'PublicBudget',
  z
    .object({
      id: Id,
      name: z.string(),
      parentId: Id.nullable(),
      status: z.string(),
      currency: CurrencyCode,
      authorized: Money,
      allocatedOut: Money,
      held: Money,
      preEncumbered: Money,
      encumbered: Money,
      actual: Money,
      available: Money,
      fiscalYearLabel: z.string().nullable(),
    })
    .strict(),
);
export type PublicBudget = z.infer<typeof PublicBudget>;

export const PublicBudgetList = named(
  'PublicBudgetList',
  z.object({ items: z.array(PublicBudget), nextCursor: z.string().nullable() }).strict(),
);

export const PublicEvent = named(
  'PublicEvent',
  z
    .object({
      id: Id,
      eventCode: z.string(),
      name: z.string(),
      status: z.string(),
      startDate: IsoDate.nullable(),
      endDate: IsoDate.nullable(),
      estimatedCost: Money.nullable(),
    })
    .strict(),
);

export const PublicEventList = named(
  'PublicEventList',
  z.object({ items: z.array(PublicEvent), nextCursor: z.string().nullable() }).strict(),
);

export const PublicImportRequest = named(
  'PublicImportRequest',
  z
    .object({
      source: z.enum(['card', 'expense', 'travel', 'erp', 'ap']),
      fileName: z.string().trim().min(1).max(200),
      csv: z.string().min(1).max(2_000_000),
    })
    .strict()
    .describe('Feeds the actuals review queue (080a). It never posts to the ledger on its own.'),
);
export type PublicImportRequest = z.infer<typeof PublicImportRequest>;

export const PublicImportResult = named(
  'PublicImportResult',
  z
    .object({
      importBatchId: Id,
      linesRead: z.int(),
      imported: z.int(),
      duplicatesSkipped: z.int(),
      rejected: z.int(),
      status: z.literal('review'),
    })
    .strict(),
);
export type PublicImportResult = z.infer<typeof PublicImportResult>;

export const DisconnectResult = named(
  'DisconnectResult',
  z.object({ disconnected: z.boolean() }).strict(),
);
export const RevokeScimTokenResult = named(
  'RevokeScimTokenResult',
  z.object({ revoked: z.boolean() }).strict(),
);
export const RemoveWebhookEndpointResult = named(
  'RemoveWebhookEndpointResult',
  z.object({ removed: z.boolean() }).strict(),
);

// Inferred types for every schema the API and the web client use.
export type IntegrationCategory = z.infer<typeof IntegrationCategory>;
export type IntegrationMode = z.infer<typeof IntegrationMode>;
export type ConnectionStatus = z.infer<typeof ConnectionStatus>;
export type SyncDirection = z.infer<typeof SyncDirection>;
export type SyncStatus = z.infer<typeof SyncStatus>;
export type IntegrationErrorClass = z.infer<typeof IntegrationErrorClass>;
export type IntegrationMessageStatus = z.infer<typeof IntegrationMessageStatus>;
export type MappingKind = z.infer<typeof MappingKind>;
export type SecretReference = z.infer<typeof SecretReference>;
export type MappingEntry = z.infer<typeof MappingEntry>;
export type IntegrationsHealth = z.infer<typeof IntegrationsHealth>;
export type PutMappingsRequest = z.infer<typeof PutMappingsRequest>;
export type SyncRunList = z.infer<typeof SyncRunList>;
export type SyncRunsQuery = z.infer<typeof SyncRunsQuery>;
export type IntegrationMessageList = z.infer<typeof IntegrationMessageList>;
export type IntegrationMessagesQuery = z.infer<typeof IntegrationMessagesQuery>;
export type RetryMessagesRequest = z.infer<typeof RetryMessagesRequest>;
export type DiscardMessagesRequest = z.infer<typeof DiscardMessagesRequest>;
export type PushKind = z.infer<typeof PushKind>;
export type PushItemList = z.infer<typeof PushItemList>;
export type DuplicateLine = z.infer<typeof DuplicateLine>;
export type DuplicateGroupList = z.infer<typeof DuplicateGroupList>;
export type AdaptivePlanLine = z.infer<typeof AdaptivePlanLine>;
export type AdaptivePlanImportRequest = z.infer<typeof AdaptivePlanImportRequest>;
export type ScimTokenView = z.infer<typeof ScimTokenView>;
export type ProvisioningLogEntry = z.infer<typeof ProvisioningLogEntry>;
export type CreateScimTokenRequest = z.infer<typeof CreateScimTokenRequest>;
export type ApiKeyList = z.infer<typeof ApiKeyList>;
export type RotateApiKeyRequest = z.infer<typeof RotateApiKeyRequest>;
export type RevokeApiKeyRequest = z.infer<typeof RevokeApiKeyRequest>;
export type WebhookEndpointList = z.infer<typeof WebhookEndpointList>;
export type UpdateWebhookEndpointRequest = z.infer<typeof UpdateWebhookEndpointRequest>;
export type WebhookDeliveryList = z.infer<typeof WebhookDeliveryList>;
export type WebhookDeliveriesQuery = z.infer<typeof WebhookDeliveriesQuery>;
export type PublicBudgetList = z.infer<typeof PublicBudgetList>;
export type PublicEvent = z.infer<typeof PublicEvent>;
export type PublicEventList = z.infer<typeof PublicEventList>;

const ConnectionParams = z.object({ connectionId: Id }).strict();
const KeyParams = z.object({ keyId: Id }).strict();
const EndpointParams = z.object({ endpointId: Id }).strict();
const DeliveryParams = z.object({ deliveryId: Id }).strict();
const FlagParams = z.object({ flagId: Id }).strict();
const TokenParams = z.object({ tokenId: Id }).strict();
const InboundWebhookParams = z.object({ tenantId: Id, connectionId: Id }).strict();

export const integrationEndpoints = {
  getIntegrationsHub: {
    operationId: 'getIntegrationsHub',
    method: 'get',
    path: '/api/integrations',
    summary: 'Connector hub: health strip, connected systems and what can still be added (092)',
    tags: ['integrations'],
    auth: true,
    response: { status: 200, schema: IntegrationsHub },
    errors: [401, 403],
  },
  connectIntegration: {
    operationId: 'connectIntegration',
    method: 'post',
    path: '/api/integrations',
    summary: 'Connect a system; the credential is encrypted at rest and never returned',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    body: ConnectRequest,
    response: { status: 201, schema: ConnectionDetail },
    errors: [400, 401, 403, 409, 422],
  },
  getIntegrationConnection: {
    operationId: 'getIntegrationConnection',
    method: 'get',
    path: '/api/integrations/connections/{connectionId}',
    summary: 'Connector detail frame: overview, connection, mappings, sync and push',
    tags: ['integrations'],
    auth: true,
    params: ConnectionParams,
    response: { status: 200, schema: ConnectionDetail },
    errors: [401, 403, 404],
  },
  updateIntegrationConnection: {
    operationId: 'updateIntegrationConnection',
    method: 'patch',
    path: '/api/integrations/connections/{connectionId}',
    summary: 'Change mode, schedules, settings or pause a connection',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: ConnectionParams,
    body: UpdateConnectionRequest,
    response: { status: 200, schema: ConnectionDetail },
    errors: [400, 401, 403, 404, 422],
  },
  replaceIntegrationCredential: {
    operationId: 'replaceIntegrationCredential',
    method: 'post',
    path: '/api/integrations/connections/{connectionId}/credential',
    summary: 'Replace the stored credential (write-only)',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: ConnectionParams,
    body: ReplaceCredentialRequest,
    response: { status: 200, schema: ConnectionDetail },
    errors: [400, 401, 403, 404, 422],
  },
  testIntegrationConnection: {
    operationId: 'testIntegrationConnection',
    method: 'post',
    path: '/api/integrations/connections/{connectionId}/test',
    summary: 'Call the provider and report whether the credentials work',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: ConnectionParams,
    response: { status: 200, schema: TestConnectionResult },
    errors: [401, 403, 404, 422],
  },
  disconnectIntegration: {
    operationId: 'disconnectIntegration',
    method: 'delete',
    path: '/api/integrations/connections/{connectionId}',
    summary: 'Disconnect: schedules and pushes stop, imported data stays',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: ConnectionParams,
    response: { status: 200, schema: DisconnectResult },
    errors: [401, 403, 404],
  },
  putIntegrationMappings: {
    operationId: 'putIntegrationMappings',
    method: 'put',
    path: '/api/integrations/connections/{connectionId}/mappings',
    summary: 'Replace the mapping table for a connector',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: ConnectionParams,
    body: PutMappingsRequest,
    response: { status: 200, schema: ConnectionDetail },
    errors: [400, 401, 403, 404, 422],
  },
  runIntegrationSync: {
    operationId: 'runIntegrationSync',
    method: 'post',
    path: '/api/integrations/connections/{connectionId}/sync',
    summary: 'Run a sync now; repeating it never applies the same record twice',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: ConnectionParams,
    body: RunSyncRequest,
    response: { status: 201, schema: SyncRunView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listSyncRuns: {
    operationId: 'listSyncRuns',
    method: 'get',
    path: '/api/integrations/sync-runs',
    summary: 'Every sync run in and out of BudgetFlow (099)',
    tags: ['integrations'],
    auth: true,
    query: SyncRunsQuery,
    response: { status: 200, schema: SyncRunList },
    errors: [400, 401, 403],
  },
  getSyncRun: {
    operationId: 'getSyncRun',
    method: 'get',
    path: '/api/integrations/sync-runs/{runId}',
    summary: 'One sync run with its counts, cursor and the batch it created',
    tags: ['integrations'],
    auth: true,
    params: z.object({ runId: Id }).strict(),
    response: { status: 200, schema: SyncRunView },
    errors: [401, 403, 404],
  },
  listIntegrationMessages: {
    operationId: 'listIntegrationMessages',
    method: 'get',
    path: '/api/integrations/messages',
    summary: 'Retrying queue and dead letter with redacted payloads (100)',
    tags: ['integrations'],
    auth: true,
    query: IntegrationMessagesQuery,
    response: { status: 200, schema: IntegrationMessageList },
    errors: [400, 401, 403],
  },
  retryIntegrationMessages: {
    operationId: 'retryIntegrationMessages',
    method: 'post',
    path: '/api/integrations/messages/retry',
    summary: 'Retry failed messages with their original idempotency key',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    body: RetryMessagesRequest,
    response: { status: 200, schema: MessageActionResult },
    errors: [400, 401, 403, 404, 422],
  },
  discardIntegrationMessages: {
    operationId: 'discardIntegrationMessages',
    method: 'post',
    path: '/api/integrations/messages/discard',
    summary: 'Discard dead-letter messages with a reason code; they stay for audit',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    body: DiscardMessagesRequest,
    response: { status: 200, schema: MessageActionResult },
    errors: [400, 401, 403, 404, 422],
  },
  listIntegrationPushes: {
    operationId: 'listIntegrationPushes',
    method: 'get',
    path: '/api/integrations/pushes',
    summary: 'Event codes and card limits pushed to providers (99b)',
    tags: ['integrations'],
    auth: true,
    query: z.object({ connectionId: Id.optional(), kind: PushKind.optional() }).strict(),
    response: { status: 200, schema: PushItemList },
    errors: [400, 401, 403],
  },
  createIntegrationPush: {
    operationId: 'createIntegrationPush',
    method: 'post',
    path: '/api/integrations/pushes',
    summary: 'Push an event code or a card limit for an approved commitment',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    body: CreatePushRequest,
    response: { status: 201, schema: PushItemView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  listNavanCustomFields: {
    operationId: 'listNavanCustomFields',
    method: 'get',
    path: '/api/integrations/connections/{connectionId}/navan/custom-fields',
    summary: 'Custom fields defined in the connected Navan account, for the field mapping (16a)',
    tags: ['integrations'],
    auth: true,
    params: ConnectionParams,
    response: { status: 200, schema: NavanCustomFieldList },
    errors: [401, 403, 404, 409, 422],
  },
  listCrossSourceDuplicates: {
    operationId: 'listCrossSourceDuplicates',
    method: 'get',
    path: '/api/integrations/duplicates',
    summary: 'Possible duplicates held before matching, grouped by spend (99a)',
    tags: ['integrations'],
    auth: true,
    query: z.object({ status: z.enum(['open', 'resolved']).optional() }).strict(),
    response: { status: 200, schema: DuplicateGroupList },
    errors: [400, 401, 403],
  },
  resolveCrossSourceDuplicate: {
    operationId: 'resolveCrossSourceDuplicate',
    method: 'post',
    path: '/api/integrations/duplicates/{flagId}/resolve',
    summary: 'Keep one line as the record and exclude the other, or mark them not duplicates',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: FlagParams,
    body: ResolveDuplicateRequest,
    response: { status: 200, schema: DuplicateGroupView },
    errors: [400, 401, 403, 404, 409, 422],
  },
  previewPlanImport: {
    operationId: 'previewPlanImport',
    method: 'post',
    path: '/api/integrations/connections/{connectionId}/plan-import/preview',
    summary: 'Differences between the planning system and the root budgets, with floors (094a)',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: ConnectionParams,
    body: AdaptivePlanImportRequest,
    response: { status: 200, schema: AdaptivePlanPreview },
    errors: [400, 401, 403, 404, 422],
  },
  getIdentityIntegration: {
    operationId: 'getIdentityIntegration',
    method: 'get',
    path: '/api/integrations/identity',
    summary: 'Single sign-on status, SCIM tokens and the provisioning log (098)',
    tags: ['integrations'],
    auth: true,
    response: { status: 200, schema: IdentityOverview },
    errors: [401, 403],
  },
  createScimToken: {
    operationId: 'createScimToken',
    method: 'post',
    path: '/api/integrations/identity/tokens',
    summary: 'Generate a SCIM bearer token; shown once and stored hashed',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    body: CreateScimTokenRequest,
    response: { status: 201, schema: ScimTokenCreated },
    errors: [400, 401, 403, 422],
  },
  revokeScimToken: {
    operationId: 'revokeScimToken',
    method: 'delete',
    path: '/api/integrations/identity/tokens/{tokenId}',
    summary: 'Revoke a SCIM token; provider calls then fail with 401',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: TokenParams,
    response: { status: 200, schema: RevokeScimTokenResult },
    errors: [401, 403, 404],
  },
  provisionScimUser: {
    operationId: 'provisionScimUser',
    method: 'post',
    path: '/scim/v2/Users',
    summary: 'SCIM 2.0: create, update or deactivate a person (bearer SCIM token)',
    tags: ['integrations'],
    auth: false,
    response: { status: 200, schema: ScimUserResponse },
    body: ScimUserRequest,
    errors: [400, 401, 403, 404, 422, 429],
  },
  listApiKeys: {
    operationId: 'listApiKeys',
    method: 'get',
    path: '/api/integrations/api-keys',
    summary: 'Scoped, expiring API keys with their service owners (101)',
    tags: ['integrations'],
    auth: true,
    response: { status: 200, schema: ApiKeyList },
    errors: [401, 403],
  },
  createApiKey: {
    operationId: 'createApiKey',
    method: 'post',
    path: '/api/integrations/api-keys',
    summary: 'Issue a key; the secret is shown once and stored hashed',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    body: CreateApiKeyRequest,
    response: { status: 201, schema: ApiKeyCreated },
    errors: [400, 401, 403, 404, 422],
  },
  rotateApiKey: {
    operationId: 'rotateApiKey',
    method: 'post',
    path: '/api/integrations/api-keys/{keyId}/rotate',
    summary: 'Issue a replacement; the old key keeps working for the overlap period',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: KeyParams,
    body: RotateApiKeyRequest,
    response: { status: 201, schema: ApiKeyCreated },
    errors: [400, 401, 403, 404, 409, 422],
  },
  revokeApiKey: {
    operationId: 'revokeApiKey',
    method: 'post',
    path: '/api/integrations/api-keys/{keyId}/revoke',
    summary: 'Revoke a key immediately',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: KeyParams,
    body: RevokeApiKeyRequest,
    response: { status: 200, schema: ApiKeyView },
    errors: [400, 401, 403, 404, 422],
  },
  getApiKeyUsage: {
    operationId: 'getApiKeyUsage',
    method: 'get',
    path: '/api/integrations/api-keys/{keyId}/usage',
    summary: 'Calls per day and the last 50 requests made with the key',
    tags: ['integrations'],
    auth: true,
    params: KeyParams,
    response: { status: 200, schema: ApiKeyUsage },
    errors: [401, 403, 404],
  },
  listWebhookEndpoints: {
    operationId: 'listWebhookEndpoints',
    method: 'get',
    path: '/api/integrations/webhook-endpoints',
    summary: 'Subscribed endpoints with status and success rate (101)',
    tags: ['integrations'],
    auth: true,
    response: { status: 200, schema: WebhookEndpointList },
    errors: [401, 403],
  },
  createWebhookEndpoint: {
    operationId: 'createWebhookEndpoint',
    method: 'post',
    path: '/api/integrations/webhook-endpoints',
    summary: 'Subscribe an https endpoint; the signing secret is shown once',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    body: CreateWebhookEndpointRequest,
    response: { status: 201, schema: WebhookEndpointCreated },
    errors: [400, 401, 403, 422],
  },
  updateWebhookEndpoint: {
    operationId: 'updateWebhookEndpoint',
    method: 'patch',
    path: '/api/integrations/webhook-endpoints/{endpointId}',
    summary: 'Change the events, description, or re-enable a disabled endpoint',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: EndpointParams,
    body: UpdateWebhookEndpointRequest,
    response: { status: 200, schema: WebhookEndpointView },
    errors: [400, 401, 403, 404, 422],
  },
  deleteWebhookEndpoint: {
    operationId: 'deleteWebhookEndpoint',
    method: 'delete',
    path: '/api/integrations/webhook-endpoints/{endpointId}',
    summary: 'Remove an endpoint; its delivery log stays',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: EndpointParams,
    response: { status: 200, schema: RemoveWebhookEndpointResult },
    errors: [401, 403, 404],
  },
  rotateWebhookSecret: {
    operationId: 'rotateWebhookSecret',
    method: 'post',
    path: '/api/integrations/webhook-endpoints/{endpointId}/rotate-secret',
    summary: 'Rotate the signing secret; both secrets sign for 24 hours',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: EndpointParams,
    response: { status: 200, schema: WebhookEndpointCreated },
    errors: [401, 403, 404, 422],
  },
  sendWebhookTestPing: {
    operationId: 'sendWebhookTestPing',
    method: 'post',
    path: '/api/integrations/webhook-endpoints/{endpointId}/test',
    summary: 'Send a signed test ping and report the result',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: EndpointParams,
    response: { status: 200, schema: SendTestPingResult },
    errors: [401, 403, 404, 422],
  },
  listWebhookDeliveries: {
    operationId: 'listWebhookDeliveries',
    method: 'get',
    path: '/api/integrations/webhook-deliveries',
    summary: 'Delivery log with attempt, status code, duration and next retry',
    tags: ['integrations'],
    auth: true,
    query: WebhookDeliveriesQuery,
    response: { status: 200, schema: WebhookDeliveryList },
    errors: [400, 401, 403],
  },
  redeliverWebhook: {
    operationId: 'redeliverWebhook',
    method: 'post',
    path: '/api/integrations/webhook-deliveries/{deliveryId}/redeliver',
    summary: 'Send the same event again to the same endpoint',
    tags: ['integrations'],
    auth: true,
    idempotent: true,
    params: DeliveryParams,
    response: { status: 200, schema: SendTestPingResult },
    errors: [401, 403, 404, 422],
  },
  receiveProviderWebhook: {
    operationId: 'receiveProviderWebhook',
    method: 'post',
    path: '/api/integrations/webhooks/{tenantId}/{connectionId}',
    summary: 'Inbound provider callback: HMAC signature, 5-minute window, replays rejected',
    tags: ['integrations'],
    auth: false,
    params: InboundWebhookParams,
    body: InboundWebhookRequest,
    response: { status: 200, schema: InboundWebhookResult },
    errors: [400, 401, 404, 409, 422],
  },
  getPublicApiMeta: {
    operationId: 'getPublicApiMeta',
    method: 'get',
    path: '/api/public/v1/meta',
    summary: 'Public API: the scopes and rate limit of the calling key (101a)',
    tags: ['public-api'],
    auth: false,
    response: { status: 200, schema: PublicApiMeta },
    errors: [401, 403, 429],
  },
  listPublicBudgets: {
    operationId: 'listPublicBudgets',
    method: 'get',
    path: '/api/public/v1/budgets',
    summary: 'Public API: budgets with their bucket balances (scope budgets.read)',
    tags: ['public-api'],
    auth: false,
    query: CursorQuery,
    response: { status: 200, schema: PublicBudgetList },
    errors: [400, 401, 403, 429],
  },
  listPublicEvents: {
    operationId: 'listPublicEvents',
    method: 'get',
    path: '/api/public/v1/events',
    summary: 'Public API: events (scope events.read)',
    tags: ['public-api'],
    auth: false,
    query: CursorQuery,
    response: { status: 200, schema: PublicEventList },
    errors: [400, 401, 403, 429],
  },
  createPublicActualsImport: {
    operationId: 'createPublicActualsImport',
    method: 'post',
    path: '/api/public/v1/actuals/imports',
    summary: 'Public API: feed lines into the actuals review queue (scope actuals.write)',
    tags: ['public-api'],
    auth: false,
    idempotent: true,
    body: PublicImportRequest,
    response: { status: 201, schema: PublicImportResult },
    errors: [400, 401, 403, 409, 422, 429],
  },
} as const satisfies Record<string, Endpoint>;
