import { ApiProblem, CommandRunner, DB, PolicyService, type RequestActor } from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import {
  costCenters,
  currencies,
  fiscalCalendars,
  legalEntities,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type { LegalEntity } from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { assertTenant, duplicate, invalid, tenantOf, type CommandContext } from './finance-base';

type Row = typeof legalEntities.$inferSelect;

@Injectable()
export class LegalEntitiesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  list(actor: RequestActor) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const rows = await tx.select().from(legalEntities).orderBy(asc(legalEntities.code));
      return { items: await this.toDtos(tx, actor, rows) };
    });
  }

  create(
    actor: RequestActor,
    req: {
      code: string;
      name: string;
      country: string;
      functionalCurrency: string;
      fiscalCalendarId: string;
      taxJurisdiction?: string;
      erpCompanyCode?: string;
    },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'finance.legal_entities.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        assertTenant(this.policy, actor, 'master_data.manage');
        const [dup] = await tx
          .select({ id: legalEntities.id })
          .from(legalEntities)
          .where(eq(legalEntities.code, req.code));
        if (dup) throw duplicate(`Legal entity ${req.code}`);
        const [ccy] = await tx
          .select()
          .from(currencies)
          .where(eq(currencies.code, req.functionalCurrency));
        if (!ccy)
          throw invalid('functionalCurrency', `Unknown currency ${req.functionalCurrency}.`);
        const [cal] = await tx
          .select({ id: fiscalCalendars.id })
          .from(fiscalCalendars)
          .where(eq(fiscalCalendars.id, req.fiscalCalendarId));
        if (!cal) throw invalid('fiscalCalendarId', 'The fiscal calendar does not exist.');
        const [row] = await tx
          .insert(legalEntities)
          .values({
            tenantId: actor.tenantId,
            code: req.code,
            name: req.name,
            country: req.country,
            functionalCurrency: req.functionalCurrency,
            fiscalCalendarId: req.fiscalCalendarId,
            taxJurisdiction: req.taxJurisdiction ?? null,
            erpCompanyCode: req.erpCompanyCode ?? null,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'legal_entity.created',
          resourceType: 'legal_entity',
          resourceId: row.id,
          legalEntityId: row.id,
          requestId: ctx.requestId,
          changes: {
            code: { from: null, to: row.code },
            name: { from: null, to: row.name },
            functionalCurrency: { from: null, to: row.functionalCurrency },
            fiscalCalendarId: { from: null, to: row.fiscalCalendarId },
          },
        });
        return (await this.toDtos(tx, actor, [row]))[0];
      },
    );
  }

  update(
    actor: RequestActor,
    id: string,
    req: {
      name?: string;
      taxJurisdiction?: string | null;
      erpCompanyCode?: string | null;
      reason: string;
    },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `finance.legal_entities.update:${id}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(legalEntities)
          .where(eq(legalEntities.id, id))
          .for('update');
        if (!row) throw ApiProblem.notFound('legal entity');
        assertTenant(this.policy, actor, 'master_data.manage');
        const patch: Partial<Row> = {};
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const key of ['name', 'taxJurisdiction', 'erpCompanyCode'] as const) {
          if (req[key] !== undefined && req[key] !== row[key]) {
            (patch as Record<string, unknown>)[key] = req[key];
            changes[key] = { from: row[key], to: req[key] };
          }
        }
        if (!Object.keys(changes).length)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Nothing changes: the values are already in force.',
          );
        const [updated] = await tx
          .update(legalEntities)
          .set(patch)
          .where(eq(legalEntities.id, id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'legal_entity.changed',
          resourceType: 'legal_entity',
          resourceId: id,
          legalEntityId: id,
          requestId: ctx.requestId,
          reason: req.reason,
          changes,
        });
        return (await this.toDtos(tx, actor, [updated]))[0];
      },
    );
  }

  private async toDtos(tx: Tx, actor: RequestActor, rows: Row[]): Promise<LegalEntity[]> {
    const cals = new Map(
      (
        await tx
          .select({ id: fiscalCalendars.id, name: fiscalCalendars.name })
          .from(fiscalCalendars)
      ).map((c) => [c.id, c.name]),
    );
    const counts = new Map(
      (
        await tx
          .select({ id: costCenters.legalEntityId, n: sql<number>`count(*)::int` })
          .from(costCenters)
          .groupBy(costCenters.legalEntityId)
      ).map((c) => [c.id, c.n]),
    );
    const manage = this.policy.can(actor, 'master_data.manage', tenantOf(actor)).allowed;
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      country: r.country,
      functionalCurrency: r.functionalCurrency,
      fiscalCalendarId: r.fiscalCalendarId,
      fiscalCalendarName: cals.get(r.fiscalCalendarId) ?? '',
      taxJurisdiction: r.taxJurisdiction,
      erpCompanyCode: r.erpCompanyCode,
      costCenterCount: counts.get(r.id) ?? 0,
      allowedActions: manage ? ['master_data.manage'] : [],
    }));
  }
}
