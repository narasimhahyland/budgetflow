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
import { ledgerBalances, withTenant, type Db } from '@bf/api/db';
import type {
  BiConnectorView,
  BiDataset,
  BiFeedPage,
  CreateBiConnectionRequest,
  EcosystemConnectionCreated,
  UpdateBiConnectorRequest,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { asc, inArray } from 'drizzle-orm';
import { BI_DATASET_CATALOG, ECOSYSTEM_LIMITS, biDataset } from './catalog';
import {
  EcosystemConnectionsService,
  type CommandContext,
  type ConnectionIdentity,
} from './connections.service';
import { EcosystemScopedReads } from './scoped-reads';
import { EcosystemSurfacesService, tenantOf } from './surfaces.service';

const DAY_MS = 86_400_000;
const BI_TOOL_TITLES: Record<string, string> = { power_bi: 'Power BI', tableau: 'Tableau' };

/**
 * The BI connector (092a): curated read-only datasets a person points Power BI or Tableau at.
 *
 * The feed has no write path at all, and each connection acts as the person who made it. A BI report
 * therefore cannot show more than its author could see in BudgetFlow, however the report is shared
 * afterwards. Figures come from the same read models as the app, so the two never disagree.
 */
@Injectable()
export class BiConnectorService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly surfaces: EcosystemSurfacesService,
    private readonly connections: EcosystemConnectionsService,
    private readonly reads: EcosystemScopedReads,
    private readonly views: BudgetViews,
  ) {}

  // Administration -----------------------------------------------------------------------------------

  view(actor: RequestActor): Promise<BiConnectorView> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) => {
      this.policy.assert(actor, 'tenant.read', tenantOf(actor), 'the BI connector');
      return this.viewInTx(tx, actor);
    });
  }

  update(
    actor: RequestActor,
    req: UpdateBiConnectorRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<BiConnectorView>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'ecosystem.bi.update',
        request: req,
        status: 200,
      },
      async (tx) => {
        this.surfaces.assertCanManage(actor, 'the BI connector');
        const before = await this.surfaces.bi(tx, actor.tenantId);
        const datasets = new Set(before.config.datasets);
        for (const change of req.datasets ?? []) {
          if (change.enabled) datasets.add(change.dataset);
          else datasets.delete(change.dataset);
        }
        const enabled = req.enabled ?? before.enabled;
        const next = [...datasets].sort();
        await this.surfaces.write(
          tx,
          actor.tenantId,
          'bi',
          { enabled, config: { datasets: next } },
          actor.personId,
        );
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ecosystem.bi_connector_changed',
          resourceType: 'ecosystem_surface',
          resourceId: 'bi',
          requestId: ctx.requestId,
          changes: {
            enabled: { from: before.enabled, to: enabled },
            datasets: { from: [...before.config.datasets].sort().join(' '), to: next.join(' ') },
          },
        });
        return this.viewInTx(tx, actor);
      },
    );
  }

  /**
   * A person connects their own tool. They must already hold `report.read`, and every dataset they
   * ask for has to be on for the company: a connection can only ever narrow what its person may do.
   */
  connect(
    actor: RequestActor,
    req: CreateBiConnectionRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<EcosystemConnectionCreated>> {
    return this.connectChecked(actor, req, ctx);
  }

  private async connectChecked(
    actor: RequestActor,
    req: CreateBiConnectionRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<EcosystemConnectionCreated>> {
    await withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const { enabled, config } = await this.surfaces.bi(tx, actor.tenantId);
      this.surfaces.assertEnabled(enabled, 'The BI connector');
      this.policy.assert(actor, 'report.read', tenantOf(actor), 'BI connections');
      const off = req.datasets.filter((d) => !config.datasets.includes(d));
      if (off.length)
        throw new ApiProblem(
          409,
          'BI_DATASET_DISABLED',
          `This company does not offer the ${off.map((d) => biDataset(d).title).join(', ')} dataset.`,
          { datasets: off.join(' ') },
        );
    });
    return this.connections.create(
      actor,
      {
        kind: 'bi',
        clientKey: req.tool,
        label: req.label,
        grants: [...req.datasets].sort(),
        consentText: `${BI_TOOL_TITLES[req.tool] ?? req.tool} reads the datasets you chose, with your own access.`,
        lifetimeDays: ECOSYSTEM_LIMITS.biConnectionLifetimeDays,
      },
      ctx,
    );
  }

  // The feed -------------------------------------------------------------------------------------------

  /**
   * One page of one dataset for one connection. The order of checks is the point: the surface switch,
   * then the dataset switch, then the connection's own grant, then the refresh limit, and only then
   * a read that is itself filtered row by row through `PolicyService`.
   */
  async feed(
    identity: ConnectionIdentity,
    dataset: BiDataset,
    page: { cursor?: string; limit?: number },
  ): Promise<BiFeedPage> {
    const actor = identity.actor;
    const definition = biDataset(dataset);
    const limit = Math.min(page.limit ?? 200, ECOSYSTEM_LIMITS.biMaxRowsPerRequest);

    const enabledDatasets = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        const { enabled, config } = await this.surfaces.bi(tx, actor.tenantId);
        this.surfaces.assertEnabled(enabled, 'The BI connector');
        return config.datasets;
      },
    );
    if (!enabledDatasets.includes(dataset))
      throw new ApiProblem(
        409,
        'BI_DATASET_DISABLED',
        `The ${definition.title} dataset is turned off for this company.`,
      );
    this.connections.assertGrant(identity, dataset, `the ${definition.title} dataset`);
    this.policy.assert(actor, definition.action, tenantOf(actor), definition.title);
    const remaining = await this.connections.consumeRate(identity, {
      windowMs: DAY_MS,
      limit: ECOSYSTEM_LIMITS.biRefreshesPerDay,
      code: 'BI_REFRESH_LIMIT_REACHED',
      detail: `Refresh limit reached (${ECOSYSTEM_LIMITS.biRefreshesPerDay} per day).`,
    });

    const rows = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      (tx) => this.rowsFor(tx, actor, dataset, page.cursor, limit + 1),
    );
    const pageRows = rows.slice(0, limit);
    await this.connections.logCall(identity, {
      surface: 'bi',
      operation: `feed:${dataset}`,
      outcome: 'ok',
      recordsReturned: pageRows.length,
    });
    return {
      dataset,
      rows: pageRows,
      rowCount: pageRows.length,
      nextCursor: rows.length > limit ? String(pageRows.at(-1)?.['cursor'] ?? '') || null : null,
      generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      refreshesRemainingToday: remaining,
      currency: actor.reportingCurrency,
    };
  }

  private async rowsFor(
    tx: Parameters<EcosystemScopedReads['budgets']>[0],
    actor: RequestActor,
    dataset: BiDataset,
    cursor: string | undefined,
    take: number,
  ): Promise<Record<string, unknown>[]> {
    const after = (id: string) => !cursor || id > cursor;
    switch (dataset) {
      case 'budgets': {
        const scoped = await this.reads.budgets(tx, actor);
        const chosen = scoped.filter((b) => after(b.id)).slice(0, take);
        const details = await this.views.details(tx, actor, chosen);
        return details.map((d) => {
          const b = d.balances.budgetCurrency;
          return {
            cursor: d.id,
            budgetId: d.id,
            name: d.name,
            parentId: d.parentId,
            ownerName: d.display.ownerName,
            status: d.status,
            categoryCode: d.categoryCode,
            currency: d.currency,
            authorizedMinor: b.authorized.amountMinor,
            allocatedOutMinor: b.allocatedOut.amountMinor,
            heldMinor: b.held.amountMinor,
            preEncumberedMinor: b.preEncumbered.amountMinor,
            encumberedMinor: b.encumbered.amountMinor,
            actualMinor: b.actual.amountMinor,
            availableUnderRulesMinor: d.available.underRules.amountMinor,
            utilizationBps: d.utilizationBps,
            fiscalYearLabel: d.display.fiscalYearLabel,
          };
        });
      }
      case 'company_rollup': {
        const scoped = await this.reads.budgets(tx, actor);
        const roots = scoped.filter((b) => b.parentId === null && after(b.id)).slice(0, take);
        const details = await this.views.details(tx, actor, roots);
        return details.map((d) => ({
          cursor: d.id,
          budgetId: d.id,
          name: d.name,
          currency: d.currency,
          authorizedMinor: d.balances.budgetCurrency.authorized.amountMinor,
          availableCompanyWideMinor: d.available.companyWide.amountMinor,
          childCount: d.childCount,
        }));
      }
      case 'ledger_summary': {
        const scoped = await this.reads.budgets(tx, actor);
        if (!scoped.length) return [];
        const byId = new Map(scoped.map((b) => [b.id, b] as const));
        const rows = await tx
          .select()
          .from(ledgerBalances)
          .where(inArray(ledgerBalances.budgetId, [...byId.keys()]))
          .orderBy(
            asc(ledgerBalances.budgetId),
            asc(ledgerBalances.fiscalPeriodId),
            asc(ledgerBalances.bucket),
          );
        return rows
          .map((r) => ({
            key: `${r.budgetId}|${r.fiscalPeriodId}|${r.bucket}`,
            row: r,
          }))
          .filter((r) => after(r.key))
          .slice(0, take)
          .map(({ key, row }) => ({
            cursor: key,
            budgetId: row.budgetId,
            budgetName: byId.get(row.budgetId)!.name,
            accountingPeriodId: row.fiscalPeriodId,
            bucket: row.bucket,
            currency: byId.get(row.budgetId)!.currency,
            amountMinor: row.budgetAmountMinor,
            lineCount: row.lineCount,
          }));
      }
      case 'events': {
        const scoped = await this.reads.events(tx, actor);
        return scoped
          .filter((e) => after(e.id))
          .slice(0, take)
          .map((e) => ({
            cursor: e.id,
            eventId: e.id,
            eventCode: e.eventCode,
            name: e.name,
            status: e.status,
            startDate: e.startsAt ? e.startsAt.toISOString().slice(0, 10) : null,
            endDate: e.endsAt ? e.endsAt.toISOString().slice(0, 10) : null,
            currency: e.currency,
            estimateMinor: e.estimateMinor,
          }));
      }
      case 'requests': {
        const scoped = await this.reads.requests(tx, actor);
        return scoped
          .filter((r) => after(r.id))
          .slice(0, take)
          .map((r) => ({
            cursor: r.id,
            requestId: r.id,
            ref: r.ref,
            budgetId: r.budgetId,
            status: r.status,
            kind: r.kind,
            categoryCode: r.category,
            currency: r.currency,
            amountMinor: r.amountMinor,
            createdAt: r.createdAt.toISOString().replace(/\.\d+Z$/, 'Z'),
          }));
      }
    }
  }

  private async viewInTx(
    tx: Parameters<EcosystemScopedReads['budgets']>[0],
    actor: RequestActor,
  ): Promise<BiConnectorView> {
    const { enabled, config } = await this.surfaces.bi(tx, actor.tenantId);
    const [active, refreshes] = await Promise.all([
      this.connections.activeCount(tx, 'bi'),
      this.connections.callsSince(tx, 'bi', new Date(Date.now() - DAY_MS)),
    ]);
    return {
      enabled,
      feedBaseUrl: '/api/bi/v1',
      datasets: BI_DATASET_CATALOG.map((d) => ({
        dataset: d.dataset,
        title: d.title,
        description: d.description,
        enabled: config.datasets.includes(d.dataset),
        fields: d.fields.map((f) => ({ ...f })),
      })),
      connectionsActive: active,
      refreshesLast24h: refreshes,
      refreshLimitPerDay: ECOSYSTEM_LIMITS.biRefreshesPerDay,
      maxRowsPerRequest: ECOSYSTEM_LIMITS.biMaxRowsPerRequest,
      connectionLifetimeDays: ECOSYSTEM_LIMITS.biConnectionLifetimeDays,
      notice:
        'The feed is read-only and each connection carries its own sign-in, so a report never shows more than the person who built it can see.',
      canManage: this.surfaces.canManage(actor),
      canConnect: this.policy.can(actor, 'report.read', tenantOf(actor)).allowed,
    };
  }
}
