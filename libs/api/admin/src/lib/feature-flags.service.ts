import { AuditService } from '@bf/api/audit';
import { ApiProblem, CommandRunner, DB, PolicyService, type RequestActor } from '@bf/api/core';
import {
  adminChangeRequests,
  chatInstallations,
  featureFlags,
  integrationConnections,
  orgUnits,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  AdminChangeRequest,
  AdminDecisionRequest,
  EffectiveFeatureList,
  FeatureFlag,
  FeatureFlagHistory,
  FeatureFlagList,
  SwitchFeatureFlagRequest,
  SwitchFeatureFlagResult,
} from '@bf/contracts';
import {
  FLAG_CATALOG,
  flagAppliesTo,
  flagByKey,
  planFlagSwitch,
  type Action,
  type FlagAudience,
  type FlagDefinition,
  type FlagRollout,
  type RoleId,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { assertAnyTenant, assertTenant, personNames, type CommandContext } from './admin-reads';

type FlagRow = typeof featureFlags.$inferSelect;
type ChangeRow = typeof adminChangeRequests.$inferSelect;

interface SwitchPayload {
  enabled: boolean;
  rolloutMode: 'everyone' | 'pilot';
  pilotOrgUnitIds: string[];
  pilotRoleIds: string[];
}

/** Which connected system a flag needs before it can be switched on. */
const DEPENDENCIES: Record<string, { chatProvider?: string; connectorCategory?: string }> = {
  'channels.slack_app': { chatProvider: 'slack' },
  'channels.teams_app': { chatProvider: 'teams' },
  'integrations.card_limit_push': { connectorCategory: 'cards' },
};

/**
 * Feature flags (105). A flag reveals or hides a capability; it is never an authorization answer.
 * `isEnabled` is what other code asks, and every caller must still assert the action through
 * `PolicyService`, so turning a flag on can never give anyone an action the policy refuses.
 */
@Injectable()
export class FeatureFlagsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  /** Who may ask for a flag change: Organization Admin for product flags, Finance Admin for finance ones. */
  private assertMayRequest(actor: RequestActor): void {
    assertAnyTenant(this.policy, actor, ['tenant.settings.manage', 'master_data.manage']);
  }

  private rolloutOf(row: FlagRow | undefined, definition: FlagDefinition): FlagRollout {
    return {
      enabled: row?.enabled ?? definition.defaultEnabled,
      mode: (row?.rolloutMode as 'everyone' | 'pilot') ?? 'everyone',
      orgUnitIds: row?.pilotOrgUnitIds ?? [],
      roleIds: row?.pilotRoleIds ?? [],
    };
  }

  private async dependenciesMet(tx: Tx): Promise<Map<string, boolean>> {
    const chat = await tx
      .select({ provider: chatInstallations.provider, status: chatInstallations.status })
      .from(chatInstallations);
    const connectors = await tx
      .select({ category: integrationConnections.category, status: integrationConnections.status })
      .from(integrationConnections);
    const met = new Map<string, boolean>();
    for (const flag of FLAG_CATALOG) {
      const need = DEPENDENCIES[flag.key];
      if (!need) {
        met.set(flag.key, true);
        continue;
      }
      if (need.chatProvider) {
        met.set(
          flag.key,
          chat.some((c) => c.provider === need.chatProvider && c.status === 'connected'),
        );
        continue;
      }
      met.set(
        flag.key,
        connectors.some((c) => c.category === need.connectorCategory && c.status === 'connected'),
      );
    }
    return met;
  }

  private changeView(
    row: ChangeRow,
    names: Map<string, string>,
    summary: string,
  ): AdminChangeRequest {
    return {
      id: row.id,
      kind: row.kind as AdminChangeRequest['kind'],
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
      summary,
    };
  }

  private summarize(row: ChangeRow): string {
    const payload = row.payload as SwitchPayload;
    const definition = flagByKey(row.subjectKey);
    const name = definition?.name ?? row.subjectKey;
    if (!payload || typeof payload.enabled !== 'boolean') return `Change to ${name}`;
    if (!payload.enabled) return `Turn ${name} off`;
    return payload.rolloutMode === 'pilot'
      ? `Pilot ${name} with ${payload.pilotOrgUnitIds.length} location(s) and ${payload.pilotRoleIds.length} role(s)`
      : `Turn ${name} on for everyone`;
  }

  list(actor: RequestActor): Promise<FeatureFlagList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const rows = await tx.select().from(featureFlags);
      const byKey = new Map(rows.map((r) => [r.key, r]));
      const pending = await tx
        .select()
        .from(adminChangeRequests)
        .where(
          and(
            eq(adminChangeRequests.kind, 'feature_flag'),
            eq(adminChangeRequests.status, 'pending'),
          ),
        );
      const applied = await tx
        .select()
        .from(adminChangeRequests)
        .where(
          and(
            eq(adminChangeRequests.kind, 'feature_flag'),
            eq(adminChangeRequests.status, 'applied'),
          ),
        )
        .orderBy(desc(adminChangeRequests.decidedAt));
      const names = await personNames(tx, [
        ...pending.map((p) => p.requestedByPersonId),
        ...pending.map((p) => p.confirmedByPersonId),
        ...applied.map((p) => p.requestedByPersonId),
      ]);
      const unitIds = [...new Set(rows.flatMap((r) => r.pilotOrgUnitIds))];
      const units = unitIds.length
        ? await tx
            .select({ id: orgUnits.id, name: orgUnits.name })
            .from(orgUnits)
            .where(inArray(orgUnits.id, unitIds))
        : [];
      const unitNames = new Map(units.map((u) => [u.id, u.name]));
      const met = await this.dependenciesMet(tx);
      const lastApplied = new Map<string, ChangeRow>();
      for (const row of applied)
        if (!lastApplied.has(row.subjectKey)) lastApplied.set(row.subjectKey, row);

      const items: FeatureFlag[] = FLAG_CATALOG.map((definition) => {
        const row = byKey.get(definition.key);
        const rollout = this.rolloutOf(row, definition);
        const waiting = pending.find((p) => p.subjectKey === definition.key);
        const last = lastApplied.get(definition.key);
        return {
          key: definition.key,
          area: definition.area,
          name: definition.name,
          description: definition.description,
          enabled: rollout.enabled,
          rolloutMode: rollout.mode,
          pilotOrgUnitIds: [...rollout.orgUnitIds],
          pilotOrgUnitNames: rollout.orgUnitIds.map((u) => unitNames.get(u) ?? u),
          pilotRoleIds: [...rollout.roleIds] as RoleId[],
          moneyAffecting: definition.moneyAffecting,
          gatedAction: definition.gatedAction,
          dependsOn: definition.dependsOn,
          dependencyMet: met.get(definition.key) ?? true,
          changedByName: last?.requestedByPersonId
            ? (names.get(last.requestedByPersonId) ?? null)
            : null,
          changedAt: last?.decidedAt?.toISOString() ?? row?.updatedAt.toISOString() ?? null,
          pendingChange: waiting ? this.changeView(waiting, names, this.summarize(waiting)) : null,
        };
      }).sort(
        (a, b) =>
          a.area.localeCompare(b.area) ||
          a.name.localeCompare(b.name) ||
          a.key.localeCompare(b.key),
      );
      return { items };
    });
  }

  history(actor: RequestActor, query: { key?: string }): Promise<FeatureFlagHistory> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const where = query.key
        ? and(
            eq(adminChangeRequests.kind, 'feature_flag'),
            eq(adminChangeRequests.subjectKey, query.key),
          )
        : eq(adminChangeRequests.kind, 'feature_flag');
      const rows = await tx
        .select()
        .from(adminChangeRequests)
        .where(where)
        .orderBy(desc(adminChangeRequests.createdAt), asc(adminChangeRequests.id));
      const names = await personNames(tx, [
        ...rows.map((r) => r.requestedByPersonId),
        ...rows.map((r) => r.confirmedByPersonId),
      ]);
      return { items: rows.map((r) => this.changeView(r, names, this.summarize(r))) };
    });
  }

  /**
   * Applies a rollout to the flag row. Nothing here touches authorization: the state only decides
   * whether the capability is shown.
   */
  private async persist(
    tx: Tx,
    tenantId: string,
    actorPersonId: string | null,
    key: string,
    payload: SwitchPayload,
  ): Promise<void> {
    await tx
      .insert(featureFlags)
      .values({
        tenantId,
        key,
        enabled: payload.enabled,
        rolloutMode: payload.rolloutMode,
        pilotOrgUnitIds: payload.pilotOrgUnitIds,
        pilotRoleIds: payload.pilotRoleIds,
        updatedByPersonId: actorPersonId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [featureFlags.tenantId, featureFlags.key],
        set: {
          enabled: payload.enabled,
          rolloutMode: payload.rolloutMode,
          pilotOrgUnitIds: payload.pilotOrgUnitIds,
          pilotRoleIds: payload.pilotRoleIds,
          updatedByPersonId: actorPersonId,
          updatedAt: new Date(),
        },
      });
  }

  switch(actor: RequestActor, key: string, req: SwitchFeatureFlagRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `admin.features.switch:${key}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<SwitchFeatureFlagResult> => {
        this.assertMayRequest(actor);
        const definition = flagByKey(key);
        if (!definition) throw ApiProblem.notFound('feature flag');
        const [row] = await tx.select().from(featureFlags).where(eq(featureFlags.key, key));
        const met = await this.dependenciesMet(tx);
        const existing = await tx
          .select({ id: adminChangeRequests.id })
          .from(adminChangeRequests)
          .where(
            and(
              eq(adminChangeRequests.kind, 'feature_flag'),
              eq(adminChangeRequests.subjectKey, key),
              eq(adminChangeRequests.status, 'pending'),
            ),
          );
        const payload: SwitchPayload = {
          enabled: req.enabled,
          rolloutMode: req.rolloutMode,
          pilotOrgUnitIds: [...req.pilotOrgUnitIds],
          pilotRoleIds: [...req.pilotRoleIds],
        };
        const planned = planFlagSwitch({
          key,
          rollout: {
            enabled: payload.enabled,
            mode: payload.rolloutMode,
            orgUnitIds: payload.pilotOrgUnitIds,
            roleIds: payload.pilotRoleIds,
          },
          dependencyMet: met.get(key) ?? true,
          hasPendingChange: existing.length > 0,
        });
        if (!planned.ok) {
          const status = planned.code === 'FLAG_ROLLOUT_INVALID' ? 422 : 409;
          throw new ApiProblem(status, planned.code, planned.message);
        }
        if (payload.pilotOrgUnitIds.length) {
          const units = await tx
            .select({ id: orgUnits.id })
            .from(orgUnits)
            .where(inArray(orgUnits.id, payload.pilotOrgUnitIds));
          if (units.length !== payload.pilotOrgUnitIds.length)
            throw ApiProblem.notFound('pilot location');
        }

        const [change] = await tx
          .insert(adminChangeRequests)
          .values({
            tenantId: actor.tenantId,
            kind: 'feature_flag',
            subjectKey: key,
            payload,
            reason: req.reason,
            requestedByPersonId: actor.personId,
            requestedBySubject: actor.subject,
            status: planned.plan.needsConfirmation ? 'pending' : 'applied',
            needsConfirmation: planned.plan.needsConfirmation,
            decidedAt: planned.plan.needsConfirmation ? null : new Date(),
          })
          .returning();

        const before = this.rolloutOf(row, definition);
        if (!planned.plan.needsConfirmation) {
          await this.persist(tx, actor.tenantId, actor.personId, key, payload);
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: planned.plan.needsConfirmation
            ? 'admin.feature_flag.change_requested'
            : 'admin.feature_flag.changed',
          resourceType: 'feature_flag',
          resourceId: key,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            enabled: { from: before.enabled, to: payload.enabled },
            rolloutMode: { from: before.mode, to: payload.rolloutMode },
            pilotOrgUnitIds: { from: [...before.orgUnitIds], to: payload.pilotOrgUnitIds },
            pilotRoleIds: { from: [...before.roleIds], to: payload.pilotRoleIds },
            moneyAffecting: definition.moneyAffecting,
          },
        });
        const names = await personNames(tx, [change.requestedByPersonId]);
        const applied = !planned.plan.needsConfirmation;
        return {
          key,
          applied,
          enabled: applied ? payload.enabled : before.enabled,
          rolloutMode: applied ? payload.rolloutMode : before.mode,
          pendingChange: applied ? null : this.changeView(change, names, this.summarize(change)),
        };
      },
    );
  }

  decide(actor: RequestActor, changeId: string, req: AdminDecisionRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `admin.features.decision:${changeId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<SwitchFeatureFlagResult> => {
        const [change] = await tx
          .select()
          .from(adminChangeRequests)
          .where(
            and(eq(adminChangeRequests.id, changeId), eq(adminChangeRequests.kind, 'feature_flag')),
          )
          .for('update');
        if (!change) throw ApiProblem.notFound('flag change');
        if (change.status !== 'pending')
          throw new ApiProblem(
            409,
            'CHANGE_NOT_PENDING',
            'This flag change has already been decided.',
          );
        const definition = flagByKey(change.subjectKey);
        if (!definition) throw ApiProblem.notFound('feature flag');

        if (req.decision === 'cancel') {
          // Only the requester withdraws their own request.
          if (!actor.personId || actor.personId !== change.requestedByPersonId)
            throw ApiProblem.forbidden(
              'Only the person who asked for this change can withdraw it.',
            );
        } else {
          // A money-affecting flag needs a Finance Controller who is not the requester.
          assertTenant(this.policy, actor, 'flags.confirm_finance', 'flag confirmation');
          if (actor.personId && actor.personId === change.requestedByPersonId)
            throw new ApiProblem(
              409,
              'SAME_PERSON_APPROVAL',
              'The person who asked for this change cannot confirm it.',
            );
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

        const payload = change.payload as SwitchPayload;
        const [row] = await tx
          .select()
          .from(featureFlags)
          .where(eq(featureFlags.key, change.subjectKey));
        const before = this.rolloutOf(row, definition);
        if (req.decision === 'confirm') {
          await this.persist(tx, actor.tenantId, actor.personId, change.subjectKey, payload);
        }
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: `admin.feature_flag.${status}`,
          resourceType: 'feature_flag',
          resourceId: change.subjectKey,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            changeId: change.id,
            decision: req.decision,
            enabled: {
              from: before.enabled,
              to: req.decision === 'confirm' ? payload.enabled : before.enabled,
            },
          },
        });
        const names = await personNames(tx, [change.requestedByPersonId, actor.personId]);
        const [after] = await tx
          .select()
          .from(adminChangeRequests)
          .where(eq(adminChangeRequests.id, change.id));
        return {
          key: change.subjectKey,
          applied: req.decision === 'confirm',
          enabled: req.decision === 'confirm' ? payload.enabled : before.enabled,
          rolloutMode: req.decision === 'confirm' ? payload.rolloutMode : before.mode,
          pendingChange: this.changeView(after, names, this.summarize(after)),
        };
      },
    );
  }

  private audienceOf(actor: RequestActor): FlagAudience {
    return {
      roles: actor.roles,
      orgUnitIds: [...(actor.orgScopeUnitIds ?? []), ...(actor.homeOrgUnitIds ?? [])],
    };
  }

  /**
   * Whether the capability is revealed to this actor. Callers must still assert the action: a flag
   * never decides what someone is allowed to do.
   */
  async isEnabled(tx: Tx, key: string, actor: RequestActor): Promise<boolean> {
    const definition = flagByKey(key);
    if (!definition) return false;
    const [row] = await tx.select().from(featureFlags).where(eq(featureFlags.key, key));
    return flagAppliesTo(this.rolloutOf(row, definition), this.audienceOf(actor));
  }

  /** Refuses with `FEATURE_DISABLED` when the capability is hidden. Authorization is checked separately. */
  async assertEnabled(tx: Tx, key: string, actor: RequestActor): Promise<void> {
    if (await this.isEnabled(tx, key, actor)) return;
    const definition = flagByKey(key);
    throw new ApiProblem(
      409,
      'FEATURE_DISABLED',
      `${definition?.name ?? key} is switched off for you.`,
    );
  }

  effective(actor: RequestActor): Promise<EffectiveFeatureList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const rows = await tx.select().from(featureFlags);
      const byKey = new Map(rows.map((r) => [r.key, r]));
      const audience = this.audienceOf(actor);
      const items = FLAG_CATALOG.map((definition) => ({
        key: definition.key,
        name: definition.name,
        area: definition.area,
        on: flagAppliesTo(this.rolloutOf(byKey.get(definition.key), definition), audience),
        gatedAction: definition.gatedAction,
        // The policy answer, independent of the flag: a capability that is on but not allowed is
        // still refused by the API.
        allowed: definition.gatedAction
          ? this.policy.can(actor, definition.gatedAction as Action, {
              kind: 'tenant',
              tenantId: actor.tenantId,
            }).allowed
          : true,
      })).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
      return { items };
    });
  }
}
