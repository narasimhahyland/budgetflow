import { AuditService } from '@bf/api/audit';
import { BudgetViews, budgetResource } from '@bf/api/budgets';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import {
  ecosystemCalls,
  embeddedWidgets,
  eventParticipants,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  CreateWidgetRequest,
  UpdateWidgetRequest,
  WidgetContent,
  WidgetEvent,
  WidgetKind,
  WidgetList,
  WidgetTeamBudget,
  WidgetView,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { CommandContext } from './connections.service';
import { EcosystemScopedReads } from './scoped-reads';
import { tenantOf } from './surfaces.service';

const MONTH_MS = 30 * 86_400_000;

/**
 * Embeddable widgets (102d) are the sharpest edge in this phase, so the rules are worth stating
 * plainly.
 *
 * - **The widget never carries authorization.** A widget id selects presentation only: which card to
 *   render, how many events, whether to show figures. The viewer comes from their own bearer token
 *   and nothing else, so a host page cannot name a tenant, a person or a budget and be believed.
 * - **The allowed-site list decides framing, not data.** It produces the `frame-ancestors` value the
 *   embed route is served with, and a request arriving from a site that is not on the list is
 *   refused at the API too, so a copied snippet on another page gets nothing even if the browser is
 *   lenient. Only exact origins are accepted: a wildcard would mean any page on any host.
 * - **A widget id from another tenant simply does not exist.** The lookup runs under the viewer's own
 *   tenant session, so row level security answers "not found" before any of the above matters.
 * - **Read-only.** Nothing here writes financial state.
 */
@Injectable()
export class WidgetsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly reads: EcosystemScopedReads,
    private readonly views: BudgetViews,
  ) {}

  /** Configuring widgets is the Organization Admin's job, and the Integration Admin co-manages it. */
  canManage(actor: RequestActor): boolean {
    const tenant = tenantOf(actor);
    return (
      this.policy.can(actor, 'tenant.settings.manage', tenant).allowed ||
      this.policy.can(actor, 'integration.manage', tenant).allowed
    );
  }

  private assertCanManage(actor: RequestActor): void {
    if (!this.canManage(actor))
      throw ApiProblem.forbidden('Changing widgets needs tenant settings or integration access.');
  }

  // Administration ------------------------------------------------------------------------------------

  list(actor: RequestActor): Promise<WidgetList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'tenant.read', tenantOf(actor), 'widgets');
      const rows = await tx
        .select()
        .from(embeddedWidgets)
        .where(isNull(embeddedWidgets.deletedAt))
        .orderBy(asc(embeddedWidgets.name), asc(embeddedWidgets.id));
      const items = await Promise.all(rows.map((r) => this.view(tx, r)));
      return { items, canManage: this.canManage(actor) };
    });
  }

  create(
    actor: RequestActor,
    req: CreateWidgetRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<WidgetView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'ecosystem.widget.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        this.assertCanManage(actor);
        const origins = normalizeOrigins(req.allowedOrigins);
        const [row] = await tx
          .insert(embeddedWidgets)
          .values({
            tenantId: actor.tenantId,
            name: req.name,
            kind: req.kind,
            allowedOrigins: origins,
            showAmounts: req.showAmounts,
            eventCount: req.eventCount,
            createdBy: actor.personId,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ecosystem.widget_created',
          resourceType: 'embedded_widget',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            name: { from: null, to: req.name },
            kind: { from: null, to: req.kind },
            allowedOrigins: { from: null, to: origins.join(' ') },
            showAmounts: { from: null, to: req.showAmounts },
          },
        });
        return this.view(tx, row);
      },
    );
  }

  update(
    actor: RequestActor,
    widgetId: string,
    req: UpdateWidgetRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<WidgetView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `ecosystem.widget.update:${widgetId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        this.assertCanManage(actor);
        const before = await this.rowOrFail(tx, widgetId);
        const origins = req.allowedOrigins
          ? normalizeOrigins(req.allowedOrigins)
          : before.allowedOrigins;
        const [row] = await tx
          .update(embeddedWidgets)
          .set({
            name: req.name ?? before.name,
            allowedOrigins: origins,
            showAmounts: req.showAmounts ?? before.showAmounts,
            eventCount: req.eventCount ?? before.eventCount,
            status: req.status ?? before.status,
            updatedAt: new Date(),
          })
          .where(eq(embeddedWidgets.id, widgetId))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ecosystem.widget_changed',
          resourceType: 'embedded_widget',
          resourceId: widgetId,
          requestId: ctx.requestId,
          changes: {
            name: { from: before.name, to: row.name },
            allowedOrigins: {
              from: before.allowedOrigins.join(' '),
              to: row.allowedOrigins.join(' '),
            },
            showAmounts: { from: before.showAmounts, to: row.showAmounts },
            status: { from: before.status, to: row.status },
          },
        });
        return this.view(tx, row);
      },
    );
  }

  remove(
    actor: RequestActor,
    widgetId: string,
    ctx: CommandContext,
  ): Promise<CommandResult<WidgetView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `ecosystem.widget.remove:${widgetId}`,
        request: { widgetId },
        status: 200,
      },
      async (tx) => {
        this.assertCanManage(actor);
        const before = await this.rowOrFail(tx, widgetId);
        const [row] = await tx
          .update(embeddedWidgets)
          .set({ deletedAt: new Date(), status: 'paused', updatedAt: new Date() })
          .where(eq(embeddedWidgets.id, widgetId))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ecosystem.widget_removed',
          resourceType: 'embedded_widget',
          resourceId: widgetId,
          requestId: ctx.requestId,
          changes: {
            name: { from: before.name, to: before.name },
            removed: { from: false, to: true },
          },
        });
        return this.view(tx, row);
      },
    );
  }

  // What a viewer sees ----------------------------------------------------------------------------------

  /**
   * The widget content for one signed-in viewer. `origin` is the `Origin` header the browser sent,
   * which the browser sets and a page cannot forge for a cross-site request; an absent one means the
   * call did not come from a framed page and is treated as not allowed.
   */
  content(actor: RequestActor, widgetId: string, origin: string | null): Promise<WidgetContent> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const row = await this.rowOrFail(tx, widgetId);
      if (row.status !== 'active')
        throw new ApiProblem(409, 'WIDGET_PAUSED', 'This widget is paused.');
      const host = origin ? origin.trim().replace(/\/$/, '').toLowerCase() : null;
      if (!host || !row.allowedOrigins.includes(host)) {
        await tx.insert(ecosystemCalls).values({
          tenantId: actor.tenantId,
          widgetId: row.id,
          surface: 'widget',
          operation: `content:${row.kind}`,
          outcome: 'origin_refused',
          recordsReturned: 0,
          refusedOrigin: (host ?? 'none').slice(0, 200),
          actorPersonId: actor.personId,
        });
        throw new ApiProblem(
          403,
          'WIDGET_ORIGIN_NOT_ALLOWED',
          'This site is not allowed to show the widget. Ask your administrator to add it.',
        );
      }

      const content =
        row.kind === 'team_budget'
          ? await this.teamBudget(tx, actor, row.showAmounts)
          : { teamBudget: null, events: await this.upcomingEvents(tx, actor, row.eventCount) };
      await tx.insert(ecosystemCalls).values({
        tenantId: actor.tenantId,
        widgetId: row.id,
        surface: 'widget',
        operation: `content:${row.kind}`,
        outcome: 'ok',
        recordsReturned: content.teamBudget ? 1 : content.events.length,
        actorPersonId: actor.personId,
      });
      return {
        widgetId: row.id,
        kind: row.kind as WidgetKind,
        showAmounts: row.showAmounts,
        viewerName: actor.displayName,
        teamBudget: content.teamBudget,
        events: content.events,
        emptyMessage: emptyMessageFor(row.kind as WidgetKind, content),
        openInAppUrl: row.kind === 'team_budget' ? '/budgets' : '/events',
        frameAncestors: frameAncestors(row.allowedOrigins),
      };
    });
  }

  /**
   * The viewer's own team budget: the budget they own, or failing that the one their home org unit
   * may request from. A viewer with neither gets a neutral line, never a hint that other budgets exist.
   */
  private async teamBudget(
    tx: Tx,
    actor: RequestActor,
    showAmounts: boolean,
  ): Promise<{ teamBudget: WidgetTeamBudget | null; events: WidgetEvent[] }> {
    const scoped = await this.reads.budgets(tx, actor);
    // Prefer a budget the viewer owns, then the deepest one they can see: both are theirs to spend.
    const mine =
      scoped.find((b) => b.ownerPersonId === actor.personId) ??
      [...scoped].sort((a, b) => b.depth - a.depth || a.name.localeCompare(b.name))[0];
    if (!mine) return { teamBudget: null, events: [] };
    const [detail] = await this.views.details(tx, actor, [mine]);
    const currency = detail.currency;
    const available = { amountMinor: detail.available.underRules.amountMinor, currency };
    return {
      teamBudget: {
        budgetId: detail.id,
        budgetName: detail.name,
        headline: showAmounts
          ? `${detail.name}: money is available for team activities this period.`
          : 'Your team has budget for activities.',
        available: showAmounts ? available : null,
        authorized: showAmounts
          ? { amountMinor: detail.balances.budgetCurrency.authorized.amountMinor, currency }
          : null,
        utilizationBps: showAmounts ? detail.utilizationBps : null,
        status: detail.status,
        canRequest: this.policy.can(actor, 'request.create', budgetResource(mine)).allowed,
      },
      events: [],
    };
  }

  /** The viewer's next few events: ones they are invited to or can otherwise see. */
  private async upcomingEvents(tx: Tx, actor: RequestActor, count: number): Promise<WidgetEvent[]> {
    const scoped = await this.reads.events(tx, actor);
    const invited = actor.personId
      ? new Map(
          (
            await tx
              .select({
                eventId: eventParticipants.eventId,
                rsvp: eventParticipants.rsvpStatus,
              })
              .from(eventParticipants)
              .where(eq(eventParticipants.personId, actor.personId))
          ).map((r) => [r.eventId, r.rsvp] as const),
        )
      : new Map<string, string | null>();
    const now = Date.now();
    return scoped
      .filter((e) => !e.startsAt || e.startsAt.getTime() >= now)
      .sort(
        (a, b) =>
          (a.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
            (b.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, count)
      .map((e) => ({
        eventId: e.id,
        name: e.name,
        startDate: e.startsAt ? e.startsAt.toISOString().slice(0, 10) : null,
        city: null,
        rsvpStatus: invited.get(e.id) ?? null,
        canRsvp: invited.has(e.id),
      }));
  }

  // Internals ---------------------------------------------------------------------------------------------

  private async rowOrFail(tx: Tx, widgetId: string) {
    const [row] = await tx
      .select()
      .from(embeddedWidgets)
      .where(and(eq(embeddedWidgets.id, widgetId), isNull(embeddedWidgets.deletedAt)));
    if (!row) throw ApiProblem.notFound('widget');
    return row;
  }

  private async view(tx: Tx, row: typeof embeddedWidgets.$inferSelect): Promise<WidgetView> {
    const since = new Date(Date.now() - MONTH_MS);
    const [views] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(ecosystemCalls)
      .where(
        and(
          eq(ecosystemCalls.widgetId, row.id),
          eq(ecosystemCalls.outcome, 'ok'),
          gt(ecosystemCalls.at, since),
        ),
      );
    const blocked = await tx
      .select({ origin: ecosystemCalls.refusedOrigin, n: sql<number>`count(*)::int` })
      .from(ecosystemCalls)
      .where(
        and(
          eq(ecosystemCalls.widgetId, row.id),
          eq(ecosystemCalls.outcome, 'origin_refused'),
          gt(ecosystemCalls.at, since),
        ),
      )
      .groupBy(ecosystemCalls.refusedOrigin)
      .orderBy(asc(ecosystemCalls.refusedOrigin));
    return {
      id: row.id,
      name: row.name,
      kind: row.kind as WidgetKind,
      allowedOrigins: row.allowedOrigins,
      showAmounts: row.showAmounts,
      eventCount: row.eventCount,
      status: row.status as WidgetView['status'],
      viewsLast30Days: views?.n ?? 0,
      blockedOriginsLast30Days: blocked.map((b) => ({ origin: b.origin ?? 'none', attempts: b.n })),
      frameAncestors: frameAncestors(row.allowedOrigins),
      embedSnippet: embedSnippet(row.id, row.name),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }
}

/** Exact origins, lower-cased and without a trailing slash, sorted so the policy header is stable. */
const normalizeOrigins = (origins: readonly string[]): string[] =>
  [...new Set(origins.map((o) => o.trim().replace(/\/$/, '').toLowerCase()))].sort();

/**
 * The `frame-ancestors` directive for the embed route. It never contains `*`: a widget that any site
 * could frame would be a widget whose audience nobody chose.
 */
export const frameAncestors = (origins: readonly string[]): string =>
  origins.length ? `frame-ancestors ${origins.join(' ')}` : "frame-ancestors 'none'";

const embedSnippet = (widgetId: string, name: string): string =>
  `<iframe src="/embed/${widgetId}" title="BudgetFlow: ${name}" width="100%" height="220" style="border:0"></iframe>`;

const emptyMessageFor = (
  kind: WidgetKind,
  content: { teamBudget: WidgetTeamBudget | null; events: WidgetEvent[] },
): string | null => {
  if (kind === 'team_budget') return content.teamBudget ? null : 'No shared team budget.';
  return content.events.length ? null : 'No events coming up.';
};

const iso = (d: Date): string => d.toISOString().replace(/\.\d+Z$/, 'Z');
