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
  legalEntities,
  people,
  reportingLines,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type { Person, PersonDetail } from '@bf/contracts';
import { dayBefore, validateEffectiveDate } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { CommandContext } from './org-units.service';
import { descendantsOf, OrgReads, todayUtc, type OrgView } from './org-reads';

type PersonRow = typeof people.$inferSelect;

const activeOn = (asOf: string): SQL =>
  and(
    or(isNull(people.startDate), lte(people.startDate, asOf)),
    or(isNull(people.endDate), gte(people.endDate, asOf)),
  )!;

@Injectable()
export class PeopleService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly reads: OrgReads,
    private readonly audit: AuditService,
  ) {}

  list(
    actor: RequestActor,
    q: { q?: string; orgUnitId?: string; asOf?: string; cursor?: string; limit?: number },
  ) {
    const asOf = q.asOf ?? todayUtc();
    const limit = q.limit ?? 50;
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const view = await this.reads.view(tx, actor, asOf);
      const filters: SQL[] = [activeOn(asOf)];
      if (view.scope !== 'tenant') {
        const visibleUnits = [...view.units.keys()].filter((id) => view.canSee(id));
        const mine = actor.personId ? [eq(people.id, actor.personId)] : [];
        filters.push(
          visibleUnits.length
            ? or(
                inArray(people.locationOrgUnitId, visibleUnits),
                inArray(people.orgUnitId, visibleUnits),
                ...mine,
              )!
            : (mine[0] ?? sql`false`),
        );
      }
      if (q.orgUnitId) {
        if (!view.canSee(q.orgUnitId)) throw ApiProblem.notFound('org unit');
        const subtree = [q.orgUnitId, ...descendantsOf(view.units, q.orgUnitId).keys()];
        filters.push(
          or(inArray(people.locationOrgUnitId, subtree), inArray(people.orgUnitId, subtree))!,
        );
      }
      if (q.q) {
        const like = `%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        filters.push(
          or(
            ilike(people.displayName, like),
            ilike(people.email, like),
            ilike(people.jobTitle, like),
          )!,
        );
      }
      const [{ total }] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(people)
        .where(and(...filters));
      if (q.cursor) {
        const [name, id] = Buffer.from(q.cursor, 'base64url').toString('utf8').split('\u0000');
        filters.push(
          or(
            sql`${people.displayName} > ${name}`,
            and(eq(people.displayName, name ?? ''), sql`${people.id} > ${id}`),
          )!,
        );
      }
      const rows = await tx
        .select()
        .from(people)
        .where(and(...filters))
        .orderBy(asc(people.displayName), asc(people.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const items = await this.toPersons(tx, view, page, asOf);
      const last = page[page.length - 1];
      return {
        scope: view.scope,
        total,
        items,
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(`${last.displayName}\u0000${last.id}`, 'utf8').toString('base64url')
            : null,
      };
    });
  }

  get(actor: RequestActor, id: string, asOf = todayUtc()): Promise<PersonDetail> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.detail(tx, actor, id, asOf),
    );
  }

  private async detail(
    tx: Tx,
    actor: RequestActor,
    id: string,
    asOf: string,
  ): Promise<PersonDetail> {
    const [row] = await tx.select().from(people).where(eq(people.id, id));
    if (!row) throw ApiProblem.notFound('person');
    const view = await this.reads.view(tx, actor, asOf);
    if (!view.canSeePerson(row)) throw ApiProblem.notFound('person');
    const [person] = await this.toPersons(tx, view, [row], asOf);
    const lines = await tx
      .select({
        id: reportingLines.id,
        managerPersonId: reportingLines.managerPersonId,
        managerName: people.displayName,
        kind: reportingLines.kind,
        validFrom: reportingLines.validFrom,
        validTo: reportingLines.validTo,
      })
      .from(reportingLines)
      .innerJoin(people, eq(people.id, reportingLines.managerPersonId))
      .where(eq(reportingLines.personId, id))
      .orderBy(desc(reportingLines.validFrom));
    const reports = await tx
      .select({ id: people.id, displayName: people.displayName, jobTitle: people.jobTitle })
      .from(reportingLines)
      .innerJoin(people, eq(people.id, reportingLines.personId))
      .where(
        and(
          eq(reportingLines.managerPersonId, id),
          eq(reportingLines.kind, 'solid'),
          lte(reportingLines.validFrom, asOf),
          or(isNull(reportingLines.validTo), gte(reportingLines.validTo, asOf)),
        ),
      )
      .orderBy(asc(people.displayName));
    const resource = this.reads.personResource(actor, view.units, row);
    return {
      ...person,
      asOf,
      reportingLines: lines,
      directReports: reports,
      allowedActions: this.policy.can(actor, 'org.manage', resource).allowed ? ['org.manage'] : [],
    };
  }

  changeReportingLine(
    actor: RequestActor,
    personId: string,
    req: {
      managerPersonId: string;
      kind: 'solid' | 'matrix';
      effectiveFrom: string;
      reason: string;
    },
    ctx: CommandContext,
  ): Promise<CommandResult<PersonDetail>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `org.people.reporting_line:${personId}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const [row] = await tx.select().from(people).where(eq(people.id, personId)).for('update');
        if (!row) throw ApiProblem.notFound('person');
        const view = await this.reads.view(tx, actor, todayUtc());
        if (!view.canSeePerson(row)) throw ApiProblem.notFound('person');
        this.policy.assert(
          actor,
          'org.manage',
          this.reads.personResource(actor, view.units, row),
          'person',
        );
        const [manager] = await tx.select().from(people).where(eq(people.id, req.managerPersonId));
        if (!manager)
          throw new ApiProblem(422, 'VALIDATION_FAILED', 'The manager does not exist.', {
            field: 'managerPersonId',
          });
        if (manager.id === personId)
          throw new ApiProblem(422, 'ORG_HIERARCHY_INVALID', 'People cannot report to themselves.');
        if (await this.reportsTo(tx, manager.id, personId, req.effectiveFrom)) {
          throw new ApiProblem(
            422,
            'ORG_HIERARCHY_INVALID',
            `${manager.displayName} already reports to ${row.displayName}; that would create a loop.`,
          );
        }
        const [current] = await tx
          .select()
          .from(reportingLines)
          .where(and(eq(reportingLines.personId, personId), eq(reportingLines.kind, req.kind)))
          .orderBy(desc(reportingLines.validFrom))
          .limit(1);
        if (req.kind === 'solid' && current) {
          unwrap(validateEffectiveDate(req.effectiveFrom, current.validFrom));
          if (current.validTo === null || current.validTo >= req.effectiveFrom) {
            await tx
              .update(reportingLines)
              .set({ validTo: dayBefore(req.effectiveFrom) })
              .where(eq(reportingLines.id, current.id));
          }
        }
        await tx.insert(reportingLines).values({
          tenantId: actor.tenantId,
          personId,
          managerPersonId: manager.id,
          kind: req.kind,
          validFrom: req.effectiveFrom,
        });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'person.reporting_line_changed',
          resourceType: 'person',
          resourceId: personId,
          legalEntityId: row.employingEntityId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            managerPersonId: {
              from: req.kind === 'solid' ? (current?.managerPersonId ?? null) : null,
              to: manager.id,
            },
            kind: { from: null, to: req.kind },
            effectiveFrom: { from: null, to: req.effectiveFrom },
          },
        });
        return this.detail(tx, actor, personId, req.effectiveFrom);
      },
    );
  }

  /** Whether `personId` reports (directly or indirectly, solid lines) to `managerId` on the date. */
  private async reportsTo(
    tx: Tx,
    personId: string,
    managerId: string,
    date: string,
  ): Promise<boolean> {
    const rows = await tx.execute<{ found: boolean }>(sql`
      with recursive chain(person_id, depth) as (
        select ${personId}::uuid, 0
        union all
        select r.manager_person_id, c.depth + 1 from chain c
          join ${reportingLines} r on r.person_id = c.person_id and r.kind = 'solid'
           and r.valid_from <= ${date} and (r.valid_to is null or r.valid_to >= ${date})
        where c.depth < 50
      )
      select exists(select 1 from chain where person_id = ${managerId}::uuid and depth > 0) as found`);
    return rows.rows[0]?.found === true;
  }

  private async toPersons(
    tx: Tx,
    view: OrgView,
    rows: PersonRow[],
    asOf: string,
  ): Promise<Person[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const managers = await tx
      .select({
        personId: reportingLines.personId,
        managerPersonId: reportingLines.managerPersonId,
        managerName: people.displayName,
      })
      .from(reportingLines)
      .innerJoin(people, eq(people.id, reportingLines.managerPersonId))
      .where(
        and(
          inArray(reportingLines.personId, ids),
          eq(reportingLines.kind, 'solid'),
          lte(reportingLines.validFrom, asOf),
          or(isNull(reportingLines.validTo), gte(reportingLines.validTo, asOf)),
        ),
      );
    const managerOf = new Map(managers.map((m) => [m.personId, m]));
    const ccIds = [...new Set(rows.map((r) => r.costCenterId).filter((c): c is string => !!c))];
    const ccs = ccIds.length
      ? await tx
          .select({ id: costCenters.id, code: costCenters.code })
          .from(costCenters)
          .where(inArray(costCenters.id, ccIds))
      : [];
    const leIds = [
      ...new Set(rows.map((r) => r.employingEntityId).filter((c): c is string => !!c)),
    ];
    const les = leIds.length
      ? await tx
          .select({ id: legalEntities.id, code: legalEntities.code })
          .from(legalEntities)
          .where(inArray(legalEntities.id, leIds))
      : [];
    const ccCode = new Map(ccs.map((c) => [c.id, c.code]));
    const leCode = new Map(les.map((l) => [l.id, l.code]));
    const unitName = (id: string | null) => (id ? (view.units.get(id)?.name ?? null) : null);
    return rows.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      email: r.email,
      jobTitle: r.jobTitle,
      seniority: r.seniority,
      employmentType: r.employmentType,
      locationOrgUnitId: r.locationOrgUnitId,
      locationName: unitName(r.locationOrgUnitId),
      orgUnitId: r.orgUnitId,
      orgUnitName: unitName(r.orgUnitId),
      costCenterId: r.costCenterId,
      costCenterCode: r.costCenterId ? (ccCode.get(r.costCenterId) ?? null) : null,
      employingEntityId: r.employingEntityId,
      employingEntityCode: r.employingEntityId ? (leCode.get(r.employingEntityId) ?? null) : null,
      timezone: r.timezone,
      startDate: r.startDate,
      endDate: r.endDate,
      managerPersonId: managerOf.get(r.id)?.managerPersonId ?? null,
      managerName: managerOf.get(r.id)?.managerName ?? null,
    }));
  }
}
