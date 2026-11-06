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
  apiKeys,
  approvalTasks,
  budgets,
  memberships,
  people,
  roleGrants,
  scimOperations,
  tenantSettings,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  IdentityOverview,
  ScimTokenCreated,
  ScimUserRequest,
  ScimUserResponse,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ApiKeysService } from './api-keys.service';
import { tenantOf, type CommandContext } from './connections.service';

const SCIM_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const todayUtc = () => new Date().toISOString().slice(0, 10);

/**
 * SCIM 2.0 provisioning (098). The identity provider creates, updates and deactivates people; it
 * never deletes anything. Deactivation ends the membership and its role grants the same day, so a
 * leaver loses access immediately, while open approvals and owned budgets are reported rather than
 * moved silently.
 */
@Injectable()
export class ScimService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly keys: ApiKeysService,
  ) {}

  overview(actor: RequestActor): Promise<IdentityOverview> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'integration.read', tenantOf(actor));
      const tokens = await this.keys.activeScimTokens(tx);
      const log = await tx
        .select({ op: scimOperations, person: people.displayName })
        .from(scimOperations)
        .leftJoin(people, eq(people.id, scimOperations.personId))
        .orderBy(desc(scimOperations.at))
        .limit(50);
      const [settings] = await tx.select().from(tenantSettings).limit(1);
      const hold = Boolean(
        ((settings?.settings ?? {}) as { holdOwnerDeactivations?: boolean }).holdOwnerDeactivations,
      );
      return {
        ssoStatus: 'connected',
        ssoDescription:
          'People sign in through the company identity provider (OpenID Connect); multi-factor authentication is optional per person.',
        scimEndpoint: '/scim/v2/Users',
        tokens: tokens.map((t) => ({
          id: t.k.id,
          prefix: t.k.prefix,
          createdAt: t.k.createdAt.toISOString(),
          createdByName: t.owner,
          lastUsedAt: t.k.lastUsedAt?.toISOString() ?? null,
          expiresAt: t.k.expiresAt.toISOString(),
          revokedAt: t.k.revokedAt?.toISOString() ?? null,
        })),
        holdOwnerDeactivations: hold,
        log: log.map((l) => ({
          id: l.op.id,
          at: l.op.at.toISOString(),
          operation: l.op.operation as IdentityOverview['log'][number]['operation'],
          personName: l.person,
          externalId: l.op.externalId,
          result: l.op.result as 'applied' | 'rejected',
          detail: l.op.detail,
        })),
      };
    });
  }

  createToken(
    actor: RequestActor,
    expiresInDays: number,
    ctx: CommandContext,
  ): Promise<CommandResult<ScimTokenCreated>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'integrations.scim.token.create',
        request: { expiresInDays },
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const { row, secret } = await this.keys.issueScimToken(tx, actor, expiresInDays);
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.scim_token_created',
          resourceType: 'api_key',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            prefix: { from: null, to: row.prefix },
            expiresAt: { from: null, to: row.expiresAt.toISOString() },
          },
        });
        return {
          token: {
            id: row.id,
            prefix: row.prefix,
            createdAt: row.createdAt.toISOString(),
            createdByName: actor.displayName,
            lastUsedAt: null,
            expiresAt: row.expiresAt.toISOString(),
            revokedAt: null,
          },
          secret,
        };
      },
    );
  }

  revokeToken(
    actor: RequestActor,
    tokenId: string,
    ctx: CommandContext,
  ): Promise<CommandResult<{ revoked: boolean }>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `integrations.scim.token.revoke:${tokenId}`,
        request: { tokenId },
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'integration.manage', tenantOf(actor));
        const [row] = await tx
          .select()
          .from(apiKeys)
          .where(and(eq(apiKeys.id, tokenId), eq(apiKeys.kind, 'scim')));
        if (!row) throw ApiProblem.notFound('token');
        await tx.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, tokenId));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integration.scim_token_revoked',
          resourceType: 'api_key',
          resourceId: tokenId,
          requestId: ctx.requestId,
          changes: {
            prefix: { from: row.prefix, to: row.prefix },
            revoked: { from: false, to: true },
          },
        });
        return { revoked: true };
      },
    );
  }

  /** The SCIM endpoint itself: bearer token, then create, update or deactivate one person. */
  async provision(
    bearer: string | undefined,
    req: ScimUserRequest,
    clientIp: string | null,
    requestId: string | null,
  ): Promise<ScimUserResponse> {
    if (!bearer?.startsWith('Bearer ')) {
      throw new ApiProblem(401, 'API_KEY_INVALID', 'Send the SCIM bearer token.');
    }
    const identity = await this.keys.authenticate(bearer.slice(7).trim(), clientIp, 'scim');
    const actor: RequestActor = {
      ...identity.actor,
      // SCIM acts with user-management authority and nothing else.
      serviceScopes: ['tenant.read', 'users.manage', 'org.read'],
    };
    const result = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        this.policy.assert(actor, 'users.manage', tenantOf(actor));
        const existing = await this.match(tx, req);
        return req.active
          ? this.upsert(tx, actor, req, existing, requestId)
          : this.deactivate(tx, actor, req, existing, requestId);
      },
    );
    await this.keys.logRequest(identity, 'POST', '/scim/v2/Users', 200);
    return result;
  }

  /** Matching follows 098: the work email identifies the person. */
  private async match(tx: Tx, req: ScimUserRequest) {
    const [row] = await tx
      .select()
      .from(people)
      .where(sql`lower(${people.email}) = ${req.userName.toLowerCase()}`)
      .limit(1);
    return row ?? null;
  }

  private async upsert(
    tx: Tx,
    actor: RequestActor,
    req: ScimUserRequest,
    existing: typeof people.$inferSelect | null,
    requestId: string | null,
  ): Promise<ScimUserResponse> {
    const operation = existing ? 'update' : 'create';
    const [row] = existing
      ? await tx
          .update(people)
          .set({ displayName: req.displayName ?? existing.displayName, endDate: null })
          .where(eq(people.id, existing.id))
          .returning()
      : await tx
          .insert(people)
          .values({
            tenantId: actor.tenantId,
            displayName: req.displayName ?? req.userName,
            email: req.userName,
            startDate: todayUtc(),
          })
          .returning();
    await this.record(tx, actor, {
      operation,
      externalId: req.externalId,
      personId: row.id,
      result: 'applied',
      detail: existing
        ? `Updated ${row.displayName}.`
        : `Created ${row.displayName}; roles follow the group mapping.`,
      requestId,
    });
    return this.response(row, {
      openApprovals: 0,
      endedRoleGrants: 0,
      budgetsFlaggedForNewOwner: 0,
      held: false,
    });
  }

  private async deactivate(
    tx: Tx,
    actor: RequestActor,
    req: ScimUserRequest,
    existing: typeof people.$inferSelect | null,
    requestId: string | null,
  ): Promise<ScimUserResponse> {
    if (!existing) throw ApiProblem.notFound('person');
    const owned = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(budgets)
      .where(eq(budgets.ownerPersonId, existing.id));
    const budgetsOwned = owned[0]?.n ?? 0;
    const [settings] = await tx.select().from(tenantSettings).limit(1);
    const hold =
      Boolean(
        ((settings?.settings ?? {}) as { holdOwnerDeactivations?: boolean }).holdOwnerDeactivations,
      ) && budgetsOwned > 0;

    const open = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(approvalTasks)
      .where(
        and(eq(approvalTasks.assigneePersonId, existing.id), eq(approvalTasks.status, 'pending')),
      );
    const openApprovals = open[0]?.n ?? 0;

    if (hold) {
      await this.record(tx, actor, {
        operation: 'deactivate',
        externalId: req.externalId,
        personId: existing.id,
        result: 'rejected',
        detail: `Deactivation of ${existing.displayName} waits for review: they own ${budgetsOwned} budget(s).`,
        requestId,
      });
      return this.response(existing, {
        openApprovals,
        endedRoleGrants: 0,
        budgetsFlaggedForNewOwner: budgetsOwned,
        held: true,
      });
    }

    const mine = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.personId, existing.id));
    const ids = mine.map((m) => m.id);
    let endedRoleGrants = 0;
    if (ids.length) {
      const ended = await tx
        .update(roleGrants)
        .set({ validTo: todayUtc() })
        .where(and(inArray(roleGrants.membershipId, ids), isNull(roleGrants.validTo)))
        .returning({ id: roleGrants.id });
      endedRoleGrants = ended.length;
      await tx.update(memberships).set({ status: 'inactive' }).where(inArray(memberships.id, ids));
    }
    await tx.update(people).set({ endDate: todayUtc() }).where(eq(people.id, existing.id));
    await this.record(tx, actor, {
      operation: 'deactivate',
      externalId: req.externalId,
      personId: existing.id,
      result: 'applied',
      detail: `Deactivated ${existing.displayName}: ${endedRoleGrants} role grant(s) ended, ${openApprovals} open approval(s) escalate on the next sweep, ${budgetsOwned} budget(s) flagged for a new owner.`,
      requestId,
    });
    return this.response(
      { ...existing, endDate: todayUtc() },
      { openApprovals, endedRoleGrants, budgetsFlaggedForNewOwner: budgetsOwned, held: false },
    );
  }

  private response(
    row: typeof people.$inferSelect,
    budgetflow: ScimUserResponse['budgetflow'],
  ): ScimUserResponse {
    return {
      schemas: [SCIM_SCHEMA],
      id: row.id,
      externalId: row.email,
      userName: row.email,
      displayName: row.displayName,
      active: !row.endDate,
      meta: { resourceType: 'User', lastModified: new Date().toISOString() },
      budgetflow,
    };
  }

  /** One provisioning log row and one audit entry per operation; tokens never appear in either. */
  private async record(
    tx: Tx,
    actor: RequestActor,
    input: {
      operation: 'create' | 'update' | 'deactivate' | 'group_change';
      externalId: string;
      personId: string | null;
      result: 'applied' | 'rejected';
      detail: string;
      requestId: string | null;
    },
  ): Promise<void> {
    await tx.insert(scimOperations).values({
      tenantId: actor.tenantId,
      operation: input.operation,
      externalId: input.externalId,
      personId: input.personId,
      result: input.result,
      detail: input.detail,
    });
    await this.audit.append(tx, {
      tenantId: actor.tenantId,
      actorPersonId: null,
      actorSubject: actor.subject,
      action: `identity.scim_${input.operation}`,
      resourceType: 'person',
      resourceId: input.personId ?? input.externalId,
      requestId: input.requestId,
      changes: {
        externalId: { from: null, to: input.externalId },
        result: { from: null, to: input.result },
        detail: { from: null, to: input.detail },
      },
    });
  }
}
