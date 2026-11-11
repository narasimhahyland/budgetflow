import { AiQueryLogService, AiSettingsService, minimize, type Fact } from '@bf/api/ai';
import { ApprovalsService } from '@bf/api/approvals';
import { AuditService } from '@bf/api/audit';
import { BudgetViews } from '@bf/api/budgets';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
  nowUtc,
} from '@bf/api/core';
import { withTenant, type Db, type Tx } from '@bf/api/db';
import type {
  AssistantConnectorView,
  AssistantTool,
  CreateAssistantConnectionRequest,
  EcosystemConnectionCreated,
  McpToolCallRequest,
  McpToolCallResult,
  McpToolListResult,
  UpdateAssistantConnectorRequest,
} from '@bf/contracts';
import { aiFeatureFlagKey, type AiOutcome } from '@bf/contracts';
import type { Action } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import {
  ASSISTANT_CONSENT_TEXT,
  ASSISTANT_TOOL_CATALOG,
  ECOSYSTEM_LIMITS,
  MCP_PROTOCOL_VERSION,
  NEVER_DOES,
  OUT_OF_SCOPE_NOTICE,
  assistantTool,
} from './catalog';
import {
  EcosystemConnectionsService,
  type CommandContext,
  type ConnectionIdentity,
} from './connections.service';
import { EcosystemScopedReads } from './scoped-reads';
import { EcosystemSurfacesService, tenantOf } from './surfaces.service';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** What each tool reads, so the call is refused before retrieval when the person lacks the action. */
const TOOL_ACTION: Record<AssistantTool, Action> = {
  list_my_budgets: 'budget.read',
  get_budget_balance: 'budget.read',
  list_my_requests: 'request.create',
  get_request_status: 'request.create',
  list_waiting_approvals: 'request.approve',
  search_events: 'event.read',
};

/**
 * The connector for AI assistants (092c): a Model Context Protocol server offering read-only tools
 * under each person's own sign-in.
 *
 * It obeys the Phase 13 rules exactly, because it reuses the Phase 13 machinery. Retrieval goes
 * through the same `PolicyService`-filtered reads as the in-app assistant, what leaves the server is
 * cut down by the same `minimize()` allow-list, and every call writes an `ai_query_log` row with the
 * scope that was applied. There is no tool that submits, approves, applies a control or moves money,
 * and an out-of-scope lookup answers with the neutral wording of 011a rather than a denial that
 * would confirm the record exists.
 */
@Injectable()
export class AssistantConnectorService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly surfaces: EcosystemSurfacesService,
    private readonly connections: EcosystemConnectionsService,
    private readonly reads: EcosystemScopedReads,
    private readonly views: BudgetViews,
    private readonly approvals: ApprovalsService,
    private readonly aiSettings: AiSettingsService,
    private readonly queryLog: AiQueryLogService,
  ) {}

  // Administration ------------------------------------------------------------------------------------

  view(actor: RequestActor): Promise<AssistantConnectorView> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) => {
      this.policy.assert(actor, 'tenant.read', tenantOf(actor), 'the assistant connector');
      return this.viewInTx(tx, actor);
    });
  }

  update(
    actor: RequestActor,
    req: UpdateAssistantConnectorRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<AssistantConnectorView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'ecosystem.assistants.update',
        request: req,
        status: 200,
      },
      async (tx) => {
        this.surfaces.assertCanManage(actor, 'the assistant connector');
        const before = await this.surfaces.assistants(tx, actor.tenantId);
        const tools = new Set(before.config.tools);
        for (const change of req.tools ?? []) {
          if (change.enabled) tools.add(change.tool);
          else tools.delete(change.tool);
        }
        const enabled = req.enabled ?? before.enabled;
        const allowedApps =
          req.allowedApps === undefined ? before.config.allowedApps : req.allowedApps;
        const nextTools = [...tools].sort();
        await this.surfaces.write(
          tx,
          actor.tenantId,
          'assistants',
          { enabled, config: { tools: nextTools, allowedApps } },
          actor.personId,
        );
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ecosystem.assistant_connector_changed',
          resourceType: 'ecosystem_surface',
          resourceId: 'assistants',
          requestId: ctx.requestId,
          changes: {
            enabled: { from: before.enabled, to: enabled },
            tools: { from: [...before.config.tools].sort().join(' '), to: nextTools.join(' ') },
            allowedApps: {
              from: before.config.allowedApps?.join(' ') ?? 'any',
              to: allowedApps?.join(' ') ?? 'any',
            },
          },
        });
        return this.viewInTx(tx, actor);
      },
    );
  }

  /**
   * A person allows one assistant app to read, for 30 days. Three things must hold before a token
   * exists: the connector is on, the 113a `ai.mcp` switch is on, and the app is one the Integration
   * Admin allows. The tools the person picks are then narrowed again to the ones the company offers.
   */
  async connect(
    actor: RequestActor,
    req: CreateAssistantConnectionRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<EcosystemConnectionCreated>> {
    const grants = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        const { enabled, config } = await this.surfaces.assistants(tx, actor.tenantId);
        this.surfaces.assertEnabled(enabled, 'The connector for AI assistants');
        await this.aiSettings.assertEnabled(tx, actor.tenantId, 'mcp');
        if (config.allowedApps !== null && !config.allowedApps.includes(req.appKey))
          throw new ApiProblem(
            403,
            'ASSISTANT_APP_NOT_ALLOWED',
            `${actor.tenantName} has not allowed that assistant.`,
          );
        const off = req.tools.filter((t) => !config.tools.includes(t));
        if (off.length)
          throw new ApiProblem(
            409,
            'ASSISTANT_TOOL_DISABLED',
            `This company does not offer the ${off.map((t) => assistantTool(t).title).join(', ')} tool.`,
            { tools: off.join(' ') },
          );
        return [...req.tools].sort();
      },
    );
    return this.connections.create(
      actor,
      {
        kind: 'assistant',
        clientKey: req.appKey,
        label: req.label,
        grants,
        consentText: ASSISTANT_CONSENT_TEXT,
        lifetimeDays: ECOSYSTEM_LIMITS.assistantConnectionLifetimeDays,
      },
      ctx,
    );
  }

  // The Model Context Protocol surface -------------------------------------------------------------------

  async tools(identity: ConnectionIdentity): Promise<McpToolListResult> {
    const offered = await this.offeredTools(identity);
    await this.connections.logCall(identity, {
      surface: 'assistant',
      operation: 'tools/list',
      outcome: 'ok',
      recordsReturned: offered.length,
    });
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      serverName: 'BudgetFlow',
      tools: offered.map((t) => ({
        name: t.tool,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
        readOnly: true as const,
      })),
      notice:
        'There are no tools to submit, approve, reject, apply controls or move money. Open BudgetFlow to decide anything.',
    };
  }

  /**
   * One tool call. The outcome is recorded in the AI query log whatever happens, including a refusal,
   * so an auditor sees every attempt an assistant made and the scope that was applied to it.
   */
  async call(identity: ConnectionIdentity, req: McpToolCallRequest): Promise<McpToolCallResult> {
    const started = Date.now();
    const actor = identity.actor;
    const offered = await this.offeredTools(identity);
    if (!offered.some((t) => t.tool === req.tool)) {
      await this.record(identity, req.tool, 'refused_action', 0, [], started);
      throw new ApiProblem(
        403,
        'ASSISTANT_TOOL_DISABLED',
        'That tool is not available on this connection.',
      );
    }
    await this.connections.consumeRate(identity, {
      windowMs: 60_000,
      limit: ECOSYSTEM_LIMITS.callsPerMinute,
      code: 'RATE_LIMIT_EXCEEDED',
      detail: `This connection is limited to ${ECOSYSTEM_LIMITS.callsPerMinute} tool calls a minute.`,
    });

    const action = TOOL_ACTION[req.tool];
    if (
      !this.policy.can(actor, action, tenantOf(actor)).allowed &&
      !actor.ownedBudgetPaths.length
    ) {
      // The person holds the action nowhere, so there is nothing in scope to answer with. It reads
      // as an empty result rather than a refusal: an assistant learns nothing it did not already know.
      await this.record(identity, req.tool, 'refused_out_of_scope', 0, [], started);
      return this.empty(req.tool);
    }

    const { records, truncated, scopeCounts } = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      (tx) => this.runTool(tx, actor, req),
    );
    // The same allow-list the in-app assistant uses decides which field names leave the server.
    const minimized = minimize('mcp', records);
    const out = minimized.facts.map((f) => ({ id: f.id, label: f.label, ...f.fields }));
    await this.record(
      identity,
      req.tool,
      'answered',
      scopeCounts.considered,
      minimized.sentFields,
      started,
      scopeCounts.permitted,
      action,
    );
    await this.connections.logCall(identity, {
      surface: 'assistant',
      operation: `tools/call:${req.tool}`,
      outcome: 'ok',
      recordsReturned: out.length,
    });
    return {
      tool: req.tool,
      records: out,
      recordCount: out.length,
      truncated,
      notice: out.length === 0 ? OUT_OF_SCOPE_NOTICE : NEVER_DOES[0],
      links: minimized.facts.slice(0, ECOSYSTEM_LIMITS.assistantMaxRecordsPerCall).map((f) => ({
        label: f.label,
        url: linkFor(req.tool, f.id),
      })),
    };
  }

  // Internals ---------------------------------------------------------------------------------------------

  private async offeredTools(identity: ConnectionIdentity) {
    const actor = identity.actor;
    const config = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        const surface = await this.surfaces.assistants(tx, actor.tenantId);
        this.surfaces.assertEnabled(surface.enabled, 'The connector for AI assistants');
        await this.aiSettings.assertEnabled(tx, actor.tenantId, 'mcp');
        if (
          surface.config.allowedApps !== null &&
          !surface.config.allowedApps.includes(identity.clientKey)
        )
          throw new ApiProblem(
            403,
            'ASSISTANT_APP_NOT_ALLOWED',
            `${actor.tenantName} has not allowed that assistant.`,
          );
        return surface.config;
      },
    );
    // A tool has to be on for the company and granted on this connection: the narrower wins.
    return ASSISTANT_TOOL_CATALOG.filter(
      (t) => config.tools.includes(t.tool) && identity.grants.includes(t.tool),
    );
  }

  private async runTool(
    tx: Tx,
    actor: RequestActor,
    req: McpToolCallRequest,
  ): Promise<{
    records: Fact[];
    truncated: boolean;
    scopeCounts: { considered: number; permitted: number };
  }> {
    const cap = ECOSYSTEM_LIMITS.assistantMaxRecordsPerCall;
    const arg = (name: string): string | undefined => {
      const v = req.arguments[name];
      return typeof v === 'string' && v.trim() ? v.trim() : undefined;
    };

    switch (req.tool) {
      case 'list_my_budgets':
      case 'get_budget_balance': {
        const wanted = req.tool === 'get_budget_balance' ? arg('budgetId') : undefined;
        const scoped = wanted
          ? ((row) => (row ? [row] : []))(await this.reads.budget(tx, actor, wanted))
          : await this.reads.budgets(tx, actor, arg('search'));
        const chosen = scoped.slice(0, cap);
        const details = await this.views.details(tx, actor, chosen);
        return {
          records: details.map((d) => ({
            type: 'budget',
            id: d.id,
            label: d.name,
            fields: {
              status: d.status,
              currency: d.currency,
              authorizedMinor: d.balances.budgetCurrency.authorized.amountMinor,
              committedMinor:
                d.balances.budgetCurrency.preEncumbered.amountMinor +
                d.balances.budgetCurrency.encumbered.amountMinor,
              actualMinor: d.balances.budgetCurrency.actual.amountMinor,
              availableMinor: d.available.underRules.amountMinor,
              utilizationBps: d.utilizationBps,
              ownerName: d.display.ownerName,
              fiscalYearLabel: d.display.fiscalYearLabel,
              childCount: d.childCount,
            },
          })),
          truncated: scoped.length > cap,
          scopeCounts: { considered: scoped.length, permitted: scoped.length },
        };
      }
      case 'list_my_requests':
      case 'get_request_status': {
        const ref = req.tool === 'get_request_status' ? arg('ref') : undefined;
        const all = await this.reads.requests(tx, actor);
        const scoped = ref ? all.filter((r) => r.ref.toUpperCase() === ref.toUpperCase()) : all;
        const chosen = scoped.slice(0, cap);
        return {
          records: chosen.map((r) => ({
            type: 'request',
            id: r.id,
            label: r.ref,
            fields: {
              status: r.status,
              currency: r.currency,
              amountMinor: r.amountMinor,
              reference: r.ref,
              categoryCode: r.category,
            },
          })),
          truncated: scoped.length > cap,
          scopeCounts: { considered: all.length, permitted: scoped.length },
        };
      }
      case 'list_waiting_approvals': {
        // The approval inbox is already scoped to the person; nothing here widens it.
        const inbox = await this.approvals.inbox(actor, 'assigned', cap);
        return {
          records: inbox.items.map((t) => ({
            type: 'approval',
            id: t.taskId,
            label: t.title,
            fields: {
              status: t.taskStatus,
              currency: t.amount.currency,
              amountMinor: t.amount.amountMinor,
              reference: t.ref,
              dueDate: t.dueAt ? t.dueAt.slice(0, 10) : null,
              requestedByName: t.requesterName,
              stepName: `Step ${t.stepNo}`,
            },
          })),
          truncated: inbox.counts.assigned > inbox.items.length,
          scopeCounts: { considered: inbox.counts.assigned, permitted: inbox.items.length },
        };
      }
      case 'search_events': {
        const scoped = await this.reads.events(tx, actor, arg('search'));
        const chosen = scoped.slice(0, cap);
        return {
          records: chosen.map((e) => ({
            type: 'event',
            id: e.id,
            label: e.name,
            fields: {
              status: e.status,
              currency: e.currency,
              amountMinor: e.estimateMinor,
              eventDate: e.startsAt ? e.startsAt.toISOString().slice(0, 10) : null,
              reference: e.eventCode,
            },
          })),
          truncated: scoped.length > cap,
          scopeCounts: { considered: scoped.length, permitted: scoped.length },
        };
      }
    }
  }

  /** One `ai_query_log` row per tool call, including the refusals (092c, 113a). */
  private async record(
    identity: ConnectionIdentity,
    tool: AssistantTool,
    outcome: AiOutcome,
    considered: number,
    sentFields: readonly string[],
    started: number,
    permitted = considered,
    action: Action = 'budget.read',
  ): Promise<void> {
    const actor = identity.actor;
    await withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.queryLog.append(tx, {
        tenantId: actor.tenantId,
        feature: 'mcp',
        channel: 'mcp',
        actorPersonId: actor.personId,
        actorSubject: actor.subject,
        outcome,
        scope: {
          action,
          scope: this.scopeKind(actor, action),
          consideredCount: considered,
          permittedCount: permitted,
        },
        factRefs: [],
        sentFields,
        provider: 'mcp',
        modelId: tool,
        modelVersion: MCP_PROTOCOL_VERSION,
        latencyMs: Date.now() - started,
      }),
    );
  }

  private scopeKind(actor: RequestActor, action: Action): 'tenant' | 'owned' | 'self' | 'none' {
    if (this.policy.can(actor, action, tenantOf(actor)).allowed) return 'tenant';
    if (actor.ownedBudgetPaths.length > 0) return 'owned';
    return actor.personId ? 'self' : 'none';
  }

  private empty(tool: AssistantTool): McpToolCallResult {
    return {
      tool,
      records: [],
      recordCount: 0,
      truncated: false,
      notice: OUT_OF_SCOPE_NOTICE,
      links: [],
    };
  }

  private async viewInTx(tx: Tx, actor: RequestActor): Promise<AssistantConnectorView> {
    const { enabled, config } = await this.surfaces.assistants(tx, actor.tenantId);
    const [connectedPeople, calls, aiOn] = await Promise.all([
      this.connections.activeCount(tx, 'assistant'),
      this.connections.callsSince(tx, 'assistant', new Date(nowUtc().getTime() - WEEK_MS)),
      this.aiSettings.isEnabled(tx, actor.tenantId, 'mcp'),
    ]);
    return {
      enabled,
      serverUrl: '/api/mcp/v1',
      protocolVersion: MCP_PROTOCOL_VERSION,
      tools: ASSISTANT_TOOL_CATALOG.map((t) => ({
        tool: t.tool,
        title: t.title,
        description: t.description,
        enabled: config.tools.includes(t.tool),
      })),
      allowedApps: config.allowedApps,
      connectedPeople,
      toolCallsLast7Days: calls,
      maxRecordsPerCall: ECOSYSTEM_LIMITS.assistantMaxRecordsPerCall,
      connectionLifetimeDays: ECOSYSTEM_LIMITS.assistantConnectionLifetimeDays,
      aiFeatureFlagKey: aiFeatureFlagKey('mcp'),
      aiFeatureEnabled: aiOn,
      consentText: ASSISTANT_CONSENT_TEXT,
      neverDoes: [...NEVER_DOES],
      canManage: this.surfaces.canManage(actor),
      canConnect: Boolean(actor.personId),
    };
  }
}

const linkFor = (tool: AssistantTool, id: string): string => {
  switch (tool) {
    case 'list_my_budgets':
    case 'get_budget_balance':
      return `/budgets/${id}`;
    case 'list_my_requests':
    case 'get_request_status':
      return `/requests/${id}`;
    case 'list_waiting_approvals':
      return `/approvals/${id}`;
    case 'search_events':
      return `/events/${id}`;
  }
};
