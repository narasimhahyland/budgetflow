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
  inboundWebhookEvents,
  integrationConnections,
  integrationSecrets,
  tenants,
  webhookDeliveries,
  webhookEndpoints,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  CreateWebhookEndpointRequest,
  InboundWebhookRequest,
  InboundWebhookResult,
  IntegrationProvider,
  SendTestPingResult,
  SyncObject,
  UpdateWebhookEndpointRequest,
  WebhookDeliveriesQuery,
  WebhookDeliveryList,
  WebhookDeliveryView,
  WebhookEndpointCreated,
  WebhookEndpointList,
  WebhookEndpointView,
  WebhookEventType,
} from '@bf/contracts';
import type { Action, CurrencyCode } from '@bf/domain';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import {
  integrationsConfig,
  MAX_RETRY_ATTEMPTS,
  RETRY_BACKOFF_MINUTES,
  WEBHOOK_FAILURE_WINDOW_HOURS,
  WEBHOOK_SECRET_OVERLAP_HOURS,
} from './config';
import { ConnectionsService, tenantOf, type CommandContext } from './connections.service';
import {
  constantTimeEquals,
  decryptSecret,
  newBearerSecret,
  redact,
  signWebhookPayload,
  webhookDigest,
  type EncryptedSecret,
} from './crypto';
import { OutboundHttp, providerMessage } from './http';
import { SyncService } from './sync.service';

const HOUR_MS = 3_600_000;
const VERIFICATION =
  'Every delivery carries a BudgetFlow-Signature header: t=<unix seconds>,v1=<HMAC-SHA256 of "<t>.<body>">. Reject deliveries older than 5 minutes.';

/** Which inbound provider event feeds which object, so a callback runs the same sync as a schedule. */
const INBOUND_OBJECT: Record<string, SyncObject> = {
  'gl.posted': 'gl_lines',
  'gl_entry.submitted': 'gl_lines',
  'transaction.created': 'transactions',
  'transaction.updated': 'transactions',
  'expense.submitted': 'expense_lines',
  'expense.approved': 'expense_lines',
  'calendar.response': 'calendar_responses',
};

/** The outbox topics Phase 12 republishes to customer endpoints, and the names they get outside. */
const OUTBOX_TO_WEBHOOK: Record<
  string,
  (payload: Record<string, unknown>) => WebhookEventType | null
> = {
  'budget.control_changed': (p) => {
    const action = String(p['action'] ?? '');
    if (action === 'frozen') return 'budget.frozen';
    if (action === 'reduced') return 'budget.reduced';
    if (action === 'set_to_zero') return 'budget.set_to_zero';
    return null;
  },
  'budget.threshold_crossed': () => 'budget.threshold_crossed',
};

/**
 * Outbound webhooks to customer endpoints (101) and inbound provider callbacks (094, 096). Both
 * directions are HMAC-signed with a timestamp; inbound callbacks outside the window are rejected and
 * a provider event that arrives twice is applied once.
 */
@Injectable()
export class WebhooksService {
  private readonly log = new Logger(WebhooksService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly connections: ConnectionsService,
    private readonly http: OutboundHttp,
    private readonly audit: AuditService,
    private readonly sync: SyncService,
  ) {}

  // Endpoints ------------------------------------------------------------------------------------

  listEndpoints(actor: RequestActor): Promise<WebhookEndpointList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'integration.read', tenantOf(actor));
      const rows = await tx
        .select()
        .from(webhookEndpoints)
        .where(isNull(webhookEndpoints.deletedAt))
        .orderBy(desc(webhookEndpoints.createdAt));
      const items: WebhookEndpointView[] = [];
      for (const r of rows) items.push(await this.endpointView(tx, r));
      return { items, verification: VERIFICATION };
    });
  }

  private async endpointView(
    tx: Tx,
    row: typeof webhookEndpoints.$inferSelect,
  ): Promise<WebhookEndpointView> {
    const since = new Date(Date.now() - 7 * 24 * HOUR_MS);
    const [stats] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        ok: sql<number>`count(*) filter (where ${webhookDeliveries.status} = 'succeeded')::int`,
      })
      .from(webhookDeliveries)
      .where(
        and(eq(webhookDeliveries.endpointId, row.id), gte(webhookDeliveries.createdAt, since)),
      );
    const [last] = await tx
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.endpointId, row.id))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(1);
    return {
      id: row.id,
      url: row.url,
      description: row.description,
      events: row.events as WebhookEventType[],
      status: row.status as WebhookEndpointView['status'],
      lastDeliveryAt: last?.createdAt.toISOString() ?? null,
      lastStatusCode: last?.statusCode ?? null,
      lastDurationMs: last?.durationMs ?? null,
      successRateBps: stats && stats.total > 0 ? Math.round((stats.ok * 10_000) / stats.total) : 0,
      disabledAt: row.disabledAt?.toISOString() ?? null,
      disabledReason: row.disabledReason,
      secretSetAt: row.secretSetAt.toISOString(),
      secretRotatedAt: row.secretRotatedAt?.toISOString() ?? null,
    };
  }

  createEndpoint(
    actor: RequestActor,
    req: CreateWebhookEndpointRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<WebhookEndpointCreated>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'integrations.webhooks.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const url = new URL(req.url);
        if (
          url.protocol !== 'https:' &&
          !integrationsConfig().allowedHosts.includes(url.hostname)
        ) {
          throw new ApiProblem(422, 'WEBHOOK_URL_NOT_HTTPS', 'Use an https address.');
        }
        this.http.assertAllowed(req.url);
        const { secret } = newBearerSecret('live', actor.tenantId);
        const secretRef = await this.connections.storeSecret(tx, actor.tenantId, 'webhook', secret);
        const [row] = await tx
          .insert(webhookEndpoints)
          .values({
            tenantId: actor.tenantId,
            url: req.url,
            description: req.description ?? null,
            events: req.events,
            status: 'active',
            secretRef,
            createdBy: actor.personId,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.webhook_endpoint_created',
          resourceType: 'webhook_endpoint',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            url: { from: null, to: req.url },
            events: { from: null, to: req.events.join(' ') },
          },
        });
        return { endpoint: await this.endpointView(tx, row), signingSecret: secret };
      },
    );
  }

  updateEndpoint(
    actor: RequestActor,
    endpointId: string,
    req: UpdateWebhookEndpointRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<WebhookEndpointView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `integrations.webhooks.update:${endpointId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const row = await this.endpointOrFail(tx, endpointId);
        const reEnable = req.enabled === true;
        const [updated] = await tx
          .update(webhookEndpoints)
          .set({
            description: req.description ?? row.description,
            events: req.events ?? row.events,
            status: reEnable ? 'active' : row.status,
            disabledAt: reEnable ? null : row.disabledAt,
            disabledReason: reEnable ? null : row.disabledReason,
            failingSince: reEnable ? null : row.failingSince,
          })
          .where(eq(webhookEndpoints.id, endpointId))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.webhook_endpoint_updated',
          resourceType: 'webhook_endpoint',
          resourceId: endpointId,
          requestId: ctx.requestId,
          changes: {
            status: { from: row.status, to: updated.status },
            events: {
              from: (row.events as string[]).join(' '),
              to: (updated.events as string[]).join(' '),
            },
          },
        });
        return this.endpointView(tx, updated);
      },
    );
  }

  deleteEndpoint(
    actor: RequestActor,
    endpointId: string,
    ctx: CommandContext,
  ): Promise<CommandResult<{ removed: boolean }>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `integrations.webhooks.delete:${endpointId}`,
        request: { endpointId },
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const row = await this.endpointOrFail(tx, endpointId);
        await tx
          .update(webhookEndpoints)
          .set({ deletedAt: new Date(), status: 'disabled' })
          .where(eq(webhookEndpoints.id, endpointId));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.webhook_endpoint_removed',
          resourceType: 'webhook_endpoint',
          resourceId: endpointId,
          requestId: ctx.requestId,
          changes: { url: { from: row.url, to: null } },
        });
        return { removed: true };
      },
    );
  }

  rotateSecret(
    actor: RequestActor,
    endpointId: string,
    ctx: CommandContext,
  ): Promise<CommandResult<WebhookEndpointCreated>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `integrations.webhooks.rotate:${endpointId}`,
        request: { endpointId },
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const row = await this.endpointOrFail(tx, endpointId);
        const { secret } = newBearerSecret('live', actor.tenantId);
        const secretRef = await this.connections.storeSecret(tx, actor.tenantId, 'webhook', secret);
        const [updated] = await tx
          .update(webhookEndpoints)
          .set({
            secretRef,
            previousSecretRef: row.secretRef,
            secretRotatedAt: new Date(),
            previousSecretValidUntil: new Date(Date.now() + WEBHOOK_SECRET_OVERLAP_HOURS * HOUR_MS),
          })
          .where(eq(webhookEndpoints.id, endpointId))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.webhook_secret_rotated',
          resourceType: 'webhook_endpoint',
          resourceId: endpointId,
          requestId: ctx.requestId,
          changes: { secret: { from: row.secretRef, to: secretRef } },
        });
        return { endpoint: await this.endpointView(tx, updated), signingSecret: secret };
      },
    );
  }

  // Deliveries ------------------------------------------------------------------------------------

  listDeliveries(actor: RequestActor, q: WebhookDeliveriesQuery): Promise<WebhookDeliveryList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'integration.read', tenantOf(actor));
      const rows = await tx
        .select()
        .from(webhookDeliveries)
        .where(q.endpointId ? eq(webhookDeliveries.endpointId, q.endpointId) : undefined)
        .orderBy(desc(webhookDeliveries.createdAt))
        .limit(q.limit ?? 100);
      return { items: rows.map((r) => this.deliveryView(r)) };
    });
  }

  private deliveryView(row: typeof webhookDeliveries.$inferSelect): WebhookDeliveryView {
    return {
      id: row.id,
      endpointId: row.endpointId,
      eventId: row.eventId,
      eventType: row.eventType as WebhookEventType,
      attempt: row.attempt,
      statusCode: row.statusCode,
      durationMs: row.durationMs,
      status: row.status as WebhookDeliveryView['status'],
      nextRetryAt: row.nextRetryAt?.toISOString() ?? null,
      error: row.error,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** "Send test ping": one signed delivery the admin can see the result of straight away. */
  async sendTestPing(
    actor: RequestActor,
    endpointId: string,
    ctx: CommandContext,
  ): Promise<SendTestPingResult> {
    const prepared = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        return this.endpointOrFail(tx, endpointId);
      },
    );
    return this.deliver(actor.tenantId, prepared.id, 'budget.threshold_crossed', {
      test: true,
      message: 'This is a BudgetFlow test ping.',
      requestId: ctx.requestId,
    });
  }

  async redeliver(actor: RequestActor, deliveryId: string): Promise<SendTestPingResult> {
    const prior = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const [row] = await tx
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.id, deliveryId));
        if (!row) throw ApiProblem.notFound('delivery');
        return row;
      },
    );
    return this.deliver(
      actor.tenantId,
      prior.endpointId,
      prior.eventType as WebhookEventType,
      (prior.payload ?? {}) as Record<string, unknown>,
      prior.eventId,
      prior.attempt + 1,
    );
  }

  /**
   * Signs and sends one delivery, then records the attempt. Failures retry with backoff; an endpoint
   * that has been failing for 24 hours is disabled so a broken receiver cannot be retried forever.
   *
   * `deliveryId` is the queued row this attempt belongs to. The result is written onto that row, so
   * a delivery the fan-out queued is one row moving `pending` → `succeeded` / `failed` / `exhausted`
   * rather than a queued row that nothing ever resolves plus a second row with the outcome. Without
   * it (a test ping or an operator redelivery, which have no queued row) the attempt is inserted.
   */
  async deliver(
    tenantId: string,
    endpointId: string,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
    eventId: string = randomUUID(),
    attempt = 1,
    deliveryId: string | null = null,
  ): Promise<SendTestPingResult> {
    const endpoint = await withTenant(
      this.db,
      { tenantId, subject: 'system:webhooks' },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(webhookEndpoints)
          .where(eq(webhookEndpoints.id, endpointId));
        if (!row) throw ApiProblem.notFound('endpoint');
        const secret = row.secretRef ? await this.secretValue(tx, row.secretRef) : null;
        const previous =
          row.previousSecretRef &&
          row.previousSecretValidUntil &&
          row.previousSecretValidUntil.getTime() > Date.now()
            ? await this.secretValue(tx, row.previousSecretRef)
            : null;
        return { row, secret, previous };
      },
    );
    if (!endpoint.secret) {
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'This endpoint has no signing secret.');
    }
    const body = JSON.stringify({
      id: eventId,
      type: eventType,
      occurredAt: new Date().toISOString(),
      data: redact(payload),
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = {
      'BudgetFlow-Signature': signWebhookPayload(endpoint.secret, timestamp, body),
      'BudgetFlow-Event': eventType,
      'BudgetFlow-Delivery': eventId,
    };
    // During rotation both secrets sign, so a receiver can switch over without downtime.
    if (endpoint.previous) {
      headers['BudgetFlow-Signature-Previous'] = signWebhookPayload(
        endpoint.previous,
        timestamp,
        body,
      );
    }
    const res = await this.http.send({
      url: endpoint.row.url,
      method: 'POST',
      headers,
      body,
      attempts: 1,
    });

    return withTenant(this.db, { tenantId, subject: 'system:webhooks' }, async (tx) => {
      const failing = !res.ok;
      const exhausted = failing && attempt >= MAX_RETRY_ATTEMPTS;
      const outcome = {
        attempt,
        status: res.ok ? 'succeeded' : exhausted ? 'exhausted' : 'failed',
        statusCode: res.statusCode || null,
        durationMs: res.durationMs,
        nextRetryAt:
          failing && !exhausted
            ? new Date(
                Date.now() +
                  RETRY_BACKOFF_MINUTES[Math.min(attempt - 1, RETRY_BACKOFF_MINUTES.length - 1)] *
                    60_000,
              )
            : null,
        error: res.ok ? null : providerMessage(res.statusCode || null, res.body),
      };
      const [row] = deliveryId
        ? await tx
            .update(webhookDeliveries)
            .set(outcome)
            .where(eq(webhookDeliveries.id, deliveryId))
            .returning()
        : await tx
            .insert(webhookDeliveries)
            .values({ tenantId, endpointId, eventId, eventType, payload, ...outcome })
            .onConflictDoNothing()
            .returning();
      const since = endpoint.row.failingSince ?? new Date();
      const disable =
        failing && Date.now() - since.getTime() >= WEBHOOK_FAILURE_WINDOW_HOURS * HOUR_MS;
      await tx
        .update(webhookEndpoints)
        .set({
          failingSince: res.ok ? null : since,
          status: res.ok ? 'active' : disable ? 'disabled' : 'failing',
          disabledAt: disable ? new Date() : endpoint.row.disabledAt,
          disabledReason: disable
            ? `Disabled after ${WEBHOOK_FAILURE_WINDOW_HOURS} hours of failures.`
            : endpoint.row.disabledReason,
        })
        .where(eq(webhookEndpoints.id, endpointId));
      return {
        ok: res.ok,
        statusCode: res.statusCode || null,
        durationMs: res.durationMs,
        message: res.ok
          ? `${res.statusCode} OK in ${res.durationMs} ms`
          : providerMessage(res.statusCode || null, res.body),
        deliveryId: row?.id ?? null,
      };
    });
  }

  /**
   * Reuses the Phase 8 outbox: as the worker drains a message it offers it here, and every endpoint
   * subscribed to the matching event gets a pending delivery. No separate event pipeline. That
   * pending row is the delivery, not a note that one is coming: `deliverDue` hands its id to
   * `deliver`, which writes the outcome back onto it.
   *
   * An endpoint only receives events that happened while it existed. `messageCreatedAt` is the
   * outbox row's `created_at` and the endpoint's is its `created_at`; both are assigned by the same
   * Postgres `now()`, so the comparison orders two database timestamps rather than two clocks.
   * Without it, draining a backlog would hand a newly registered endpoint the history before it —
   * events its owner was never authorized to see, and the reason an endpoint's delivery count
   * depended on whether the worker drained before or after the endpoint was created.
   */
  async fanOutFromOutbox(
    tx: Tx,
    tenantId: string,
    topic: string,
    payload: Record<string, unknown>,
    messageCreatedAt: Date,
  ): Promise<string[]> {
    const map = OUTBOX_TO_WEBHOOK[topic];
    if (!map) return [];
    const eventType = map(payload);
    if (!eventType) return [];
    const endpoints = await tx
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          isNull(webhookEndpoints.deletedAt),
          lte(webhookEndpoints.createdAt, messageCreatedAt),
          sql`${eventType} = any(${webhookEndpoints.events})`,
        ),
      );
    const ids: string[] = [];
    for (const e of endpoints) {
      if (e.status === 'disabled') continue;
      const [row] = await tx
        .insert(webhookDeliveries)
        .values({
          tenantId,
          endpointId: e.id,
          eventId: randomUUID(),
          eventType,
          attempt: 0,
          status: 'pending',
          payload: redact(payload) as Record<string, unknown>,
          nextRetryAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: webhookDeliveries.id });
      if (row) ids.push(row.id);
    }
    return ids;
  }

  /** Worker job: sends everything pending or due for a retry, across tenants. */
  async deliverDue(): Promise<number> {
    const all = await this.db.transaction((tx) => tx.select({ id: tenants.id }).from(tenants));
    let sent = 0;
    for (const t of all) {
      const due = await withTenant(this.db, { tenantId: t.id, subject: 'system:webhooks' }, (tx) =>
        tx
          .select()
          .from(webhookDeliveries)
          .where(
            and(
              or(eq(webhookDeliveries.status, 'pending'), eq(webhookDeliveries.status, 'failed')),
              lte(webhookDeliveries.nextRetryAt, new Date()),
            ),
          )
          .orderBy(webhookDeliveries.createdAt)
          .limit(25),
      );
      for (const d of due) {
        // Clearing nextRetryAt claims the row, so the next tick cannot pick it up while it is in
        // flight; deliver() then writes this attempt's outcome back onto the same row.
        try {
          await withTenant(this.db, { tenantId: t.id, subject: 'system:webhooks' }, (tx) =>
            tx
              .update(webhookDeliveries)
              .set({ nextRetryAt: null })
              .where(eq(webhookDeliveries.id, d.id)),
          );
          await this.deliver(
            t.id,
            d.endpointId,
            d.eventType as WebhookEventType,
            (d.payload ?? {}) as Record<string, unknown>,
            d.eventId,
            d.attempt + 1,
            d.id,
          );
          sent++;
        } catch (e) {
          // The send never happened (a removed endpoint, a missing secret). Record it against the
          // claimed row: leaving it pending would show the log a queued delivery nothing will send.
          const message = (e as Error).message;
          this.log.warn(`webhook delivery ${d.id} failed: ${message}`);
          await this.recordUnsent(t.id, d.id, d.attempt + 1, message);
        }
      }
    }
    return sent;
  }

  /** Marks a claimed delivery that could not be attempted at all, so it never stays `pending`. */
  private async recordUnsent(
    tenantId: string,
    deliveryId: string,
    attempt: number,
    message: string,
  ): Promise<void> {
    const exhausted = attempt >= MAX_RETRY_ATTEMPTS;
    await withTenant(this.db, { tenantId, subject: 'system:webhooks' }, (tx) =>
      tx
        .update(webhookDeliveries)
        .set({
          attempt,
          status: exhausted ? 'exhausted' : 'failed',
          error: message,
          nextRetryAt: exhausted
            ? null
            : new Date(
                Date.now() +
                  RETRY_BACKOFF_MINUTES[Math.min(attempt - 1, RETRY_BACKOFF_MINUTES.length - 1)] *
                    60_000,
              ),
        })
        .where(eq(webhookDeliveries.id, deliveryId)),
    ).catch((e) =>
      this.log.error(`could not record delivery ${deliveryId}: ${(e as Error).message}`),
    );
  }

  // Inbound provider callbacks ------------------------------------------------------------------

  /**
   * Verifies the HMAC signature and the timestamp window before any business logic, rejects anything
   * outside the window as a replay, applies a provider event only once, and then runs the same sync
   * a schedule would: records reach the actuals review, never the ledger directly.
   */
  async receive(
    tenantId: string,
    connectionId: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
    parsed: InboundWebhookRequest,
    requestId: string | null,
  ): Promise<InboundWebhookResult> {
    const prepared = await withTenant(
      this.db,
      { tenantId, subject: `webhook:${connectionId}` },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(integrationConnections)
          .where(eq(integrationConnections.id, connectionId));
        if (!row || row.disconnectedAt) throw ApiProblem.notFound('connection');
        const secret = row.secretRef ? await this.secretValue(tx, row.secretRef) : null;
        return { row, secret };
      },
    );
    if (!prepared.secret) {
      throw new ApiProblem(
        401,
        'WEBHOOK_SIGNATURE_INVALID',
        'This connection has no shared secret to verify the call with.',
      );
    }
    this.verifyInboundSignature(headers, rawBody, prepared.secret);

    const replayed = await withTenant(
      this.db,
      { tenantId, subject: `webhook:${connectionId}` },
      async (tx) => {
        const inserted = await tx
          .insert(inboundWebhookEvents)
          .values({
            tenantId,
            connectionId,
            externalEventId: parsed.eventId,
            eventType: parsed.type,
          })
          .onConflictDoNothing({
            target: [inboundWebhookEvents.connectionId, inboundWebhookEvents.externalEventId],
          })
          .returning({ id: inboundWebhookEvents.id });
        return inserted.length === 0;
      },
    );
    if (replayed) {
      // The provider is retrying an event BudgetFlow already handled: acknowledge, change nothing.
      return { accepted: true, replayed: true, syncRunId: null, recordsApplied: 0 };
    }

    const object = INBOUND_OBJECT[parsed.type];
    if (!object) {
      return { accepted: true, replayed: false, syncRunId: null, recordsApplied: 0 };
    }
    const actor = await this.systemActor(tenantId, connectionId, prepared.row.provider);
    const run = await this.sync.run(
      actor,
      connectionId,
      { object, direction: 'inbound' },
      { idempotencyKey: `webhook:${connectionId}:${parsed.eventId}`, requestId },
    );
    await withTenant(this.db, { tenantId, subject: actor.subject }, (tx) =>
      tx
        .update(inboundWebhookEvents)
        .set({ syncRunId: run.id, recordsApplied: run.recordsApplied })
        .where(
          and(
            eq(inboundWebhookEvents.connectionId, connectionId),
            eq(inboundWebhookEvents.externalEventId, parsed.eventId),
          ),
        ),
    );
    return {
      accepted: true,
      replayed: false,
      syncRunId: run.id,
      recordsApplied: run.recordsApplied,
    };
  }

  private verifyInboundSignature(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
    secret: string,
  ): void {
    const get = (k: string) => {
      const v = headers[k];
      return Array.isArray(v) ? v[0] : v;
    };
    const raw = get('budgetflow-signature') ?? get('x-bf-signature');
    if (!raw) {
      throw new ApiProblem(401, 'WEBHOOK_SIGNATURE_INVALID', 'Missing webhook HMAC signature.');
    }
    const match = /^t=(\d{9,12}),v1=([0-9a-f]{64})$/.exec(raw.trim());
    if (!match) {
      throw new ApiProblem(
        401,
        'WEBHOOK_SIGNATURE_INVALID',
        'The BudgetFlow-Signature header is malformed.',
      );
    }
    const timestamp = Number(match[1]);
    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
    if (ageSeconds > integrationsConfig().webhookToleranceSeconds) {
      throw new ApiProblem(
        401,
        'WEBHOOK_TIMESTAMP_EXPIRED',
        'This call is outside the five-minute replay window.',
      );
    }
    if (!constantTimeEquals(webhookDigest(secret, timestamp, rawBody), match[2])) {
      throw new ApiProblem(
        401,
        'WEBHOOK_SIGNATURE_INVALID',
        'Webhook signature verification failed.',
      );
    }
  }

  /**
   * A verified callback has no signed-in person. It acts as a service identity scoped to exactly the
   * actions an inbound sync needs, so `PolicyService` still decides every step.
   */
  private async systemActor(
    tenantId: string,
    connectionId: string,
    provider: string,
  ): Promise<RequestActor> {
    const [tenant] = await this.db.transaction((tx) =>
      tx
        .select({ name: tenants.name, currency: tenants.reportingCurrency })
        .from(tenants)
        .where(eq(tenants.id, tenantId)),
    );
    const scopes: Action[] = [
      'tenant.read',
      'integration.read',
      'integration.manage',
      'actuals.read',
      'actuals.manage',
    ];
    return {
      subject: `webhook:${provider}:${connectionId}`,
      tenantId,
      personId: null,
      roles: [],
      ownedBudgetPaths: [],
      serviceScopes: scopes,
      displayName: `${provider} webhook`,
      tenantName: tenant?.name ?? '',
      reportingCurrency: (tenant?.currency ?? 'USD') as CurrencyCode,
      memberships: [],
    };
  }

  private async secretValue(tx: Tx, secretRef: string): Promise<string | null> {
    const [row] = await tx
      .select()
      .from(integrationSecrets)
      .where(eq(integrationSecrets.id, secretRef));
    return row ? decryptSecret(row as unknown as EncryptedSecret) : null;
  }

  private async endpointOrFail(tx: Tx, endpointId: string) {
    const [row] = await tx
      .select()
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.id, endpointId));
    if (!row || row.deletedAt) throw ApiProblem.notFound('webhook endpoint');
    return row;
  }

  /** Exposed for the inbound scenarios and the mock receiver: the signature a provider must send. */
  static signatureFor(secret: string, timestampSeconds: number, body: string): string {
    return signWebhookPayload(secret, timestampSeconds, body);
  }

  /** Used by the connection detail to say which provider may call in. */
  providerOf(row: { provider: string }): IntegrationProvider {
    return row.provider as IntegrationProvider;
  }
}
