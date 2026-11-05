import 'reflect-metadata';
import { ActualsModule } from '@bf/api/actuals';
import { AuditModule } from '@bf/api/audit';
import { BudgetsModule, BudgetsService } from '@bf/api/budgets';
import { ActorResolver, CoreModule, DB } from '@bf/api/core';
import type { Db } from '@bf/api/db';
import { LedgerModule } from '@bf/api/ledger';
import { budgetSteps, SEED_ACCOUNTING_DATE, userById } from '@bf/seed';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SEED_EXTENSIONS } from './seed/extensions';
import { seedReference } from './seed/reference';

// Deterministic seed for the Hyland tenant and the scenario-only Globex and Initech Sandbox tenants. Reference data is
// inserted with fixed ids; budgets and allocations go through the real commands with fixed idempotency
// keys, so running the seed again changes nothing. Runs as the owner role (scripts/stack.sh seed).
const ownerUrl = process.env.DATABASE_URL_OWNER;
if (!ownerUrl) {
  console.error('seed: DATABASE_URL_OWNER is not set');
  process.exit(1);
}
process.env.DATABASE_URL = ownerUrl;
process.env.KEYCLOAK_ISSUER ??= 'http://localhost:8080/realms/budgetflow';

@Module({ imports: [CoreModule, AuditModule, LedgerModule, BudgetsModule, ActualsModule] })
class SeedModule {}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error', 'warn'] });
  try {
    await seedReference(app.get<Db>(DB));
    const actors = app.get(ActorResolver);
    const budgets = app.get(BudgetsService);
    let created = 0;
    let allocated = 0;
    for (const step of budgetSteps) {
      const as = userById(step.as);
      const actor = await actors.resolve(as.subject, step.tenantId, as.displayName);
      if (step.kind === 'create') {
        const r = await budgets.create(
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
            currency: step.currency,
            fiscalYearId: step.fiscalYearId,
            planVersionId: step.planVersionId,
            originalAmount: step.originalAmount,
            accountingDate: SEED_ACCOUNTING_DATE,
          },
          { idempotencyKey: `seed:create:${step.id}`, requestId: 'seed', fixedId: step.id },
        );
        if (!r.replayed) created++;
      } else {
        const r = await budgets.allocate(
          actor,
          step.parentId,
          {
            childBudgetId: step.childId,
            amount: step.amount,
            accountingDate: SEED_ACCOUNTING_DATE,
            memo: 'Seed allocation',
          },
          { idempotencyKey: `seed:allocate:${step.parentId}:${step.childId}`, requestId: 'seed' },
        );
        if (!r.replayed) allocated++;
      }
    }
    for (const extension of SEED_EXTENSIONS) {
      await extension.run(app);
      console.log(`seed: ${extension.phase} ${extension.name} ready`);
    }
    console.log(
      `seed: reference data ready; ${created} budget(s) created and ${allocated} allocation(s) posted (0 means already seeded)`,
    );
  } finally {
    await app.close();
  }
}

main().catch((e: Error) => {
  console.error(`seed: failed: ${e.stack ?? e.message}`);
  process.exit(1);
});
