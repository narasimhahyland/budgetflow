import {
  AllocationService,
  BudgetsService,
  ControlsService,
  PlanningService,
} from '@bf/api/budgets';
import { ActorResolver, ApiProblem, DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import type { Db } from '@bf/api/db';
import {
  BENGALURU_LIMITS,
  FISCAL_YEARS,
  P4_TENANT,
  p4Steps,
  PER_HEAD_RATE_MINOR,
  SEED_ACCOUNTING_DATE,
  TEMPLATE_DEFAULTS,
  userById,
  type SeedUserId,
} from '@bf/seed';
import type { INestApplicationContext } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

/**
 * Phase 4 budgets: program template defaults, then demo budgets through the real commands with fixed
 * idempotency keys (a replay returns the first result, so running the seed again changes nothing).
 */
export async function seedBudgets(app: INestApplicationContext): Promise<void> {
  const db = app.get<Db>(DB);
  await db.transaction(async (tx) => {
    for (const [code, defaults] of Object.entries(TEMPLATE_DEFAULTS)) {
      await tx
        .update(s.programTemplates)
        .set({ defaults })
        .where(
          and(
            eq(s.programTemplates.tenantId, P4_TENANT),
            eq(s.programTemplates.code, code),
            sql`${s.programTemplates.defaults} = '{}'::jsonb`,
          ),
        );
    }
  });
  const actors = app.get(ActorResolver);
  const budgets = app.get(BudgetsService);
  const controls = app.get(ControlsService);
  const allocation = app.get(AllocationService);
  const planning = app.get(PlanningService);
  const as = (id: SeedUserId) => {
    const u = userById(id);
    return actors.resolve(u.subject, P4_TENANT, u.displayName);
  };
  const ctx = (key: string) => ({ idempotencyKey: `seed:p4:${key}`, requestId: 'seed' });
  const perHead = TEMPLATE_DEFAULTS['PER-HEAD-ENGAGEMENT'] as {
    eligibleTypes: ('employee' | 'intern')[];
  };
  for (const [i, step] of p4Steps.entries()) {
    const actor = await as(step.as);
    switch (step.kind) {
      case 'create':
        await budgets.create(
          actor,
          {
            name: step.name,
            code: step.code,
            parentId: step.parentId ?? null,
            legalEntityId: step.legalEntityId,
            costCenterId: step.costCenterId ?? null,
            orgUnitId: step.orgUnitId ?? null,
            ownerPersonId: userById(step.owner).personId,
            categoryCode: step.categoryCode,
            budgetType: step.budgetType,
            fiscalYearId: FISCAL_YEARS.acmeFy2026,
            planVersionId: step.planVersionId,
            originalAmount: step.originalAmount,
            accountingDate: SEED_ACCOUNTING_DATE,
          },
          { ...ctx(`create:${step.id}`), fixedId: step.id },
        );
        break;
      case 'allocate':
        await budgets.allocate(
          actor,
          step.parentId,
          {
            childBudgetId: step.childId,
            amount: { amountMinor: step.amountMinor, currency: 'USD' },
            accountingDate: SEED_ACCOUNTING_DATE,
            memo: 'Seed allocation',
          },
          ctx(`allocate:${step.childId}`),
        );
        break;
      case 'transfer':
        await controls.transfer(
          actor,
          step.fromId,
          {
            toBudgetId: step.toId,
            amountMinor: step.amountMinor,
            reasonCode: 'TRF-REBALANCE',
            reason: step.reason,
            accountingDate: SEED_ACCOUNTING_DATE,
          },
          ctx(`transfer:${i}`),
        );
        break;
      case 'per_head':
        await allocation.perHead(
          actor,
          step.parentId,
          {
            childBudgetId: step.childId,
            rateMinor: PER_HEAD_RATE_MINOR,
            eligibleTypes: perHead.eligibleTypes,
            prorate: true,
            // The first HR import; the 1 November refresh leaves a true-up to review.
            asOf: '2026-10-31',
            dryRun: false,
          },
          ctx(`per-head:${step.childId}`),
        );
        break;
      case 'freeze':
        await controls.freeze(
          actor,
          step.id,
          { reasonCode: step.reasonCode, reason: step.reason },
          ctx(`freeze:${step.id}`),
        );
        break;
      case 'zero': {
        const preview = await controls
          .preview(actor, step.id, { action: 'set_to_zero', destination: 'parent' })
          .catch((e: unknown) => (e instanceof ApiProblem ? null : Promise.reject(e)));
        await controls.setToZero(
          actor,
          step.id,
          {
            reasonCode: step.reasonCode,
            reason: step.reason,
            destination: 'parent',
            confirmedFloorMinor: preview?.floorMinor ?? 0,
            confirmText: step.code,
          },
          ctx(`zero:${step.id}`),
        );
        break;
      }
      case 'increase':
        await allocation.requestIncrease(
          actor,
          step.id,
          { amountMinor: step.amountMinor, reason: step.reason },
          ctx(`increase:${step.id}`),
        );
        break;
      case 'release':
        await allocation.requestRelease(
          actor,
          step.reserveId,
          { toBudgetId: step.toId, amountMinor: step.amountMinor, reason: step.reason },
          ctx(`release:${step.toId}`),
        );
        break;
      case 'phase':
        await planning.setPhasing(actor, step.id, { method: 'even' }, ctx(`phase:${step.id}`));
        break;
      case 'limits':
        await planning.setLimits(
          actor,
          step.id,
          { items: BENGALURU_LIMITS, reason: 'Per-person and event caps for Bengaluru' },
          ctx(`limits:${step.id}`),
        );
        break;
    }
  }
}
