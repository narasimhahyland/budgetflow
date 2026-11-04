import { PolicyService, type RequestActor } from '@bf/api/core';
import { orgUnits, orgUnitVersions, people, type Tx } from '@bf/api/db';
import type { OrgUnit } from '@bf/contracts';
import type { Action, OrgUnitKind, Resource } from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';

/** An org unit as of one date: identity from `org_units`, attributes from the version in force. */
export interface UnitAsOf {
  id: string;
  code: string;
  kind: OrgUnitKind;
  name: string;
  parentId: string | null;
  managerPersonId: string | null;
  legalEntityId: string | null;
  timezone: string | null;
  validFrom: string;
  validTo: string | null;
  versionFrom: string;
}

export type UnitMap = Map<string, UnitAsOf>;

export const todayUtc = (): string => new Date().toISOString().slice(0, 10);

/** Ancestors from the root down to `id` (inclusive), following parents in the as-of map. */
export function ancestorsOf(units: UnitMap, id: string): string[] {
  const chain: string[] = [];
  let cursor: string | null = id;
  while (cursor && !chain.includes(cursor)) {
    chain.unshift(cursor);
    cursor = units.get(cursor)?.parentId ?? null;
  }
  return chain;
}

/** Descendants of `id` (exclusive) with their depth below it, in the as-of map. */
export function descendantsOf(units: UnitMap, id: string): Map<string, number> {
  const children = new Map<string, string[]>();
  for (const u of units.values()) {
    if (!u.parentId) continue;
    children.set(u.parentId, [...(children.get(u.parentId) ?? []), u.id]);
  }
  const out = new Map<string, number>();
  const walk = (parent: string, depth: number) => {
    for (const c of children.get(parent) ?? []) {
      if (out.has(c)) continue;
      out.set(c, depth);
      walk(c, depth + 1);
    }
  };
  walk(id, 1);
  return out;
}

/** What one actor may see of the org on one date, decided by PolicyService for every unit. */
export interface OrgView {
  scope: 'tenant' | 'subtree' | 'self';
  units: UnitMap;
  canSee(unitId: string): boolean;
  canSeePerson(p: {
    id: string;
    locationOrgUnitId: string | null;
    orgUnitId: string | null;
  }): boolean;
  unitResource(unitId: string): Resource;
}

@Injectable()
export class OrgReads {
  constructor(private readonly policy: PolicyService) {}

  async unitsAsOf(tx: Tx, asOf: string): Promise<UnitMap> {
    const rows = await tx
      .select({
        id: orgUnits.id,
        code: orgUnits.code,
        kind: orgUnits.kind,
        validFrom: orgUnits.validFrom,
        validTo: orgUnits.validTo,
        name: orgUnitVersions.name,
        parentId: orgUnitVersions.parentId,
        managerPersonId: orgUnitVersions.managerPersonId,
        legalEntityId: orgUnitVersions.legalEntityId,
        timezone: orgUnitVersions.timezone,
        versionFrom: orgUnitVersions.validFrom,
      })
      .from(orgUnitVersions)
      .innerJoin(orgUnits, eq(orgUnits.id, orgUnitVersions.orgUnitId))
      .where(
        and(
          lte(orgUnitVersions.validFrom, asOf),
          or(isNull(orgUnitVersions.validTo), gte(orgUnitVersions.validTo, asOf)),
        ),
      );
    return new Map(rows.map((r) => [r.id, r]));
  }

  resource(actor: RequestActor, units: UnitMap, unitId: string): Resource {
    return {
      kind: 'org-unit',
      tenantId: actor.tenantId,
      id: unitId,
      ancestorIds: ancestorsOf(units, unitId),
    };
  }

  personResource(
    actor: RequestActor,
    units: UnitMap,
    p: { id: string; locationOrgUnitId: string | null; orgUnitId: string | null },
  ): Resource {
    const ancestorIds = [
      ...new Set([
        ...(p.locationOrgUnitId ? ancestorsOf(units, p.locationOrgUnitId) : []),
        ...(p.orgUnitId ? ancestorsOf(units, p.orgUnitId) : []),
      ]),
    ];
    return { kind: 'person', tenantId: actor.tenantId, personId: p.id, ancestorIds };
  }

  /** Whether `action` is granted over the whole tenant (a unit with no ancestors is covered only by tenant scope). */
  tenantWide(actor: RequestActor, action: Action): boolean {
    return this.policy.can(actor, action, {
      kind: 'org-unit',
      tenantId: actor.tenantId,
      id: '00000000-0000-4000-8000-000000000000',
      ancestorIds: [],
    }).allowed;
  }

  async view(tx: Tx, actor: RequestActor, asOf: string): Promise<OrgView> {
    const units = await this.unitsAsOf(tx, asOf);
    const unitResource = (id: string) => this.resource(actor, units, id);
    const tenant = this.tenantWide(actor, 'org.read');
    const visible = new Set(
      tenant
        ? units.keys()
        : [...units.keys()].filter(
            (id) => this.policy.can(actor, 'org.read', unitResource(id)).allowed,
          ),
    );
    const home = actor.homeOrgUnitIds ?? [];
    const scope = tenant
      ? 'tenant'
      : [...visible].some((id) => !home.includes(id))
        ? 'subtree'
        : 'self';
    return {
      scope,
      units,
      canSee: (id) => visible.has(id),
      canSeePerson: (p) =>
        tenant || this.policy.can(actor, 'org.read', this.personResource(actor, units, p)).allowed,
      unitResource,
    };
  }

  /** People counts per unit (location or team), for people active on the date. */
  async peopleCounts(tx: Tx, asOf: string): Promise<Map<string, number>> {
    const rows = await tx.execute<{ unit_id: string; n: number }>(sql`
      select unit_id, count(*)::int as n from (
        select ${people.locationOrgUnitId} as unit_id from ${people}
          where ${people.locationOrgUnitId} is not null and (${people.startDate} is null or ${people.startDate} <= ${asOf})
            and (${people.endDate} is null or ${people.endDate} >= ${asOf})
        union all
        select ${people.orgUnitId} from ${people}
          where ${people.orgUnitId} is not null and (${people.startDate} is null or ${people.startDate} <= ${asOf})
            and (${people.endDate} is null or ${people.endDate} >= ${asOf})
      ) x group by unit_id`);
    return new Map(rows.rows.map((r) => [r.unit_id, r.n]));
  }

  async personNames(tx: Tx, ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (!wanted.length) return new Map();
    const rows = await tx
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(inArray(people.id, wanted));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  toDto(
    actor: RequestActor,
    view: OrgView,
    u: UnitAsOf,
    counts: Map<string, number>,
    names: Map<string, string>,
  ): OrgUnit {
    const ancestorIds = ancestorsOf(view.units, u.id);
    return {
      id: u.id,
      code: u.code,
      kind: u.kind,
      name: u.name,
      parentId: u.parentId,
      ancestorIds,
      depth: ancestorIds.length - 1,
      legalEntityId: u.legalEntityId,
      timezone: u.timezone,
      managerPersonId: u.managerPersonId,
      managerName: u.managerPersonId ? (names.get(u.managerPersonId) ?? null) : null,
      validFrom: u.validFrom,
      validTo: u.validTo,
      peopleCount: counts.get(u.id) ?? 0,
      allowedActions: this.policy.can(actor, 'org.manage', view.unitResource(u.id)).allowed
        ? ['org.manage']
        : [],
    };
  }
}
