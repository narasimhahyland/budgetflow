import {
  budgetCoOwners,
  budgets,
  breakGlassGrants,
  memberships,
  people,
  roleGrants,
  tenants,
  withSubject,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type { Actor, CurrencyCode, RoleId } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { DB } from './db.module';
import { ApiProblem } from './problem';

/** The signed-in user in the selected tenant: the domain actor plus display data for /api/me. */
export interface RequestActor extends Actor {
  subject: string;
  displayName: string;
  tenantName: string;
  reportingCurrency: CurrencyCode;
  memberships: { tenantId: string; tenantName: string; roles: RoleId[] }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolves memberships, roles, owned budget subtrees and break-glass state for a Keycloak subject. */
@Injectable()
export class ActorResolver {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Roles granted to a person in the current tenant on a date (RLS applies through `tx`). */
  async rolesForPerson(tx: Tx, personId: string, date: string): Promise<RoleId[]> {
    const rows = await tx
      .selectDistinct({ role: roleGrants.role })
      .from(roleGrants)
      .innerJoin(memberships, eq(memberships.id, roleGrants.membershipId))
      .where(
        and(
          eq(memberships.personId, personId),
          eq(memberships.status, 'active'),
          lte(roleGrants.validFrom, date),
          or(isNull(roleGrants.validTo), gte(roleGrants.validTo, date)),
        ),
      );
    return rows.map((r) => r.role);
  }

  async resolve(
    subject: string,
    requestedTenantId: string | undefined,
    tokenName: string | undefined,
    today = new Date().toISOString().slice(0, 10),
  ): Promise<RequestActor> {
    const rows = await withSubject(this.db, subject, (tx) =>
      tx
        .select({
          tenantId: memberships.tenantId,
          personId: memberships.personId,
          tenantName: tenants.name,
          reportingCurrency: tenants.reportingCurrency,
          role: roleGrants.role,
          scopeOrgUnitId: roleGrants.scopeOrgUnitId,
        })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .leftJoin(
          roleGrants,
          and(
            eq(roleGrants.membershipId, memberships.id),
            lte(roleGrants.validFrom, today),
            or(isNull(roleGrants.validTo), gte(roleGrants.validTo, today)),
          ),
        )
        .where(and(eq(memberships.idpSubject, subject), eq(memberships.status, 'active'))),
    );
    const byTenant = new Map<
      string,
      {
        tenantName: string;
        reportingCurrency: string;
        personId: string | null;
        roles: RoleId[];
        scopeUnits: string[];
      }
    >();
    for (const r of rows) {
      const m = byTenant.get(r.tenantId) ?? {
        tenantName: r.tenantName,
        reportingCurrency: r.reportingCurrency,
        personId: r.personId,
        roles: [],
        scopeUnits: [],
      };
      if (r.role && !m.roles.includes(r.role)) m.roles.push(r.role);
      if (r.scopeOrgUnitId && !m.scopeUnits.includes(r.scopeOrgUnitId))
        m.scopeUnits.push(r.scopeOrgUnitId);
      byTenant.set(r.tenantId, m);
    }
    if (requestedTenantId !== undefined && !UUID.test(requestedTenantId)) {
      throw new ApiProblem(400, 'VALIDATION_FAILED', 'X-Tenant-Id must be a tenant id (UUID).');
    }
    let tenantId = requestedTenantId;
    if (!tenantId) {
      if (byTenant.size === 1) tenantId = [...byTenant.keys()][0];
      else if (byTenant.size === 0)
        throw new ApiProblem(
          403,
          'TENANT_NOT_MEMBER',
          'Your account does not belong to any BudgetFlow tenant.',
        );
      else
        throw new ApiProblem(
          400,
          'TENANT_REQUIRED',
          'You belong to several tenants: choose one with the X-Tenant-Id header.',
        );
    }
    const m = byTenant.get(tenantId);
    if (!m) throw new ApiProblem(403, 'TENANT_NOT_MEMBER', 'You are not a member of that tenant.');

    const extra = await withTenant(this.db, { tenantId, subject }, async (tx) => {
      const person = m.personId
        ? (
            await tx
              .select({
                displayName: people.displayName,
                locationOrgUnitId: people.locationOrgUnitId,
                orgUnitId: people.orgUnitId,
              })
              .from(people)
              .where(eq(people.id, m.personId))
          )[0]
        : undefined;
      const owned = m.personId
        ? await tx.execute<{ path: string; org_unit_id: string | null }>(
            sql`select ${budgets.path} as path, ${budgets.orgUnitId} as org_unit_id from ${budgets} where ${budgets.ownerPersonId} = ${m.personId}
                union select b.path, b.org_unit_id from ${budgetCoOwners} c join ${budgets} b on b.id = c.budget_id where c.person_id = ${m.personId}`,
          )
        : { rows: [] as { path: string; org_unit_id: string | null }[] };
      const now = new Date();
      const glass = await tx
        .select({ id: breakGlassGrants.id })
        .from(breakGlassGrants)
        .where(
          and(
            eq(breakGlassGrants.idpSubject, subject),
            lte(breakGlassGrants.validFromTs, now),
            gte(breakGlassGrants.validToTs, now),
          ),
        );
      const home = [person?.locationOrgUnitId, person?.orgUnitId].filter((u): u is string =>
        Boolean(u),
      );
      const ownedUnits = owned.rows
        .map((r) => r.org_unit_id)
        .filter((u): u is string => Boolean(u));
      return {
        displayName: person?.displayName,
        ownedBudgetPaths: owned.rows.map((r) => r.path),
        breakGlass: glass.length > 0,
        homeOrgUnitIds: home,
        orgScopeUnitIds: [...new Set([...m.scopeUnits, ...ownedUnits, ...home])],
      };
    });

    return {
      subject,
      tenantId,
      personId: m.personId,
      roles: m.roles,
      ownedBudgetPaths: extra.ownedBudgetPaths,
      breakGlass: extra.breakGlass,
      orgScopeUnitIds: extra.orgScopeUnitIds,
      homeOrgUnitIds: extra.homeOrgUnitIds,
      displayName: extra.displayName ?? tokenName ?? subject,
      tenantName: m.tenantName,
      reportingCurrency: m.reportingCurrency as CurrencyCode,
      memberships: [...byTenant.entries()].map(([id, v]) => ({
        tenantId: id,
        tenantName: v.tenantName,
        roles: v.roles,
      })),
    };
  }
}
