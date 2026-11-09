import { DB, PolicyService, type RequestActor, todayUtc } from '@bf/api/core';
import {
  auditEvents,
  budgets,
  doaMatrixVersions,
  eventParticipants,
  events,
  featureFlags,
  fiscalYears,
  legalEntities,
  notifications,
  orgUnits,
  people,
  planVersions,
  requests,
  retentionPolicies,
  roleGrants,
  withTenant,
  type Db,
} from '@bf/api/db';
import type { MyActivity, MyActivityEntry, SetupChecklist } from '@bf/contracts';
import { Injectable, Inject } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { assertTenant } from './admin-reads';

const DEFAULT_ACTIVITY_DAYS = 30;
const DEFAULT_ACTIVITY_LIMIT = 100;

/** Which activity type an audited action belongs to, so the timeline can be filtered. */
function activityTypeOf(action: string, resourceType: string): MyActivityEntry['type'] {
  if (resourceType === 'request' || action.startsWith('request.')) return 'request';
  if (action.includes('approval') || action.includes('approved') || action.includes('decided'))
    return 'approval';
  if (resourceType === 'event' || action.startsWith('event.')) return 'event';
  if (resourceType === 'document' || action.includes('receipt')) return 'receipt';
  if (action.includes('delegation')) return 'delegation';
  if (action.includes('export')) return 'export';
  if (action.includes('comment')) return 'comment';
  if (resourceType === 'budget') return 'budget';
  return 'other';
}

/** The guided setup checklist (10a) and a person's own activity (122). */
@Injectable()
export class ExperienceService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
  ) {}

  setupChecklist(actor: RequestActor): Promise<SetupChecklist> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'tenant.read');
      const one = async (query: Promise<{ n: string }[]>) => Number((await query)[0]?.n ?? 0);

      const units = await one(tx.select({ n: sql<string>`count(*)` }).from(orgUnits));
      const peopleCount = await one(tx.select({ n: sql<string>`count(*)` }).from(people));
      const entities = await one(tx.select({ n: sql<string>`count(*)` }).from(legalEntities));
      const years = await one(tx.select({ n: sql<string>`count(*)` }).from(fiscalYears));
      const approvedPlans = await one(
        tx
          .select({ n: sql<string>`count(*)` })
          .from(planVersions)
          .where(eq(planVersions.status, 'approved')),
      );
      const rootBudgets = await one(
        tx
          .select({ n: sql<string>`count(*)` })
          .from(budgets)
          .where(sql`${budgets.parentId} is null`),
      );
      const doa = await one(
        tx
          .select({ n: sql<string>`count(*)` })
          .from(doaMatrixVersions)
          .where(eq(doaMatrixVersions.status, 'approved')),
      );
      const rolesGranted = await one(
        tx.select({ n: sql<string>`count(distinct ${roleGrants.role})` }).from(roleGrants),
      );
      const retentionReviewed = await one(
        tx.select({ n: sql<string>`count(*)` }).from(retentionPolicies),
      );
      const flagsReviewed = await one(tx.select({ n: sql<string>`count(*)` }).from(featureFlags));

      const items = [
        {
          key: 'org_structure',
          name: 'Add your locations and teams',
          description: 'Regions, offices and teams give every budget an owner and a place.',
          done: units > 1,
          detail: `${units} org unit(s).`,
          route: '/org/units',
          requiredAction: 'org.manage',
        },
        {
          key: 'people',
          name: 'Bring in your people',
          description: 'People can own budgets, request money and approve once they exist here.',
          done: peopleCount > 0,
          detail: `${peopleCount} person(s).`,
          route: '/org/people',
          requiredAction: 'org.manage',
        },
        {
          key: 'legal_entities',
          name: 'Set up legal entities',
          description: 'Every budget and posting belongs to one legal entity.',
          done: entities > 0,
          detail: `${entities} legal entit(y/ies).`,
          route: '/finance/legal-entities',
          requiredAction: 'master_data.manage',
        },
        {
          key: 'fiscal_calendar',
          name: 'Set the fiscal calendar',
          description: 'Periods decide where postings land and when the books close.',
          done: years > 0,
          detail: `${years} fiscal year(s).`,
          route: '/finance/fiscal-periods',
          requiredAction: 'master_data.manage',
        },
        {
          key: 'plan_version',
          name: 'Approve a plan version',
          description: 'Root budgets tie to the approved plan for the year.',
          done: approvedPlans > 0,
          detail: `${approvedPlans} approved plan version(s).`,
          route: '/budgets/plan-versions',
          requiredAction: 'budget.create_root',
        },
        {
          key: 'root_budget',
          name: 'Create the first budget',
          description: 'A root budget is where authorized money enters BudgetFlow.',
          done: rootBudgets > 0,
          detail: `${rootBudgets} root budget(s).`,
          route: '/budgets',
          requiredAction: 'budget.create_root',
        },
        {
          key: 'doa_matrix',
          name: 'Approve the delegation-of-authority matrix',
          description: 'Who may approve what, up to which limit. Approval needs it.',
          done: doa > 0,
          detail: `${doa} approved matrix version(s).`,
          route: '/finance/delegation-of-authority',
          requiredAction: 'doa.manage',
        },
        {
          key: 'roles',
          name: 'Give people their roles',
          description: 'Roles decide what each person can see and do.',
          done: rolesGranted > 1,
          detail: `${rolesGranted} distinct role(s) granted.`,
          route: '/admin/users',
          requiredAction: 'users.manage',
        },
        {
          key: 'retention',
          name: 'Review data retention',
          description:
            'The periods ship as provisional defaults; finance and legal still have to sign them off.',
          done: retentionReviewed > 0,
          detail:
            retentionReviewed > 0
              ? `${retentionReviewed} categor(y/ies) reviewed.`
              : 'No category has been reviewed yet.',
          route: '/admin/retention',
          requiredAction: 'tenant.settings.manage',
        },
        {
          key: 'feature_flags',
          name: 'Choose which capabilities are on',
          description: 'Optional capabilities are off until someone turns them on.',
          done: flagsReviewed > 0,
          detail: `${flagsReviewed} flag(s) set for this tenant.`,
          route: '/admin/features',
          requiredAction: 'tenant.settings.manage',
        },
      ].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));

      return { completed: items.filter((i) => i.done).length, total: items.length, items };
    });
  }

  /**
   * A person's own activity (122). Strictly self-service: there is no person parameter, and every
   * query is filtered to the signed-in person.
   */
  myActivity(
    actor: RequestActor,
    query: { from?: string; to?: string; types?: string; limit?: number },
  ): Promise<MyActivity> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const to = query.to ?? todayUtc();
      const from =
        query.from ??
        new Date(Date.now() - DEFAULT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
      const limit = query.limit ?? DEFAULT_ACTIVITY_LIMIT;
      const wanted = query.types
        ? new Set(
            query.types
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
          )
        : null;
      const fromTs = new Date(`${from}T00:00:00.000Z`);
      const toTs = new Date(`${to}T23:59:59.999Z`);
      const personId = actor.personId;

      if (!personId) {
        return {
          personId: null,
          from,
          to,
          totals: {
            fiscalYearLabel: null,
            requestsSubmitted: 0,
            requestsApproved: 0,
            approvedTotal: null,
            eventsAttended: 0,
            eventsOrganised: 0,
          },
          entries: [],
          entryCount: 0,
        };
      }

      const auditRows = await tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.actorPersonId, personId),
            gte(auditEvents.occurredAt, fromTs),
            lte(auditEvents.occurredAt, toTs),
          ),
        )
        .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.seq))
        .limit(limit);
      const notificationRows = await tx
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.recipientPersonId, personId),
            gte(notifications.createdAt, fromTs),
            lte(notifications.createdAt, toTs),
          ),
        )
        .orderBy(desc(notifications.createdAt), asc(notifications.id))
        .limit(limit);

      const onBehalfNames = await (async () => {
        const ids = [...new Set(auditRows.map((r) => r.onBehalfOfPersonId).filter(Boolean))];
        if (!ids.length) return new Map<string, string>();
        const rows = await tx
          .select({ id: people.id, displayName: people.displayName })
          .from(people)
          .where(inArray(people.id, ids as string[]));
        return new Map(rows.map((r) => [r.id, r.displayName]));
      })();

      const entries: MyActivityEntry[] = [
        ...auditRows.map((r) => ({
          id: r.id,
          occurredAt: r.occurredAt.toISOString(),
          type: activityTypeOf(r.action, r.resourceType),
          summary: `You did ${r.action.replace(/[._]/g, ' ')} on ${r.resourceType.replace(/_/g, ' ')}`,
          itemType: r.resourceType,
          itemId: /^[0-9a-f-]{36}$/i.test(r.resourceId) ? r.resourceId : null,
          onBehalfOfName: r.onBehalfOfPersonId
            ? (onBehalfNames.get(r.onBehalfOfPersonId) ?? null)
            : null,
          byMe: true,
        })),
        ...notificationRows.map((r) => ({
          id: r.id,
          occurredAt: r.createdAt.toISOString(),
          type: activityTypeOf(r.type, r.itemType ?? 'other'),
          summary: r.title,
          itemType: r.itemType,
          itemId: r.itemId,
          onBehalfOfName: null,
          byMe: false,
        })),
      ]
        .filter((e) => !wanted || wanted.has(e.type))
        .sort(
          (a, b) =>
            b.occurredAt.localeCompare(a.occurredAt) ||
            a.summary.localeCompare(b.summary) ||
            a.id.localeCompare(b.id),
        )
        .slice(0, limit);

      const today = todayUtc();
      const [year] = await tx
        .select({
          label: fiscalYears.label,
          startDate: fiscalYears.startDate,
          endDate: fiscalYears.endDate,
        })
        .from(fiscalYears)
        .where(and(lte(fiscalYears.startDate, today), gte(fiscalYears.endDate, today)))
        .orderBy(asc(fiscalYears.startDate), asc(fiscalYears.label))
        .limit(1);

      const mine = await tx
        .select({
          status: requests.status,
          approvedMinor: requests.approvedMinor,
          amountMinor: requests.amountMinor,
          currency: requests.currency,
        })
        .from(requests)
        .where(eq(requests.requesterPersonId, personId));
      const approved = mine.filter((r) => r.status === 'approved');
      const currencies = [...new Set(approved.map((r) => r.currency))];
      const approvedTotal =
        currencies.length === 0
          ? { amountMinor: 0, currency: actor.reportingCurrency }
          : currencies.length === 1
            ? {
                amountMinor: approved.reduce(
                  (n, r) => n + Number(r.approvedMinor ?? r.amountMinor),
                  0,
                ),
                currency: currencies[0],
              }
            : null;

      const [attended] = await tx
        .select({ n: sql<string>`count(*)` })
        .from(eventParticipants)
        .where(eq(eventParticipants.personId, personId));
      const [organised] = await tx
        .select({ n: sql<string>`count(*)` })
        .from(events)
        .where(eq(events.organizerPersonId, personId));

      return {
        personId,
        from,
        to,
        totals: {
          fiscalYearLabel: year?.label ?? null,
          requestsSubmitted: mine.filter((r) => r.status !== 'draft').length,
          requestsApproved: approved.length,
          approvedTotal,
          eventsAttended: Number(attended?.n ?? 0),
          eventsOrganised: Number(organised?.n ?? 0),
        },
        entries,
        entryCount: entries.length,
      };
    });
  }
}
