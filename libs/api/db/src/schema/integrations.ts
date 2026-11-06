import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { ccy, createdAt, day, minor, pk, tenantRef, ts, updatedAt } from './_columns';
import { importBatches } from './actuals';
import { commitments, events } from './spend';
import { tenants } from './tenancy';

/**
 * One connection to an external system (092). Credentials never live here: `secret_ref` points at an
 * `integration_secrets` row that holds the encrypted value.
 */
export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    provider: varchar('provider', { length: 40 }).notNull(),
    category: varchar('category', { length: 20 }).notNull(),
    displayName: text('display_name').notNull(),
    mode: varchar('mode', { length: 10 }).notNull().default('mock'),
    status: varchar('status', { length: 20 }).notNull().default('connected'),
    attention: text('attention'),
    baseUrl: text('base_url'),
    accountRef: varchar('account_ref', { length: 120 }),
    clientId: varchar('client_id', { length: 200 }),
    secretRef: uuid('secret_ref'),
    secretSetAt: ts('secret_set_at'),
    secretSetBy: uuid('secret_set_by'),
    settings: jsonb('settings').notNull().default({}),
    schedules: jsonb('schedules').notNull().default([]),
    cursors: jsonb('cursors').notNull().default({}),
    pausedAt: ts('paused_at'),
    pausedBy: uuid('paused_by'),
    lastSyncAt: ts('last_sync_at'),
    disconnectedAt: ts('disconnected_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('integration_connections_provider').on(t.tenantId, t.provider),
    index('integration_connections_category').on(t.tenantId, t.category, t.status),
  ],
);

/** Credentials encrypted at rest (AES-256-GCM). Values are never selected into a response or a log. */
export const integrationSecrets = pgTable(
  'integration_secrets',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    purpose: varchar('purpose', { length: 40 }).notNull(),
    algorithm: varchar('algorithm', { length: 20 }).notNull().default('aes-256-gcm'),
    iv: varchar('iv', { length: 48 }).notNull(),
    authTag: varchar('auth_tag', { length: 48 }).notNull(),
    ciphertext: text('ciphertext').notNull(),
    createdAt: createdAt(),
    rotatedAt: ts('rotated_at'),
  },
  (t) => [index('integration_secrets_tenant').on(t.tenantId, t.purpose)],
);

/** External value to BudgetFlow value, per connector (entities, cost centers, GL accounts, categories). */
export const integrationMappings = pgTable(
  'integration_mappings',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id),
    kind: varchar('kind', { length: 30 }).notNull(),
    externalValue: varchar('external_value', { length: 200 }).notNull(),
    internalId: uuid('internal_id'),
    internalValue: varchar('internal_value', { length: 200 }),
    approved: boolean('approved').notNull().default(true),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('integration_mappings_entry').on(t.connectionId, t.kind, t.externalValue),
    index('integration_mappings_tenant').on(t.tenantId, t.kind),
  ],
);

/** Operational log of every synchronization run in or out of BudgetFlow (099). */
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id),
    object: varchar('object', { length: 30 }).notNull(),
    direction: varchar('direction', { length: 10 }).notNull(),
    mode: varchar('mode', { length: 10 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('running'),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    recordsRead: integer('records_read').notNull().default(0),
    recordsApplied: integer('records_applied').notNull().default(0),
    recordsSkippedDuplicate: integer('records_skipped_duplicate').notNull().default(0),
    recordsFailed: integer('records_failed').notNull().default(0),
    cursor: varchar('cursor', { length: 200 }),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    importBatchId: uuid('import_batch_id').references(() => importBatches.id),
    errorSummary: text('error_summary'),
    triggeredBy: uuid('triggered_by'),
  },
  (t) => [
    index('sync_runs_tenant_started').on(t.tenantId, t.startedAt),
    index('sync_runs_connection').on(t.tenantId, t.connectionId, t.object, t.startedAt),
    uniqueIndex('sync_runs_idempotency').on(t.tenantId, t.idempotencyKey),
  ],
);

/**
 * Inbound records and outbound items that failed: retried with exponential backoff (8 attempts),
 * then moved to the dead letter. Payloads are stored redacted; signature failures are never retried.
 */
export const integrationMessages = pgTable(
  'integration_messages',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id),
    syncRunId: uuid('sync_run_id').references(() => syncRuns.id),
    direction: varchar('direction', { length: 10 }).notNull(),
    item: text('item').notNull(),
    errorClass: varchar('error_class', { length: 30 }).notNull(),
    lastError: text('last_error').notNull(),
    attempts: integer('attempts').notNull().default(1),
    maxAttempts: integer('max_attempts').notNull().default(8),
    firstFailedAt: ts('first_failed_at').notNull().defaultNow(),
    nextRetryAt: ts('next_retry_at'),
    movedToDeadLetterAt: ts('moved_to_dead_letter_at'),
    status: varchar('status', { length: 20 }).notNull().default('retrying'),
    discardReasonCode: varchar('discard_reason_code', { length: 40 }),
    discardReason: text('discard_reason'),
    payloadRedacted: jsonb('payload_redacted').notNull().default({}),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('integration_messages_status').on(t.tenantId, t.status, t.nextRetryAt),
    uniqueIndex('integration_messages_key').on(t.tenantId, t.idempotencyKey),
  ],
);

/** Every accepted inbound callback, so a replay of the same provider event is rejected. */
export const inboundWebhookEvents = pgTable(
  'inbound_webhook_events',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id),
    externalEventId: varchar('external_event_id', { length: 200 }).notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    syncRunId: uuid('sync_run_id').references(() => syncRuns.id),
    recordsApplied: integer('records_applied').notNull().default(0),
  },
  (t) => [uniqueIndex('inbound_webhook_events_external').on(t.connectionId, t.externalEventId)],
);

/** Event codes and card limits pushed out to providers (99b); limits never exceed the commitment. */
export const integrationPushes = pgTable(
  'integration_pushes',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => integrationConnections.id),
    kind: varchar('kind', { length: 20 }).notNull(),
    eventId: uuid('event_id').references(() => events.id),
    commitmentId: uuid('commitment_id').references(() => commitments.id),
    reference: varchar('reference', { length: 120 }).notNull(),
    amountMinor: minor('amount_minor'),
    currency: ccy('currency'),
    validFrom: day('valid_from'),
    validTo: day('valid_to'),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    externalId: varchar('external_id', { length: 200 }),
    lastError: text('last_error'),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).notNull(),
    pushedAt: ts('pushed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('integration_pushes_key').on(t.tenantId, t.idempotencyKey),
    index('integration_pushes_connection').on(t.tenantId, t.connectionId, t.kind),
  ],
);

/**
 * Public API keys and SCIM tokens (101, 098). Only the hash is stored; scopes map to PolicyService
 * actions at tenant scope and never include approvals, controls or anything that moves money.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    kind: varchar('kind', { length: 20 }).notNull().default('public_api'),
    name: text('name').notNull(),
    prefix: varchar('prefix', { length: 40 }).notNull(),
    keyHash: varchar('key_hash', { length: 64 }).notNull(),
    scopes: text('scopes').array().notNull().default([]),
    ownerPersonId: uuid('owner_person_id'),
    allowedCidrs: text('allowed_cidrs').array().notNull().default([]),
    rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(120),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    lastUsedAt: ts('last_used_at'),
    rotatedFromId: uuid('rotated_from_id'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('api_keys_hash').on(t.keyHash),
    index('api_keys_tenant_kind').on(t.tenantId, t.kind, t.revokedAt),
  ],
);

/** Request log per key (prefix only, never the secret) behind "View usage" on 101. */
export const apiKeyRequests = pgTable(
  'api_key_requests',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id),
    at: ts('at').notNull().defaultNow(),
    method: varchar('method', { length: 10 }).notNull(),
    path: varchar('path', { length: 300 }).notNull(),
    status: integer('status').notNull(),
  },
  (t) => [index('api_key_requests_key_at').on(t.tenantId, t.apiKeyId, t.at)],
);

/** Fixed-window rate counters per key, so the limit holds across API instances. */
export const apiKeyRateWindows = pgTable(
  'api_key_rate_windows',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id),
    windowStart: ts('window_start').notNull(),
    calls: integer('calls').notNull().default(0),
  },
  (t) => [uniqueIndex('api_key_rate_windows_window').on(t.apiKeyId, t.windowStart)],
);

/** Customer endpoints subscribed to BudgetFlow events; secrets are hashed and shown once (101). */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    url: text('url').notNull(),
    description: text('description'),
    events: text('events').array().notNull().default([]),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    secretRef: uuid('secret_ref'),
    previousSecretRef: uuid('previous_secret_ref'),
    secretSetAt: ts('secret_set_at').notNull().defaultNow(),
    secretRotatedAt: ts('secret_rotated_at'),
    previousSecretValidUntil: ts('previous_secret_valid_until'),
    failingSince: ts('failing_since'),
    disabledAt: ts('disabled_at'),
    disabledReason: text('disabled_reason'),
    deletedAt: ts('deleted_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [index('webhook_endpoints_tenant').on(t.tenantId, t.status)],
);

/**
 * One row per delivery, carrying the payload that was signed (identifiers only, no secrets). A row
 * the outbox fan-out queues moves `pending` → `succeeded` / `failed` / `exhausted` in place and
 * `attempt` counts the tries it took; a test ping or an operator redelivery adds its own row.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id),
    eventId: uuid('event_id').notNull(),
    eventType: varchar('event_type', { length: 60 }).notNull(),
    attempt: integer('attempt').notNull().default(1),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    statusCode: integer('status_code'),
    durationMs: integer('duration_ms'),
    nextRetryAt: ts('next_retry_at'),
    error: text('error'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('webhook_deliveries_endpoint').on(t.tenantId, t.endpointId, t.createdAt),
    uniqueIndex('webhook_deliveries_attempt').on(t.endpointId, t.eventId, t.attempt),
  ],
);

/** SCIM provisioning log (098): what the identity provider asked for and what BudgetFlow did. */
export const scimOperations = pgTable(
  'scim_operations',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    at: ts('at').notNull().defaultNow(),
    operation: varchar('operation', { length: 20 }).notNull(),
    externalId: varchar('external_id', { length: 120 }).notNull(),
    personId: uuid('person_id'),
    result: varchar('result', { length: 20 }).notNull(),
    detail: text('detail').notNull(),
    tokenId: uuid('token_id').references(() => apiKeys.id),
  },
  (t) => [index('scim_operations_tenant_at').on(t.tenantId, t.at)],
);
