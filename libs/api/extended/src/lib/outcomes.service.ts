import { ApiProblem, DB, PolicyService, type RequestActor } from '@bf/api/core';
import {
  budgetCategories,
  budgets,
  eventParticipants,
  eventSurveyResponses,
  events,
  fiscalYears,
  headcountSnapshotLines,
  headcountSnapshots,
  orgUnits,
  people,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  OutcomeCategoryRow,
  OutcomeLinkage,
  ParticipationLeaderboard,
  ParticipationRankRow,
  RetentionBandRow,
  SuppressibleFigure,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  MIN_RANKED_GROUP,
  MIN_RETENTION_GROUP,
  MIN_SURVEY_RESPONSES,
  bps,
  iso,
  suppressible,
  todayUtc,
} from './support';

const ASSOCIATION_NOTE =
  'These figures show association, not cause. People who attend events may differ in other ways.';

/** Attendance that counts as taking part (47e). */
const ATTENDED = ['attended', 'walk_in'] as const;

interface RetentionCohort {
  band: RetentionBandRow['band'];
  label: string;
  people: number;
  stillEmployed: number;
}

/**
 * Outcome linkage (015c) and participation leaderboards (122a).
 *
 * Both are read-only and both are built to make an individual unreachable, not merely unshown:
 *
 * - Survey responses carry no person reference at all (`event_survey_responses` stores a token hash,
 *   never a person id), so a pulse figure cannot be traced back to a respondent even inside the API.
 * - Every aggregate is returned with the size of the group behind it. A group under its threshold —
 *   five responses for survey figures, ten people for retention — is suppressed: the value is
 *   dropped rather than rounded, so nothing can be reconstructed from the response.
 * - No row is ever per person. Retention is counted over cohorts; the leaderboard ranks offices and
 *   teams of at least five eligible people and never an employee.
 * - A Regional Manager sees pulse and eNPS for their region but no retention: retention stays a
 *   company and region view for People Ops and leadership.
 * - The leaderboard reads no money at all, so a location can never climb it by spending more.
 */
@Injectable()
export class OutcomesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
  ) {}

  linkage(
    actor: RequestActor,
    query: { fiscalYearId?: string; regionOrgUnitId?: string },
  ): Promise<OutcomeLinkage> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const tenant = { kind: 'tenant' as const, tenantId: actor.tenantId };
      this.policy.assert(actor, 'report.read', tenant, 'outcome report');
      // Retention is company and region level work for People Ops and leadership. A role that reads
      // reports only inside what it owns gets the survey view and no retention cohorts.
      const retentionAvailable = this.policy.can(actor, 'org.read', tenant).allowed;
      const year = await this.fiscalYear(tx, actor.tenantId, query.fiscalYearId);
      const scopedEvents = await this.eventsInYear(tx, actor.tenantId, year, query.regionOrgUnitId);
      const eventIds = scopedEvents.map((e) => e.id);
      const pulse = await this.pulse(tx, eventIds);
      const enps = await this.enps(tx, eventIds);
      const reach = await this.reach(tx, actor.tenantId, eventIds);
      const categories = await this.categoryRows(tx, scopedEvents);
      const retentionBands = retentionAvailable
        ? await this.retentionBands(tx, actor.tenantId, year)
        : [];
      const enoughData =
        pulse.groupSize >= MIN_SURVEY_RESPONSES || categories.some((c) => c.eventCount > 0);
      return {
        asOf: iso(new Date()),
        fiscalYearId: year.id,
        associationNote: ASSOCIATION_NOTE,
        thresholds: {
          surveyResponses: MIN_SURVEY_RESPONSES,
          retentionGroup: MIN_RETENTION_GROUP,
        },
        averagePulse: pulse,
        enps,
        reachBps: reach,
        categories,
        retentionBands,
        retentionAvailable,
        enoughData,
      };
    });
  }

  leaderboard(
    actor: RequestActor,
    query: { period?: 'month' | 'quarter' | 'year'; locationOrgUnitId?: string },
  ): Promise<ParticipationLeaderboard> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      // Every employee may see their company's turnout; it contains no money and no individual.
      this.policy.assert(
        actor,
        'tenant.read',
        { kind: 'tenant', tenantId: actor.tenantId },
        'participation leaderboard',
      );
      const period = query.period ?? 'quarter';
      const from = this.periodStart(period);
      const attendance = await tx
        .select({
          locationOrgUnitId: eventParticipants.locationOrgUnitId,
          personId: eventParticipants.personId,
          eventId: eventParticipants.eventId,
        })
        .from(eventParticipants)
        .innerJoin(events, eq(events.id, eventParticipants.eventId))
        .where(
          and(
            eq(eventParticipants.tenantId, actor.tenantId),
            inArray(eventParticipants.attendanceStatus, [...ATTENDED]),
            gte(events.startsAt, new Date(`${from}T00:00:00Z`)),
            lte(events.startsAt, new Date()),
          ),
        );
      const locations = await tx
        .select({ id: orgUnits.id, name: orgUnits.name, kind: orgUnits.kind })
        .from(orgUnits)
        .where(
          and(eq(orgUnits.tenantId, actor.tenantId), inArray(orgUnits.kind, ['location', 'team'])),
        )
        .orderBy(asc(orgUnits.name), asc(orgUnits.id));
      const eligible = await this.eligibleByUnit(tx, actor.tenantId);
      const rank = (kind: 'location' | 'team'): ParticipationRankRow[] => {
        const rows = locations
          .filter((u) => u.kind === kind)
          .filter(
            (u) => !query.locationOrgUnitId || u.id === query.locationOrgUnitId || kind === 'team',
          )
          .map((unit) => {
            const headcount = eligible.get(unit.id) ?? 0;
            const took = new Set(
              attendance
                .filter((a) => a.locationOrgUnitId === unit.id && a.personId)
                .map((a) => a.personId as string),
            );
            const events = new Set(
              attendance.filter((a) => a.locationOrgUnitId === unit.id).map((a) => a.eventId),
            );
            const ranked = headcount >= MIN_RANKED_GROUP;
            return {
              orgUnitId: unit.id,
              name: unit.name,
              rank: null as number | null,
              eligibleHeadcount: headcount,
              turnoutBps: ranked ? bps(took.size, headcount) : null,
              eventsHeld: events.size,
              ranked,
              notRankedReason: ranked
                ? null
                : `Not ranked (fewer than ${MIN_RANKED_GROUP} eligible people)`,
            };
          })
          .sort(
            (a, b) =>
              (b.turnoutBps ?? -1) - (a.turnoutBps ?? -1) ||
              a.name.localeCompare(b.name) ||
              a.orgUnitId.localeCompare(b.orgUnitId),
          );
        let position = 0;
        for (const row of rows) if (row.ranked) row.rank = ++position;
        return rows;
      };
      return {
        asOf: iso(new Date()),
        period,
        note: 'Ranked by turnout: the share of eligible people who took part. Spending never counts.',
        minimumGroupSize: MIN_RANKED_GROUP,
        locations: rank('location'),
        teams: rank('team'),
      };
    });
  }

  // Internals ----------------------------------------------------------------------------

  private async fiscalYear(
    tx: Tx,
    tenantId: string,
    fiscalYearId?: string,
  ): Promise<{ id: string; startDate: string; endDate: string }> {
    const rows = await tx
      .select({
        id: fiscalYears.id,
        startDate: fiscalYears.startDate,
        endDate: fiscalYears.endDate,
      })
      .from(fiscalYears)
      .where(
        and(
          eq(fiscalYears.tenantId, tenantId),
          fiscalYearId ? eq(fiscalYears.id, fiscalYearId) : undefined,
        ),
      )
      .orderBy(asc(fiscalYears.startDate));
    const today = todayUtc();
    const current = rows.find((r) => r.startDate <= today && r.endDate >= today) ?? rows.at(-1);
    if (!current) throw ApiProblem.notFound('fiscal year');
    return current;
  }

  private eventsInYear(
    tx: Tx,
    tenantId: string,
    year: { startDate: string; endDate: string },
    regionOrgUnitId?: string,
  ) {
    return tx
      .select({
        id: events.id,
        name: events.name,
        startsAt: events.startsAt,
        categoryCode: budgetCategories.code,
        categoryName: budgetCategories.name,
        currency: budgets.currency,
      })
      .from(events)
      .leftJoin(budgets, eq(budgets.id, events.budgetId))
      .leftJoin(budgetCategories, eq(budgetCategories.id, budgets.categoryId))
      .where(
        and(
          eq(events.tenantId, tenantId),
          gte(events.startsAt, new Date(`${year.startDate}T00:00:00Z`)),
          lte(events.startsAt, new Date(`${year.endDate}T23:59:59Z`)),
          regionOrgUnitId ? eq(budgets.orgUnitId, regionOrgUnitId) : undefined,
        ),
      )
      .orderBy(asc(events.name), asc(events.id));
  }

  /**
   * Average event pulse in thousandths of a point. Built from anonymous responses: the query reads
   * ratings only, and the table it reads has no person column to read even if it wanted one.
   */
  private async pulse(tx: Tx, eventIds: readonly string[]): Promise<SuppressibleFigure> {
    if (eventIds.length === 0) return suppressible(null, 0, MIN_SURVEY_RESPONSES, 'responses');
    const [row] = await tx
      .select({
        total: sql<string>`coalesce(sum(${eventSurveyResponses.rating}), 0)`,
        n: sql<string>`count(*)`,
      })
      .from(eventSurveyResponses)
      .where(inArray(eventSurveyResponses.eventId, [...eventIds]));
    const n = Number(row?.n ?? 0);
    const total = Number(row?.total ?? 0);
    return suppressible(
      n > 0 ? Math.round((total / n) * 1000) : null,
      n,
      MIN_SURVEY_RESPONSES,
      'responses',
    );
  }

  /**
   * eNPS from the same anonymous responses: promoters (5) minus detractors (1-3) as a share of all
   * responses, in thousandths so the caller can render +32 without a float.
   */
  private async enps(tx: Tx, eventIds: readonly string[]): Promise<SuppressibleFigure> {
    if (eventIds.length === 0) return suppressible(null, 0, MIN_SURVEY_RESPONSES, 'responses');
    const [row] = await tx
      .select({
        promoters: sql<string>`count(*) filter (where ${eventSurveyResponses.rating} >= 5)`,
        detractors: sql<string>`count(*) filter (where ${eventSurveyResponses.rating} <= 3)`,
        n: sql<string>`count(*)`,
      })
      .from(eventSurveyResponses)
      .where(inArray(eventSurveyResponses.eventId, [...eventIds]));
    const n = Number(row?.n ?? 0);
    if (n === 0) return suppressible(null, 0, MIN_SURVEY_RESPONSES, 'responses');
    const score = (Number(row.promoters) - Number(row.detractors)) / n;
    return suppressible(Math.round(score * 1000), n, MIN_SURVEY_RESPONSES, 'responses');
  }

  /** Share of eligible employees who took part in at least one event (15b). */
  private async reach(
    tx: Tx,
    tenantId: string,
    eventIds: readonly string[],
  ): Promise<number | null> {
    if (eventIds.length === 0) return null;
    const rows = await tx
      .selectDistinct({ personId: eventParticipants.personId })
      .from(eventParticipants)
      .where(
        and(
          eq(eventParticipants.tenantId, tenantId),
          inArray(eventParticipants.eventId, [...eventIds]),
          inArray(eventParticipants.attendanceStatus, [...ATTENDED]),
        ),
      );
    const eligible = await this.eligibleTotal(tx, tenantId);
    return bps(rows.filter((r) => r.personId).length, eligible);
  }

  private async categoryRows(
    tx: Tx,
    scopedEvents: readonly {
      id: string;
      categoryCode: string | null;
      categoryName: string | null;
      currency: string | null;
    }[],
  ): Promise<OutcomeCategoryRow[]> {
    if (scopedEvents.length === 0) return [];
    const eventIds = scopedEvents.map((e) => e.id);
    const attendance = await tx
      .select({
        eventId: eventParticipants.eventId,
        attendanceStatus: eventParticipants.attendanceStatus,
      })
      .from(eventParticipants)
      .where(inArray(eventParticipants.eventId, [...eventIds]));
    const ratings = await tx
      .select({
        eventId: eventSurveyResponses.eventId,
        rating: eventSurveyResponses.rating,
      })
      .from(eventSurveyResponses)
      .where(inArray(eventSurveyResponses.eventId, [...eventIds]));
    const byCategory = new Map<string, { name: string; events: string[]; currency: string }>();
    for (const e of scopedEvents) {
      const code = e.categoryCode ?? 'uncategorised';
      const entry = byCategory.get(code) ?? {
        name: e.categoryName ?? 'Uncategorised',
        events: [],
        currency: e.currency ?? 'USD',
      };
      entry.events.push(e.id);
      byCategory.set(code, entry);
    }
    return [...byCategory.entries()]
      .map(([code, entry]) => {
        const invited = attendance.filter((a) => entry.events.includes(a.eventId));
        const attended = invited.filter((a) =>
          (ATTENDED as readonly string[]).includes(a.attendanceStatus),
        );
        const responses = ratings.filter((r) => entry.events.includes(r.eventId));
        const total = responses.reduce((s, r) => s + r.rating, 0);
        return {
          categoryCode: code,
          categoryName: entry.name,
          eventCount: entry.events.length,
          // Cost per attendee comes from the ledger-backed event spending report (085) and is not
          // recomputed here; this view states attendance and feedback only.
          costPerAttendee: null,
          attendanceRateBps: bps(attended.length, invited.length),
          pulse: suppressible(
            responses.length ? Math.round((total / responses.length) * 1000) : null,
            responses.length,
            MIN_SURVEY_RESPONSES,
            'responses',
          ),
          responseCount: responses.length,
        };
      })
      .sort(
        (a, b) =>
          a.categoryName.localeCompare(b.categoryName) ||
          a.categoryCode.localeCompare(b.categoryCode),
      );
  }

  /**
   * Retention by participation band. Cohorts are counted, never listed: the query returns three
   * numbers per band and the response carries the group size so a reader can see how solid it is.
   */
  private async retentionBands(
    tx: Tx,
    tenantId: string,
    year: { startDate: string; endDate: string },
  ): Promise<RetentionBandRow[]> {
    const employed = await tx
      .select({ id: people.id, endDate: people.endDate })
      .from(people)
      .where(
        and(
          eq(people.tenantId, tenantId),
          eq(people.employmentType, 'employee'),
          lte(people.startDate, year.startDate),
        ),
      );
    const attendance = await tx
      .select({
        personId: eventParticipants.personId,
        eventId: eventParticipants.eventId,
      })
      .from(eventParticipants)
      .innerJoin(events, eq(events.id, eventParticipants.eventId))
      .where(
        and(
          eq(eventParticipants.tenantId, tenantId),
          inArray(eventParticipants.attendanceStatus, [...ATTENDED]),
          gte(events.startsAt, new Date(`${year.startDate}T00:00:00Z`)),
          lte(events.startsAt, new Date(`${year.endDate}T23:59:59Z`)),
        ),
      );
    const counts = new Map<string, number>();
    for (const a of attendance)
      if (a.personId) counts.set(a.personId, (counts.get(a.personId) ?? 0) + 1);
    const cohorts: RetentionCohort[] = [
      { band: 'none', label: '0 events', people: 0, stillEmployed: 0 },
      { band: 'one_to_two', label: '1-2 events', people: 0, stillEmployed: 0 },
      { band: 'three_or_more', label: '3 or more events', people: 0, stillEmployed: 0 },
    ];
    for (const person of employed) {
      const n = counts.get(person.id) ?? 0;
      const cohort = n === 0 ? cohorts[0] : n <= 2 ? cohorts[1] : cohorts[2];
      cohort.people += 1;
      if (!person.endDate || person.endDate > year.endDate) cohort.stillEmployed += 1;
    }
    return cohorts.map((c) => ({
      band: c.band,
      bandLabel: `${c.label} (${c.people} people)`,
      retention: suppressible(
        c.people ? Math.round((c.stillEmployed / c.people) * 100_000) / 100 : null,
        c.people,
        MIN_RETENTION_GROUP,
        'people',
      ),
    }));
  }

  private async eligibleByUnit(tx: Tx, tenantId: string): Promise<Map<string, number>> {
    const [snapshot] = await tx
      .select({ id: headcountSnapshots.id })
      .from(headcountSnapshots)
      .where(eq(headcountSnapshots.tenantId, tenantId))
      .orderBy(sql`${headcountSnapshots.asOfDate} desc`)
      .limit(1);
    if (!snapshot) return new Map();
    const lines = await tx
      .select({
        orgUnitId: headcountSnapshotLines.orgUnitId,
        headcount: headcountSnapshotLines.headcount,
      })
      .from(headcountSnapshotLines)
      .where(
        and(
          eq(headcountSnapshotLines.snapshotId, snapshot.id),
          eq(headcountSnapshotLines.employmentType, 'employee'),
        ),
      );
    const out = new Map<string, number>();
    for (const line of lines)
      out.set(line.orgUnitId, (out.get(line.orgUnitId) ?? 0) + line.headcount);
    return out;
  }

  private async eligibleTotal(tx: Tx, tenantId: string): Promise<number> {
    const [row] = await tx
      .select({ n: sql<string>`count(*)` })
      .from(people)
      .where(and(eq(people.tenantId, tenantId), eq(people.employmentType, 'employee')));
    return Number(row?.n ?? 0);
  }

  /** Relative window start, so the figures move with real time instead of a hard-coded date. */
  private periodStart(period: 'month' | 'quarter' | 'year'): string {
    const now = new Date();
    const months = period === 'month' ? 1 : period === 'quarter' ? 3 : 12;
    const from = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate()),
    );
    return from.toISOString().slice(0, 10);
  }
}
