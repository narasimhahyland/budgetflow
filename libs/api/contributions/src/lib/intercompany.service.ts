import { ApiProblem, PolicyService, unwrap, type RequestActor } from '@bf/api/core';
import { AuditService } from '@bf/api/audit';
import {
  contributionRequests,
  events,
  intercompanyPolicies,
  legalEntities,
  rechargeSchedules,
  tenantSettings,
  type Tx,
} from '@bf/api/db';
import { personNames } from '@bf/api/approvals';
import { PostingSupport, todayUtc, type PostCtx } from '@bf/api/spend';
import type { IntercompanyPolicyView, RechargeView } from '@bf/contracts';
import {
  postIntercompanyRecharge,
  rechargeMachine,
  resolveIntercompany,
  type CurrencyCode,
  type IntercompanyMode,
  type IntercompanyPolicy,
  type IntercompanyTreatment,
  type Result,
} from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';

type RechargeRow = typeof rechargeSchedules.$inferSelect;
export interface PolicyMatch extends IntercompanyPolicy {
  id: string | null;
}

/**
 * Intercompany policy on cross-entity contributions (block, recharge at cost, recharge with markup,
 * tax approver) and the recharge schedule with its balanced due-to / due-from journal.
 */
@Injectable()
export class IntercompanyService {
  constructor(
    private readonly posting: PostingSupport,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
  ) {}

  /** The most specific active policy for a pair (exact pair, then from-only, to-only, tenant-wide), else the tenant default. */
  async policyFor(
    tx: Tx,
    fromEntityId: string,
    toEntityId: string,
    date = todayUtc(),
  ): Promise<PolicyMatch> {
    const rows = await tx
      .select()
      .from(intercompanyPolicies)
      .where(
        and(
          lte(intercompanyPolicies.validFrom, date),
          or(isNull(intercompanyPolicies.validTo), gte(intercompanyPolicies.validTo, date)),
          or(
            isNull(intercompanyPolicies.fromLegalEntityId),
            eq(intercompanyPolicies.fromLegalEntityId, fromEntityId),
          ),
          or(
            isNull(intercompanyPolicies.toLegalEntityId),
            eq(intercompanyPolicies.toLegalEntityId, toEntityId),
          ),
        ),
      );
    const score = (r: (typeof rows)[number]) =>
      (r.fromLegalEntityId ? 2 : 0) + (r.toLegalEntityId ? 1 : 0);
    rows.sort((a, b) => score(b) - score(a) || b.validFrom.localeCompare(a.validFrom));
    const best = rows[0];
    if (best)
      return {
        id: best.id,
        mode: best.mode,
        markupBps: best.markupBps,
        taxApproverPersonId: best.taxApproverPersonId,
      };
    const [settings] = await tx.select().from(tenantSettings);
    return {
      id: null,
      mode: settings?.defaultIntercompanyMode ?? 'block',
      markupBps: 0,
      taxApproverPersonId: null,
    };
  }

  async treatment(
    tx: Tx,
    giverEntityId: string,
    receiverEntityId: string,
    amountMinor: number,
  ): Promise<{ policy: PolicyMatch; result: Result<IntercompanyTreatment> }> {
    const policy = await this.policyFor(tx, giverEntityId, receiverEntityId);
    return {
      policy,
      result: resolveIntercompany(policy, giverEntityId, receiverEntityId, amountMinor),
    };
  }

  /** Creates the recharge for an approved cross-entity contribution; posts it now unless a tax approver must sign off. */
  async scheduleRecharge(
    tx: Tx,
    c: PostCtx,
    input: {
      contributionId: string;
      eventId: string | null;
      fromEntityId: string;
      toEntityId: string;
      policy: PolicyMatch;
      treatment: Extract<IntercompanyTreatment, { kind: 'recharge' }>;
      amount: { amountMinor: number; currency: string };
    },
  ): Promise<RechargeRow> {
    const needsTax = input.treatment.requiresTaxApproval;
    const [row] = await tx
      .insert(rechargeSchedules)
      .values({
        tenantId: c.actor.tenantId,
        contributionRequestId: input.contributionId,
        eventId: input.eventId,
        fromLegalEntityId: input.fromEntityId,
        toLegalEntityId: input.toEntityId,
        mode: input.policy.mode,
        amountMinor: input.amount.amountMinor,
        markupMinor: input.treatment.markupMinor,
        markupBps: input.policy.markupBps,
        currency: input.amount.currency,
        status: unwrap(
          rechargeMachine.next('proposed', needsTax ? 'request_tax_approval' : 'approve'),
        ),
        taxApproverPersonId: input.policy.taxApproverPersonId,
      })
      .returning();
    return needsTax ? row : this.postRecharge(tx, c, row);
  }

  private async postRecharge(tx: Tx, c: PostCtx, row: RechargeRow): Promise<RechargeRow> {
    const draft = unwrap(
      postIntercompanyRecharge(
        {
          fromLegalEntityId: row.fromLegalEntityId,
          toLegalEntityId: row.toLegalEntityId,
          amount: {
            amountMinor: row.amountMinor + row.markupMinor,
            currency: row.currency as CurrencyCode,
          },
          contributionId: row.contributionRequestId,
        },
        {
          reportingCurrency: c.actor.reportingCurrency,
          rates: [],
          accountingDate: todayUtc(),
        },
      ),
    );
    const [journalId] = await this.posting.post(tx, [draft], null, c);
    const [updated] = await tx
      .update(rechargeSchedules)
      .set({ journalId })
      .where(eq(rechargeSchedules.id, row.id))
      .returning();
    return updated;
  }

  /** The tax approver signs off a pending recharge; the balanced due-to / due-from journal posts. */
  async approve(
    tx: Tx,
    c: PostCtx & { actor: RequestActor },
    rechargeId: string,
  ): Promise<RechargeRow> {
    const [row] = await tx
      .select()
      .from(rechargeSchedules)
      .where(eq(rechargeSchedules.id, rechargeId))
      .for('update');
    if (!row) throw ApiProblem.notFound('recharge');
    if (row.taxApproverPersonId !== c.actor.personId) {
      throw ApiProblem.forbidden(
        'Only the tax approver named in the intercompany policy can approve this recharge.',
      );
    }
    const status = unwrap(rechargeMachine.next(row.status, 'approve'));
    await tx
      .update(rechargeSchedules)
      .set({ status, taxApprovedAt: new Date() })
      .where(eq(rechargeSchedules.id, row.id));
    const posted = await this.postRecharge(tx, c, { ...row, status });
    await this.audit.append(tx, {
      tenantId: c.actor.tenantId,
      actorPersonId: c.actor.personId,
      actorSubject: c.actor.subject,
      action: 'recharge.approved',
      resourceType: 'recharge',
      resourceId: row.id,
      legalEntityId: row.fromLegalEntityId,
      requestId: c.requestId,
      changes: {
        status: { from: row.status, to: status },
        journalId: { from: null, to: posted.journalId },
        total: {
          from: null,
          to: { amountMinor: row.amountMinor + row.markupMinor, currency: row.currency },
        },
      },
    });
    return posted;
  }

  async views(tx: Tx, actor: RequestActor, rows: RechargeRow[]): Promise<RechargeView[]> {
    if (!rows.length) return [];
    const entities = new Map(
      (await tx.select({ id: legalEntities.id, name: legalEntities.name }).from(legalEntities)).map(
        (e) => [e.id, e.name],
      ),
    );
    const contributionIds = rows
      .map((r) => r.contributionRequestId)
      .filter((x): x is string => Boolean(x));
    const contribs = contributionIds.length
      ? await tx
          .select({ id: contributionRequests.id, ref: contributionRequests.ref })
          .from(contributionRequests)
          .where(inArray(contributionRequests.id, contributionIds))
      : [];
    const eventIds = rows.map((r) => r.eventId).filter((x): x is string => Boolean(x));
    const evs = eventIds.length
      ? await tx
          .select({ id: events.id, name: events.name })
          .from(events)
          .where(inArray(events.id, eventIds))
      : [];
    const names = await personNames(
      tx,
      rows.map((r) => r.taxApproverPersonId),
    );
    return rows.map((r) => {
      const m = (amountMinor: number) => ({ amountMinor, currency: r.currency });
      return {
        id: r.id,
        contributionId: r.contributionRequestId,
        contributionRef: contribs.find((x) => x.id === r.contributionRequestId)?.ref ?? null,
        eventId: r.eventId,
        eventName: evs.find((e) => e.id === r.eventId)?.name ?? null,
        fromLegalEntityId: r.fromLegalEntityId,
        fromEntityName: entities.get(r.fromLegalEntityId) ?? '',
        toLegalEntityId: r.toLegalEntityId,
        toEntityName: entities.get(r.toLegalEntityId) ?? '',
        mode: r.mode as IntercompanyMode,
        amount: m(r.amountMinor),
        markup: m(r.markupMinor),
        total: m(r.amountMinor + r.markupMinor),
        markupBps: r.markupBps,
        status: r.status,
        taxApproverName: r.taxApproverPersonId ? (names.get(r.taxApproverPersonId) ?? null) : null,
        taxApprovedAt: r.taxApprovedAt?.toISOString() ?? null,
        journalId: r.journalId,
        canApprove: r.status === 'pending_tax_approval' && r.taxApproverPersonId === actor.personId,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  byIds(tx: Tx, ids: readonly string[]): Promise<RechargeRow[]> {
    return ids.length
      ? tx
          .select()
          .from(rechargeSchedules)
          .where(inArray(rechargeSchedules.id, [...ids]))
      : Promise.resolve([]);
  }

  async list(tx: Tx, actor: RequestActor, eventId?: string): Promise<RechargeRow[]> {
    const tenantWide = this.policy.can(actor, 'budget.read', {
      kind: 'budget',
      tenantId: actor.tenantId,
      id: '',
      path: '/',
    }).allowed;
    const rows = await tx
      .select()
      .from(rechargeSchedules)
      .where(eventId ? eq(rechargeSchedules.eventId, eventId) : undefined)
      .orderBy(desc(rechargeSchedules.createdAt))
      .limit(200);
    return tenantWide || eventId
      ? rows
      : rows.filter((r) => r.taxApproverPersonId === actor.personId);
  }

  /** Cross-entity contributions of an event whose recharge is not yet approved (blocks close). */
  async missingRecharges(tx: Tx, eventId: string): Promise<number> {
    const rows = await tx
      .select({
        id: contributionRequests.id,
        recharge: contributionRequests.rechargeScheduleId,
        mode: contributionRequests.intercompanyMode,
      })
      .from(contributionRequests)
      .where(
        and(
          eq(contributionRequests.eventId, eventId),
          inArray(contributionRequests.status, ['earmarked', 'transferred']),
        ),
      );
    const cross = rows.filter((r) => r.mode && r.mode !== 'block');
    if (!cross.length) return 0;
    const ids = cross.map((r) => r.recharge).filter((x): x is string => Boolean(x));
    const done = ids.length
      ? await tx
          .select({ id: rechargeSchedules.id })
          .from(rechargeSchedules)
          .where(
            and(
              inArray(rechargeSchedules.id, ids),
              inArray(rechargeSchedules.status, ['approved', 'scheduled', 'exported', 'posted']),
            ),
          )
      : [];
    return cross.length - done.length;
  }

  async policies(tx: Tx): Promise<IntercompanyPolicyView[]> {
    const rows = await tx
      .select()
      .from(intercompanyPolicies)
      .orderBy(intercompanyPolicies.validFrom);
    const entities = new Map(
      (await tx.select({ id: legalEntities.id, name: legalEntities.name }).from(legalEntities)).map(
        (e) => [e.id, e.name],
      ),
    );
    const names = await personNames(
      tx,
      rows.map((r) => r.taxApproverPersonId),
    );
    return rows.map((r) => ({
      id: r.id,
      fromLegalEntityId: r.fromLegalEntityId,
      fromEntityName: r.fromLegalEntityId ? (entities.get(r.fromLegalEntityId) ?? null) : null,
      toLegalEntityId: r.toLegalEntityId,
      toEntityName: r.toLegalEntityId ? (entities.get(r.toLegalEntityId) ?? null) : null,
      mode: r.mode,
      markupBps: r.markupBps,
      taxApproverName: r.taxApproverPersonId ? (names.get(r.taxApproverPersonId) ?? null) : null,
      validFrom: r.validFrom,
      validTo: r.validTo,
    }));
  }
}
