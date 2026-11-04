import { AccrualsService, ImportsService, QueueService, TieOutService } from '@bf/api/actuals';
import { AuditService } from '@bf/api/audit';
import { ActorResolver, DB, unwrap } from '@bf/api/core';
import * as s from '@bf/api/db';
import { withTenant, type Db, type Tx } from '@bf/api/db';
import { LedgerReads, LedgerService, toPostingBudget } from '@bf/api/ledger';
import { postCommitmentMovement, type CurrencyCode } from '@bf/domain';
import {
  ACTUALS_COMMITMENTS,
  ACTUALS_EVENTS,
  ACTUALS_MAPPING_RULE,
  actualsCommitmentsData,
  actualsEventsData,
  CARD_FEED_NOV_2026,
  COST_CENTERS,
  ERP_FEED_NOV_2026,
  HYLAND_ENTITIES,
  SEED_ACCOUNTING_DATE,
  TENANTS,
  userById,
} from '@bf/seed';
import type { INestApplicationContext } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

const T = TENANTS.acme;
const AS_OF = '2026-11-05';

/** General ledger balances (fictional) for the November tie-outs: India includes travel BudgetFlow has not matched yet. */
const GL_FILES = {
  india: {
    fileName: 'gl-trial-balance-HYL-IN-2026-11.csv',
    content: [
      'cost_center,gl_account,amount,currency',
      'CC-IN-BLR-200,6100,140350.00,INR',
      'CC-IN-HYD-210,6100,52000.00,INR',
      'CC-IN-HYD-210,6140,66440.00,INR',
    ].join('\n'),
  },
  us: {
    fileName: 'gl-trial-balance-HYL-US-2026-11.csv',
    content: ['cost_center,gl_account,amount,currency', 'CC-US-NYC-300,6100,4800.00,USD'].join(
      '\n',
    ),
  },
};

async function glAccountId(tx: Tx, legalEntityId: string, code: string): Promise<string | null> {
  const [g] = await tx
    .select({ id: s.glAccounts.id })
    .from(s.glAccounts)
    .where(and(eq(s.glAccounts.legalEntityId, legalEntityId), eq(s.glAccounts.code, code)));
  return g?.id ?? null;
}

/**
 * Phase 6 fixtures: events, encumbered commitments (posted through the ledger with the domain builder),
 * a mapping rule, the November ERP and card feeds (imported and posted), a deposit matched as a
 * prepaid, accrual proposals and the November GL tie-outs. Idempotent: fixed ids and idempotency keys.
 */
export async function seedActuals(app: INestApplicationContext): Promise<void> {
  const db = app.get<Db>(DB);
  const ledger = app.get(LedgerService);
  const ledgerReads = app.get(LedgerReads);
  const audit = app.get(AuditService);
  const actors = app.get(ActorResolver);
  const fc = userById('finance-controller');
  const fa = userById('finance-admin');
  const controller = await actors.resolve(fc.subject, T, fc.displayName);
  const admin = await actors.resolve(fa.subject, T, fa.displayName);

  await withTenant(db, { tenantId: T, subject: fa.subject }, async (tx) => {
    for (const e of actualsEventsData) {
      await tx
        .insert(s.events)
        .values({
          id: e.id,
          tenantId: T,
          name: e.name,
          eventType: e.eventType,
          status: e.status,
          organizerPersonId: userById(e.organizer).personId!,
          legalEntityId: e.legalEntityId,
          costCenterId: e.costCenterId,
          eventCode: e.eventCode,
          budgetId: e.budgetId,
          currency: e.currency,
          estimateMinor: e.estimateMinor,
        })
        .onConflictDoNothing();
    }
    const vendorRows = await tx.select({ id: s.vendors.id, name: s.vendors.name }).from(s.vendors);
    for (const c of actualsCommitmentsData) {
      const inserted = await tx
        .insert(s.commitments)
        .values({
          id: c.id,
          tenantId: T,
          budgetId: c.budgetId,
          eventId: c.eventId,
          status: 'pre_encumbered',
          vendorId: c.vendor ? (vendorRows.find((v) => v.name === c.vendor)?.id ?? null) : null,
          legalEntityId: c.legalEntityId,
          costCenterId: c.costCenterId,
          glAccountId: await glAccountId(tx, c.legalEntityId, c.glAccount),
          description: c.description,
          serviceStart: c.serviceStart,
          serviceEnd: c.serviceEnd,
          amountMinor: c.amountMinor,
          currency: c.currency,
          nonRefundableDepositMinor: c.nonRefundableDepositMinor,
        })
        .onConflictDoNothing()
        .returning({ id: s.commitments.id });
      if (inserted.length === 0) continue;
      await ledgerReads.lockBudgets(tx, [c.budgetId]);
      const budget = toPostingBudget(
        (await ledgerReads.budgetRows(tx, [c.budgetId])).get(c.budgetId)!,
      );
      const ctx = {
        reportingCurrency: admin.reportingCurrency,
        rates: await ledgerReads.planRates(tx, budget.fiscalYearId),
        accountingDate: SEED_ACCOUNTING_DATE,
      };
      for (const kind of ['pre_encumber', 'encumber'] as const) {
        const balances = (await ledgerReads.balances(tx, [budget.id])).get(budget.id)!.budget;
        const draft = unwrap(
          postCommitmentMovement(
            {
              kind,
              budget: { ...budget, balances },
              amount: { amountMinor: c.amountMinor, currency: c.currency as CurrencyCode },
              provenance: { commitmentId: c.id, eventId: c.eventId },
            },
            ctx,
          ),
        );
        await ledger.post(tx, draft, {
          actor: admin,
          command: 'seed.commitment',
          fiscalYearId: budget.fiscalYearId,
          requestId: 'seed',
          idempotencyKey: `seed:commitment:${kind}:${c.id}`,
        });
      }
      await tx
        .update(s.commitments)
        .set({ status: 'encumbered' })
        .where(eq(s.commitments.id, c.id));
      await audit.append(tx, {
        tenantId: T,
        actorPersonId: admin.personId,
        actorSubject: admin.subject,
        action: 'commitment.encumbered',
        resourceType: 'commitment',
        resourceId: c.id,
        legalEntityId: c.legalEntityId,
        requestId: 'seed',
        reason: 'Seed fixture',
        changes: {
          status: { from: null, to: 'encumbered' },
          amountMinor: { from: null, to: c.amountMinor },
        },
      });
    }
    await tx
      .insert(s.actualMappingRules)
      .values({
        id: ACTUALS_MAPPING_RULE,
        tenantId: T,
        name: 'Hyderabad ground transport to Hack Week',
        priority: 10,
        match: {
          costCenterId: COST_CENTERS.hyderabad,
          glAccountId: (await glAccountId(tx, HYLAND_ENTITIES.india, '6140')) ?? undefined,
        },
        targetEventId: ACTUALS_EVENTS.hyderabadHackWeek,
        createdBy: admin.personId,
      })
      .onConflictDoNothing();
  });

  const imports = app.get(ImportsService);
  const queue = app.get(QueueService);
  const accruals = app.get(AccrualsService);
  const tieouts = app.get(TieOutService);
  const seedCtx = (key: string) => ({ idempotencyKey: `seed:actuals:${key}`, requestId: 'seed' });

  for (const feed of [ERP_FEED_NOV_2026, CARD_FEED_NOV_2026]) {
    const up = await imports.upload(
      controller,
      { source: feed.source, fileName: feed.fileName, content: feed.content },
      seedCtx(`upload:${feed.fileName}`),
    );
    await imports.post(controller, up.body.id, seedCtx(`post:${feed.fileName}`));
  }

  const deposit = await withTenant(
    db,
    { tenantId: T, subject: fc.subject },
    async (tx) =>
      (
        await tx
          .select()
          .from(s.actuals)
          .where(and(eq(s.actuals.source, 'erp'), eq(s.actuals.sourceRef, 'ERP-2611-0007')))
      )[0],
  );
  if (deposit && deposit.matchStatus === 'unmatched') {
    await queue.match(
      controller,
      deposit.id,
      {
        parts: [{ commitmentId: ACTUALS_COMMITMENTS.annualDayVenue }],
        prepaid: { serviceStart: '2026-12-05', serviceEnd: '2026-12-06', nonRefundable: true },
        note: 'Venue deposit, consumed when the venue is used',
      },
      seedCtx('prepaid:ERP-2611-0007'),
    );
  }

  const proposed = await accruals.propose(
    controller,
    { asOfDate: AS_OF },
    seedCtx(`accruals:${AS_OF}`),
  );
  const hackWeek = proposed.body.items.find(
    (a) => a.commitmentId === ACTUALS_COMMITMENTS.hackWeekVenue,
  );
  if (hackWeek)
    await accruals.approve(
      controller,
      hackWeek.id,
      seedCtx(`accrual:approve:${hackWeek.commitmentId}`),
    );

  await tieouts.create(
    controller,
    {
      legalEntityId: HYLAND_ENTITIES.india,
      month: '2026-11',
      toleranceMinor: 5_000,
      ...GL_FILES.india,
    },
    seedCtx('tieout:HYL-IN:2026-11'),
  );
  await tieouts.create(
    controller,
    { legalEntityId: HYLAND_ENTITIES.us, month: '2026-11', toleranceMinor: 5_000, ...GL_FILES.us },
    seedCtx('tieout:HYL-US:2026-11'),
  );
}
