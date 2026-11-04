import { DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import type { Db } from '@bf/api/db';
import { generateFiscalYear, mapToGroupYear, type FiscalCalendarDefinition } from '@bf/domain';
import {
  categoriesData,
  CALENDARS,
  existingUnitManagers,
  extraDoaLimits,
  extraRates,
  extraReasonCodes,
  glAccountsData,
  glMappingsData,
  headcountRefresh,
  hylandPeople,
  hylandReportingLines,
  managerPersonId,
  newCostCenters,
  newOrgUnits,
  newUnitManagers,
  orgUnitsData,
  periodId,
  roleUserTeams,
  seedId,
  seedPeriodStatus,
  TENANTS,
  UK_CALENDAR,
  ukFiscalYearId,
  ukLegalEntity,
  userById,
  vendorsData,
  type SeedUserId,
} from '@bf/seed';
import type { INestApplicationContext } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

const FROM = '2026-01-01';

/** Phase 3 org and finance master data (idempotent: fixed ids with ON CONFLICT DO NOTHING). */
export async function seedOrg(app: INestApplicationContext): Promise<void> {
  const db = app.get<Db>(DB);
  await db.transaction(async (tx) => {
    // UK entity calendar (4-4-5, 52/53 weeks) mapped to the group calendar.
    const def = UK_CALENDAR.def as FiscalCalendarDefinition;
    await tx
      .insert(s.fiscalCalendars)
      .values({
        id: UK_CALENDAR.id,
        tenantId: TENANTS.acme,
        name: UK_CALENDAR.name,
        calendarType: def.type,
        endMonth: UK_CALENDAR.def.endMonth,
        endWeekday: UK_CALENDAR.def.endWeekday,
        weekMethod: UK_CALENDAR.def.method,
        groupCalendarId: UK_CALENDAR.groupCalendarId,
      })
      .onConflictDoNothing();
    const groupYears = await tx
      .select()
      .from(s.fiscalYears)
      .where(eq(s.fiscalYears.fiscalCalendarId, CALENDARS.acmeGroup));
    for (const year of UK_CALENDAR.years) {
      const fy = generateFiscalYear(def, year);
      if (!fy.ok) throw new Error(fy.error.message);
      const id = ukFiscalYearId(year);
      await tx
        .insert(s.fiscalYears)
        .values({
          id,
          tenantId: TENANTS.acme,
          fiscalCalendarId: UK_CALENDAR.id,
          label: fy.value.label,
          startDate: fy.value.startDate,
          endDate: fy.value.endDate,
          groupFiscalYearId: mapToGroupYear(fy.value, groupYears)?.id ?? null,
          planRatesLockedAt: new Date('2026-01-01T00:00:00Z'),
        })
        .onConflictDoNothing();
      await tx
        .insert(s.fiscalPeriods)
        .values(
          fy.value.periods.map((p) => ({
            id: periodId(UK_CALENDAR.index, year, p.number),
            tenantId: TENANTS.acme,
            fiscalYearId: id,
            fiscalCalendarId: UK_CALENDAR.id,
            periodNumber: p.number,
            label: p.label,
            startDate: p.startDate,
            endDate: p.endDate,
            status: seedPeriodStatus(p.endDate),
          })),
        )
        .onConflictDoNothing();
    }
    await tx.insert(s.legalEntities).values(ukLegalEntity).onConflictDoNothing();

    // Org units: new rows, unit heads, effective-dated versions and closure rows for the whole tree.
    const managerOf = (id: string): string | null => {
      const role = existingUnitManagers[id];
      if (role) return userById(role).personId;
      const ref = newUnitManagers[id];
      return ref === undefined ? null : managerPersonId(ref);
    };
    await tx
      .insert(s.orgUnits)
      .values(newOrgUnits.map((u) => ({ ...u, tenantId: TENANTS.acme, validFrom: FROM })))
      .onConflictDoNothing();
    // People before managers (unit heads reference them).
    await tx
      .insert(s.costCenters)
      .values(newCostCenters.map((c) => ({ ...c, tenantId: TENANTS.acme, validFrom: FROM })))
      .onConflictDoNothing();
    await tx.insert(s.people).values(hylandPeople).onConflictDoNothing();
    for (const [role, team] of Object.entries(roleUserTeams) as [SeedUserId, string][]) {
      await tx
        .update(s.people)
        .set({ orgUnitId: team })
        .where(and(eq(s.people.id, userById(role).personId!), isNull(s.people.orgUnitId)));
    }
    await tx.insert(s.reportingLines).values(hylandReportingLines).onConflictDoNothing();

    const all = [
      ...orgUnitsData.map((u) => ({ ...u, parentId: u.parentId as string | null })),
      ...newOrgUnits.map((u) => ({
        ...u,
        tenantId: TENANTS.acme,
        parentId: u.parentId as string | null,
      })),
    ];
    for (const u of all) {
      const manager = managerOf(u.id);
      if (manager)
        await tx
          .update(s.orgUnits)
          .set({ managerPersonId: manager })
          .where(and(eq(s.orgUnits.id, u.id), isNull(s.orgUnits.managerPersonId)));
    }
    await tx
      .insert(s.orgUnitVersions)
      .values(
        all.map((u, i) => ({
          id: seedId('36000000', i + 1),
          tenantId: u.tenantId,
          orgUnitId: u.id,
          name: u.name,
          parentId: u.parentId,
          managerPersonId: managerOf(u.id),
          legalEntityId: u.legalEntityId,
          timezone: u.timezone,
          changeKind: 'created',
          validFrom: FROM,
        })),
      )
      .onConflictDoNothing();
    const closure: (typeof s.orgUnitClosure.$inferInsert)[] = [];
    newOrgUnits.forEach((unit, n) => {
      let cursor: { id: string; parentId: string | null } | undefined = unit;
      let depth = 0;
      let k = 0;
      while (cursor) {
        closure.push({
          id: seedId('34000000', 1000 + n * 10 + k++),
          tenantId: TENANTS.acme,
          ancestorId: cursor.id,
          descendantId: unit.id,
          depth,
          validFrom: FROM,
        });
        const parent: string | null = cursor.parentId;
        cursor = all.find((o) => o.id === parent);
        depth++;
      }
    });
    await tx.insert(s.orgUnitClosure).values(closure).onConflictDoNothing();

    await tx.insert(s.headcountSnapshots).values(headcountRefresh.snapshot).onConflictDoNothing();
    await tx.insert(s.headcountSnapshotLines).values(headcountRefresh.lines).onConflictDoNothing();

    await tx
      .insert(s.exchangeRates)
      .values(
        extraRates.map((r) => ({
          ...r,
          lockedAt: r.locked ? new Date('2026-01-01T00:00:00Z') : null,
        })),
      )
      .onConflictDoNothing();

    await tx.insert(s.glAccounts).values(glAccountsData).onConflictDoNothing();
    const categoryId = new Map(
      categoriesData
        .filter((c) => c.tenantId === TENANTS.acme)
        .map((c) => [c.code as string, c.id]),
    );
    await tx
      .insert(s.glMappings)
      .values(
        glMappingsData.map(({ categoryCode, ...m }) => ({
          ...m,
          categoryId: categoryId.get(categoryCode)!,
        })),
      )
      .onConflictDoNothing();
    await tx.insert(s.vendors).values(vendorsData).onConflictDoNothing();
    await tx.insert(s.reasonCodes).values(extraReasonCodes).onConflictDoNothing();
    await tx
      .insert(s.doaLimits)
      .values(extraDoaLimits as (typeof s.doaLimits.$inferInsert)[])
      .onConflictDoNothing();
  });
}
