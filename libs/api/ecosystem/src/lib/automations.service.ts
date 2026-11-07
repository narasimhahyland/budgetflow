import { AuditService } from '@bf/api/audit';
import { BudgetViews } from '@bf/api/budgets';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { withTenant, type Db, type Tx } from '@bf/api/db';
import { RequestsService } from '@bf/api/spend';
import type {
  AutomationBalanceResult,
  AutomationConnectorView,
  AutomationDraftRequestBody,
  AutomationDraftRequestResult,
  CreateAutomationRequest,
  EcosystemConnectionCreated,
  NoCodePlatform,
  UpdateNoCodePlatformRequest,
} from '@bf/contracts';
import { AUTOMATION_TRIGGERS } from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import {
  AUTOMATION_ACTION_CATALOG,
  AUTOMATION_CONSENT_TEXT,
  AUTOMATION_TRIGGER_TITLES,
  ECOSYSTEM_LIMITS,
  NEVER_DOES,
  NO_CODE_PLATFORM_TITLES,
} from './catalog';
import {
  EcosystemConnectionsService,
  type CommandContext,
  type ConnectionIdentity,
} from './connections.service';
import { EcosystemScopedReads } from './scoped-reads';
import { EcosystemSurfacesService, tenantOf } from './surfaces.service';

const WEEK_MS = 7 * 86_400_000;

/**
 * No-code connectors (092b): Zapier, Make, Power Automate and Workato, each connected by a person
 * for themselves.
 *
 * Two things make this safe. An automation acts as the person who connected it, never as a
 * company-wide service key, so its reach shrinks the moment their access does. And the only write it
 * can reach is a Draft request, created through the ordinary `RequestsService.create` command with
 * `submit: false`, which runs its own `PolicyService` check, idempotency key and audit entry. A
 * Draft moves no money and stays a Draft until a person opens and submits it in BudgetFlow.
 *
 * Trigger delivery is deliberately not wired yet: the Phase 12 fan-out builds one payload per
 * tenant-wide endpoint, and delivering those to a personal automation would hand the platform
 * records the connected person may not see. The trigger catalogue is published so the frontend can
 * show it, each marked unavailable, until that fan-out learns per-person scoping.
 */
@Injectable()
export class AutomationConnectorService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly surfaces: EcosystemSurfacesService,
    private readonly connections: EcosystemConnectionsService,
    private readonly reads: EcosystemScopedReads,
    private readonly views: BudgetViews,
    private readonly requests: RequestsService,
  ) {}

  // Administration ------------------------------------------------------------------------------------

  view(actor: RequestActor): Promise<AutomationConnectorView> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) => {
      this.policy.assert(actor, 'tenant.read', tenantOf(actor), 'no-code connectors');
      return this.viewInTx(tx, actor);
    });
  }

  setPlatform(
    actor: RequestActor,
    platform: NoCodePlatform,
    req: UpdateNoCodePlatformRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<AutomationConnectorView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `ecosystem.automations.platform:${platform}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        this.surfaces.assertCanManage(actor, 'no-code connectors');
        const before = await this.surfaces.automations(tx, actor.tenantId);
        const allowed = new Set(before.config.platforms);
        if (req.allowed) allowed.add(platform);
        else allowed.delete(platform);
        const next = [...allowed].sort();
        await this.surfaces.write(
          tx,
          actor.tenantId,
          'automations',
          { enabled: next.length > 0, config: { platforms: next } },
          actor.personId,
        );
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ecosystem.no_code_platform_changed',
          resourceType: 'ecosystem_surface',
          resourceId: platform,
          requestId: ctx.requestId,
          changes: {
            allowed: { from: before.config.platforms.includes(platform), to: req.allowed },
          },
        });
        return this.viewInTx(tx, actor);
      },
    );
  }

  /** A person connects a platform to their own account, for the actions they agree to. */
  async connect(
    actor: RequestActor,
    req: CreateAutomationRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<EcosystemConnectionCreated>> {
    await withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const { config } = await this.surfaces.automations(tx, actor.tenantId);
      if (!config.platforms.includes(req.platform))
        throw new ApiProblem(
          403,
          'AUTOMATION_PLATFORM_NOT_ALLOWED',
          `${actor.tenantName} has not allowed ${NO_CODE_PLATFORM_TITLES[req.platform]}. Ask your Integration Admin.`,
        );
      // An automation cannot be given an action its person could not take unaided.
      if (
        req.actions.includes('request.draft.create') &&
        !this.policy.can(actor, 'request.create', tenantOf(actor)).allowed &&
        actor.ownedBudgetPaths.length === 0
      )
        throw ApiProblem.forbidden('You cannot raise requests, so an automation cannot either.');
    });
    return this.connections.create(
      actor,
      {
        kind: 'automation',
        clientKey: req.platform,
        label: req.label,
        grants: [...req.actions].sort(),
        consentText: AUTOMATION_CONSENT_TEXT,
        lifetimeDays: ECOSYSTEM_LIMITS.automationConnectionLifetimeDays,
      },
      ctx,
    );
  }

  // Actions an automation may take -----------------------------------------------------------------------

  /** Reads one budget balance, if the connected person may read that budget. */
  async balance(identity: ConnectionIdentity, budgetId: string): Promise<AutomationBalanceResult> {
    await this.beforeAction(identity, 'budget.balance.read', 'budget balances');
    const actor = identity.actor;
    const result = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        const row = await this.reads.budget(tx, actor, budgetId);
        if (!row) throw ApiProblem.notFound('budget');
        const [detail] = await this.views.details(tx, actor, [row]);
        const currency = detail.currency;
        const b = detail.balances.budgetCurrency;
        return {
          budgetId: detail.id,
          name: detail.name,
          status: detail.status,
          currency,
          authorized: { amountMinor: b.authorized.amountMinor, currency },
          committed: {
            amountMinor: b.preEncumbered.amountMinor + b.encumbered.amountMinor,
            currency,
          },
          actual: { amountMinor: b.actual.amountMinor, currency },
          availableUnderRules: {
            amountMinor: detail.available.underRules.amountMinor,
            currency,
          },
        } satisfies AutomationBalanceResult;
      },
    );
    await this.connections.logCall(identity, {
      surface: 'automation',
      operation: 'budget.balance.read',
      outcome: 'ok',
      recordsReturned: 1,
    });
    return result;
  }

  /**
   * Creates a Draft request as the connected person. It goes through the same command a person uses
   * in the app, so the budget control, the policy check, the idempotency key and the single audit
   * entry are the real ones. Nothing here can submit it.
   */
  async draftRequest(
    identity: ConnectionIdentity,
    body: AutomationDraftRequestBody,
    ctx: CommandContext,
  ): Promise<AutomationDraftRequestResult> {
    await this.beforeAction(identity, 'request.draft.create', 'creating drafts');
    const actor = identity.actor;
    const platform =
      NO_CODE_PLATFORM_TITLES[identity.clientKey as NoCodePlatform] ?? identity.label;
    const created = await this.requests.create(
      actor,
      {
        kind: 'spending',
        budgetId: body.budgetId,
        amount: body.amount,
        spendType: body.spendType,
        title: body.title,
        purpose: body.purpose,
        ...(body.category ? { category: body.category } : {}),
        ...(body.neededBy ? { neededBy: body.neededBy } : {}),
        submit: false,
      },
      ctx,
    );
    await this.connections.logCall(identity, {
      surface: 'automation',
      operation: 'request.draft.create',
      outcome: 'ok',
      recordsReturned: 1,
    });
    return {
      requestId: created.body.id,
      ref: created.body.ref,
      status: 'draft',
      label: `Drafted by ${platform} for ${actor.displayName}`,
      openUrl: `/requests/${created.body.id}`,
      notice:
        'This is a Draft. Open it in BudgetFlow and submit it yourself; an automation cannot submit, approve or move money.',
    };
  }

  // Internals --------------------------------------------------------------------------------------------

  /** Platform still allowed, action still granted, rate still available: in that order. */
  private async beforeAction(
    identity: ConnectionIdentity,
    grant: string,
    what: string,
  ): Promise<void> {
    const actor = identity.actor;
    await withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const { config } = await this.surfaces.automations(tx, actor.tenantId);
      if (!config.platforms.includes(identity.clientKey as NoCodePlatform))
        throw new ApiProblem(
          403,
          'AUTOMATION_PLATFORM_NOT_ALLOWED',
          'Access revoked: this company no longer allows that platform.',
        );
    });
    this.connections.assertGrant(identity, grant, what);
    await this.connections.consumeRate(identity, {
      windowMs: 60_000,
      limit: ECOSYSTEM_LIMITS.callsPerMinute,
      code: 'RATE_LIMIT_EXCEEDED',
      detail: `This automation is limited to ${ECOSYSTEM_LIMITS.callsPerMinute} calls a minute.`,
    });
  }

  private async viewInTx(tx: Tx, actor: RequestActor): Promise<AutomationConnectorView> {
    const { enabled, config } = await this.surfaces.automations(tx, actor.tenantId);
    const [active, runs, rows] = await Promise.all([
      this.connections.activeCount(tx, 'automation'),
      this.connections.callsSince(tx, 'automation', new Date(Date.now() - WEEK_MS)),
      this.connections.activeRows(tx, 'automation'),
    ]);
    const perPlatform = new Map<string, number>();
    for (const r of rows) perPlatform.set(r.clientKey, (perPlatform.get(r.clientKey) ?? 0) + 1);
    return {
      enabled,
      platforms: (Object.keys(NO_CODE_PLATFORM_TITLES) as NoCodePlatform[])
        .map((platform) => ({
          platform,
          title: NO_CODE_PLATFORM_TITLES[platform],
          allowed: config.platforms.includes(platform),
          automationsActive: perPlatform.get(platform) ?? 0,
          lastChangedAt: null,
          lastChangedByName: null,
        }))
        .sort((a, b) => a.title.localeCompare(b.title) || a.platform.localeCompare(b.platform)),
      actions: AUTOMATION_ACTION_CATALOG.map((a) => ({ ...a })),
      triggers: AUTOMATION_TRIGGERS.map((trigger) => ({
        trigger,
        title: AUTOMATION_TRIGGER_TITLES[trigger],
        deliveryAvailable: false,
      })),
      automationsActive: active,
      runsLast7Days: runs,
      connectionLifetimeDays: ECOSYSTEM_LIMITS.automationConnectionLifetimeDays,
      consentText: AUTOMATION_CONSENT_TEXT,
      neverDoes: [...NEVER_DOES],
      canManage: this.surfaces.canManage(actor),
      canConnect: Boolean(actor.personId) && config.platforms.length > 0,
    };
  }
}
