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
  integrationSecrets,
  people,
  syncRuns,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  ConnectRequest,
  ConnectionDetail,
  ConnectionSummary,
  IntegrationProvider,
  IntegrationsHub,
  PutMappingsRequest,
  SyncSchedule,
  TestConnectionResult,
  UpdateConnectionRequest,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { integrationsConfig } from './config';
import { CONNECTORS, connectorFor, type ConnectorDefinition } from './connectors';
import { decryptSecret, encryptSecret, type EncryptedSecret } from './crypto';
import { OutboundHttp, providerMessage } from './http';

export interface CommandContext {
  idempotencyKey: string;
  requestId: string | null;
}

export const tenantOf = (actor: RequestActor) =>
  ({ kind: 'tenant', tenantId: actor.tenantId }) as const;

export type ConnectionRow = typeof integrationConnections.$inferSelect;

/** Everything an adapter needs for one call. The credential is decrypted here and never logged. */
export interface ConnectorContext {
  connection: ConnectionRow;
  definition: ConnectorDefinition;
  baseUrl: string;
  credential: string;
  mappings: Map<string, string>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Connections, credentials, mappings and the hub (092, 093-098, 094a). */
@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly http: OutboundHttp,
  ) {}

  // Reads ---------------------------------------------------------------------------------------

  hub(actor: RequestActor): Promise<IntegrationsHub> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'integration.read', tenantOf(actor));
      const rows = await tx
        .select()
        .from(integrationConnections)
        .orderBy(integrationConnections.category, integrationConnections.displayName);
      const live = rows.filter((r) => !r.disconnectedAt);
      const connections = await Promise.all(live.map((r) => this.summary(tx, r)));
      const counts = await tx
        .select({ status: integrationMessages.status, n: sql<number>`count(*)::int` })
        .from(integrationMessages)
        .groupBy(integrationMessages.status);
      const taken = new Set(live.map((r) => r.provider));
      return {
        health: {
          connected: connections.filter((c) => c.status === 'connected').length,
          needsAttention: connections.filter((c) => c.status === 'needs_attention').length,
          notConnected: Object.keys(CONNECTORS).length - taken.size,
          retrying: counts.find((c) => c.status === 'retrying')?.n ?? 0,
          deadLetter: counts.find((c) => c.status === 'dead_letter')?.n ?? 0,
        },
        connections,
        available: Object.values(CONNECTORS)
          .filter((c) => !taken.has(c.provider))
          .map((c) => ({
            provider: c.provider,
            category: c.category,
            displayName: c.displayName,
            exchanges: c.exchanges,
          })),
        canManage: this.policy.can(actor, 'integration.manage', tenantOf(actor)).allowed,
      };
    });
  }

  detail(actor: RequestActor, connectionId: string): Promise<ConnectionDetail> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'integration.read', tenantOf(actor));
      return this.detailTx(tx, await this.rowOrFail(tx, connectionId));
    });
  }

  async rowOrFail(tx: Tx, connectionId: string): Promise<ConnectionRow> {
    const [row] = await tx
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, connectionId));
    if (!row || row.disconnectedAt) throw ApiProblem.notFound('connection');
    return row;
  }

  async summary(tx: Tx, row: ConnectionRow): Promise<ConnectionSummary> {
    const since = new Date(Date.now() - DAY_MS);
    const [agg] = await tx
      .select({
        records: sql<number>`coalesce(sum(${syncRuns.recordsApplied}), 0)::int`,
        failed: sql<number>`coalesce(sum(${syncRuns.recordsFailed}), 0)::int`,
      })
      .from(syncRuns)
      .where(and(eq(syncRuns.connectionId, row.id), gte(syncRuns.startedAt, since)));
    const pausedBy = row.pausedBy ? await this.personName(tx, row.pausedBy) : null;
    return {
      id: row.id,
      provider: row.provider as IntegrationProvider,
      category: row.category as ConnectionSummary['category'],
      displayName: row.displayName,
      status: row.status as ConnectionSummary['status'],
      mode: row.mode as ConnectionSummary['mode'],
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      recordsLast24h: agg?.records ?? 0,
      errorsLast24h: agg?.failed ?? 0,
      attention: row.attention,
      pausedByName: pausedBy,
    };
  }

  async detailTx(tx: Tx, row: ConnectionRow): Promise<ConnectionDetail> {
    const definition = connectorFor(row.provider as IntegrationProvider);
    const mappings = await tx
      .select()
      .from(integrationMappings)
      .where(eq(integrationMappings.connectionId, row.id))
      .orderBy(integrationMappings.kind, integrationMappings.externalValue);
    const since = new Date(Date.now() - DAY_MS);
    const runs = await tx
      .select({
        direction: syncRuns.direction,
        applied: sql<number>`coalesce(sum(${syncRuns.recordsApplied}), 0)::int`,
      })
      .from(syncRuns)
      .where(and(eq(syncRuns.connectionId, row.id), gte(syncRuns.startedAt, since)))
      .groupBy(syncRuns.direction);
    return {
      summary: await this.summary(tx, row),
      baseUrl: this.baseUrlOf(row),
      accountRef: row.accountRef,
      credential: {
        secretRef: row.secretRef,
        setAt: row.secretSetAt?.toISOString() ?? null,
        setByName: row.secretSetBy ? await this.personName(tx, row.secretSetBy) : null,
      },
      settings: (row.settings ?? {}) as Record<string, unknown>,
      schedules: (row.schedules ?? []) as SyncSchedule[],
      mappings: mappings.map((m) => ({
        id: m.id,
        kind: m.kind as ConnectionDetail['mappings'][number]['kind'],
        externalValue: m.externalValue,
        internalId: m.internalId,
        internalValue: m.internalValue,
        approved: m.approved,
      })),
      objects: definition.objects.map((o) => ({ object: o.object, direction: o.direction })),
      inboundWebhookPath: definition.supportsInboundWebhook
        ? `/api/integrations/webhooks/${row.tenantId}/${row.id}`
        : null,
      recordsIn24h: runs.find((r) => r.direction === 'inbound')?.applied ?? 0,
      recordsOut24h: runs.find((r) => r.direction === 'outbound')?.applied ?? 0,
    };
  }

  // Connector context ----------------------------------------------------------------------------

  /** Mock mode always talks to the local mock provider, whatever base URL is stored. */
  baseUrlOf(row: ConnectionRow): string {
    return row.mode === 'mock' ? integrationsConfig().mockBaseUrl : (row.baseUrl ?? '');
  }

  async contextFor(tx: Tx, row: ConnectionRow): Promise<ConnectorContext> {
    const mappings = new Map<string, string>();
    for (const m of await tx
      .select()
      .from(integrationMappings)
      .where(eq(integrationMappings.connectionId, row.id))) {
      if (!m.approved) continue;
      mappings.set(
        `${m.kind}:${m.externalValue.toLowerCase()}`,
        m.internalValue ?? m.internalId ?? '',
      );
    }
    return {
      connection: row,
      definition: connectorFor(row.provider as IntegrationProvider),
      baseUrl: this.baseUrlOf(row),
      credential: await this.credentialOf(tx, row),
      mappings,
    };
  }

  private async credentialOf(tx: Tx, row: ConnectionRow): Promise<string> {
    if (!row.secretRef) {
      throw new ApiProblem(
        409,
        'INTEGRATION_NOT_CONNECTED',
        `${row.displayName} has no stored credential. Replace it on the Connection tab.`,
      );
    }
    const [secret] = await tx
      .select()
      .from(integrationSecrets)
      .where(eq(integrationSecrets.id, row.secretRef));
    if (!secret) {
      throw new ApiProblem(
        409,
        'INTEGRATION_NOT_CONNECTED',
        `${row.displayName} has no stored credential. Replace it on the Connection tab.`,
      );
    }
    return decryptSecret(secret as unknown as EncryptedSecret);
  }

  // Commands -------------------------------------------------------------------------------------

  connect(
    actor: RequestActor,
    req: ConnectRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<ConnectionDetail>> {
    const { credential, ...audited } = req;
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'integrations.connect',
        // The credential is deliberately left out of the idempotency request hash and the audit entry.
        request: audited,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const definition = connectorFor(req.provider);
        const [existing] = await tx
          .select()
          .from(integrationConnections)
          .where(eq(integrationConnections.provider, req.provider));
        if (existing && !existing.disconnectedAt) {
          throw new ApiProblem(
            409,
            'INTEGRATION_ALREADY_CONNECTED',
            `${definition.displayName} is already connected.`,
            { connectionId: existing.id },
          );
        }
        if (req.mode !== 'mock' && !req.baseUrl) {
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Sandbox and live connections need the base address of the provider.',
          );
        }
        if (req.baseUrl) this.http.assertAllowed(req.baseUrl);
        const secretId = await this.storeSecret(
          tx,
          actor.tenantId,
          `connector:${req.provider}`,
          credential,
        );
        const values = {
          tenantId: actor.tenantId,
          provider: req.provider,
          category: definition.category,
          displayName: req.displayName ?? definition.displayName,
          mode: req.mode,
          status: 'connected' as const,
          attention: null,
          baseUrl: req.baseUrl ?? null,
          accountRef: req.accountRef ?? null,
          clientId: req.clientId ?? null,
          secretRef: secretId,
          secretSetAt: new Date(),
          secretSetBy: actor.personId,
          settings: req.settings ?? {},
          schedules: [],
          cursors: {},
          pausedAt: null,
          pausedBy: null,
          disconnectedAt: null,
          createdBy: actor.personId,
          updatedAt: new Date(),
        };
        const id = existing
          ? (
              await tx
                .update(integrationConnections)
                .set(values)
                .where(eq(integrationConnections.id, existing.id))
                .returning({ id: integrationConnections.id })
            )[0].id
          : (
              await tx
                .insert(integrationConnections)
                .values(values)
                .returning({ id: integrationConnections.id })
            )[0].id;
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.connected',
          resourceType: 'integration_connection',
          resourceId: id,
          requestId: ctx.requestId,
          changes: {
            provider: { from: null, to: req.provider },
            mode: { from: null, to: req.mode },
            credential: { from: null, to: `stored as ${secretId}` },
          },
        });
        return this.detailTx(tx, await this.rowOrFail(tx, id));
      },
    );
  }

  update(
    actor: RequestActor,
    connectionId: string,
    req: UpdateConnectionRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<ConnectionDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `integrations.update:${connectionId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const row = await this.rowOrFail(tx, connectionId);
        const schedules = req.schedules
          ? req.schedules.map((s) => ({
              object: s.object,
              direction: s.direction,
              everyMinutes: s.everyMinutes,
              mode: s.mode ?? 'incremental',
              dedupeKey: 'source_ref',
              paused: s.paused ?? false,
              nextRunAt: new Date(Date.now() + s.everyMinutes * 60_000).toISOString(),
            }))
          : (row.schedules as SyncSchedule[]);
        const paused = req.paused ?? Boolean(row.pausedAt);
        await tx
          .update(integrationConnections)
          .set({
            displayName: req.displayName ?? row.displayName,
            mode: req.mode ?? row.mode,
            settings: req.settings
              ? { ...(row.settings as object), ...req.settings }
              : row.settings,
            schedules,
            pausedAt: paused ? (row.pausedAt ?? new Date()) : null,
            pausedBy: paused ? (row.pausedBy ?? actor.personId) : null,
            status: paused ? 'paused' : row.status === 'paused' ? 'connected' : row.status,
            updatedAt: new Date(),
          })
          .where(eq(integrationConnections.id, connectionId));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.updated',
          resourceType: 'integration_connection',
          resourceId: connectionId,
          requestId: ctx.requestId,
          changes: {
            mode: { from: row.mode, to: req.mode ?? row.mode },
            paused: { from: Boolean(row.pausedAt), to: paused },
            schedules: { from: (row.schedules as unknown[]).length, to: schedules.length },
          },
        });
        return this.detailTx(tx, await this.rowOrFail(tx, connectionId));
      },
    );
  }

  replaceCredential(
    actor: RequestActor,
    connectionId: string,
    credential: string,
    ctx: CommandContext,
  ): Promise<CommandResult<ConnectionDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `integrations.credential:${connectionId}`,
        // The new credential never enters the idempotency hash or the audit entry.
        request: { connectionId },
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const row = await this.rowOrFail(tx, connectionId);
        const secretId = await this.storeSecret(
          tx,
          actor.tenantId,
          `connector:${row.provider}`,
          credential,
        );
        await tx
          .update(integrationConnections)
          .set({
            secretRef: secretId,
            secretSetAt: new Date(),
            secretSetBy: actor.personId,
            status: 'connected',
            attention: null,
            updatedAt: new Date(),
          })
          .where(eq(integrationConnections.id, connectionId));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.credential_replaced',
          resourceType: 'integration_connection',
          resourceId: connectionId,
          requestId: ctx.requestId,
          changes: { credential: { from: row.secretRef, to: secretId } },
        });
        return this.detailTx(tx, await this.rowOrFail(tx, connectionId));
      },
    );
  }

  /** Calls the provider with the stored credential and reports what it said, never the credential. */
  async test(actor: RequestActor, connectionId: string): Promise<TestConnectionResult> {
    const { row, context } = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const r = await this.rowOrFail(tx, connectionId);
        return { row: r, context: await this.contextFor(tx, r) };
      },
    );
    if (!context.definition.testPath) {
      return {
        ok: true,
        statusCode: null,
        durationMs: 0,
        message: `${context.definition.displayName} has no outbound call to test; it only receives.`,
      };
    }
    const res = await this.http.send({
      url: `${context.baseUrl}${context.definition.testPath}`,
      headers: { authorization: `Bearer ${context.credential}` },
      attempts: 1,
    });
    const result: TestConnectionResult = {
      ok: res.ok,
      statusCode: res.statusCode || null,
      durationMs: res.durationMs,
      message: res.ok
        ? `${row.displayName} answered in ${res.durationMs} ms.`
        : providerMessage(res.statusCode || null, res.body),
    };
    await withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      tx
        .update(integrationConnections)
        .set({
          status: res.ok ? 'connected' : 'needs_attention',
          attention: res.ok ? null : result.message,
          updatedAt: new Date(),
        })
        .where(eq(integrationConnections.id, connectionId)),
    );
    return result;
  }

  disconnect(
    actor: RequestActor,
    connectionId: string,
    ctx: CommandContext,
  ): Promise<CommandResult<{ disconnected: boolean }>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `integrations.disconnect:${connectionId}`,
        request: { connectionId },
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const row = await this.rowOrFail(tx, connectionId);
        await tx
          .update(integrationConnections)
          .set({
            disconnectedAt: new Date(),
            status: 'not_connected',
            schedules: [],
            secretRef: null,
            updatedAt: new Date(),
          })
          .where(eq(integrationConnections.id, connectionId));
        if (row.secretRef)
          await tx.delete(integrationSecrets).where(eq(integrationSecrets.id, row.secretRef));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.disconnected',
          resourceType: 'integration_connection',
          resourceId: connectionId,
          requestId: ctx.requestId,
          changes: {
            status: { from: row.status, to: 'not_connected' },
            note: { from: null, to: 'Schedules and pushes stop; imported data stays.' },
          },
        });
        return { disconnected: true };
      },
    );
  }

  putMappings(
    actor: RequestActor,
    connectionId: string,
    req: PutMappingsRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<ConnectionDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `integrations.mappings:${connectionId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const row = await this.rowOrFail(tx, connectionId);
        // Entity and GL account mappings change accounting, so they wait for a Finance Admin.
        const needsFinance = (kind: string) => kind === 'legal_entity' || kind === 'gl_account';
        const canApprove = this.policy.can(actor, 'master_data.manage', tenantOf(actor)).allowed;
        await tx
          .delete(integrationMappings)
          .where(eq(integrationMappings.connectionId, connectionId));
        for (const e of req.entries) {
          await tx.insert(integrationMappings).values({
            tenantId: actor.tenantId,
            connectionId,
            kind: e.kind,
            externalValue: e.externalValue,
            internalId: e.internalId ?? null,
            internalValue: e.internalValue ?? null,
            approved: needsFinance(e.kind) ? canApprove : true,
          });
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.mappings_changed',
          resourceType: 'integration_connection',
          resourceId: connectionId,
          requestId: ctx.requestId,
          changes: {
            entries: { from: null, to: req.entries.length },
            provider: { from: null, to: row.provider },
          },
        });
        return this.detailTx(tx, await this.rowOrFail(tx, connectionId));
      },
    );
  }

  // Helpers --------------------------------------------------------------------------------------

  async storeSecret(tx: Tx, tenantId: string, purpose: string, plaintext: string): Promise<string> {
    const enc = encryptSecret(plaintext);
    const [row] = await tx
      .insert(integrationSecrets)
      .values({ tenantId, purpose, ...enc })
      .returning({ id: integrationSecrets.id });
    return row.id;
  }

  async readSecret(tx: Tx, secretRef: string): Promise<string | null> {
    const [row] = await tx
      .select()
      .from(integrationSecrets)
      .where(eq(integrationSecrets.id, secretRef));
    return row ? decryptSecret(row as unknown as EncryptedSecret) : null;
  }

  async personName(tx: Tx, personId: string): Promise<string | null> {
    const [row] = await tx
      .select({ name: people.displayName })
      .from(people)
      .where(eq(people.id, personId));
    return row?.name ?? null;
  }

  /** Marks a connection as needing attention after a failed run, with the provider's own words. */
  async flagAttention(tx: Tx, connectionId: string, message: string | null): Promise<void> {
    await tx
      .update(integrationConnections)
      .set({
        status: message ? 'needs_attention' : 'connected',
        attention: message,
        updatedAt: new Date(),
      })
      .where(eq(integrationConnections.id, connectionId));
  }

  async lastRuns(tx: Tx, connectionId: string, limit = 20) {
    return tx
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.connectionId, connectionId))
      .orderBy(desc(syncRuns.startedAt))
      .limit(limit);
  }
}
