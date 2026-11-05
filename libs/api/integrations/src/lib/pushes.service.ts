import { AuditService } from '@bf/api/audit';
import { ApiProblem, DB, PolicyService, type RequestActor } from '@bf/api/core';
import {
  commitments,
  events,
  integrationConnections,
  integrationPushes,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  CreatePushRequest,
  IntegrationProvider,
  PushItemList,
  PushItemView,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { connectorFor } from './connectors';
import { ConnectionsService, tenantOf, type CommandContext } from './connections.service';
import { classifyError, OutboundHttp, providerMessage } from './http';
import { SyncService } from './sync.service';

/** How long a pushed card limit stays open after the service ends (096). */
const LIMIT_GRACE_DAYS = 7;

const addDays = (iso: string, days: number): string =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Event codes and card limits pushed out to providers (99b, 096). A card limit never exceeds the
 * approved commitment, and every push carries an idempotency key so a retry cannot double a limit.
 */
@Injectable()
export class PushesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly connections: ConnectionsService,
    private readonly http: OutboundHttp,
    private readonly audit: AuditService,
    private readonly sync: SyncService,
  ) {}

  list(
    actor: RequestActor,
    q: { connectionId?: string; kind?: 'event_code' | 'card_limit' },
  ): Promise<PushItemList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'integration.read', tenantOf(actor));
      const filters = [
        q.connectionId ? eq(integrationPushes.connectionId, q.connectionId) : undefined,
        q.kind ? eq(integrationPushes.kind, q.kind) : undefined,
      ].filter(Boolean);
      const rows = await tx
        .select({ push: integrationPushes, provider: integrationConnections.provider })
        .from(integrationPushes)
        .innerJoin(
          integrationConnections,
          eq(integrationConnections.id, integrationPushes.connectionId),
        )
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(desc(integrationPushes.createdAt))
        .limit(200);
      const enabled = q.connectionId
        ? Boolean(
            (
              (await this.connections.rowOrFail(tx, q.connectionId)).settings as {
                cardLimitPush?: boolean;
              }
            ).cardLimitPush,
          )
        : false;
      return {
        items: rows.map((r) => this.view(r.push, r.provider as IntegrationProvider)),
        cardLimitPushEnabled: enabled,
      };
    });
  }

  view(row: typeof integrationPushes.$inferSelect, provider: IntegrationProvider): PushItemView {
    return {
      id: row.id,
      connectionId: row.connectionId,
      provider,
      kind: row.kind as PushItemView['kind'],
      reference: row.reference,
      amount:
        row.amountMinor !== null && row.currency
          ? { amountMinor: row.amountMinor, currency: row.currency }
          : null,
      validFrom: row.validFrom,
      validTo: row.validTo,
      status: row.status as PushItemView['status'],
      externalId: row.externalId,
      lastError: row.lastError,
      pushedAt: row.pushedAt?.toISOString() ?? null,
    };
  }

  /** Creates the push item, calls the provider, and records a retryable failure when it refuses. */
  async create(
    actor: RequestActor,
    req: CreatePushRequest,
    ctx: CommandContext,
  ): Promise<PushItemView> {
    const prepared = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const row = await this.connections.rowOrFail(tx, req.connectionId);
        const definition = connectorFor(row.provider as IntegrationProvider);
        const spec = definition.pushes.find((p) => p.kind === req.kind);
        if (!spec) {
          throw new ApiProblem(
            422,
            'CONNECTOR_OBJECT_UNSUPPORTED',
            `${definition.displayName} does not accept ${req.kind.replace('_', ' ')} pushes.`,
          );
        }
        const item =
          req.kind === 'card_limit'
            ? await this.cardLimit(
                tx,
                row.settings as { cardLimitPush?: boolean },
                req,
                definition.displayName,
              )
            : await this.eventCode(tx, req);
        const idempotencyKey = `push:${req.connectionId}:${req.kind}:${item.reference}`;
        const [existing] = await tx
          .select()
          .from(integrationPushes)
          .where(eq(integrationPushes.idempotencyKey, idempotencyKey));
        if (existing && existing.status === 'pushed')
          return { row, spec, existing, item, idempotencyKey };
        const [created] =
          existing !== undefined
            ? [existing]
            : await tx
                .insert(integrationPushes)
                .values({
                  tenantId: actor.tenantId,
                  connectionId: req.connectionId,
                  kind: req.kind,
                  eventId: req.eventId ?? null,
                  commitmentId: req.commitmentId ?? null,
                  reference: item.reference,
                  amountMinor: item.amountMinor,
                  currency: item.currency,
                  validFrom: item.validFrom,
                  validTo: item.validTo,
                  status: 'pending',
                  idempotencyKey,
                })
                .returning();
        return { row, spec, existing: created, item, idempotencyKey };
      },
    );

    const provider = prepared.row.provider as IntegrationProvider;
    if (prepared.existing.status === 'pushed') return this.view(prepared.existing, provider);

    const context = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      (tx) => this.connections.contextFor(tx, prepared.row),
    );
    const body = JSON.stringify({
      reference: prepared.item.reference,
      amountMinor: prepared.item.amountMinor,
      currency: prepared.item.currency,
      validFrom: prepared.item.validFrom,
      validTo: prepared.item.validTo,
      idempotencyKey: prepared.idempotencyKey,
    });
    const res = await this.http.send({
      url: `${context.baseUrl}${prepared.spec.path}`,
      method: 'POST',
      headers: { authorization: `Bearer ${context.credential}` },
      body,
    });
    const externalId = res.ok
      ? ((prepared.spec.externalIdPath.reduce<unknown>(
          (acc, k) => (acc as never)?.[k],
          JSON.parse(res.body || '{}'),
        ) as string | undefined) ?? null)
      : null;

    if (!res.ok) {
      const message = providerMessage(res.statusCode || null, res.body);
      await this.sync.recordFailure(actor, {
        connectionId: req.connectionId,
        syncRunId: null,
        direction: 'outbound',
        item: `${req.kind === 'card_limit' ? 'Card limit' : 'Event code'} ${prepared.item.reference} to ${prepared.row.displayName}`,
        error: message,
        statusCode: res.statusCode || null,
        payload: { pushId: prepared.existing.id, reference: prepared.item.reference },
        idempotencyKey: prepared.idempotencyKey,
        errorClass: classifyError(res.statusCode || null, message),
      });
    }

    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const [updated] = await tx
        .update(integrationPushes)
        .set({
          status: res.ok ? 'pushed' : 'failed',
          externalId,
          lastError: res.ok ? null : providerMessage(res.statusCode || null, res.body),
          pushedAt: res.ok ? new Date() : null,
        })
        .where(eq(integrationPushes.id, prepared.existing.id))
        .returning();
      await this.audit.append(tx, {
        tenantId: actor.tenantId,
        actorPersonId: actor.personId,
        actorSubject: actor.subject,
        action: res.ok ? 'integration.pushed' : 'integration.push_failed',
        resourceType: 'integration_push',
        resourceId: updated.id,
        requestId: ctx.requestId,
        changes: {
          kind: { from: null, to: req.kind },
          reference: { from: null, to: prepared.item.reference },
          amountMinor: { from: null, to: prepared.item.amountMinor },
          externalId: { from: null, to: externalId },
        },
      });
      return this.view(updated, provider);
    });
  }

  /** The limit equals the approved commitment and expires seven days after the service ends. */
  private async cardLimit(
    tx: Tx,
    settings: { cardLimitPush?: boolean },
    req: CreatePushRequest,
    connectorName: string,
  ) {
    if (!settings.cardLimitPush) {
      throw new ApiProblem(
        409,
        'PUSH_NOT_ENABLED',
        `Card-limit push is off for ${connectorName}. A Finance Admin turns it on first.`,
      );
    }
    if (!req.commitmentId)
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'Name the commitment the limit is for.');
    const [c] = await tx.select().from(commitments).where(eq(commitments.id, req.commitmentId));
    if (!c) throw ApiProblem.notFound('commitment');
    if (c.status !== 'encumbered' && c.status !== 'partially_consumed') {
      throw new ApiProblem(
        409,
        'COMMITMENT_NOT_OPEN',
        'Only an approved, open commitment can become a card limit.',
        { status: c.status },
      );
    }
    const open = c.amountMinor - c.consumedMinor - c.releasedMinor;
    const today = new Date().toISOString().slice(0, 10);
    return {
      reference: `CMT-${c.id.slice(-8).toUpperCase()}`,
      amountMinor: open,
      currency: c.currency,
      validFrom: today,
      validTo: addDays(c.serviceEnd ?? today, LIMIT_GRACE_DAYS),
    };
  }

  private async eventCode(tx: Tx, req: CreatePushRequest) {
    if (!req.eventId)
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'Name the event whose code is pushed.');
    const [e] = await tx.select().from(events).where(eq(events.id, req.eventId));
    if (!e) throw ApiProblem.notFound('event');
    return {
      reference: e.eventCode,
      amountMinor: null,
      currency: null,
      validFrom: null,
      validTo: null,
    };
  }
}
