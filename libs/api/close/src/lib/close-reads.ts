import { ApiProblem, type RequestActor, todayUtc } from '@bf/api/core';
import { fiscalPeriods, fiscalYears, legalEntities, people, type Tx } from '@bf/api/db';
import type { Action } from '@bf/domain';
import { PolicyService } from '@bf/api/core';
import { Injectable } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';

export interface CommandContext {
  idempotencyKey: string;
  requestId: string | null;
}

export type PeriodRow = typeof fiscalPeriods.$inferSelect;
export type FiscalYearRow = typeof fiscalYears.$inferSelect;
export type LegalEntityRow = typeof legalEntities.$inferSelect;

/**
 * Re-exported so this module's callers keep their existing import, with one implementation
 * behind it: `@bf/api/core` owns the clock, which a test run can pin (`FIXED_NOW`).
 */
export { todayUtc };

export const tenantOf = (actor: RequestActor) => ({
  kind: 'tenant' as const,
  tenantId: actor.tenantId,
});

/** Period close and year-end are tenant-wide finance work: every check is at tenant scope. */
export function assertTenant(policy: PolicyService, actor: RequestActor, action: Action): void {
  policy.assert(actor, action, tenantOf(actor));
}

/** Shared reads for the close checklist and the year-end run. */
@Injectable()
export class CloseReads {
  async period(tx: Tx, id: string, lock = false): Promise<PeriodRow> {
    const q = tx.select().from(fiscalPeriods).where(eq(fiscalPeriods.id, id));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw ApiProblem.notFound('accounting period');
    return row;
  }

  /** Every period of the period's calendar, in date order (the sequencing rules need them all). */
  calendarPeriods(tx: Tx, calendarId: string, lock = false) {
    const q = tx
      .select()
      .from(fiscalPeriods)
      .where(eq(fiscalPeriods.fiscalCalendarId, calendarId))
      .orderBy(asc(fiscalPeriods.startDate));
    return lock ? q.for('update') : q;
  }

  async fiscalYear(tx: Tx, id: string): Promise<FiscalYearRow> {
    const [row] = await tx.select().from(fiscalYears).where(eq(fiscalYears.id, id));
    if (!row) throw ApiProblem.notFound('fiscal year');
    return row;
  }

  /** Entities whose fiscal calendar the period belongs to: the checklist has one row per entity. */
  entitiesOfPeriod(tx: Tx, period: PeriodRow): Promise<LegalEntityRow[]> {
    return tx
      .select()
      .from(legalEntities)
      .where(eq(legalEntities.fiscalCalendarId, period.fiscalCalendarId))
      .orderBy(asc(legalEntities.code));
  }

  async names(tx: Tx, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (!unique.length) return new Map();
    const rows = await tx
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(inArray(people.id, unique));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
