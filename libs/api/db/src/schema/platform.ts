import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, pk, tenantRef, ts } from './_columns';
import { tenants } from './tenancy';

/** Append-only, per-tenant SHA-256 hash-chained audit trail. One event per successful mutation. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    tenantId: tenantRef().references(() => tenants.id),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    occurredAt: ts('occurred_at').notNull(),
    actorPersonId: uuid('actor_person_id'),
    actorSubject: varchar('actor_subject', { length: 255 }),
    onBehalfOfPersonId: uuid('on_behalf_of_person_id'),
    action: varchar('action', { length: 100 }).notNull(),
    resourceType: varchar('resource_type', { length: 50 }).notNull(),
    resourceId: varchar('resource_id', { length: 100 }).notNull(),
    legalEntityId: uuid('legal_entity_id'),
    requestId: varchar('request_id', { length: 100 }),
    reason: text('reason'),
    changes: jsonb('changes').notNull(),
    prevHash: varchar('prev_hash', { length: 64 }).notNull(),
    hash: varchar('hash', { length: 64 }).notNull(),
  },
  (t) => [
    uniqueIndex('audit_events_tenant_seq').on(t.tenantId, t.seq),
    index('audit_events_resource').on(t.tenantId, t.resourceType, t.resourceId),
  ],
);

/** Chain head per tenant; writers lock it so the chain is strictly sequential. */
export const auditChainHeads = pgTable('audit_chain_heads', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  lastSeq: bigint('last_seq', { mode: 'number' }).notNull(),
  lastHash: varchar('last_hash', { length: 64 }).notNull(),
});

/** Transactional outbox: written with the change, drained by the worker into pg-boss. */
export const outboxMessages = pgTable(
  'outbox_messages',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    topic: varchar('topic', { length: 100 }).notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: createdAt(),
    publishedAt: ts('published_at'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [index('outbox_messages_unpublished').on(t.tenantId, t.publishedAt, t.createdAt)],
);

/** Replays of a mutation with the same key return the stored response without posting again. */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    key: varchar('key', { length: 200 }).notNull(),
    actorSubject: varchar('actor_subject', { length: 255 }).notNull(),
    operation: varchar('operation', { length: 100 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('idempotency_keys_tenant_key').on(t.tenantId, t.key)],
);
