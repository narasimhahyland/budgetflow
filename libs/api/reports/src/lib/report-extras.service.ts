import type { Tx } from '@bf/api/db';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { EventFigures, ParticipationFigures, ReportExtras } from './report-builders';

export interface EventFiguresQuery {
  budgetIds: string[];
  periodFrom?: string;
  periodTo?: string;
}

const EMPTY: ReportExtras = { events: [], headcount: new Map(), participation: new Map() };

const uuidList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

/**
 * Data the event, fairness and participation reports need on top of the budget dataset: event money
 * from the ledger (never recomputed from estimates), eligible headcount from the latest HR snapshot,
 * and attendance aggregated so no individual is exposed.
 */
@Injectable()
export class ReportExtrasReads {
  /**
   * Events funded by budgets in the viewer's scope, with their committed and actual money read from
   * the ledger lines carrying the event code.
   */
  async events(tx: Tx, q: EventFiguresQuery): Promise<ReportExtras> {
    if (!q.budgetIds.length) return EMPTY;
    const ids = uuidList(q.budgetIds);
    const res = await tx.execute<{
      id: string;
      name: string;
      event_code: string;
      status: string;
      starts_at: string | null;
      location_id: string | null;
      location_name: string | null;
      funded: string;
      returned: string;
      pre_encumbered: string;
      encumbered: string;
      actual: string;
      attendees: string | null;
      co_funders: string;
    }>(sql`
      with scoped as (
        select distinct e.id
        from events e
        left join event_funding_sources fs on fs.event_id = e.id
        where e.budget_id in (${ids}) or fs.budget_id in (${ids}) or fs.origin_budget_id in (${ids})
      )
      select e.id, e.name, e.event_code, e.status::text as status, e.starts_at::text as starts_at,
             ou.id as location_id, ou.name as location_name,
             coalesce((select sum(fs.funded_minor) from event_funding_sources fs where fs.event_id = e.id), 0)::text as funded,
             coalesce((select sum(fs.returned_minor) from event_funding_sources fs where fs.event_id = e.id), 0)::text as returned,
             coalesce((select sum(l.reporting_amount_minor) from ledger_lines l
                        where l.event_code = e.event_code and l.account = 'pre_encumbered'
                          and l.budget_id in (${ids})), 0)::text as pre_encumbered,
             coalesce((select sum(l.reporting_amount_minor) from ledger_lines l
                        where l.event_code = e.event_code and l.account = 'encumbered'
                          and l.budget_id in (${ids})), 0)::text as encumbered,
             coalesce((select sum(l.reporting_amount_minor) from ledger_lines l
                        where l.event_code = e.event_code and l.account = 'actual'
                          and l.budget_id in (${ids})), 0)::text as actual,
             case when e.attendance_final then
               (select count(*) from event_participants p
                 where p.event_id = e.id and p.attendance_status = 'attended')
             end::text as attendees,
             (select count(*) from contribution_requests c
               where c.event_id = e.id and c.status = 'approved')::text as co_funders
      from events e
      join scoped s on s.id = e.id
      left join event_locations el on el.event_id = e.id
      left join org_units ou on ou.id = el.org_unit_id
      where e.status <> 'cancelled'
        ${q.periodFrom ? sql`and (e.starts_at is null or e.starts_at >= ${q.periodFrom}::date)` : sql``}
        ${q.periodTo ? sql`and (e.starts_at is null or e.starts_at <= ${q.periodTo}::date + 1)` : sql``}
      order by e.starts_at desc nulls last
      limit 500`);

    const seen = new Set<string>();
    const events: EventFigures[] = [];
    for (const r of res.rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      events.push({
        id: r.id,
        name: r.name,
        eventCode: r.event_code,
        status: r.status,
        startsAt: r.starts_at ? new Date(r.starts_at) : null,
        locationId: r.location_id,
        locationName: r.location_name ?? 'Not set',
        fundedMinor: Number(r.funded),
        returnedMinor: Number(r.returned),
        preEncumberedMinor: Number(r.pre_encumbered),
        encumberedMinor: Number(r.encumbered),
        actualMinor: Number(r.actual),
        attendees: r.attendees === null ? null : Number(r.attendees),
        coFunders: Number(r.co_funders),
      });
    }
    return { ...EMPTY, events };
  }

  /** Eligible headcount per location from the latest HR snapshot (employees only). */
  async headcount(tx: Tx): Promise<ReportExtras> {
    const res = await tx.execute<{ location_id: string; headcount: string }>(sql`
      with latest as (
        select id from headcount_snapshots order by as_of_date desc limit 1
      ),
      loc as (
        select c.descendant_id as unit_id, c.ancestor_id as location_id, c.depth,
               row_number() over (partition by c.descendant_id order by c.depth) as rn
        from org_unit_closure c
        join org_units u on u.id = c.ancestor_id
        where u.kind in ('location', 'region', 'company')
          and c.valid_from <= current_date and (c.valid_to is null or c.valid_to >= current_date)
      )
      select loc.location_id, sum(l.headcount)::text as headcount
      from headcount_snapshot_lines l
      join latest on latest.id = l.snapshot_id
      join loc on loc.unit_id = l.org_unit_id and loc.rn = 1
      where l.employment_type = 'employee'
      group by loc.location_id`);
    return {
      ...EMPTY,
      headcount: new Map(res.rows.map((r) => [r.location_id, Number(r.headcount)])),
    };
  }

  /** Reach per location: eligible headcount against the people who attended at least one event. */
  async participation(tx: Tx, q: EventFiguresQuery): Promise<ReportExtras> {
    const heads = (await this.headcount(tx)).headcount;
    const res = await tx.execute<{
      location_id: string | null;
      label: string | null;
      reached: string;
      attendances: string;
      said_going: string;
      no_shows: string;
      events_held: string;
    }>(sql`
      with loc as (
        select c.descendant_id as unit_id, c.ancestor_id as location_id, u.name as label,
               row_number() over (partition by c.descendant_id order by c.depth) as rn
        from org_unit_closure c
        join org_units u on u.id = c.ancestor_id
        where u.kind in ('location', 'region', 'company')
          and c.valid_from <= current_date and (c.valid_to is null or c.valid_to >= current_date)
      ),
      parts as (
        select p.person_id, p.attendance_status, p.rsvp_status, p.event_id,
               coalesce(loc.location_id, p.location_org_unit_id) as location_id,
               loc.label
        from event_participants p
        join events e on e.id = p.event_id and e.status <> 'cancelled'
        left join loc on loc.unit_id = p.location_org_unit_id and loc.rn = 1
        where p.person_id is not null
          ${q.periodFrom ? sql`and (e.starts_at is null or e.starts_at >= ${q.periodFrom}::date)` : sql``}
          ${q.periodTo ? sql`and (e.starts_at is null or e.starts_at <= ${q.periodTo}::date + 1)` : sql``}
      )
      select location_id, max(label) as label,
             count(distinct person_id) filter (where attendance_status = 'attended')::text as reached,
             count(*) filter (where attendance_status = 'attended')::text as attendances,
             count(*) filter (where rsvp_status = 'going')::text as said_going,
             count(*) filter (where rsvp_status = 'going' and attendance_status = 'no_show')::text as no_shows,
             count(distinct event_id)::text as events_held
      from parts
      group by location_id`);

    const participation = new Map<string, ParticipationFigures>();
    for (const [locationId, eligible] of heads)
      participation.set(locationId, {
        locationId,
        label: '',
        eligible,
        reached: 0,
        eventsHeld: 0,
        attendances: 0,
        saidGoing: 0,
        noShows: 0,
      });
    for (const r of res.rows) {
      const key = r.location_id ?? 'none';
      const cur = participation.get(key) ?? {
        locationId: r.location_id,
        label: r.label ?? 'Not set',
        eligible: 0,
        reached: 0,
        eventsHeld: 0,
        attendances: 0,
        saidGoing: 0,
        noShows: 0,
      };
      cur.label = r.label ?? cur.label ?? 'Not set';
      cur.reached = Number(r.reached);
      cur.attendances = Number(r.attendances);
      cur.saidGoing = Number(r.said_going);
      cur.noShows = Number(r.no_shows);
      cur.eventsHeld = Number(r.events_held);
      participation.set(key, cur);
    }
    if (participation.size) await this.nameLocations(tx, participation);
    return { ...EMPTY, participation };
  }

  private async nameLocations(
    tx: Tx,
    participation: Map<string, ParticipationFigures>,
  ): Promise<void> {
    const ids = [...participation.keys()].filter((k) => k !== 'none');
    if (!ids.length) return;
    const res = await tx.execute<{ id: string; name: string }>(
      sql`select id, name from org_units where id in (${uuidList(ids)})`,
    );
    for (const r of res.rows) {
      const f = participation.get(r.id);
      if (f) f.label = r.name;
    }
    for (const [key, f] of participation) if (!f.label) f.label = key === 'none' ? 'Not set' : key;
  }
}
