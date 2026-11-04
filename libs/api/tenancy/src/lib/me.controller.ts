import {
  fiscalCalendars,
  fiscalYears,
  orgUnits,
  people,
  tenants,
  withTenant,
  type Db,
} from '@bf/api/db';
import { CurrentActor, DB, PolicyService, type RequestActor } from '@bf/api/core';
import type { MeResponse } from '@bf/contracts';
import { ACTIONS } from '@bf/domain';
import { Controller, Get, Inject } from '@nestjs/common';
import { asc, eq, isNull } from 'drizzle-orm';

@Controller('api/me')
export class MeController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
  ) {}

  /** The caller's own identity: readable by every member, including platform operators without tenant data access. */
  @Get()
  async me(@CurrentActor() actor: RequestActor): Promise<MeResponse> {
    const ctx = { tenantId: actor.tenantId, subject: actor.subject };
    const { person, tenantTimezone, years } = await withTenant(this.db, ctx, async (tx) => {
      const [tenant] = await tx
        .select({ timezone: tenants.defaultTimezone })
        .from(tenants)
        .where(eq(tenants.id, actor.tenantId));
      const [p] = actor.personId
        ? await tx
            .select({
              email: people.email,
              jobTitle: people.jobTitle,
              timezone: people.timezone,
              locationName: orgUnits.name,
              locationTimezone: orgUnits.timezone,
            })
            .from(people)
            .leftJoin(orgUnits, eq(orgUnits.id, people.locationOrgUnitId))
            .where(eq(people.id, actor.personId))
        : [];
      const fy = await tx
        .select({
          id: fiscalYears.id,
          label: fiscalYears.label,
          startDate: fiscalYears.startDate,
          endDate: fiscalYears.endDate,
        })
        .from(fiscalYears)
        .innerJoin(fiscalCalendars, eq(fiscalCalendars.id, fiscalYears.fiscalCalendarId))
        .where(isNull(fiscalCalendars.groupCalendarId))
        .orderBy(asc(fiscalYears.startDate));
      return { person: p, tenantTimezone: tenant?.timezone ?? 'UTC', years: fy };
    });
    const tenantResource = { kind: 'tenant', tenantId: actor.tenantId } as const;
    return {
      subject: actor.subject,
      tenantId: actor.tenantId,
      tenantName: actor.tenantName,
      reportingCurrency: actor.reportingCurrency,
      personId: actor.personId,
      displayName: actor.displayName,
      roles: [...actor.roles],
      memberships: actor.memberships,
      email: person?.email ?? null,
      jobTitle: person?.jobTitle ?? null,
      locationName: person?.locationName ?? null,
      timezone: person?.timezone ?? person?.locationTimezone ?? tenantTimezone,
      tenantTimezone,
      permissions: this.policy.allowed(actor, tenantResource, ACTIONS),
      platformOperator: !this.policy.can(actor, 'tenant.read', tenantResource).allowed,
      fiscalYears: years.map((y) => ({
        id: y.id,
        label: y.label,
        startDate: String(y.startDate),
        endDate: String(y.endDate),
      })),
    };
  }
}
