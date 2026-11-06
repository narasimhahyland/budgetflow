import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { featureFlags, people, tenantSettings, withTenant, type Db, type Tx } from '@bf/api/db';
import { DB } from '@bf/api/core';
import {
  AI_FEATURES,
  aiFeatureFlagKey,
  type AiFeature,
  type AiSettings,
  type AiSettingsView,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { AiGateway } from './ai-gateway.service';
import { dataSentFor, FEATURE_CATALOG, featureDefinition } from './feature-catalog';

export interface CommandContext {
  idempotencyKey: string;
  requestId: string | null;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  questionsPerPersonPerHour: 50,
  conversationHistoryDays: 30,
  nudgeMinimumAmount: { amountMinor: 50_000, currency: 'USD' },
  nudgeMinimumPct: 10,
  nudgeFrequencyDays: 14,
  showFlagsToApprovers: true,
};

interface StoredAi {
  settings?: Partial<AiSettings>;
  pending?: Record<string, { requestedBySubject: string; requestedAt: string }>;
  lastChanged?: Record<string, { personId: string | null; at: string }>;
}

/**
 * The per-tenant kill switch and limits of 113a. A feature that is off is refused by the API, so
 * turning it off takes effect on the next request. Finance-affecting features (matching, extraction,
 * anomaly flags, outlook) stay pending until a Finance Admin confirms them in their own right.
 */
@Injectable()
export class AiSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly commands: CommandRunner,
    private readonly audit: AuditService,
    private readonly gateway: AiGateway,
  ) {}

  private tenant(actor: RequestActor) {
    return { kind: 'tenant' as const, tenantId: actor.tenantId };
  }

  canManage(actor: RequestActor): boolean {
    return this.policy.can(actor, 'tenant.settings.manage', this.tenant(actor)).allowed;
  }

  canConfirmFinance(actor: RequestActor): boolean {
    return this.policy.can(actor, 'ai.confirm_finance', this.tenant(actor)).allowed;
  }

  private async stored(tx: Tx, tenantId: string): Promise<StoredAi> {
    const [row] = await tx
      .select({ settings: tenantSettings.settings })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId));
    const all = (row?.settings ?? {}) as Record<string, unknown>;
    return (all['ai'] as StoredAi | undefined) ?? {};
  }

  private async writeStored(tx: Tx, tenantId: string, next: StoredAi): Promise<void> {
    const [row] = await tx
      .select({ settings: tenantSettings.settings })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId));
    const all = { ...((row?.settings ?? {}) as Record<string, unknown>), ai: next };
    await tx
      .insert(tenantSettings)
      .values({ tenantId, settings: all })
      .onConflictDoUpdate({ target: tenantSettings.tenantId, set: { settings: all } });
  }

  async settings(tx: Tx, tenantId: string): Promise<AiSettings> {
    const stored = await this.stored(tx, tenantId);
    return { ...DEFAULT_AI_SETTINGS, ...(stored.settings ?? {}) };
  }

  /** Effective on/off per feature, from `feature_flags`. */
  async enabledFeatures(tx: Tx, tenantId: string): Promise<Map<AiFeature, boolean>> {
    const keys = AI_FEATURES.map(aiFeatureFlagKey);
    const rows = await tx
      .select({ key: featureFlags.key, enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(and(eq(featureFlags.tenantId, tenantId), inArray(featureFlags.key, keys)));
    const byKey = new Map(rows.map((r) => [r.key, r.enabled]));
    return new Map(AI_FEATURES.map((f) => [f, byKey.get(aiFeatureFlagKey(f)) ?? false]));
  }

  async isEnabled(tx: Tx, tenantId: string, feature: AiFeature): Promise<boolean> {
    return (await this.enabledFeatures(tx, tenantId)).get(feature) ?? false;
  }

  /** Refuses a call to a feature that is off, or when no model provider is configured. */
  async assertEnabled(tx: Tx, tenantId: string, feature: AiFeature): Promise<void> {
    if (!this.gateway.configured)
      throw new ApiProblem(
        409,
        'AI_PROVIDER_NOT_CONFIGURED',
        'No model provider is configured. AI features cannot run.',
      );
    if (!(await this.isEnabled(tx, tenantId, feature)))
      throw new ApiProblem(
        409,
        'AI_FEATURE_DISABLED',
        `${featureDefinition(feature).title} is turned off for this company.`,
      );
  }

  async view(actor: RequestActor): Promise<AiSettingsView> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.viewInTx(tx, actor),
    );
  }

  async viewInTx(tx: Tx, actor: RequestActor): Promise<AiSettingsView> {
    this.policy.assert(actor, 'tenant.read', this.tenant(actor), 'AI settings');
    const [enabled, stored, settings] = await Promise.all([
      this.enabledFeatures(tx, actor.tenantId),
      this.stored(tx, actor.tenantId),
      this.settings(tx, actor.tenantId),
    ]);
    const changerIds = Object.values(stored.lastChanged ?? {})
      .map((c) => c.personId)
      .filter((id): id is string => Boolean(id));
    const names = changerIds.length
      ? new Map(
          (
            await tx
              .select({ id: people.id, name: people.displayName })
              .from(people)
              .where(inArray(people.id, [...new Set(changerIds)]))
          ).map((p) => [p.id, p.name]),
        )
      : new Map<string, string>();
    return {
      features: FEATURE_CATALOG.map((def) => {
        const changed = stored.lastChanged?.[def.feature] ?? null;
        return {
          feature: def.feature,
          flagKey: aiFeatureFlagKey(def.feature),
          title: def.title,
          appearsOn: def.appearsOn,
          enabled: enabled.get(def.feature) ?? false,
          pendingFinanceConfirmation: Boolean(stored.pending?.[def.feature]),
          needsFinanceConfirmation: def.needsFinanceConfirmation,
          dataSent: dataSentFor(def.feature),
          neverDoes: [...def.neverDoes],
          lastChangedByName: changed?.personId ? (names.get(changed.personId) ?? null) : null,
          lastChangedAt: changed?.at ?? null,
        };
      }),
      settings,
      provider: {
        configured: this.gateway.configured,
        provider: this.gateway.providerId,
        modelId: this.gateway.modelId,
        modelVersion: this.gateway.modelVersion,
        note: 'Provider keys are held in the server environment and never shown or stored here.',
      },
      canManage: this.canManage(actor),
      canConfirmFinance: this.canConfirmFinance(actor),
    };
  }

  switchFeature(
    actor: RequestActor,
    feature: AiFeature,
    req: { enabled: boolean },
    ctx: CommandContext,
  ): Promise<CommandResult<AiSettingsView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `ai.feature.switch:${feature}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'tenant.settings.manage', this.tenant(actor), 'AI settings');
        if (req.enabled && !this.gateway.configured)
          throw new ApiProblem(
            409,
            'AI_PROVIDER_NOT_CONFIGURED',
            'No model provider is configured. AI features cannot be turned on.',
          );
        const def = featureDefinition(feature);
        const before = await this.enabledFeatures(tx, actor.tenantId);
        const stored = await this.stored(tx, actor.tenantId);
        const pending = { ...(stored.pending ?? {}) };
        const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        let effective = req.enabled;
        if (req.enabled && def.needsFinanceConfirmation) {
          effective = false;
          pending[feature] = { requestedBySubject: actor.subject, requestedAt: now };
        } else {
          delete pending[feature];
        }
        await this.setFlag(tx, actor.tenantId, feature, effective);
        await this.writeStored(tx, actor.tenantId, {
          ...stored,
          pending,
          lastChanged: {
            ...(stored.lastChanged ?? {}),
            [feature]: { personId: actor.personId, at: now },
          },
        });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ai.feature.switched',
          resourceType: 'ai_feature',
          resourceId: feature,
          requestId: ctx.requestId,
          changes: {
            enabled: { from: before.get(feature) ?? false, to: effective },
            pendingFinanceConfirmation: {
              from: Boolean(stored.pending?.[feature]),
              to: Boolean(pending[feature]),
            },
          },
        });
        return this.viewInTx(tx, actor);
      },
    );
  }

  confirmFinanceFeature(
    actor: RequestActor,
    feature: AiFeature,
    ctx: CommandContext,
  ): Promise<CommandResult<AiSettingsView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `ai.feature.confirm:${feature}`,
        request: { feature },
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'ai.confirm_finance', this.tenant(actor), 'AI settings');
        const stored = await this.stored(tx, actor.tenantId);
        if (!stored.pending?.[feature])
          throw new ApiProblem(
            409,
            'CONFLICT',
            'That feature is not waiting for a Finance Admin confirmation.',
          );
        const pending = { ...stored.pending };
        delete pending[feature];
        const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        await this.setFlag(tx, actor.tenantId, feature, true);
        await this.writeStored(tx, actor.tenantId, {
          ...stored,
          pending,
          lastChanged: {
            ...(stored.lastChanged ?? {}),
            [feature]: { personId: actor.personId, at: now },
          },
        });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ai.feature.finance_confirmed',
          resourceType: 'ai_feature',
          resourceId: feature,
          requestId: ctx.requestId,
          changes: { enabled: { from: false, to: true } },
        });
        return this.viewInTx(tx, actor);
      },
    );
  }

  updateSettings(
    actor: RequestActor,
    req: AiSettings,
    ctx: CommandContext,
  ): Promise<CommandResult<AiSettingsView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'ai.settings.update',
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'tenant.settings.manage', this.tenant(actor), 'AI settings');
        const stored = await this.stored(tx, actor.tenantId);
        const before = await this.settings(tx, actor.tenantId);
        await this.writeStored(tx, actor.tenantId, { ...stored, settings: req });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ai.settings.updated',
          resourceType: 'tenant',
          resourceId: actor.tenantId,
          requestId: ctx.requestId,
          changes: { aiSettings: { from: before, to: req } },
        });
        return this.viewInTx(tx, actor);
      },
    );
  }

  /** Seed and admin helper: sets a feature flag without an audit entry (used by `seed/ai.ts`). */
  async setFlag(tx: Tx, tenantId: string, feature: AiFeature, enabled: boolean): Promise<void> {
    await tx
      .insert(featureFlags)
      .values({ tenantId, key: aiFeatureFlagKey(feature), enabled })
      .onConflictDoUpdate({
        target: [featureFlags.tenantId, featureFlags.key],
        set: { enabled, updatedAt: new Date() },
      });
  }
}
