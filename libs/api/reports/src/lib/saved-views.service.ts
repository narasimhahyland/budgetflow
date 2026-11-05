import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { reportSavedViews, withTenant, type Db, type Tx } from '@bf/api/db';
import type { CreateSavedViewRequest, ReportFilters, SavedReportView } from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, or } from 'drizzle-orm';

export interface CommandContext {
  idempotencyKey: string;
  requestId: string | null;
}

type ViewRow = typeof reportSavedViews.$inferSelect;

const toView = (r: ViewRow): SavedReportView => ({
  id: r.id,
  reportId: r.reportId as SavedReportView['reportId'],
  name: r.name,
  filters: r.filters as ReportFilters,
  favourite: r.favourite,
  ownerPersonId: r.ownerPersonId,
  lastOpenedAt: r.lastOpenedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

/** Saved report views: filters only, never data, so a view can never show stale numbers. */
@Injectable()
export class SavedViewsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  private assertCanRead(actor: RequestActor): void {
    this.policy.assert(
      actor,
      'report.read',
      { kind: 'tenant', tenantId: actor.tenantId },
      'reports',
    );
  }

  async listInTx(tx: Tx, actor: RequestActor): Promise<SavedReportView[]> {
    const rows = await tx
      .select()
      .from(reportSavedViews)
      .where(
        actor.personId
          ? or(
              eq(reportSavedViews.ownerPersonId, actor.personId),
              isNull(reportSavedViews.ownerPersonId),
            )
          : isNull(reportSavedViews.ownerPersonId),
      )
      .orderBy(desc(reportSavedViews.favourite), desc(reportSavedViews.createdAt));
    return rows.map(toView);
  }

  list(actor: RequestActor): Promise<{ items: SavedReportView[] }> {
    this.assertCanRead(actor);
    return withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => ({
        items: await this.listInTx(tx, actor),
      }),
    );
  }

  create(
    actor: RequestActor,
    body: CreateSavedViewRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<SavedReportView>> {
    this.assertCanRead(actor);
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'createSavedView',
        request: body,
        status: 201,
      },
      async (tx) => {
        const [row] = await tx
          .insert(reportSavedViews)
          .values({
            tenantId: actor.tenantId,
            reportId: body.reportId,
            name: body.name,
            filters: body.filters,
            favourite: body.favourite ?? false,
            ownerPersonId: actor.personId,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'report.view_saved',
          resourceType: 'report_saved_view',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: { reportId: body.reportId, name: body.name, filters: body.filters },
        });
        return toView(row);
      },
    );
  }

  remove(
    actor: RequestActor,
    viewId: string,
    ctx: CommandContext,
  ): Promise<CommandResult<{ items: SavedReportView[] }>> {
    this.assertCanRead(actor);
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'deleteSavedView',
        request: { viewId },
        status: 200,
      },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(reportSavedViews)
          .where(eq(reportSavedViews.id, viewId));
        if (!row) throw ApiProblem.notFound('saved view');
        if (row.ownerPersonId && row.ownerPersonId !== actor.personId)
          throw ApiProblem.forbidden(
            'A saved view can only be deleted by the person who saved it.',
          );
        await tx
          .delete(reportSavedViews)
          .where(
            and(eq(reportSavedViews.id, viewId), eq(reportSavedViews.tenantId, actor.tenantId)),
          );
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'report.view_deleted',
          resourceType: 'report_saved_view',
          resourceId: viewId,
          requestId: ctx.requestId,
          changes: { reportId: row.reportId, name: row.name },
        });
        return { items: await this.listInTx(tx, actor) };
      },
    );
  }
}
