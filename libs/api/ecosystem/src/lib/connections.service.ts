import { AuditService } from '@bf/api/audit';
import {
  ActorResolver,
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import {
  ecosystemCalls,
  ecosystemConnections,
  people,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import {
  newBearerSecret,
  sha256Hex,
  tenantFromSecret,
  type BearerLabel,
} from '@bf/api/integrations';
import type {
  EcosystemConnectionCreated,
  EcosystemConnectionKind,
  EcosystemConnectionList,
  EcosystemConnectionStatus,
  EcosystemConnectionView,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { ECOSYSTEM_LIMITS } from './catalog';
import { tenantOf } from './surfaces.service';

const DAY_MS = 86_400_000;

export interface CommandContext {
  idempotencyKey: string;
  requestId: string | null;
}

export interface NewConnection {
  kind: EcosystemConnectionKind;
  clientKey: string;
  label: string;
  grants: string[];
  consentText: string;
  lifetimeDays: number;
}

/**
 * An authenticated external call. `actor` is the **person** who made the connection, resolved fresh
 * from the identity provider subject on every call, so their current roles, owned budgets and
 * membership decide what the call may read. The connection only ever narrows that, through `grants`.
 */
export interface ConnectionIdentity {
  connectionId: string;
  kind: EcosystemConnectionKind;
  clientKey: string;
  label: string;
  grants: string[];
  actor: RequestActor;
}

const LABEL_FOR: Record<EcosystemConnectionKind, BearerLabel> = {
  bi: 'bi',
  assistant: 'mcp',
  automation: 'auto',
};

const KIND_TITLE: Record<EcosystemConnectionKind, string> = {
  bi: 'BI connection',
  assistant: 'assistant connection',
  automation: 'automation',
};

/**
 * Personal connections for every external surface: one place that issues a token, resolves it back
 * to its person, enforces expiry, revocation and the call rate, and writes the append-only call log.
 *
 * The token names its tenant, so the database session is scoped before the connection row is looked
 * up and row level security applies to that lookup too. A token minted in one tenant therefore finds
 * nothing in another, whatever the caller claims.
 */
@Injectable()
export class EcosystemConnectionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly actors: ActorResolver,
  ) {}

  // Lifecycle ---------------------------------------------------------------------------------------

  create(
    actor: RequestActor,
    input: NewConnection,
    ctx: CommandContext,
  ): Promise<CommandResult<EcosystemConnectionCreated>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `ecosystem.connection.create:${input.kind}`,
        request: { ...input, lifetimeDays: input.lifetimeDays },
        status: 201,
      },
      async (tx) => {
        if (!actor.personId)
          throw ApiProblem.forbidden('Only a signed-in person can connect an outside tool.');
        const { secret, prefix } = newBearerSecret(LABEL_FOR[input.kind], actor.tenantId);
        const [row] = await tx
          .insert(ecosystemConnections)
          .values({
            tenantId: actor.tenantId,
            kind: input.kind,
            personId: actor.personId,
            personSubject: actor.subject,
            clientKey: input.clientKey,
            label: input.label,
            tokenPrefix: prefix,
            tokenHash: sha256Hex(secret),
            grants: input.grants,
            consentText: input.consentText,
            expiresAt: new Date(Date.now() + input.lifetimeDays * DAY_MS),
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ecosystem.connection_created',
          resourceType: 'ecosystem_connection',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            kind: { from: null, to: input.kind },
            client: { from: null, to: input.clientKey },
            label: { from: null, to: input.label },
            grants: { from: null, to: input.grants.join(' ') },
            expiresAt: { from: null, to: row.expiresAt.toISOString() },
          },
        });
        return {
          connection: this.view(row, actor.displayName, 0),
          token: secret,
          notice: `Paste this token into ${input.label}. It is shown once, acts only with your own access, and expires in ${input.lifetimeDays} days.`,
        };
      },
    );
  }

  /**
   * A person always sees their own connections. An Integration Admin (or anyone with
   * `integration.read`) sees everyone's, because revoking someone else's connection is their job.
   */
  list(actor: RequestActor, kind: EcosystemConnectionKind): Promise<EcosystemConnectionList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const seesAll = this.policy.can(actor, 'integration.read', tenantOf(actor)).allowed;
      if (!seesAll && !actor.personId)
        throw ApiProblem.forbidden('Only a signed-in person can list connections.');
      const rows = await tx
        .select({ c: ecosystemConnections, personName: people.displayName })
        .from(ecosystemConnections)
        .leftJoin(people, eq(people.id, ecosystemConnections.personId))
        .where(
          and(
            eq(ecosystemConnections.kind, kind),
            seesAll ? undefined : eq(ecosystemConnections.personId, actor.personId!),
          ),
        )
        .orderBy(asc(ecosystemConnections.label), asc(ecosystemConnections.id));
      const counts = await this.callCounts(
        tx,
        rows.map((r) => r.c.id),
      );
      return {
        items: rows.map((r) => this.view(r.c, r.personName, counts.get(r.c.id) ?? 0)),
        seesAll,
        canRevokeAll: this.policy.can(actor, 'integration.manage', tenantOf(actor)).allowed,
      };
    });
  }

  revoke(
    actor: RequestActor,
    kind: EcosystemConnectionKind,
    connectionId: string,
    reason: string | undefined,
    ctx: CommandContext,
  ): Promise<CommandResult<EcosystemConnectionView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `ecosystem.connection.revoke:${connectionId}`,
        request: { reason: reason ?? null },
        status: 200,
      },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(ecosystemConnections)
          .where(
            and(eq(ecosystemConnections.id, connectionId), eq(ecosystemConnections.kind, kind)),
          );
        if (!row) throw ApiProblem.notFound(KIND_TITLE[kind]);
        const mine = Boolean(actor.personId) && row.personId === actor.personId;
        if (!mine) this.policy.assert(actor, 'integration.manage', tenantOf(actor), 'connections');
        if (row.revokedAt)
          throw new ApiProblem(
            409,
            'ECOSYSTEM_CONNECTION_REVOKED',
            'That connection was already revoked.',
          );
        const [updated] = await tx
          .update(ecosystemConnections)
          .set({
            revokedAt: new Date(),
            revokedBy: actor.personId,
            revokeReason: reason ?? null,
          })
          .where(eq(ecosystemConnections.id, connectionId))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ecosystem.connection_revoked',
          resourceType: 'ecosystem_connection',
          resourceId: connectionId,
          requestId: ctx.requestId,
          reason: reason ?? null,
          changes: {
            revoked: { from: false, to: true },
            client: { from: row.clientKey, to: row.clientKey },
          },
        });
        const personName = updated.personId
          ? ((
              await tx
                .select({ n: people.displayName })
                .from(people)
                .where(eq(people.id, updated.personId))
            )[0]?.n ?? null)
          : null;
        return this.view(updated, personName, 0);
      },
    );
  }

  // Authentication -----------------------------------------------------------------------------------

  /**
   * Resolves a connection token into the person who made it. Order matters: the tenant comes from
   * the token, the session is scoped to it, the row is read under row level security, and only then
   * are expiry, revocation and the rate limit checked. The actor is resolved live, so a person who
   * lost a role or left the company cannot keep reading through a token issued earlier.
   */
  async authenticate(secret: string, kind: EcosystemConnectionKind): Promise<ConnectionIdentity> {
    const tenantId = tenantFromSecret(secret);
    if (!tenantId) throw this.invalid();
    const hash = sha256Hex(secret);
    const row = await withTenant(
      this.db,
      { tenantId, subject: `ecosystem:${hash.slice(0, 8)}` },
      async (tx) => {
        const [found] = await tx
          .select()
          .from(ecosystemConnections)
          .where(
            and(eq(ecosystemConnections.tokenHash, hash), eq(ecosystemConnections.kind, kind)),
          );
        return found;
      },
    );
    if (!row) throw this.invalid();
    if (row.revokedAt) throw new ApiProblem(401, 'ECOSYSTEM_CONNECTION_REVOKED', 'Access revoked.');
    if (row.expiresAt.getTime() <= Date.now())
      throw new ApiProblem(
        401,
        'ECOSYSTEM_CONNECTION_EXPIRED',
        'This connection has expired. Connect again to renew it.',
      );

    // Resolving the actor goes through the ordinary path: an inactive membership raises
    // TENANT_NOT_MEMBER here, which is how an automation stops when its person leaves (092b).
    const actor = await this.actors.resolve(row.personSubject, tenantId, undefined);
    await withTenant(this.db, { tenantId, subject: actor.subject }, (tx) =>
      tx
        .update(ecosystemConnections)
        .set({ lastUsedAt: new Date() })
        .where(eq(ecosystemConnections.id, row.id)),
    );
    return {
      connectionId: row.id,
      kind: row.kind as EcosystemConnectionKind,
      clientKey: row.clientKey,
      label: row.label,
      grants: row.grants,
      actor,
    };
  }

  /** The connection must carry the grant; otherwise the call is refused before anything is read. */
  assertGrant(identity: ConnectionIdentity, grant: string, what: string): void {
    if (!identity.grants.includes(grant))
      throw new ApiProblem(
        403,
        'ECOSYSTEM_GRANT_MISSING',
        `This connection was not given access to ${what}.`,
        { grant },
      );
  }

  // Rate limits and the call log ------------------------------------------------------------------------

  /**
   * A fixed window counted in the database, so a limit holds across API instances. `windowMs` and
   * `limit` come from the surface: the BI feed limits refreshes per day (092a), the others limit
   * calls per minute.
   */
  async consumeRate(
    identity: ConnectionIdentity,
    opts: {
      windowMs: number;
      limit: number;
      code: 'BI_REFRESH_LIMIT_REACHED' | 'RATE_LIMIT_EXCEEDED';
      detail: string;
    },
  ): Promise<number> {
    const since = new Date(Date.now() - opts.windowMs);
    const used = await withTenant(
      this.db,
      { tenantId: identity.actor.tenantId, subject: identity.actor.subject },
      async (tx) => {
        const res = await tx.execute<{ n: string }>(sql`
          select count(*)::text as n from ${ecosystemCalls}
          where ${ecosystemCalls.connectionId} = ${identity.connectionId}
            and ${ecosystemCalls.outcome} = 'ok'
            and ${ecosystemCalls.at} > ${since}`);
        return Number(res.rows[0]?.n ?? 0);
      },
    );
    if (used >= opts.limit) {
      await this.logCall(identity, {
        surface: identity.kind,
        operation: 'rate_limit',
        outcome: 'rate_limited',
        recordsReturned: 0,
      });
      throw new ApiProblem(429, opts.code, opts.detail, { limit: opts.limit });
    }
    return opts.limit - used - 1;
  }

  /** One append-only row per external call, whatever its outcome. */
  async logCall(
    identity: ConnectionIdentity,
    entry: {
      surface: string;
      operation: string;
      outcome: string;
      recordsReturned: number;
    },
  ): Promise<void> {
    await withTenant(
      this.db,
      { tenantId: identity.actor.tenantId, subject: identity.actor.subject },
      (tx) =>
        tx.insert(ecosystemCalls).values({
          tenantId: identity.actor.tenantId,
          connectionId: identity.connectionId,
          surface: entry.surface,
          operation: entry.operation.slice(0, 80),
          outcome: entry.outcome,
          recordsReturned: entry.recordsReturned,
          actorPersonId: identity.actor.personId,
        }),
    );
  }

  // Reads the connector overviews need -------------------------------------------------------------------

  async activeCount(tx: Tx, kind: EcosystemConnectionKind): Promise<number> {
    const res = await tx.execute<{ n: string }>(sql`
      select count(*)::text as n from ${ecosystemConnections}
      where ${ecosystemConnections.kind} = ${kind}
        and ${ecosystemConnections.revokedAt} is null
        and ${ecosystemConnections.expiresAt} > now()`);
    return Number(res.rows[0]?.n ?? 0);
  }

  async callsSince(tx: Tx, surface: string, since: Date): Promise<number> {
    const res = await tx.execute<{ n: string }>(sql`
      select count(*)::text as n from ${ecosystemCalls}
      where ${ecosystemCalls.surface} = ${surface} and ${ecosystemCalls.at} > ${since}`);
    return Number(res.rows[0]?.n ?? 0);
  }

  private async callCounts(tx: Tx, ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const since = new Date(Date.now() - 7 * DAY_MS);
    const rows = await tx
      .select({
        connectionId: ecosystemCalls.connectionId,
        n: sql<number>`count(*)::int`,
      })
      .from(ecosystemCalls)
      .where(and(inArray(ecosystemCalls.connectionId, [...ids]), gt(ecosystemCalls.at, since)))
      .groupBy(ecosystemCalls.connectionId);
    return new Map(rows.map((r) => [r.connectionId!, r.n]));
  }

  /** Connections of this kind that are still usable, newest first; the seed and reports use it. */
  async activeRows(tx: Tx, kind: EcosystemConnectionKind) {
    return tx
      .select()
      .from(ecosystemConnections)
      .where(and(eq(ecosystemConnections.kind, kind), isNull(ecosystemConnections.revokedAt)))
      .orderBy(desc(ecosystemConnections.createdAt));
  }

  view(
    row: typeof ecosystemConnections.$inferSelect,
    personName: string | null,
    callsLast7Days: number,
  ): EcosystemConnectionView {
    const now = Date.now();
    const status: EcosystemConnectionStatus = row.revokedAt
      ? 'revoked'
      : row.expiresAt.getTime() <= now
        ? 'expired'
        : row.expiresAt.getTime() - now <= ECOSYSTEM_LIMITS.expiringSoonDays * DAY_MS
          ? 'expiring_soon'
          : 'active';
    return {
      id: row.id,
      kind: row.kind as EcosystemConnectionKind,
      clientKey: row.clientKey,
      clientLabel: row.clientKey,
      label: row.label,
      personId: row.personId,
      personName,
      grants: row.grants,
      status,
      createdAt: iso(row.createdAt),
      lastUsedAt: row.lastUsedAt ? iso(row.lastUsedAt) : null,
      expiresAt: iso(row.expiresAt),
      revokedAt: row.revokedAt ? iso(row.revokedAt) : null,
      callsLast7Days,
    };
  }

  private invalid(): ApiProblem {
    // The same answer for a malformed token, an unknown token and a token from another tenant: a
    // caller never learns whether a connection exists somewhere else.
    return new ApiProblem(
      401,
      'ECOSYSTEM_CONNECTION_INVALID',
      'That connection token is not valid.',
    );
  }
}

const iso = (d: Date): string => d.toISOString().replace(/\.\d+Z$/, 'Z');
