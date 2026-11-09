import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type RequestActor,
  todayUtc,
  nowUtc,
} from '@bf/api/core';
import {
  adminChangeRequests,
  memberships,
  orgUnits,
  ownerInvites,
  outboxMessages,
  people,
  roleGrants,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  AdminChangeRequest,
  AdminDecisionRequest,
  AdminUser,
  AdminUserList,
  CreateOwnerInvitesRequest,
  CreateOwnerInvitesResult,
  GrantRoleRequest,
  GrantRoleResult,
  OwnerInvite,
  OwnerInviteList,
  RevokeRoleRequest,
  RevokeRoleResult,
} from '@bf/contracts';
import { assessRoleGrant, canConfirmRoleGrant, PRIVILEGED_ROLES, type RoleId } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gte, ilike, inArray, isNull, lte, or } from 'drizzle-orm';
import { assertTenant, personNames, type CommandContext } from './admin-reads';
import { FeatureFlagsService } from './feature-flags.service';
import { OWNER_INVITED_TOPIC } from './topics';

type ChangeRow = typeof adminChangeRequests.$inferSelect;
type InviteRow = typeof ownerInvites.$inferSelect;

/** Roles an invitation may suggest: never a privileged one, which always goes through a role grant. */
const INVITABLE_ROLES: readonly RoleId[] = [
  'budget-owner',
  'department-head',
  'regional-manager',
  'location-manager',
  'event-organizer',
  'employee',
  'analyst',
];

const INVITE_DAYS = 14;

/**
 * User and role administration (103) and bulk owner invites (103a).
 *
 * The guard that matters: administration cannot create authority. `assessRoleGrant` refuses a
 * self-grant and the platform-operator role outright, and a role that confers money or approval
 * authority the requester does not hold stays pending until someone who holds it confirms. Approval
 * limits are never part of a grant: they come from the delegation-of-authority matrix.
 */
@Injectable()
export class UserAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly flags: FeatureFlagsService,
  ) {}

  private today(): string {
    return todayUtc();
  }

  private activeGrantWhere(today: string) {
    return and(
      lte(roleGrants.validFrom, today),
      or(isNull(roleGrants.validTo), gte(roleGrants.validTo, today)),
    );
  }

  private changeView(row: ChangeRow, names: Map<string, string>): AdminChangeRequest {
    const payload = row.payload as { role: RoleId; targetPersonId: string | null };
    return {
      id: row.id,
      kind: 'role_grant',
      subjectKey: row.subjectKey,
      status: row.status as AdminChangeRequest['status'],
      needsConfirmation: row.needsConfirmation,
      reason: row.reason,
      requestedByName: row.requestedByPersonId
        ? (names.get(row.requestedByPersonId) ?? null)
        : null,
      requestedAt: row.createdAt.toISOString(),
      confirmedByName: row.confirmedByPersonId
        ? (names.get(row.confirmedByPersonId) ?? null)
        : null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionReason: row.decisionReason,
      summary: `Give ${
        payload?.targetPersonId ? (names.get(payload.targetPersonId) ?? 'a person') : 'a person'
      } the ${payload?.role ?? 'unknown'} role`,
    };
  }

  private async usersWith(
    tx: Tx,
    tenantId: string,
    where?: ReturnType<typeof eq>,
  ): Promise<AdminUser[]> {
    const today = this.today();
    const rows = await tx
      .select({
        membershipId: memberships.id,
        personId: memberships.personId,
        status: memberships.status,
        displayName: people.displayName,
        email: people.email,
        jobTitle: people.jobTitle,
        anonymisedAt: people.anonymisedAt,
        locationOrgUnitId: people.locationOrgUnitId,
        idpSubject: memberships.idpSubject,
      })
      .from(memberships)
      .leftJoin(people, eq(people.id, memberships.personId))
      .where(where);
    const grants = await tx
      .select({
        id: roleGrants.id,
        membershipId: roleGrants.membershipId,
        role: roleGrants.role,
        scopeOrgUnitId: roleGrants.scopeOrgUnitId,
        validFrom: roleGrants.validFrom,
        validTo: roleGrants.validTo,
      })
      .from(roleGrants)
      .where(this.activeGrantWhere(today));
    const unitIds = [
      ...new Set(
        [...grants.map((g) => g.scopeOrgUnitId), ...rows.map((r) => r.locationOrgUnitId)].filter(
          (u): u is string => Boolean(u),
        ),
      ),
    ];
    const units = unitIds.length
      ? await tx
          .select({ id: orgUnits.id, name: orgUnits.name })
          .from(orgUnits)
          .where(inArray(orgUnits.id, unitIds))
      : [];
    const unitNames = new Map(units.map((u) => [u.id, u.name]));
    const pending = await tx
      .select()
      .from(adminChangeRequests)
      .where(
        and(eq(adminChangeRequests.kind, 'role_grant'), eq(adminChangeRequests.status, 'pending')),
      );
    const names = await personNames(tx, [
      ...pending.map((p) => p.requestedByPersonId),
      ...pending.map((p) => (p.payload as { targetPersonId?: string }).targetPersonId),
    ]);

    return rows
      .map((row) => {
        const mine = grants.filter((g) => g.membershipId === row.membershipId);
        const roles = [...new Set(mine.map((g) => g.role))].sort() as RoleId[];
        return {
          membershipId: row.membershipId,
          personId: row.personId,
          displayName: row.displayName ?? row.idpSubject,
          email: row.email ?? null,
          jobTitle: row.jobTitle ?? null,
          locationName: row.locationOrgUnitId
            ? (unitNames.get(row.locationOrgUnitId) ?? null)
            : null,
          status: row.status,
          roles,
          grants: mine
            .map((g) => ({
              id: g.id,
              role: g.role as RoleId,
              scopeOrgUnitId: g.scopeOrgUnitId,
              scopeOrgUnitName: g.scopeOrgUnitId ? (unitNames.get(g.scopeOrgUnitId) ?? null) : null,
              validFrom: g.validFrom,
              validTo: g.validTo,
            }))
            .sort((a, b) => a.role.localeCompare(b.role) || a.id.localeCompare(b.id)),
          privileged: roles.some((r) => PRIVILEGED_ROLES.includes(r)),
          anonymised: Boolean(row.anonymisedAt),
          pendingRoleChanges: pending
            .filter((p) => p.subjectKey.startsWith(`${row.membershipId}:`))
            .map((p) => this.changeView(p, names)),
        };
      })
      .sort(
        (a, b) =>
          a.displayName.localeCompare(b.displayName) ||
          a.membershipId.localeCompare(b.membershipId),
      );
  }

  list(actor: RequestActor, query: { search?: string; role?: RoleId }): Promise<AdminUserList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'users.manage', 'user administration');
      const items = await this.usersWith(
        tx,
        actor.tenantId,
        query.search ? ilike(people.displayName, `%${query.search}%`) : undefined,
      );
      return {
        items: query.role ? items.filter((i) => i.roles.includes(query.role as RoleId)) : items,
      };
    });
  }

  get(actor: RequestActor, membershipId: string): Promise<AdminUser> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'users.manage', 'user administration');
      const [item] = await this.usersWith(tx, actor.tenantId, eq(memberships.id, membershipId));
      if (!item) throw ApiProblem.notFound('person');
      return item;
    });
  }

  private async rolesOfPerson(tx: Tx, personId: string | null): Promise<RoleId[]> {
    if (!personId) return [];
    const rows = await tx
      .selectDistinct({ role: roleGrants.role })
      .from(roleGrants)
      .innerJoin(memberships, eq(memberships.id, roleGrants.membershipId))
      .where(and(eq(memberships.personId, personId), this.activeGrantWhere(this.today())));
    return rows.map((r) => r.role as RoleId);
  }

  private async insertGrant(
    tx: Tx,
    tenantId: string,
    membershipId: string,
    role: RoleId,
    scopeOrgUnitId: string | null,
  ) {
    const [grant] = await tx
      .insert(roleGrants)
      .values({
        tenantId,
        membershipId,
        role,
        scopeOrgUnitId,
        validFrom: this.today(),
      })
      .returning();
    return grant;
  }

  grant(actor: RequestActor, membershipId: string, req: GrantRoleRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `admin.users.grant:${membershipId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<GrantRoleResult> => {
        assertTenant(this.policy, actor, 'users.manage', 'user administration');
        const [target] = await tx
          .select()
          .from(memberships)
          .where(eq(memberships.id, membershipId))
          .for('update');
        if (!target) throw ApiProblem.notFound('person');
        if (req.scopeOrgUnitId) {
          const [unit] = await tx
            .select({ id: orgUnits.id })
            .from(orgUnits)
            .where(eq(orgUnits.id, req.scopeOrgUnitId));
          if (!unit) throw ApiProblem.notFound('org unit');
        }
        const targetRoles = await this.rolesOfPerson(tx, target.personId);
        const assessment = assessRoleGrant({
          requesterPersonId: actor.personId,
          requesterRoles: actor.roles,
          targetPersonId: target.personId ?? target.id,
          targetRoles,
          role: req.role,
        });
        if (!assessment.ok) {
          // Refused attempts to widen authority are exactly what an auditor looks for, so they are
          // audited as well as refused.
          await this.audit.append(tx, {
            tenantId: actor.tenantId,
            actorPersonId: actor.personId,
            actorSubject: actor.subject,
            action: 'admin.role_grant.refused',
            resourceType: 'membership',
            resourceId: membershipId,
            requestId: ctx.requestId,
            reason: req.reason,
            changes: { role: req.role, refusedWith: assessment.code },
          });
          throw new ApiProblem(409, assessment.code, assessment.message);
        }

        const needsConfirmation = assessment.plan.needsConfirmation;
        const subjectKey = `${membershipId}:${req.role}`;
        const open = await tx
          .select({ id: adminChangeRequests.id })
          .from(adminChangeRequests)
          .where(
            and(
              eq(adminChangeRequests.kind, 'role_grant'),
              eq(adminChangeRequests.subjectKey, subjectKey),
              eq(adminChangeRequests.status, 'pending'),
            ),
          );
        if (open.length)
          throw new ApiProblem(
            409,
            'CHANGE_NOT_PENDING',
            'A grant of this role to this person is already waiting for confirmation.',
          );

        const [change] = await tx
          .insert(adminChangeRequests)
          .values({
            tenantId: actor.tenantId,
            kind: 'role_grant',
            subjectKey,
            payload: {
              role: req.role,
              scopeOrgUnitId: req.scopeOrgUnitId,
              membershipId,
              targetPersonId: target.personId,
              authorityBeyondRequester: assessment.plan.authorityBeyondRequester,
            },
            reason: req.reason,
            requestedByPersonId: actor.personId,
            requestedBySubject: actor.subject,
            status: needsConfirmation ? 'pending' : 'applied',
            needsConfirmation,
            decidedAt: needsConfirmation ? null : new Date(),
          })
          .returning();

        const grant = needsConfirmation
          ? null
          : await this.insertGrant(tx, actor.tenantId, membershipId, req.role, req.scopeOrgUnitId);
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: needsConfirmation ? 'admin.role_grant.requested' : 'admin.role_grant.granted',
          resourceType: 'membership',
          resourceId: membershipId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            role: req.role,
            scopeOrgUnitId: req.scopeOrgUnitId,
            authorityBeyondRequester: assessment.plan.authorityBeyondRequester,
          },
        });
        const names = await personNames(tx, [actor.personId, target.personId]);
        return {
          membershipId,
          role: req.role,
          applied: !needsConfirmation,
          authorityBeyondRequester: [...assessment.plan.authorityBeyondRequester],
          pendingChange: needsConfirmation ? this.changeView(change, names) : null,
          grant: grant
            ? {
                id: grant.id,
                role: grant.role as RoleId,
                scopeOrgUnitId: grant.scopeOrgUnitId,
                scopeOrgUnitName: null,
                validFrom: grant.validFrom,
                validTo: grant.validTo,
              }
            : null,
        };
      },
    );
  }

  decideGrant(
    actor: RequestActor,
    changeId: string,
    req: AdminDecisionRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `admin.users.grant_decision:${changeId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<GrantRoleResult> => {
        const [change] = await tx
          .select()
          .from(adminChangeRequests)
          .where(
            and(eq(adminChangeRequests.id, changeId), eq(adminChangeRequests.kind, 'role_grant')),
          )
          .for('update');
        if (!change) throw ApiProblem.notFound('role grant request');
        if (change.status !== 'pending')
          throw new ApiProblem(
            409,
            'CHANGE_NOT_PENDING',
            'This role grant has already been decided.',
          );
        const payload = change.payload as {
          role: RoleId;
          scopeOrgUnitId: string | null;
          membershipId: string;
          targetPersonId: string | null;
          authorityBeyondRequester: string[];
        };

        if (req.decision === 'cancel') {
          if (!actor.personId || actor.personId !== change.requestedByPersonId)
            throw ApiProblem.forbidden('Only the person who asked for this grant can withdraw it.');
        } else {
          // Confirming does not need user administration: it needs the authority the grant gives,
          // which is what `canConfirmRoleGrant` checks. An administrator who holds no financial
          // authority therefore cannot hand any out, alone or with a peer who holds none either.
          assertTenant(this.policy, actor, 'tenant.read');
          const allowed = canConfirmRoleGrant({
            confirmerPersonId: actor.personId,
            confirmerRoles: actor.roles,
            requesterPersonId: change.requestedByPersonId,
            targetPersonId: payload.targetPersonId ?? '',
            role: payload.role,
          });
          if (!allowed.ok) {
            await this.audit.append(tx, {
              tenantId: actor.tenantId,
              actorPersonId: actor.personId,
              actorSubject: actor.subject,
              action: 'admin.role_grant.refused',
              resourceType: 'membership',
              resourceId: payload.membershipId,
              requestId: ctx.requestId,
              reason: req.reason,
              changes: { role: payload.role, refusedWith: allowed.code, changeId: change.id },
            });
            throw new ApiProblem(409, allowed.code, allowed.message);
          }
        }

        const status =
          req.decision === 'confirm'
            ? 'applied'
            : req.decision === 'decline'
              ? 'declined'
              : 'cancelled';
        await tx
          .update(adminChangeRequests)
          .set({
            status,
            confirmedByPersonId: req.decision === 'cancel' ? null : actor.personId,
            decidedAt: new Date(),
            decisionReason: req.reason,
          })
          .where(eq(adminChangeRequests.id, change.id));
        const grant =
          req.decision === 'confirm'
            ? await this.insertGrant(
                tx,
                actor.tenantId,
                payload.membershipId,
                payload.role,
                payload.scopeOrgUnitId,
              )
            : null;
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: `admin.role_grant.${status}`,
          resourceType: 'membership',
          resourceId: payload.membershipId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: { role: payload.role, decision: req.decision, changeId: change.id },
        });
        const names = await personNames(tx, [change.requestedByPersonId, actor.personId]);
        const [after] = await tx
          .select()
          .from(adminChangeRequests)
          .where(eq(adminChangeRequests.id, change.id));
        return {
          membershipId: payload.membershipId,
          role: payload.role,
          applied: req.decision === 'confirm',
          authorityBeyondRequester: payload.authorityBeyondRequester ?? [],
          pendingChange: this.changeView(after, names),
          grant: grant
            ? {
                id: grant.id,
                role: grant.role as RoleId,
                scopeOrgUnitId: grant.scopeOrgUnitId,
                scopeOrgUnitName: null,
                validFrom: grant.validFrom,
                validTo: grant.validTo,
              }
            : null,
        };
      },
    );
  }

  revoke(actor: RequestActor, membershipId: string, req: RevokeRoleRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `admin.users.revoke:${membershipId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<RevokeRoleResult> => {
        assertTenant(this.policy, actor, 'users.manage', 'user administration');
        const [target] = await tx
          .select()
          .from(memberships)
          .where(eq(memberships.id, membershipId))
          .for('update');
        if (!target) throw ApiProblem.notFound('person');
        const today = this.today();
        const held = await tx
          .select({ id: roleGrants.id })
          .from(roleGrants)
          .where(
            and(
              eq(roleGrants.membershipId, membershipId),
              eq(roleGrants.role, req.role),
              this.activeGrantWhere(today),
            ),
          );
        if (!held.length)
          throw new ApiProblem(409, 'ROLE_NOT_GRANTED', 'This person does not hold that role.');
        // `valid_to` is inclusive everywhere (`ActorResolver`), so ending it today would leave the
        // role in force until midnight. Taking access away has to be immediate, so the grant ends on
        // the day before and stops counting from this request onwards.
        // From the API's clock, because `ActorResolver` compares `valid_to` with `todayUtc`: a wall-clock
        // yesterday would leave the role in force under a pinned clock once real time passes it.
        const endedOn = new Date(nowUtc().getTime() - 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        await tx
          .update(roleGrants)
          .set({ validTo: endedOn })
          .where(
            inArray(
              roleGrants.id,
              held.map((h) => h.id),
            ),
          );
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'admin.role_grant.revoked',
          resourceType: 'membership',
          resourceId: membershipId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: { role: req.role, validTo: { from: null, to: endedOn } },
        });
        return { membershipId, role: req.role, revoked: true };
      },
    );
  }

  // Owner invites (103a) ---------------------------------------------------------------------------

  private inviteView(row: InviteRow, names: Map<string, string>): OwnerInvite {
    return {
      id: row.id,
      batchId: row.batchId,
      email: row.email,
      displayName: row.displayName,
      proposedRole: row.proposedRole as RoleId,
      orgUnitId: row.orgUnitId,
      status: row.status as OwnerInvite['status'],
      invitedByName: row.invitedByPersonId ? (names.get(row.invitedByPersonId) ?? null) : null,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  listInvites(actor: RequestActor): Promise<OwnerInviteList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'users.manage', 'user administration');
      const rows = await tx
        .select()
        .from(ownerInvites)
        .orderBy(asc(ownerInvites.displayName), asc(ownerInvites.id));
      const names = await personNames(
        tx,
        rows.map((r) => r.invitedByPersonId),
      );
      return { items: rows.map((r) => this.inviteView(r, names)) };
    });
  }

  /**
   * Bulk owner invites. The capability is behind a feature flag **and** the action is authorized:
   * turning the flag on for someone without `users.manage` still refuses the request.
   */
  createInvites(actor: RequestActor, req: CreateOwnerInvitesRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'admin.owner_invites',
        request: req,
        status: 201,
      },
      async (tx): Promise<CreateOwnerInvitesResult> => {
        // Authorization first, so a flag can never be the reason someone gets in.
        assertTenant(this.policy, actor, 'users.manage', 'user administration');
        await this.flags.assertEnabled(tx, 'experience.bulk_owner_invites', actor);
        const notInvitable = req.invites.filter((i) => !INVITABLE_ROLES.includes(i.proposedRole));
        if (notInvitable.length)
          throw new ApiProblem(
            409,
            'INVITE_ROLE_NOT_ALLOWED',
            `An invitation cannot suggest the ${notInvitable[0].proposedRole} role; privileged roles are granted in user administration.`,
          );
        const emails = req.invites.map((i) => i.email.toLowerCase());
        const existing = await tx
          .select({ email: ownerInvites.email })
          .from(ownerInvites)
          .where(inArray(ownerInvites.email, emails));
        const already = new Set(existing.map((e) => e.email));
        const batchId = randomUUID();
        const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
        const fresh = req.invites.filter((i) => !already.has(i.email.toLowerCase()));
        const rows = fresh.length
          ? await tx
              .insert(ownerInvites)
              .values(
                fresh.map((i) => ({
                  tenantId: actor.tenantId,
                  batchId,
                  email: i.email.toLowerCase(),
                  displayName: i.displayName,
                  proposedRole: i.proposedRole,
                  orgUnitId: i.orgUnitId,
                  invitedByPersonId: actor.personId,
                  expiresAt,
                })),
              )
              .returning()
          : [];
        if (rows.length)
          await tx.insert(outboxMessages).values(
            rows.map((r) => ({
              tenantId: actor.tenantId,
              topic: OWNER_INVITED_TOPIC,
              payload: {
                eventId: r.id,
                tenantId: actor.tenantId,
                inviteId: r.id,
                batchId,
                email: r.email,
                displayName: r.displayName,
                proposedRole: r.proposedRole,
                expiresAt: r.expiresAt.toISOString(),
                occurredAt: new Date().toISOString(),
              },
            })),
          );
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'admin.owner_invites.created',
          resourceType: 'owner_invite_batch',
          resourceId: batchId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            created: rows.length,
            skippedExisting: [...already].length,
            roles: [...new Set(fresh.map((i) => i.proposedRole))].sort(),
          },
        });
        const names = await personNames(tx, [actor.personId]);
        return {
          batchId,
          created: rows.length,
          skippedExisting: [...already].sort(),
          items: rows
            .map((r) => this.inviteView(r, names))
            .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id)),
        };
      },
    );
  }
}
