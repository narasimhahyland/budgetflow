import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import {
  integrationConnections,
  integrationMappings,
  integrationMessages,
  integrationPushes,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  DiscardMessagesRequest,
  IntegrationMessageList,
  IntegrationMessageView,
  IntegrationMessagesQuery,
  IntegrationProvider,
  MessageActionResult,
  RetryMessagesRequest,
  SyncObject,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ConnectionsService, tenantOf, type CommandContext } from './connections.service';
import { PushesService } from './pushes.service';
import { SyncService } from './sync.service';

type MessageRow = typeof integrationMessages.$inferSelect;

/**
 * The retrying queue and the dead letter (100). A retry reuses the original idempotency key, so a
 * success never duplicates; a discard keeps the item with its reason for audit.
 */
@Injectable()
export class MessagesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly connections: ConnectionsService,
    private readonly sync: SyncService,
    private readonly pushes: PushesService,
    private readonly audit: AuditService,
  ) {}

  list(actor: RequestActor, q: IntegrationMessagesQuery): Promise<IntegrationMessageList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'integration.read', tenantOf(actor));
      const filters = [
        q.status ? eq(integrationMessages.status, q.status) : undefined,
        q.connectionId ? eq(integrationMessages.connectionId, q.connectionId) : undefined,
        q.direction ? eq(integrationMessages.direction, q.direction) : undefined,
        q.errorClass ? eq(integrationMessages.errorClass, q.errorClass) : undefined,
      ].filter(Boolean);
      const rows = await tx
        .select({ m: integrationMessages, provider: integrationConnections.provider })
        .from(integrationMessages)
        .innerJoin(
          integrationConnections,
          eq(integrationConnections.id, integrationMessages.connectionId),
        )
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(integrationMessages.firstFailedAt))
        .limit(200);
      const counts = await tx
        .select({ status: integrationMessages.status, n: sql<number>`count(*)::int` })
        .from(integrationMessages)
        .groupBy(integrationMessages.status);
      return {
        items: rows.map((r) => this.view(r.m, r.provider as IntegrationProvider)),
        retrying: counts.find((c) => c.status === 'retrying')?.n ?? 0,
        deadLetter: counts.find((c) => c.status === 'dead_letter')?.n ?? 0,
      };
    });
  }

  view(row: MessageRow, provider: IntegrationProvider): IntegrationMessageView {
    return {
      id: row.id,
      connectionId: row.connectionId,
      provider,
      direction: row.direction as IntegrationMessageView['direction'],
      item: row.item,
      errorClass: row.errorClass as IntegrationMessageView['errorClass'],
      lastError: row.lastError,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      firstFailedAt: row.firstFailedAt.toISOString(),
      nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
      movedToDeadLetterAt: row.movedToDeadLetterAt?.toISOString() ?? null,
      status: row.status as IntegrationMessageView['status'],
      discardReasonCode: row.discardReasonCode,
      discardReason: row.discardReason,
      payloadRedacted: (row.payloadRedacted ?? {}) as Record<string, unknown>,
      idempotencyKey: row.idempotencyKey,
    };
  }

  /** Retries each item the way it originally ran, with the key it already holds. */
  async retry(
    actor: RequestActor,
    req: RetryMessagesRequest,
    ctx: CommandContext,
  ): Promise<MessageActionResult> {
    const rows = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const found = await tx
          .select()
          .from(integrationMessages)
          .where(inArray(integrationMessages.id, req.ids));
        if (found.length !== req.ids.length) throw ApiProblem.notFound('message');
        const blocked = found.find((m) => m.status === 'discarded' || m.status === 'succeeded');
        if (blocked) {
          throw new ApiProblem(
            409,
            'MESSAGE_NOT_RETRYABLE',
            `"${blocked.item}" was already ${blocked.status === 'discarded' ? 'discarded' : 'applied'}.`,
          );
        }
        return found;
      },
    );

    let succeeded = 0;
    for (const m of rows) {
      const ok = await this.retryOne(actor, m, ctx);
      if (ok) succeeded++;
    }
    return this.finish(actor, req.ids, 'integration.messages_retried', ctx, {
      retried: rows.length,
      succeeded,
    });
  }

  private async retryOne(
    actor: RequestActor,
    message: MessageRow,
    ctx: CommandContext,
  ): Promise<boolean> {
    const payload = (message.payloadRedacted ?? {}) as Record<string, unknown>;
    try {
      if (payload['pushId']) {
        const pushed = await withTenant(
          this.db,
          { tenantId: actor.tenantId, subject: actor.subject },
          async (tx) => {
            const [p] = await tx
              .select()
              .from(integrationPushes)
              .where(eq(integrationPushes.id, String(payload['pushId'])));
            return p ?? null;
          },
        );
        if (!pushed) return false;
        const result = await this.pushes.create(
          actor,
          {
            connectionId: pushed.connectionId,
            kind: pushed.kind as 'event_code' | 'card_limit',
            eventId: pushed.eventId ?? undefined,
            commitmentId: pushed.commitmentId ?? undefined,
          },
          ctx,
        );
        if (result.status !== 'pushed') return false;
      } else if (payload['missing']) {
        // Mapping errors clear once the value is mapped; the next sync picks the record up.
        const stillMissing = await withTenant(
          this.db,
          { tenantId: actor.tenantId, subject: actor.subject },
          async (tx) => this.mappingMissing(tx, message, payload),
        );
        if (stillMissing) return false;
      } else if (payload['object']) {
        const run = await this.sync.run(
          actor,
          message.connectionId,
          {
            object: payload['object'] as SyncObject,
            direction: message.direction as 'inbound' | 'outbound',
            since: (payload['since'] as string) ?? undefined,
          },
          { idempotencyKey: `retry:${message.idempotencyKey}`, requestId: ctx.requestId },
        );
        if (run.status === 'failed') return false;
      } else {
        return false;
      }
    } catch {
      return false;
    }
    await withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      tx
        .update(integrationMessages)
        .set({ status: 'succeeded', nextRetryAt: null, updatedAt: new Date() })
        .where(eq(integrationMessages.id, message.id)),
    );
    return true;
  }

  private async mappingMissing(
    tx: Tx,
    message: MessageRow,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const missing = payload['missing'] as { kind: string; value: string } | undefined;
    if (!missing) return true;
    const [hit] = await tx
      .select()
      .from(integrationMappings)
      .where(
        and(
          eq(integrationMappings.connectionId, message.connectionId),
          eq(integrationMappings.kind, missing.kind),
          eq(integrationMappings.externalValue, missing.value),
        ),
      );
    return !hit || !hit.approved;
  }

  discard(
    actor: RequestActor,
    req: DiscardMessagesRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<MessageActionResult>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'integrations.messages.discard',
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const found = await tx
          .select()
          .from(integrationMessages)
          .where(inArray(integrationMessages.id, req.ids));
        if (found.length !== req.ids.length) throw ApiProblem.notFound('message');
        await tx
          .update(integrationMessages)
          .set({
            status: 'discarded',
            nextRetryAt: null,
            discardReasonCode: req.reasonCode,
            discardReason: req.reason,
            updatedAt: new Date(),
          })
          .where(inArray(integrationMessages.id, req.ids));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.messages_discarded',
          resourceType: 'integration_message',
          resourceId: req.ids.join(','),
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            count: { from: null, to: req.ids.length },
            reasonCode: { from: null, to: req.reasonCode },
          },
        });
        return this.resultFor(tx, req.ids);
      },
    );
  }

  private async finish(
    actor: RequestActor,
    ids: string[],
    action: string,
    ctx: CommandContext,
    changes: Record<string, number>,
  ): Promise<MessageActionResult> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: actor.personId,
        actorSubject: actor.subject,
        action,
        resourceType: 'integration_message',
        resourceId: ids.join(','),
        requestId: ctx.requestId,
        changes: Object.fromEntries(
          Object.entries(changes).map(([k, v]) => [k, { from: null, to: v }]),
        ),
      });
      return this.resultFor(tx, ids);
    });
  }

  private async resultFor(tx: Tx, ids: string[]): Promise<MessageActionResult> {
    const rows = await tx
      .select({ m: integrationMessages, provider: integrationConnections.provider })
      .from(integrationMessages)
      .innerJoin(
        integrationConnections,
        eq(integrationConnections.id, integrationMessages.connectionId),
      )
      .where(inArray(integrationMessages.id, ids));
    const items = rows.map((r) => this.view(r.m, r.provider as IntegrationProvider));
    return {
      succeeded: items.filter((i) => i.status === 'succeeded').length,
      stillFailing: items.filter((i) => i.status === 'retrying' || i.status === 'dead_letter')
        .length,
      discarded: items.filter((i) => i.status === 'discarded').length,
      items,
    };
  }

  /** Used by the connector tests to see a message straight after it was written. */
  async byKey(actor: RequestActor, key: string): Promise<MessageRow | null> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const [row] = await tx
        .select()
        .from(integrationMessages)
        .where(eq(integrationMessages.idempotencyKey, key));
      return row ?? null;
    });
  }

  /** Kept so the connection detail can report whether a connector has anything failing. */
  async failingCount(tx: Tx, connectionId: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(integrationMessages)
      .where(
        and(
          eq(integrationMessages.connectionId, connectionId),
          inArray(integrationMessages.status, ['retrying', 'dead_letter']),
        ),
      );
    return row?.n ?? 0;
  }

  /** Disconnecting stops schedules; the connection row is reloaded through ConnectionsService. */
  reload(actor: RequestActor, connectionId: string) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.connections.rowOrFail(tx, connectionId),
    );
  }
}
