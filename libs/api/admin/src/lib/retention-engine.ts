import {
  aiConversations,
  notifications,
  people,
  productAnalyticsEvents,
  webhookDeliveries,
  type Tx,
} from '@bf/api/db';
import type { RetentionCandidate } from '@bf/domain';
import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';

/**
 * What a retention category actually does to the data. `collect` finds the records that are past
 * their period; `apply` removes or anonymises exactly the ids it is given — never more. Legal holds
 * are applied between the two steps by `RetentionService`, which is the only caller.
 */
export interface RetentionHandler {
  category: string;
  collect(tx: Tx, cutoff: Date): Promise<RetentionCandidate[]>;
  apply(tx: Tx, ids: readonly string[]): Promise<number>;
}

const iso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(`${value}T00:00:00.000Z`).toISOString();

const notificationsHandler: RetentionHandler = {
  category: 'notifications',
  async collect(tx, cutoff) {
    const rows = await tx
      .select({
        id: notifications.id,
        createdAt: notifications.createdAt,
        recipientPersonId: notifications.recipientPersonId,
        itemType: notifications.itemType,
        itemId: notifications.itemId,
      })
      .from(notifications)
      .where(lt(notifications.createdAt, cutoff));
    return rows.map((r) => ({
      id: r.id,
      occurredAt: iso(r.createdAt),
      personId: r.recipientPersonId,
      eventId: r.itemType === 'event' ? r.itemId : null,
      budgetId: r.itemType === 'budget' ? r.itemId : null,
    }));
  },
  async apply(tx, ids) {
    if (!ids.length) return 0;
    await tx.delete(notifications).where(inArray(notifications.id, [...ids]));
    return ids.length;
  },
};

const analyticsHandler: RetentionHandler = {
  category: 'product_analytics',
  async collect(tx, cutoff) {
    const rows = await tx
      .select({
        id: productAnalyticsEvents.id,
        occurredAt: productAnalyticsEvents.occurredAt,
        actorPersonId: productAnalyticsEvents.actorPersonId,
      })
      .from(productAnalyticsEvents)
      .where(lt(productAnalyticsEvents.occurredAt, cutoff));
    return rows.map((r) => ({
      id: r.id,
      occurredAt: iso(r.occurredAt),
      personId: r.actorPersonId,
    }));
  },
  async apply(tx, ids) {
    if (!ids.length) return 0;
    await tx.delete(productAnalyticsEvents).where(inArray(productAnalyticsEvents.id, [...ids]));
    return ids.length;
  },
};

const webhookDeliveryHandler: RetentionHandler = {
  category: 'integration_logs',
  async collect(tx, cutoff) {
    const rows = await tx
      .select({ id: webhookDeliveries.id, createdAt: webhookDeliveries.createdAt })
      .from(webhookDeliveries)
      .where(lt(webhookDeliveries.createdAt, cutoff));
    return rows.map((r) => ({ id: r.id, occurredAt: iso(r.createdAt) }));
  },
  async apply(tx, ids) {
    if (!ids.length) return 0;
    await tx.delete(webhookDeliveries).where(inArray(webhookDeliveries.id, [...ids]));
    return ids.length;
  },
};

/**
 * Leavers: personal details are replaced, the person row stays. Ledger lines and audit entries keep
 * their reference, so the accounting record is complete and the audit chain still verifies.
 */
const leaverHandler: RetentionHandler = {
  category: 'leaver_personal_data',
  async collect(tx, cutoff) {
    const cutoffDay = cutoff.toISOString().slice(0, 10);
    const rows = await tx
      .select({ id: people.id, endDate: people.endDate })
      .from(people)
      .where(
        and(isNotNull(people.endDate), lt(people.endDate, cutoffDay), isNull(people.anonymisedAt)),
      );
    return rows.map((r) => ({ id: r.id, occurredAt: iso(r.endDate!), personId: r.id }));
  },
  async apply(tx, ids) {
    if (!ids.length) return 0;
    const now = new Date();
    for (const id of ids) {
      await tx
        .update(people)
        .set({
          displayName: sql`'Former employee ' || left(${people.id}::text, 8)`,
          email: sql`'anonymised+' || ${people.id}::text || '@example.invalid'`,
          jobTitle: null,
          timezone: null,
          anonymisedAt: now,
        })
        .where(eq(people.id, id));
    }
    return ids.length;
  },
};

/**
 * AI conversation history (113a). The window runs from the last question in a conversation, not from
 * each turn, so a thread someone is still using is never half-deleted. Deleting the conversation
 * takes its turns with it: `ai_conversation_turns.conversation_id` cascades.
 *
 * Until this handler existed the window was a read-side filter and nothing ever deleted a row, so
 * the text was hidden rather than purged. Legal holds are matched on the asker's person, as they are
 * everywhere else here, which is why this belongs in the sweep rather than in its own job.
 */
const aiConversationHandler: RetentionHandler = {
  category: 'ai_conversations',
  async collect(tx, cutoff) {
    const rows = await tx
      .select({
        id: aiConversations.id,
        lastAskedAt: aiConversations.lastAskedAt,
        personId: aiConversations.personId,
      })
      .from(aiConversations)
      .where(lt(aiConversations.lastAskedAt, cutoff));
    return rows.map((r) => ({
      id: r.id,
      occurredAt: iso(r.lastAskedAt),
      personId: r.personId,
    }));
  },
  async apply(tx, ids) {
    if (!ids.length) return 0;
    await tx.delete(aiConversations).where(inArray(aiConversations.id, [...ids]));
    return ids.length;
  },
};

export const RETENTION_HANDLERS: readonly RetentionHandler[] = [
  notificationsHandler,
  analyticsHandler,
  webhookDeliveryHandler,
  leaverHandler,
  aiConversationHandler,
];

export const handlerFor = (category: string): RetentionHandler | undefined =>
  RETENTION_HANDLERS.find((h) => h.category === category);
