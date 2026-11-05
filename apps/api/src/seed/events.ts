import { ApprovalsService } from '@bf/api/approvals';
import { ContributionsService } from '@bf/api/contributions';
import { ActorResolver, CoreModule, DB, type RequestActor } from '@bf/api/core';
import * as s from '@bf/api/db';
import type { Db } from '@bf/api/db';
import { EventsModule, EventsService } from '@bf/api/events';
import { RequestsService } from '@bf/api/spend';
import {
  BUDGETS,
  intercompanyPairPolicies,
  P5_DELEGATION,
  P5_EVENT,
  P5_REQUESTS,
  TENANTS,
  userById,
  type SeedUserId,
} from '@bf/seed';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';

@Module({ imports: [CoreModule, EventsModule] })
class EventsSeedModule {}

/**
 * Phase 5 demo data through the real commands (fixed ids and idempotency keys, so a second run
 * replays instead of posting again): the Diwali event, its funding decisions, a commitment, the
 * organizer's requests in every state and a delegation.
 */
export async function seedEvents(_app: INestApplicationContext): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(EventsSeedModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = ctx.get<Db>(DB);
    const actors = ctx.get(ActorResolver);
    const events = ctx.get(EventsService);
    const requests = ctx.get(RequestsService);
    const contributions = ctx.get(ContributionsService);
    const approvals = ctx.get(ApprovalsService);
    await db.transaction((tx) =>
      tx.insert(s.intercompanyPolicies).values(intercompanyPairPolicies).onConflictDoNothing(),
    );
    const as = (id: SeedUserId) =>
      actors.resolve(userById(id).subject, TENANTS.acme, userById(id).displayName);
    const organizer = await as(P5_EVENT.organizer);
    const approver = await as(P5_EVENT.approver);
    const giverOwner = await as('regional-manager');
    const budget = (id: string) =>
      s.withTenant(
        db,
        { tenantId: TENANTS.acme, subject: 'seed' },
        async (tx) => (await tx.select().from(s.budgets).where(eq(s.budgets.id, id)))[0],
      );
    const home = await budget(BUDGETS.bengaluru);
    const ccy = home.currency === 'INR' ? 'INR' : 'USD';
    const money = (a: { USD: number; INR: number }) => ({ amountMinor: a[ccy], currency: ccy });
    const key = (k: string) => ({ idempotencyKey: `seed:p5:${k}`, requestId: 'seed' });

    /** Decides the actor's pending task on a subject, if it is still pending (a second run finds none). */
    const decide = async (
      actor: RequestActor,
      type: 'request' | 'contribution',
      id: string,
      decision: Parameters<ApprovalsService['decide']>[2],
      k: string,
    ) => {
      const taskId = await s.withTenant(
        db,
        { tenantId: TENANTS.acme, subject: actor.subject },
        (tx) => approvals.myTask(tx, actor, type, id),
      );
      if (taskId) await approvals.decide(actor, taskId, decision, key(k));
    };

    const e = P5_EVENT;
    await events.create(
      organizer,
      {
        name: e.name,
        eventType: e.eventType,
        homeBudgetId: e.homeBudgetId,
        eventCode: e.eventCode,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        venue: e.venue,
        description: e.description,
        expectedAttendance: 230,
        toleranceBps: e.toleranceBps,
        ownFunds: money(e.ownFunds),
        locationOrgUnitIds: e.locations,
        participantPersonIds: e.participants,
        costLines: e.costLines.map((l) => ({
          category: l.category,
          description: l.description,
          quantity: l.quantity,
          unitCost: money(l.unit),
        })),
      },
      { ...key('event'), fixedId: e.id },
    );
    await events.submit(organizer, e.id, key('event:submit'));
    const ownFunds = await s.withTenant(
      db,
      { tenantId: TENANTS.acme, subject: 'seed' },
      async (tx) =>
        (
          await tx
            .select({ id: s.requests.id })
            .from(s.requests)
            .where(and(eq(s.requests.eventId, e.id), eq(s.requests.kind, 'budget')))
        )[0],
    );
    await decide(
      approver,
      'request',
      ownFunds.id,
      { decision: 'approve', noConflictAttested: true },
      'event:own-funds:approve',
    );

    const c1 = e.contributions.approved;
    await contributions.create(
      organizer,
      {
        eventId: e.id,
        giverBudgetId: c1.giverBudgetId,
        amount: money(c1.requested),
        purpose: c1.purpose,
      },
      { ...key('contribution:approved'), fixedId: c1.id },
    );
    await decide(
      giverOwner,
      'contribution',
      c1.id,
      {
        decision: 'approve_partial',
        approvedAmount: money(c1.approved),
        reasonCode: 'TRF-COFUND',
        comment: 'Funding the Hyderabad attendees; the rest comes from the Bengaluru budget.',
        noConflictAttested: true,
      },
      'contribution:approved:decide',
    );
    const c2 = e.contributions.pending;
    await contributions.create(
      organizer,
      {
        eventId: e.id,
        giverBudgetId: c2.giverBudgetId,
        amount: money(c2.requested),
        purpose: c2.purpose,
      },
      { ...key('contribution:pending'), fixedId: c2.id },
    );
    const c3 = e.contributions.crossEntity;
    // Contributions are in the event currency, so this one waits until every budget is held in USD.
    if ((await budget(c3.giverBudgetId)).currency === home.currency) {
      await contributions.create(
        organizer,
        {
          eventId: e.id,
          giverBudgetId: c3.giverBudgetId,
          amount: money(c3.requested),
          purpose: c3.purpose,
        },
        { ...key('contribution:cross-entity'), fixedId: c3.id },
      );
      await decide(
        await as(c3.giver),
        'contribution',
        c3.id,
        { decision: 'approve', noConflictAttested: true },
        'contribution:cross-entity:decide',
      );
    }
    await events.commit(
      organizer,
      e.id,
      { description: e.commitment.description, amount: money(e.commitment.amount) },
      key('event:commit'),
    );

    for (const r of P5_REQUESTS) {
      await requests.create(
        organizer,
        {
          kind: 'spending',
          budgetId: e.homeBudgetId,
          amount: money(r.amount),
          spendType: r.spendType,
          title: r.title,
          purpose: r.purpose,
          category: r.category,
          submit: r.outcome !== 'draft',
        },
        { ...key(`request:${r.id}`), fixedId: r.id },
      );
      if (r.outcome === 'approved')
        await decide(
          approver,
          'request',
          r.id,
          { decision: 'approve', noConflictAttested: true },
          `request:${r.id}:approve`,
        );
      if (r.outcome === 'rejected')
        await decide(
          approver,
          'request',
          r.id,
          {
            decision: 'reject',
            reasonCode: 'REJ-POLICY',
            comment: 'reason' in r ? r.reason : 'Rejected',
            noConflictAttested: false,
          },
          `request:${r.id}:reject`,
        );
    }

    const d = P5_DELEGATION;
    const existing = await s.withTenant(db, { tenantId: TENANTS.acme, subject: 'seed' }, (tx) =>
      tx
        .select({ id: s.approvalDelegations.id })
        .from(s.approvalDelegations)
        .where(eq(s.approvalDelegations.reason, d.reason)),
    );
    if (!existing.length) {
      await approvals.createDelegation(
        await as(d.delegator),
        {
          delegatePersonId: userById(d.delegate).personId!,
          limit: { amountMinor: d.limitMinor, currency: d.currency },
          validFrom: d.validFrom,
          validTo: d.validTo,
          reason: d.reason,
        },
        key('delegation'),
      );
    }
  } finally {
    await ctx.close();
  }
}
