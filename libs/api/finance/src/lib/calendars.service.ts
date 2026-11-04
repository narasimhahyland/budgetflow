import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  unwrap,
  type RequestActor,
} from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import {
  exchangeRates,
  fiscalCalendars,
  fiscalPeriods,
  fiscalYears,
  legalEntities,
  people,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type { CalendarDefinition, FiscalCalendarDetail, FiscalPeriod } from '@bf/contracts';
import {
  allowedPeriodEvents,
  changePeriodStatus,
  generateFiscalYear,
  mapToGroupYear,
  parseIsoDate,
  type FiscalCalendarDefinition,
  type PeriodEvent,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { assertTenant, invalid, tenantOf, type CommandContext } from './finance-base';

type CalendarRow = typeof fiscalCalendars.$inferSelect;
type YearRow = typeof fiscalYears.$inferSelect;
type PeriodRow = typeof fiscalPeriods.$inferSelect;

const WEEKLY = ['4-4-5', '4-5-4', '5-4-4', '13-period'];
const days = (start: string, end: string) =>
  Math.round((parseIsoDate(end) - parseIsoDate(start)) / 86_400_000) + 1;

/** Validated engine definition from the API shape (each calendar type needs its own fields). */
function toEngine(def: CalendarDefinition): FiscalCalendarDefinition {
  if (def.type === 'calendar_year')
    return { type: 'calendar_year', startMonth: 1, labelBy: def.labelBy ?? 'end' };
  if (def.type === 'non_calendar') {
    if (def.startMonth === undefined)
      throw invalid('definition.startMonth', 'A non-calendar year needs a start month.');
    return { type: 'non_calendar', startMonth: def.startMonth, labelBy: def.labelBy ?? 'end' };
  }
  if (def.endMonth === undefined || def.endWeekday === undefined)
    throw invalid('definition.endMonth', 'A weekly calendar needs a year-end month and weekday.');
  return {
    type: def.type,
    endMonth: def.endMonth,
    endWeekday: def.endWeekday,
    method: def.method ?? 'last',
  };
}

function fromRow(c: CalendarRow): CalendarDefinition {
  if (WEEKLY.includes(c.calendarType)) {
    return {
      type: c.calendarType,
      endMonth: c.endMonth ?? 12,
      endWeekday: c.endWeekday ?? 6,
      method: (c.weekMethod as 'last' | 'nearest' | null) ?? 'last',
    };
  }
  return {
    type: c.calendarType,
    startMonth: c.startMonth ?? 1,
    labelBy: (c.labelBy as 'start' | 'end' | null) ?? 'end',
  };
}

@Injectable()
export class CalendarsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  list(actor: RequestActor) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const cals = await tx
        .select()
        .from(fiscalCalendars)
        .orderBy(asc(fiscalCalendars.createdAt), asc(fiscalCalendars.name));
      const years = await tx.select().from(fiscalYears).orderBy(asc(fiscalYears.startDate));
      const les = await tx.select().from(legalEntities).orderBy(asc(legalEntities.code));
      return { items: cals.map((c) => this.summary(c, cals, years, les)) };
    });
  }

  get(actor: RequestActor, id: string) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      return this.detail(tx, actor, id);
    });
  }

  preview(actor: RequestActor, req: { definition: CalendarDefinition; year: number }) {
    assertTenant(this.policy, actor, 'tenant.read');
    const fy = unwrap(generateFiscalYear(toEngine(req.definition), req.year));
    return {
      label: fy.label,
      startDate: fy.startDate,
      endDate: fy.endDate,
      weeks: fy.weeks,
      days: days(fy.startDate, fy.endDate),
      periods: fy.periods.map((p) => ({ ...p, days: days(p.startDate, p.endDate) })),
    };
  }

  create(
    actor: RequestActor,
    req: {
      name: string;
      definition: CalendarDefinition;
      groupCalendarId?: string;
      years: number[];
    },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'finance.calendars.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        assertTenant(this.policy, actor, 'period.manage');
        const def = toEngine(req.definition);
        if (req.groupCalendarId) {
          const [group] = await tx
            .select()
            .from(fiscalCalendars)
            .where(eq(fiscalCalendars.id, req.groupCalendarId));
          if (!group) throw invalid('groupCalendarId', 'The group calendar does not exist.');
          if (group.groupCalendarId)
            throw invalid(
              'groupCalendarId',
              'Map to the group calendar itself, not to another entity calendar.',
            );
        }
        const [cal] = await tx
          .insert(fiscalCalendars)
          .values({
            tenantId: actor.tenantId,
            name: req.name,
            calendarType: def.type,
            startMonth: 'startMonth' in def ? def.startMonth : null,
            labelBy: 'labelBy' in def ? def.labelBy : null,
            endMonth: 'endMonth' in def ? def.endMonth : null,
            endWeekday: 'endWeekday' in def ? def.endWeekday : null,
            weekMethod: 'method' in def ? def.method : null,
            groupCalendarId: req.groupCalendarId ?? null,
          })
          .returning();
        for (const year of [...new Set(req.years)].sort())
          await this.generateYear(tx, actor, cal, year);
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'fiscal_calendar.created',
          resourceType: 'fiscal_calendar',
          resourceId: cal.id,
          requestId: ctx.requestId,
          changes: {
            name: { from: null, to: cal.name },
            calendarType: { from: null, to: cal.calendarType },
            years: { from: null, to: req.years },
          },
        });
        return this.detail(tx, actor, cal.id);
      },
    );
  }

  addYear(actor: RequestActor, calendarId: string, req: { year: number }, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `finance.calendars.add_year:${calendarId}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const [cal] = await tx
          .select()
          .from(fiscalCalendars)
          .where(eq(fiscalCalendars.id, calendarId))
          .for('update');
        if (!cal) throw ApiProblem.notFound('fiscal calendar');
        assertTenant(this.policy, actor, 'period.manage');
        const id = await this.generateYear(tx, actor, cal, req.year);
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'fiscal_year.created',
          resourceType: 'fiscal_year',
          resourceId: id,
          requestId: ctx.requestId,
          changes: {
            calendarId: { from: null, to: calendarId },
            year: { from: null, to: req.year },
          },
        });
        return this.detail(tx, actor, calendarId);
      },
    );
  }

  changePeriodStatus(
    actor: RequestActor,
    periodId: string,
    req: { action: PeriodEvent; reason?: string },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `finance.periods.status:${periodId}`,
        request: req,
        status: 201,
      },
      async (tx): Promise<FiscalPeriod> => {
        const [period] = await tx
          .select()
          .from(fiscalPeriods)
          .where(eq(fiscalPeriods.id, periodId))
          .for('update');
        if (!period) throw ApiProblem.notFound('accounting period');
        assertTenant(this.policy, actor, 'period.manage');
        const all = await tx
          .select()
          .from(fiscalPeriods)
          .where(eq(fiscalPeriods.fiscalCalendarId, period.fiscalCalendarId))
          .for('update');
        const next = unwrap(changePeriodStatus(all, periodId, req.action, req.reason));
        const [updated] = await tx
          .update(fiscalPeriods)
          .set({ status: next, statusChangedAt: new Date(), statusChangedBy: actor.personId })
          .where(eq(fiscalPeriods.id, periodId))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: `period.${req.action}`,
          resourceType: 'fiscal_period',
          resourceId: periodId,
          requestId: ctx.requestId,
          reason: req.reason ?? null,
          changes: {
            status: { from: period.status, to: next },
            label: { from: null, to: period.label },
          },
        });
        const after = all.map((p) => (p.id === periodId ? updated : p));
        return this.periodDto(actor, updated, after, await this.changerNames(tx, [updated]));
      },
    );
  }

  lockPlanRates(
    actor: RequestActor,
    fiscalYearId: string,
    req: { reason: string },
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `finance.fiscal_years.lock_plan_rates:${fiscalYearId}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const [fy] = await tx
          .select()
          .from(fiscalYears)
          .where(eq(fiscalYears.id, fiscalYearId))
          .for('update');
        if (!fy) throw ApiProblem.notFound('fiscal year');
        assertTenant(this.policy, actor, 'fx.manage');
        if (fy.planRatesLockedAt)
          throw new ApiProblem(
            409,
            'PLAN_RATE_LOCKED',
            `${fy.label} plan rates are already locked.`,
            {
              fiscalYear: fy.label,
            },
          );
        const now = new Date();
        await tx
          .update(fiscalYears)
          .set({ planRatesLockedAt: now })
          .where(eq(fiscalYears.id, fy.id));
        const locked = await tx
          .update(exchangeRates)
          .set({ locked: true, lockedAt: now })
          .where(and(eq(exchangeRates.fiscalYearId, fy.id), eq(exchangeRates.rateType, 'plan')))
          .returning({ id: exchangeRates.id });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'fiscal_year.plan_rates_locked',
          resourceType: 'fiscal_year',
          resourceId: fy.id,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            planRatesLockedAt: { from: null, to: now.toISOString() },
            lockedRates: { from: null, to: locked.map((r) => r.id) },
          },
        });
        return {
          fiscalYearId: fy.id,
          fiscalYearLabel: fy.label,
          planRatesLockedAt: now.toISOString(),
          lockedRates: locked.length,
        };
      },
    );
  }

  private async generateYear(
    tx: Tx,
    actor: RequestActor,
    cal: CalendarRow,
    year: number,
  ): Promise<string> {
    const fy = unwrap(generateFiscalYear(toEngine(fromRow(cal)), year));
    const existing = await tx
      .select({ id: fiscalYears.id })
      .from(fiscalYears)
      .where(and(eq(fiscalYears.fiscalCalendarId, cal.id), eq(fiscalYears.label, fy.label)));
    if (existing.length)
      throw new ApiProblem(409, 'DUPLICATE_CODE', `${fy.label} already exists in ${cal.name}.`, {
        year,
      });
    let groupFiscalYearId: string | null = null;
    if (cal.groupCalendarId) {
      const groupYears = await tx
        .select()
        .from(fiscalYears)
        .where(eq(fiscalYears.fiscalCalendarId, cal.groupCalendarId));
      groupFiscalYearId = mapToGroupYear(fy, groupYears)?.id ?? null;
    }
    const [row] = await tx
      .insert(fiscalYears)
      .values({
        tenantId: actor.tenantId,
        fiscalCalendarId: cal.id,
        label: fy.label,
        startDate: fy.startDate,
        endDate: fy.endDate,
        groupFiscalYearId,
      })
      .returning();
    await tx.insert(fiscalPeriods).values(
      fy.periods.map((p) => ({
        tenantId: actor.tenantId,
        fiscalYearId: row.id,
        fiscalCalendarId: cal.id,
        periodNumber: p.number,
        label: p.label,
        startDate: p.startDate,
        endDate: p.endDate,
        status: 'open' as const,
      })),
    );
    return row.id;
  }

  private async detail(tx: Tx, actor: RequestActor, id: string): Promise<FiscalCalendarDetail> {
    const cals = await tx.select().from(fiscalCalendars);
    const cal = cals.find((c) => c.id === id);
    if (!cal) throw ApiProblem.notFound('fiscal calendar');
    const years = await tx.select().from(fiscalYears).orderBy(asc(fiscalYears.startDate));
    const les = await tx.select().from(legalEntities).orderBy(asc(legalEntities.code));
    const periods = await tx
      .select()
      .from(fiscalPeriods)
      .where(eq(fiscalPeriods.fiscalCalendarId, id))
      .orderBy(asc(fiscalPeriods.startDate));
    const labels = new Map(years.map((y) => [y.id, y.label]));
    const weekly = WEEKLY.includes(cal.calendarType);
    const names = await this.changerNames(tx, periods);
    return {
      ...this.summary(cal, cals, years, les),
      fiscalYears: years
        .filter((y) => y.fiscalCalendarId === id)
        .map((y) => ({
          id: y.id,
          label: y.label,
          startDate: y.startDate,
          endDate: y.endDate,
          weeks: weekly ? Math.round(days(y.startDate, y.endDate) / 7) : null,
          groupFiscalYearId: y.groupFiscalYearId,
          groupFiscalYearLabel: y.groupFiscalYearId
            ? (labels.get(y.groupFiscalYearId) ?? null)
            : null,
          planRatesLockedAt: y.planRatesLockedAt?.toISOString() ?? null,
          periods: periods
            .filter((p) => p.fiscalYearId === y.id)
            .map((p) => this.periodDto(actor, p, periods, names)),
        })),
    };
  }

  private summary(
    cal: CalendarRow,
    cals: CalendarRow[],
    years: YearRow[],
    les: (typeof legalEntities.$inferSelect)[],
  ) {
    return {
      id: cal.id,
      name: cal.name,
      definition: fromRow(cal),
      groupCalendarId: cal.groupCalendarId,
      groupCalendarName: cal.groupCalendarId
        ? (cals.find((c) => c.id === cal.groupCalendarId)?.name ?? null)
        : null,
      legalEntities: les
        .filter((l) => l.fiscalCalendarId === cal.id)
        .map((l) => ({ id: l.id, code: l.code, name: l.name })),
      years: years
        .filter((y) => y.fiscalCalendarId === cal.id)
        .map((y) => ({ id: y.id, label: y.label, startDate: y.startDate, endDate: y.endDate })),
    };
  }

  private async changerNames(tx: Tx, periods: PeriodRow[]): Promise<Map<string, string>> {
    const ids = [
      ...new Set(periods.map((p) => p.statusChangedBy).filter((i): i is string => Boolean(i))),
    ];
    if (!ids.length) return new Map();
    const rows = await tx
      .select({ id: people.id, name: people.displayName })
      .from(people)
      .where(inArray(people.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private periodDto(
    actor: RequestActor,
    p: PeriodRow,
    calendarPeriods: PeriodRow[],
    names: Map<string, string>,
  ): FiscalPeriod {
    const manage = this.policy.can(actor, 'period.manage', tenantOf(actor)).allowed;
    return {
      id: p.id,
      fiscalYearId: p.fiscalYearId,
      periodNumber: p.periodNumber,
      label: p.label,
      startDate: p.startDate,
      endDate: p.endDate,
      status: p.status,
      statusChangedAt: p.statusChangedAt?.toISOString() ?? null,
      statusChangedByName: p.statusChangedBy ? (names.get(p.statusChangedBy) ?? null) : null,
      allowedActions: manage ? allowedPeriodEvents(calendarPeriods, p.id) : [],
    };
  }
}
