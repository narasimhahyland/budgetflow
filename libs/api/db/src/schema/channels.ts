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
import { createdAt, pk, tenantRef, ts, updatedAt } from './_columns';
import { people } from './org';
import { tenants } from './tenancy';

/** In-app notifications and multi-channel delivery summary per recipient (screen 123). */
export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    recipientPersonId: uuid('recipient_person_id')
      .notNull()
      .references(() => people.id),
    area: varchar('area', { length: 30 }).notNull(),
    type: varchar('type', { length: 60 }).notNull(),
    tone: varchar('tone', { length: 20 }).notNull().default('neutral'),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    itemType: varchar('item_type', { length: 30 }),
    itemId: uuid('item_id'),
    itemRef: varchar('item_ref', { length: 40 }),
    commentId: uuid('comment_id'),
    channelsDelivered: text('channels_delivered').array().notNull().default(['in_app']),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_recipient_created').on(t.tenantId, t.recipientPersonId, t.createdAt),
    index('notifications_recipient_unread').on(t.tenantId, t.recipientPersonId, t.readAt),
  ],
);

/** Per-user channel preferences, digest choice, quiet hours and lock-screen privacy (screen 059c). */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    matrix: jsonb('matrix').notNull().default({}),
    digestFrequency: varchar('digest_frequency', { length: 20 }).notNull().default('daily'),
    digestChannel: varchar('digest_channel', { length: 20 }).notNull().default('email'),
    digestSendTime: varchar('digest_send_time', { length: 10 }).notNull().default('08:30'),
    digestTemplateId: uuid('digest_template_id'),
    bundleNonUrgent: boolean('bundle_non_urgent').notNull().default(false),
    quietStart: varchar('quiet_start', { length: 10 }).notNull().default('20:00'),
    quietEnd: varchar('quiet_end', { length: 10 }).notNull().default('08:00'),
    weekendQuiet: boolean('weekend_quiet').notNull().default(true),
    showAmountsInPush: boolean('show_amounts_in_push').notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('notification_preferences_person').on(t.tenantId, t.personId)],
);

/** Web Push subscriptions per user and device (screen 059c). */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    deviceLabel: text('device_label').notNull(),
    userAgentFamily: varchar('user_agent_family', { length: 80 }).notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    authKey: text('auth_key').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('push_subscriptions_person').on(t.tenantId, t.personId)],
);

/** Workspace/tenant chat app installations for Slack and Microsoft Teams (screen 061e). */
export const chatInstallations = pgTable(
  'chat_installations',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    provider: varchar('provider', { length: 20 }).notNull(),
    workspaceId: varchar('workspace_id', { length: 100 }).notNull(),
    workspaceName: text('workspace_name').notNull(),
    status: varchar('status', { length: 30 }).notNull().default('not_connected'),
    statusDetail: text('status_detail'),
    features: jsonb('features').notNull().default({}),
    allowedChannels: text('allowed_channels').array().notNull().default([]),
    secretRef: varchar('secret_ref', { length: 120 })
      .notNull()
      .default('secret-store://chat/default'),
    installedByPersonId: uuid('installed_by_person_id').references(() => people.id),
    installedAt: ts('installed_at'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('chat_installations_provider').on(t.tenantId, t.provider)],
);

/** Bound identity between a BudgetFlow person and a Slack or Microsoft Teams user (screen 061e). */
export const chatAccountLinks = pgTable(
  'chat_account_links',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    provider: varchar('provider', { length: 20 }).notNull(),
    providerUserId: varchar('provider_user_id', { length: 120 }).notNull(),
    handle: varchar('handle', { length: 120 }).notNull(),
    verifiedEmail: text('verified_email').notNull(),
    linkedAt: createdAt(),
    lastUsedAt: ts('last_used_at'),
  },
  (t) => [
    uniqueIndex('chat_account_links_person_provider').on(t.tenantId, t.personId, t.provider),
    uniqueIndex('chat_account_links_provider_user').on(t.tenantId, t.provider, t.providerUserId),
  ],
);

/** Outbound channel delivery log for Slack, Teams, email and push (screen 061b, 061c, 061e). */
export const channelDeliveries = pgTable(
  'channel_deliveries',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    channel: varchar('channel', { length: 20 }).notNull(),
    recipientPersonId: uuid('recipient_person_id').references(() => people.id),
    kind: varchar('kind', { length: 60 }).notNull(),
    subjectType: varchar('subject_type', { length: 30 }),
    subjectId: uuid('subject_id'),
    status: varchar('status', { length: 20 }).notNull().default('sent'),
    attempts: integer('attempts').notNull().default(1),
    externalMessageId: varchar('external_message_id', { length: 120 }),
    errorMessage: text('error_message'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('channel_deliveries_tenant_created').on(t.tenantId, t.createdAt),
    index('channel_deliveries_subject').on(t.tenantId, t.subjectType, t.subjectId),
  ],
);

/** Discussion comments on budgets, events and requests (screen 060a). */
export const comments = pgTable(
  'comments',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    itemType: varchar('item_type', { length: 20 }).notNull(),
    itemId: uuid('item_id').notNull(),
    parentCommentId: uuid('parent_comment_id'),
    authorPersonId: uuid('author_person_id')
      .notNull()
      .references(() => people.id),
    body: text('body').notNull(),
    mentions: uuid('mentions').array().notNull().default([]),
    createdAt: createdAt(),
    editedAt: ts('edited_at'),
    removedAt: ts('removed_at'),
    removedByPersonId: uuid('removed_by_person_id').references(() => people.id),
  },
  (t) => [index('comments_item_created').on(t.tenantId, t.itemType, t.itemId, t.createdAt)],
);

/** Items followed by a person (owner automatic or manual watch, screen 060a). */
export const follows = pgTable(
  'follows',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id),
    itemType: varchar('item_type', { length: 20 }).notNull(),
    itemId: uuid('item_id').notNull(),
    level: varchar('level', { length: 30 }).notNull().default('all'),
    source: varchar('source', { length: 20 }).notNull().default('manual'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('follows_person_item').on(t.tenantId, t.personId, t.itemType, t.itemId)],
);

/** Role-based digest templates and published versions (screen 064a). */
export const digests = pgTable(
  'digests',
  {
    id: pk(),
    tenantId: tenantRef().references(() => tenants.id),
    code: varchar('code', { length: 50 }).notNull(),
    name: text('name').notNull(),
    audienceRoles: text('audience_roles').array().notNull().default([]),
    frequency: varchar('frequency', { length: 30 }).notNull().default('weekly'),
    weekday: integer('weekday'),
    sendTime: varchar('send_time', { length: 10 }).notNull().default('08:30'),
    channelsAllowed: text('channels_allowed').array().notNull().default(['email']),
    introLine: text('intro_line').notNull().default(''),
    sections: jsonb('sections').notNull().default([]),
    skipWhenEmpty: boolean('skip_when_empty').notNull().default(true),
    status: varchar('status', { length: 20 }).notNull().default('published'),
    version: integer('version').notNull().default(1),
    lastSentAt: ts('last_sent_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('digests_tenant_code').on(t.tenantId, t.code)],
);
