import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import { costCenters, legalEntities, withTenant, type Db, type Tx } from '@bf/api/db';
import type { CostCenter } from '@bf/contracts';
import { activeOn, dayBefore } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { OrgReads, todayUtc, type UnitMap } from './org-reads';
import type { CommandContext } from './org-units.service';

type Row = typeof costCenters.$inferSelect;

/** Cost centers: reference data every member reads; org admins and finance admins maintain them. */
@Injectable()
export class CostCentersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: OrgReads,
    private readonly audit: AuditService,
  ) {}

  list(actor: RequestActor, asOf = todayUtc()) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'tenant.read', { kind: 'tenant', tenantId: actor.tenantId });
      const rows = await tx.select().from(costCenters).orderBy(asc(costCenters.code));
      const units = await this.reads.unitsAsOf(tx, asOf);
      const les = await this.entityCodes(tx);
      return { asOf, items: rows.map((r) => this.toDto(r, units, les, asOf)) };
    });
  }

  create(
    actor: RequestActor,
    req: {
      code: string;
      name: string;
      legalEntityId: string;
      orgUnitId?: string | null;
      effectiveFrom: string;
    },
    ctx: CommandContext,
  ): Promise<CommandResult<CostCenter>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'org.cost_centers.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        this.assertManage(actor);
        const [dup] = await tx
          .select({ id: costCenters.id })
          .from(costCenters)
          .where(eq(costCenters.code, req.code));
        if (dup)
          throw new ApiProblem(409, 'DUPLICATE_CODE', `Cost center ${req.code} already exists.`, {
            code: req.code,
          });
        const les = await this.entityCodes(tx);
        if (!les.has(req.legalEntityId))
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'The legal entity does not exist.', {
            field: 'legalEntityId',
          });
        const units = await this.reads.unitsAsOf(tx, req.effectiveFrom);
        if (req.orgUnitId && !units.has(req.orgUnitId))
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            `The org unit is not active on ${req.effectiveFrom}.`,
            { field: 'orgUnitId' },
          );
        const [row] = await tx
          .insert(costCenters)
          .values({
            tenantId: actor.tenantId,
            code: req.code,
            name: req.name,
            legalEntityId: req.legalEntityId,
            orgUnitId: req.orgUnitId ?? null,
            validFrom: req.effectiveFrom,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'cost_center.created',
          resourceType: 'cost_center',
          resourceId: row.id,
          legalEntityId: row.legalEntityId,
          requestId: ctx.requestId,
          changes: {
            code: { from: null, to: row.code },
            name: { from: null, to: row.name },
            validFrom: { from: null, to: row.validFrom },
          },
        });
        return this.toDto(row, units, les, req.effectiveFrom);
      },
    );
  }

  change(
    actor: RequestActor,
    id: string,
    req: { name?: string; orgUnitId?: string | null; deactivateFrom?: string; reason: string },
    ctx: CommandContext,
  ): Promise<CommandResult<CostCenter>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `org.cost_centers.change:${id}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(costCenters)
          .where(eq(costCenters.id, id))
          .for('update');
        if (!row) throw ApiProblem.notFound('cost center');
        this.assertManage(actor);
        const units = await this.reads.unitsAsOf(tx, todayUtc());
        const patch: Partial<Row> = {};
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (req.name !== undefined && req.name !== row.name) {
          patch.name = req.name;
          changes['name'] = { from: row.name, to: req.name };
        }
        if (req.orgUnitId !== undefined && req.orgUnitId !== row.orgUnitId) {
          if (req.orgUnitId && !units.has(req.orgUnitId))
            throw new ApiProblem(422, 'VALIDATION_FAILED', 'The org unit is not active today.', {
              field: 'orgUnitId',
            });
          patch.orgUnitId = req.orgUnitId;
          changes['orgUnitId'] = { from: row.orgUnitId, to: req.orgUnitId };
        }
        if (req.deactivateFrom !== undefined) {
          if (req.deactivateFrom <= row.validFrom)
            throw new ApiProblem(
              409,
              'EFFECTIVE_DATE_CONFLICT',
              `The cost center starts ${row.validFrom}; deactivate it after that.`,
              { validFrom: row.validFrom },
            );
          if (row.validTo !== null && row.validTo < req.deactivateFrom)
            throw new ApiProblem(
              409,
              'EFFECTIVE_DATE_CONFLICT',
              `The cost center is already inactive after ${row.validTo}.`,
              { validTo: row.validTo },
            );
          patch.validTo = dayBefore(req.deactivateFrom);
          changes['validTo'] = { from: row.validTo, to: patch.validTo };
        }
        if (!Object.keys(changes).length)
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            'Nothing changes: the values are already in force.',
          );
        const [updated] = await tx
          .update(costCenters)
          .set(patch)
          .where(eq(costCenters.id, id))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: req.deactivateFrom ? 'cost_center.deactivated' : 'cost_center.changed',
          resourceType: 'cost_center',
          resourceId: id,
          legalEntityId: row.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes,
        });
        return this.toDto(updated, units, await this.entityCodes(tx), todayUtc());
      },
    );
  }

  private assertManage(actor: RequestActor): void {
    const tenant = { kind: 'tenant' as const, tenantId: actor.tenantId };
    if (
      !this.policy.can(actor, 'org.manage', tenant).allowed &&
      !this.policy.can(actor, 'master_data.manage', tenant).allowed
    )
      throw ApiProblem.forbidden();
  }

  private async entityCodes(tx: Tx): Promise<Map<string, string>> {
    const rows = await tx
      .select({ id: legalEntities.id, code: legalEntities.code })
      .from(legalEntities);
    return new Map(rows.map((r) => [r.id, r.code]));
  }

  private toDto(r: Row, units: UnitMap, les: Map<string, string>, asOf: string): CostCenter {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      legalEntityId: r.legalEntityId,
      legalEntityCode: les.get(r.legalEntityId) ?? '',
      orgUnitId: r.orgUnitId,
      orgUnitName: r.orgUnitId ? (units.get(r.orgUnitId)?.name ?? null) : null,
      validFrom: r.validFrom,
      validTo: r.validTo,
      active: activeOn(r, asOf),
    };
  }
}
