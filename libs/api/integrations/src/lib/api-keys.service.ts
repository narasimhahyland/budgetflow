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
  apiKeyRateWindows,
  apiKeyRequests,
  apiKeys,
  people,
  tenants,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  ApiKeyCreated,
  ApiKeyList,
  ApiKeyScope,
  ApiKeyUsage,
  ApiKeyView,
  CreateApiKeyRequest,
} from '@bf/contracts';
import type { Action, CurrencyCode } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { DEFAULT_API_KEY_RATE_LIMIT } from './config';
import { newBearerSecret, sha256Hex, tenantFromSecret } from './crypto';
import { tenantOf, type CommandContext } from './connections.service';

/**
 * Each scope maps to the PolicyService actions it allows, always at tenant scope. There is no scope
 * for approving, rejecting, applying controls or moving money, so automation can never take a
 * decision that belongs to a person with delegation-of-authority limits.
 */
export const SCOPE_ACTIONS: Record<ApiKeyScope, Action[]> = {
  'budgets.read': ['budget.read'],
  'ledger.read': ['ledger.read'],
  'reports.read': ['report.read'],
  'events.read': ['event.read'],
  'events.write': ['event.manage', 'event.read'],
  'actuals.write': ['actuals.manage', 'actuals.read'],
  'webhooks.manage': ['integration.manage', 'integration.read'],
};

const EXPIRING_SOON_DAYS = 14;
const DAY_MS = 86_400_000;

export interface ApiKeyIdentity {
  keyId: string;
  prefix: string;
  scopes: ApiKeyScope[];
  rateLimitPerMinute: number;
  rateLimitRemaining: number;
  actor: RequestActor;
}

/** Scoped, expiring API keys and SCIM tokens (101, 098), plus the rate limit that protects them. */
@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  // Administration --------------------------------------------------------------------------------

  list(actor: RequestActor, kind: 'public_api' | 'scim' = 'public_api'): Promise<ApiKeyList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'integration.read', tenantOf(actor));
      const rows = await tx
        .select({ k: apiKeys, owner: people.displayName })
        .from(apiKeys)
        .leftJoin(people, eq(people.id, apiKeys.ownerPersonId))
        .where(eq(apiKeys.kind, kind))
        .orderBy(desc(apiKeys.createdAt));
      return { items: rows.map((r) => this.view(r.k, r.owner)) };
    });
  }

  view(row: typeof apiKeys.$inferSelect, ownerName: string | null): ApiKeyView {
    const now = Date.now();
    const status: ApiKeyView['status'] = row.revokedAt
      ? 'revoked'
      : row.expiresAt.getTime() <= now
        ? 'expired'
        : row.expiresAt.getTime() - now <= EXPIRING_SOON_DAYS * DAY_MS
          ? 'expiring_soon'
          : 'active';
    return {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      scopes: row.scopes as ApiKeyScope[],
      ownerPersonId: row.ownerPersonId,
      ownerName,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      status,
      allowedCidrs: row.allowedCidrs,
      rateLimitPerMinute: row.rateLimitPerMinute,
      rotatedFromId: row.rotatedFromId,
    };
  }

  create(
    actor: RequestActor,
    req: CreateApiKeyRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<ApiKeyCreated>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'integrations.api_keys.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const [owner] = await tx
          .select({ id: people.id, name: people.displayName })
          .from(people)
          .where(eq(people.id, req.ownerPersonId));
        if (!owner) throw ApiProblem.notFound('service owner');
        const { secret, prefix } = newBearerSecret('live', actor.tenantId);
        const [row] = await tx
          .insert(apiKeys)
          .values({
            tenantId: actor.tenantId,
            kind: 'public_api',
            name: req.name,
            prefix,
            keyHash: sha256Hex(secret),
            scopes: req.scopes,
            ownerPersonId: owner.id,
            allowedCidrs: req.allowedCidrs ?? [],
            rateLimitPerMinute: req.rateLimitPerMinute ?? DEFAULT_API_KEY_RATE_LIMIT,
            expiresAt: new Date(Date.now() + req.expiresInDays * DAY_MS),
            createdBy: actor.personId,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.api_key_created',
          resourceType: 'api_key',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            name: { from: null, to: req.name },
            prefix: { from: null, to: prefix },
            scopes: { from: null, to: req.scopes.join(' ') },
            owner: { from: null, to: owner.name },
            expiresAt: { from: null, to: row.expiresAt.toISOString() },
          },
        });
        return { key: this.view(row, owner.name), secret };
      },
    );
  }

  rotate(
    actor: RequestActor,
    keyId: string,
    overlapDays: number,
    ctx: CommandContext,
  ): Promise<CommandResult<ApiKeyCreated>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `integrations.api_keys.rotate:${keyId}`,
        request: { overlapDays },
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const [old] = await tx.select().from(apiKeys).where(eq(apiKeys.id, keyId));
        if (!old) throw ApiProblem.notFound('API key');
        if (old.revokedAt)
          throw new ApiProblem(409, 'API_KEY_REVOKED', 'This key was already revoked.');
        const { secret, prefix } = newBearerSecret('live', actor.tenantId);
        const [row] = await tx
          .insert(apiKeys)
          .values({
            tenantId: actor.tenantId,
            kind: old.kind,
            name: old.name,
            prefix,
            keyHash: sha256Hex(secret),
            scopes: old.scopes,
            ownerPersonId: old.ownerPersonId,
            allowedCidrs: old.allowedCidrs,
            rateLimitPerMinute: old.rateLimitPerMinute,
            expiresAt: old.expiresAt,
            rotatedFromId: old.id,
            createdBy: actor.personId,
          })
          .returning();
        // The old key keeps working for the overlap period so callers can switch without downtime.
        const overlapEnd = new Date(Date.now() + overlapDays * DAY_MS);
        await tx
          .update(apiKeys)
          .set({ expiresAt: overlapEnd < old.expiresAt ? overlapEnd : old.expiresAt })
          .where(eq(apiKeys.id, old.id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.api_key_rotated',
          resourceType: 'api_key',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            rotatedFrom: { from: null, to: old.prefix },
            prefix: { from: null, to: prefix },
            overlapDays: { from: null, to: overlapDays },
          },
        });
        const ownerName = row.ownerPersonId ? await this.personName(tx, row.ownerPersonId) : null;
        return { key: this.view(row, ownerName), secret };
      },
    );
  }

  revoke(
    actor: RequestActor,
    keyId: string,
    confirmName: string,
    ctx: CommandContext,
  ): Promise<CommandResult<ApiKeyView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `integrations.api_keys.revoke:${keyId}`,
        request: { confirmName },
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const [row] = await tx.select().from(apiKeys).where(eq(apiKeys.id, keyId));
        if (!row) throw ApiProblem.notFound('API key');
        if (row.name !== confirmName) {
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Type the key name exactly to confirm the revocation.',
          );
        }
        const [updated] = await tx
          .update(apiKeys)
          .set({ revokedAt: new Date() })
          .where(eq(apiKeys.id, keyId))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.api_key_revoked',
          resourceType: 'api_key',
          resourceId: keyId,
          requestId: ctx.requestId,
          changes: {
            prefix: { from: row.prefix, to: row.prefix },
            revoked: { from: false, to: true },
          },
        });
        const ownerName = row.ownerPersonId ? await this.personName(tx, row.ownerPersonId) : null;
        return this.view(updated, ownerName);
      },
    );
  }

  usage(actor: RequestActor, keyId: string): Promise<ApiKeyUsage> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'integration.read', tenantOf(actor));
      const [key] = await tx.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.id, keyId));
      if (!key) throw ApiProblem.notFound('API key');
      const perDay = await tx
        .select({
          day: sql<string>`to_char(${apiKeyRequests.at}, 'YYYY-MM-DD')`,
          calls: sql<number>`count(*)::int`,
        })
        .from(apiKeyRequests)
        .where(eq(apiKeyRequests.apiKeyId, keyId))
        .groupBy(sql`to_char(${apiKeyRequests.at}, 'YYYY-MM-DD')`)
        .orderBy(sql`to_char(${apiKeyRequests.at}, 'YYYY-MM-DD') desc`)
        .limit(30);
      const recent = await tx
        .select()
        .from(apiKeyRequests)
        .where(eq(apiKeyRequests.apiKeyId, keyId))
        .orderBy(desc(apiKeyRequests.at))
        .limit(50);
      return {
        perDay,
        recent: recent.map((r) => ({
          at: r.at.toISOString(),
          method: r.method,
          path: r.path,
          status: r.status,
        })),
      };
    });
  }

  // Authentication ---------------------------------------------------------------------------------

  /**
   * Resolves a public API key into a service identity. The tenant comes from the key itself, so the
   * database session is scoped before the key is looked up and row level security applies to the
   * lookup too. Expiry, revocation, the caller's address and the rate limit are all checked here.
   */
  async authenticate(
    secret: string,
    clientIp: string | null,
    kind: 'public_api' | 'scim' = 'public_api',
  ): Promise<ApiKeyIdentity> {
    const tenantId = tenantFromSecret(secret);
    if (!tenantId) throw new ApiProblem(401, 'API_KEY_INVALID', 'That API key is not valid.');
    const hash = sha256Hex(secret);
    return withTenant(this.db, { tenantId, subject: `apikey:${hash.slice(0, 8)}` }, async (tx) => {
      const [row] = await tx
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.kind, kind)));
      if (!row) throw new ApiProblem(401, 'API_KEY_INVALID', 'That API key is not valid.');
      if (row.revokedAt)
        throw new ApiProblem(401, 'API_KEY_REVOKED', 'This key was revoked. Issue a new one.');
      if (row.expiresAt.getTime() <= Date.now())
        throw new ApiProblem(401, 'API_KEY_EXPIRED', 'This key has expired. Rotate it.');
      if (row.allowedCidrs.length > 0 && !this.ipAllowed(clientIp, row.allowedCidrs)) {
        throw new ApiProblem(
          403,
          'API_KEY_IP_NOT_ALLOWED',
          'This key is restricted to other addresses.',
        );
      }
      const remaining = await this.consumeRateBudget(tx, row);
      await tx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));

      const [tenant] = await tx
        .select({ name: tenants.name, currency: tenants.reportingCurrency })
        .from(tenants)
        .where(eq(tenants.id, tenantId));
      const scopes = row.scopes as ApiKeyScope[];
      const actions = new Set<Action>(['tenant.read']);
      for (const s of scopes) for (const a of SCOPE_ACTIONS[s] ?? []) actions.add(a);
      const actor: RequestActor = {
        subject: `apikey:${row.prefix}`,
        tenantId,
        personId: row.ownerPersonId,
        roles: [],
        ownedBudgetPaths: [],
        serviceScopes: [...actions],
        displayName: `API key ${row.name}`,
        tenantName: tenant?.name ?? '',
        reportingCurrency: (tenant?.currency ?? 'USD') as CurrencyCode,
        memberships: [],
      };
      return {
        keyId: row.id,
        prefix: row.prefix,
        scopes,
        rateLimitPerMinute: row.rateLimitPerMinute,
        rateLimitRemaining: remaining,
        actor,
      };
    });
  }

  /** The caller must hold the scope; otherwise the request is refused before anything is read. */
  assertScope(identity: ApiKeyIdentity, scope: ApiKeyScope): void {
    if (!identity.scopes.includes(scope)) {
      throw new ApiProblem(
        403,
        'API_KEY_SCOPE_MISSING',
        `This key does not have the ${scope} scope.`,
        { scope },
      );
    }
  }

  /** Fixed one-minute window counted in the database, so the limit holds across API instances. */
  private async consumeRateBudget(tx: Tx, row: typeof apiKeys.$inferSelect): Promise<number> {
    const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const [counter] = await tx
      .insert(apiKeyRateWindows)
      .values({ tenantId: row.tenantId, apiKeyId: row.id, windowStart, calls: 1 })
      .onConflictDoUpdate({
        target: [apiKeyRateWindows.apiKeyId, apiKeyRateWindows.windowStart],
        set: { calls: sql`${apiKeyRateWindows.calls} + 1` },
      })
      .returning({ calls: apiKeyRateWindows.calls });
    const used = counter?.calls ?? 1;
    if (used > row.rateLimitPerMinute) {
      const retryAfter = Math.max(
        1,
        Math.ceil((windowStart.getTime() + 60_000 - Date.now()) / 1000),
      );
      throw new ApiProblem(
        429,
        'RATE_LIMIT_EXCEEDED',
        `This key is limited to ${row.rateLimitPerMinute} requests a minute. Try again in ${retryAfter} second(s).`,
        { retryAfter, limit: row.rateLimitPerMinute },
      );
    }
    return row.rateLimitPerMinute - used;
  }

  private ipAllowed(clientIp: string | null, allowed: string[]): boolean {
    if (!clientIp) return false;
    const ip = clientIp.replace(/^::ffff:/, '');
    return allowed.some((entry) => {
      const [base, bits] = entry.split('/');
      if (!bits) return base === ip;
      const prefix = Number(bits);
      if (prefix === 32) return base === ip;
      const octets = Math.floor(prefix / 8);
      return (
        base.split('.').slice(0, octets).join('.') === ip.split('.').slice(0, octets).join('.')
      );
    });
  }

  /** Every call made with a key is logged with its prefix, never the secret (101). */
  async logRequest(
    identity: ApiKeyIdentity,
    method: string,
    path: string,
    status: number,
  ): Promise<void> {
    await withTenant(
      this.db,
      { tenantId: identity.actor.tenantId, subject: identity.actor.subject },
      (tx) =>
        tx.insert(apiKeyRequests).values({
          tenantId: identity.actor.tenantId,
          apiKeyId: identity.keyId,
          method,
          path: path.slice(0, 300),
          status,
        }),
    );
  }

  /** SCIM tokens are the same storage with a different kind; 098 shows them on the identity page. */
  async issueScimToken(
    tx: Tx,
    actor: RequestActor,
    expiresInDays: number,
  ): Promise<{ row: typeof apiKeys.$inferSelect; secret: string }> {
    const { secret, prefix } = newBearerSecret('scim', actor.tenantId);
    const [row] = await tx
      .insert(apiKeys)
      .values({
        tenantId: actor.tenantId,
        kind: 'scim',
        name: 'SCIM provisioning token',
        prefix,
        keyHash: sha256Hex(secret),
        scopes: [],
        ownerPersonId: actor.personId,
        allowedCidrs: [],
        rateLimitPerMinute: DEFAULT_API_KEY_RATE_LIMIT,
        expiresAt: new Date(Date.now() + expiresInDays * DAY_MS),
        createdBy: actor.personId,
      })
      .returning();
    return { row, secret };
  }

  async activeScimTokens(tx: Tx) {
    return tx
      .select({ k: apiKeys, owner: people.displayName })
      .from(apiKeys)
      .leftJoin(people, eq(people.id, apiKeys.createdBy))
      .where(and(eq(apiKeys.kind, 'scim'), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt));
  }

  async recentCalls(tx: Tx, keyId: string, since: Date) {
    return tx
      .select({ n: sql<number>`count(*)::int` })
      .from(apiKeyRequests)
      .where(and(eq(apiKeyRequests.apiKeyId, keyId), gte(apiKeyRequests.at, since)));
  }

  private async personName(tx: Tx, personId: string): Promise<string | null> {
    const [row] = await tx
      .select({ n: people.displayName })
      .from(people)
      .where(eq(people.id, personId));
    return row?.n ?? null;
  }
}
