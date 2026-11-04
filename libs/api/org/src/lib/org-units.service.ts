import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import {
  costCenters,
  headcountSnapshotLines,
  headcountSnapshots,
  legalEntities,
  orgUnitClosure,
  orgUnits,
  orgUnitVersions,
  people,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  CreateOrgUnitRequest,
  OrgUnit,
  OrgUnitChangeRequest,
  OrgUnitDetail,
} from '@bf/contracts';
import {
  activeOn,
  dayBefore,
  validateEffectiveDate,
  validateNoCycle,
  validateParentKind,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  ancestorsOf,
  descendantsOf,
  OrgReads,
  todayUtc,
  type UnitAsOf,
  type UnitMap,
} from './org-reads';

export interface CommandContext {
  idempotencyKey: string;
  requestId: string | null;
}

/** A unit change applied inside a command (no audit; the caller writes one audit event). */
export interface AppliedChange {
  unitId: string;
  changes: Record<string, { from: unknown; to: unknown }>;
}

@Injectable()
export class OrgUnitsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: OrgReads,
    private readonly audit: AuditService,
  ) {}

  list(actor: RequestActor, asOf = todayUtc()) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const view = await this.reads.view(tx, actor, asOf);
      const visible = [...view.units.values()].filter((u) => view.canSee(u.id));
      const counts = await this.reads.peopleCounts(tx, asOf);
      const names = await this.reads.personNames(
        tx,
        visible.map((u) => u.managerPersonId),
      );
      const items = visible
        .map((u) => this.reads.toDto(actor, view, u, counts, names))
        .sort(
          (a, b) => a.depth - b.depth || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        );
      return { asOf, scope: view.scope, items: treeOrder(items) };
    });
  }

  get(actor: RequestActor, id: string, asOf = todayUtc()): Promise<OrgUnitDetail> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.detail(tx, actor, id, asOf),
    );
  }

  async detail(tx: Tx, actor: RequestActor, id: string, asOf: string): Promise<OrgUnitDetail> {
    const versions = await tx
      .select()
      .from(orgUnitVersions)
      .where(eq(orgUnitVersions.orgUnitId, id))
      .orderBy(desc(orgUnitVersions.validFrom));
    if (!versions.length) throw ApiProblem.notFound('org unit');
    // Outside the unit's lifetime, show the closest version so history stays readable.
    const shown =
      versions.find((v) => activeOn(v, asOf)) ??
      versions.find((v) => v.validFrom <= asOf) ??
      versions[versions.length - 1];
    const readDate = activeOn(shown, asOf) ? asOf : shown.validFrom;
    const view = await this.reads.view(tx, actor, readDate);
    if (!view.canSee(id)) throw ApiProblem.notFound('org unit');
    const unit = view.units.get(id)!;
    const children = [...view.units.values()].filter((u) => u.parentId === id && view.canSee(u.id));
    const counts = await this.reads.peopleCounts(tx, readDate);
    const names = await this.reads.personNames(tx, [
      ...versions.map((v) => v.managerPersonId),
      ...children.map((c) => c.managerPersonId),
    ]);
    const parentNames = new Map<string, string>();
    for (const v of versions) {
      if (v.parentId && !parentNames.has(v.parentId)) {
        const at = await this.reads.unitsAsOf(tx, v.validFrom);
        parentNames.set(
          v.parentId,
          at.get(v.parentId)?.name ?? view.units.get(v.parentId)?.name ?? '',
        );
      }
    }
    const ccs = await tx
      .select({ id: costCenters.id, code: costCenters.code, name: costCenters.name })
      .from(costCenters)
      .where(
        and(
          eq(costCenters.orgUnitId, id),
          lte(costCenters.validFrom, readDate),
          or(isNull(costCenters.validTo), gte(costCenters.validTo, readDate)),
        ),
      )
      .orderBy(asc(costCenters.code));
    return {
      ...this.reads.toDto(actor, view, unit, counts, names),
      asOf: readDate,
      versions: versions.map((v) => ({
        validFrom: v.validFrom,
        validTo: v.validTo,
        changeKind: v.changeKind,
        name: v.name,
        parentId: v.parentId,
        parentName: v.parentId ? (parentNames.get(v.parentId) ?? null) : null,
        managerPersonId: v.managerPersonId,
        managerName: v.managerPersonId ? (names.get(v.managerPersonId) ?? null) : null,
        legalEntityId: v.legalEntityId,
        timezone: v.timezone,
        reason: v.reason,
        createdAt: v.createdAt.toISOString(),
      })),
      children: children
        .map((c) => this.reads.toDto(actor, view, c, counts, names))
        .sort((a, b) => a.name.localeCompare(b.name)),
      costCenters: ccs,
      headcount: await this.headcountFor(tx, view.units, id, readDate),
    };
  }

  /** Latest snapshot on or before the date, summed over the unit and every unit below it. */
  private async headcountFor(tx: Tx, units: UnitMap, id: string, asOf: string) {
    const [snap] = await tx
      .select()
      .from(headcountSnapshots)
      .where(lte(headcountSnapshots.asOfDate, asOf))
      .orderBy(desc(headcountSnapshots.asOfDate), desc(headcountSnapshots.createdAt))
      .limit(1);
    if (!snap) return null;
    const subtree = [id, ...descendantsOf(units, id).keys()];
    const lines = await tx
      .select()
      .from(headcountSnapshotLines)
      .where(
        and(
          eq(headcountSnapshotLines.snapshotId, snap.id),
          inArray(headcountSnapshotLines.orgUnitId, subtree),
        ),
      );
    const byType = { employee: 0, contractor: 0, intern: 0 };
    for (const l of lines) byType[l.employmentType] += l.headcount;
    return {
      asOfDate: snap.asOfDate,
      total: byType.employee + byType.contractor + byType.intern,
      byType,
    };
  }

  create(
    actor: RequestActor,
    req: CreateOrgUnitRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<OrgUnitDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'org.units.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        const units = await this.reads.unitsAsOf(tx, req.effectiveFrom);
        if (req.parentId) {
          if (!units.has(req.parentId)) {
            await this.assertParentVisible(tx, actor, req.parentId);
            throw new ApiProblem(
              422,
              'VALIDATION_FAILED',
              `The parent unit is not active on ${req.effectiveFrom}.`,
              { field: 'parentId' },
            );
          }
          this.policy.assert(
            actor,
            'org.manage',
            this.reads.resource(actor, units, req.parentId),
            'parent unit',
          );
        } else {
          this.policy.assert(actor, 'org.manage', { kind: 'tenant', tenantId: actor.tenantId });
        }
        const id = await this.createUnitTx(tx, actor, units, {
          code: req.code,
          name: req.name,
          kind: req.kind,
          parentId: req.parentId,
          legalEntityId: req.legalEntityId ?? null,
          timezone: req.timezone ?? null,
          managerPersonId: req.managerPersonId ?? null,
          effectiveFrom: req.effectiveFrom,
          reason: req.reason ?? null,
        });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'org_unit.created',
          resourceType: 'org_unit',
          resourceId: id,
          legalEntityId: units.get(id)?.legalEntityId ?? null,
          requestId: ctx.requestId,
          reason: req.reason ?? null,
          changes: {
            code: { from: null, to: req.code },
            name: { from: null, to: req.name },
            kind: { from: null, to: req.kind },
            parentId: { from: null, to: req.parentId },
            effectiveFrom: { from: null, to: req.effectiveFrom },
          },
        });
        return this.detail(tx, actor, id, req.effectiveFrom);
      },
    );
  }

  change(
    actor: RequestActor,
    id: string,
    req: OrgUnitChangeRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<OrgUnitDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `org.units.change:${id}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const [locked] = await tx.select().from(orgUnits).where(eq(orgUnits.id, id)).for('update');
        if (!locked) throw ApiProblem.notFound('org unit');
        const today = await this.reads.unitsAsOf(tx, todayUtc());
        const units = await this.reads.unitsAsOf(tx, req.effectiveFrom);
        const scopeMap = today.has(id) ? today : units;
        if (!scopeMap.has(id)) {
          const visible = this.policy.can(actor, 'org.read', {
            kind: 'org-unit',
            tenantId: actor.tenantId,
            id,
            ancestorIds: [id],
          }).allowed;
          if (!visible) throw ApiProblem.notFound('org unit');
        } else {
          this.policy.assert(
            actor,
            'org.manage',
            this.reads.resource(actor, scopeMap, id),
            'org unit',
          );
        }
        if (req.parentId) {
          const target = units.has(req.parentId) ? units : today;
          if (target.has(req.parentId)) {
            this.policy.assert(
              actor,
              'org.manage',
              this.reads.resource(actor, target, req.parentId),
              'new parent unit',
            );
          }
        }
        const applied = await this.changeUnitTx(tx, actor, units, id, {
          effectiveFrom: req.effectiveFrom,
          name: req.name,
          parentId: req.parentId,
          managerPersonId: req.managerPersonId,
          deactivate: req.deactivate === true,
          reason: req.reason,
        });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: req.deactivate ? 'org_unit.deactivated' : 'org_unit.changed',
          resourceType: 'org_unit',
          resourceId: id,
          legalEntityId: locked.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: { ...applied.changes, effectiveFrom: { from: null, to: req.effectiveFrom } },
        });
        return this.detail(
          tx,
          actor,
          id,
          req.deactivate ? dayBefore(req.effectiveFrom) : req.effectiveFrom,
        );
      },
    );
  }

  private async assertParentVisible(tx: Tx, actor: RequestActor, parentId: string): Promise<void> {
    const today = await this.reads.unitsAsOf(tx, todayUtc());
    const visible =
      today.has(parentId) &&
      this.policy.can(actor, 'org.read', this.reads.resource(actor, today, parentId)).allowed;
    if (!visible) throw ApiProblem.notFound('parent unit');
  }

  /** Creates a unit, its first version and its closure rows; adds it to `units` (as of the effective date). */
  async createUnitTx(
    tx: Tx,
    actor: RequestActor,
    units: UnitMap,
    input: {
      code: string;
      name: string;
      kind: UnitAsOf['kind'];
      parentId: string | null;
      legalEntityId: string | null;
      timezone: string | null;
      managerPersonId: string | null;
      effectiveFrom: string;
      reason: string | null;
      changeKind?: string;
    },
  ): Promise<string> {
    unwrap(validateEffectiveDate(input.effectiveFrom, null));
    const parent = input.parentId ? units.get(input.parentId) : undefined;
    if (input.parentId && !parent) {
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        `The parent unit is not active on ${input.effectiveFrom}.`,
        { field: 'parentId' },
      );
    }
    unwrap(validateParentKind(input.kind, parent?.kind ?? null));
    const [dup] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(eq(orgUnits.code, input.code));
    if (dup) {
      throw new ApiProblem(
        409,
        'DUPLICATE_CODE',
        `An org unit with code ${input.code} already exists.`,
        {
          code: input.code,
        },
      );
    }
    if (input.legalEntityId) {
      const [le] = await tx
        .select({ id: legalEntities.id })
        .from(legalEntities)
        .where(eq(legalEntities.id, input.legalEntityId));
      if (!le)
        throw new ApiProblem(422, 'VALIDATION_FAILED', 'The legal entity does not exist.', {
          field: 'legalEntityId',
        });
    }
    if (input.managerPersonId)
      await this.assertPerson(tx, input.managerPersonId, 'managerPersonId');
    const id = randomUUID();
    const legalEntityId = input.legalEntityId ?? parent?.legalEntityId ?? null;
    const timezone = input.timezone ?? parent?.timezone ?? null;
    await tx.insert(orgUnits).values({
      id,
      tenantId: actor.tenantId,
      kind: input.kind,
      code: input.code,
      name: input.name,
      parentId: input.parentId,
      legalEntityId,
      timezone,
      managerPersonId: input.managerPersonId,
      validFrom: input.effectiveFrom,
    });
    await tx.insert(orgUnitVersions).values({
      tenantId: actor.tenantId,
      orgUnitId: id,
      name: input.name,
      parentId: input.parentId,
      managerPersonId: input.managerPersonId,
      legalEntityId,
      timezone,
      changeKind: input.changeKind ?? 'created',
      reason: input.reason,
      validFrom: input.effectiveFrom,
      createdBy: actor.personId,
    });
    const ancestors = input.parentId ? ancestorsOf(units, input.parentId) : [];
    await tx.insert(orgUnitClosure).values(
      [...ancestors, id].map((a, i, all) => ({
        tenantId: actor.tenantId,
        ancestorId: a,
        descendantId: id,
        depth: all.length - 1 - i,
        validFrom: input.effectiveFrom,
      })),
    );
    units.set(id, {
      id,
      code: input.code,
      kind: input.kind,
      name: input.name,
      parentId: input.parentId,
      managerPersonId: input.managerPersonId,
      legalEntityId,
      timezone,
      validFrom: input.effectiveFrom,
      validTo: null,
      versionFrom: input.effectiveFrom,
    });
    return id;
  }

  /**
   * Applies an effective-dated change: closes the version in force the day before and appends the
   * new one; a move also re-links the closure rows of the whole subtree from the effective date.
   * `units` must be the as-of map for the effective date; it is updated in place.
   */
  async changeUnitTx(
    tx: Tx,
    actor: RequestActor,
    units: UnitMap,
    id: string,
    input: {
      effectiveFrom: string;
      name?: string;
      parentId?: string;
      managerPersonId?: string | null;
      deactivate?: boolean;
      reason: string;
    },
  ): Promise<AppliedChange> {
    const D = input.effectiveFrom;
    const versions = await tx
      .select()
      .from(orgUnitVersions)
      .where(eq(orgUnitVersions.orgUnitId, id))
      .orderBy(desc(orgUnitVersions.validFrom));
    const latest = versions[0];
    if (!latest) throw ApiProblem.notFound('org unit');
    unwrap(validateEffectiveDate(D, latest.validFrom, latest.validTo));
    const current = units.get(id);
    if (!current) {
      throw new ApiProblem(409, 'EFFECTIVE_DATE_CONFLICT', `The unit is not active on ${D}.`, {
        effectiveFrom: D,
      });
    }
    const subtree = descendantsOf(units, id);
    const subtreeIds = [...subtree.keys()];
    if (subtreeIds.length) {
      const later = await tx
        .select({ id: orgUnitVersions.orgUnitId, from: orgUnitVersions.validFrom })
        .from(orgUnitVersions)
        .where(
          and(inArray(orgUnitVersions.orgUnitId, subtreeIds), gte(orgUnitVersions.validFrom, D)),
        )
        .limit(1);
      if (later.length && (input.parentId !== undefined || input.deactivate)) {
        throw new ApiProblem(
          409,
          'EFFECTIVE_DATE_CONFLICT',
          `A unit below this one already has a change effective ${later[0].from}; date this change after it.`,
          { effectiveFrom: D, latestChangeFrom: later[0].from },
        );
      }
    }
    const changes: AppliedChange['changes'] = {};
    const closeFrom = dayBefore(D);

    if (input.deactivate) {
      const activeChildren = [...units.values()].filter((u) => u.parentId === id);
      if (activeChildren.length) {
        throw new ApiProblem(
          409,
          'ORG_UNIT_HAS_CHILDREN',
          `Move or deactivate the ${activeChildren.length} unit(s) below first.`,
          { children: activeChildren.length },
        );
      }
      await tx
        .update(orgUnitVersions)
        .set({ validTo: closeFrom })
        .where(eq(orgUnitVersions.id, latest.id));
      await tx.update(orgUnits).set({ validTo: closeFrom }).where(eq(orgUnits.id, id));
      await tx
        .update(orgUnitClosure)
        .set({ validTo: closeFrom })
        .where(
          and(
            or(eq(orgUnitClosure.descendantId, id), eq(orgUnitClosure.ancestorId, id)),
            isNull(orgUnitClosure.validTo),
          ),
        );
      units.delete(id);
      changes['validTo'] = { from: null, to: closeFrom };
      return { unitId: id, changes };
    }

    const next = {
      name: input.name ?? current.name,
      parentId: input.parentId ?? current.parentId,
      managerPersonId:
        input.managerPersonId !== undefined ? input.managerPersonId : current.managerPersonId,
    };
    if (input.name !== undefined && input.name !== current.name)
      changes['name'] = { from: current.name, to: input.name };
    if (input.managerPersonId !== undefined && input.managerPersonId !== current.managerPersonId) {
      if (input.managerPersonId)
        await this.assertPerson(tx, input.managerPersonId, 'managerPersonId');
      changes['managerPersonId'] = { from: current.managerPersonId, to: input.managerPersonId };
    }
    const moving = input.parentId !== undefined && input.parentId !== current.parentId;
    if (moving) {
      const newParent = units.get(input.parentId!);
      if (!newParent) {
        throw new ApiProblem(
          422,
          'VALIDATION_FAILED',
          `The new parent unit is not active on ${D}.`,
          { field: 'parentId' },
        );
      }
      unwrap(validateNoCycle(id, newParent.id, subtreeIds));
      unwrap(validateParentKind(current.kind, newParent.kind));
      changes['parentId'] = { from: current.parentId, to: newParent.id };
    }
    if (!Object.keys(changes).length) {
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        'Nothing changes: the values are already in force.',
      );
    }

    await tx
      .update(orgUnitVersions)
      .set({ validTo: closeFrom })
      .where(eq(orgUnitVersions.id, latest.id));
    await tx.insert(orgUnitVersions).values({
      tenantId: actor.tenantId,
      orgUnitId: id,
      name: next.name,
      parentId: next.parentId,
      managerPersonId: next.managerPersonId,
      legalEntityId: current.legalEntityId,
      timezone: current.timezone,
      changeKind:
        Object.keys(changes).length > 1 ? 'updated' : CHANGE_KIND[Object.keys(changes)[0]],
      reason: input.reason,
      validFrom: D,
      createdBy: actor.personId,
    });

    if (moving) {
      const oldAncestors = ancestorsOf(units, id).slice(0, -1);
      const moved = [id, ...subtreeIds];
      if (oldAncestors.length) {
        await tx
          .update(orgUnitClosure)
          .set({ validTo: closeFrom })
          .where(
            and(
              inArray(orgUnitClosure.ancestorId, oldAncestors),
              inArray(orgUnitClosure.descendantId, moved),
              lte(orgUnitClosure.validFrom, closeFrom),
              or(isNull(orgUnitClosure.validTo), gte(orgUnitClosure.validTo, D)),
            ),
          );
      }
      const newAncestors = ancestorsOf(units, next.parentId!);
      const rows = newAncestors.flatMap((a, i) =>
        moved.map((d) => ({
          tenantId: actor.tenantId,
          ancestorId: a,
          descendantId: d,
          depth: newAncestors.length - i + (d === id ? 0 : subtree.get(d)!),
          validFrom: D,
        })),
      );
      await tx.insert(orgUnitClosure).values(rows);
    }

    if (D <= todayUtc()) {
      await tx
        .update(orgUnits)
        .set({ name: next.name, parentId: next.parentId, managerPersonId: next.managerPersonId })
        .where(eq(orgUnits.id, id));
    }
    units.set(id, { ...current, ...next, versionFrom: D });
    return { unitId: id, changes };
  }

  private async assertPerson(tx: Tx, personId: string, field: string): Promise<void> {
    const [p] = await tx.select({ id: people.id }).from(people).where(eq(people.id, personId));
    if (!p)
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'That person does not exist.', { field });
  }
}

const CHANGE_KIND: Record<string, string> = {
  name: 'renamed',
  parentId: 'moved',
  managerPersonId: 'manager',
};

/** Depth-first order so every unit follows its parent (roots: units whose parent is not in the list). */
function treeOrder(items: OrgUnit[]): OrgUnit[] {
  const ids = new Set(items.map((i) => i.id));
  const children = new Map<string | null, OrgUnit[]>();
  for (const i of items) {
    const key = i.parentId && ids.has(i.parentId) ? i.parentId : null;
    children.set(key, [...(children.get(key) ?? []), i]);
  }
  const out: OrgUnit[] = [];
  const walk = (key: string | null) => {
    for (const c of (children.get(key) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(null);
  return out;
}
