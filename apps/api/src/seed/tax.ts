import { ActorResolver, DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import { withTenant, type Db } from '@bf/api/db';
import { BenefitsService } from '@bf/api/finance';
import {
  BENEFIT_ENTRY_SEED,
  BENEFIT_THRESHOLD_SEED,
  TAX_SEED,
  TAX_SEED_RULES,
  TENANTS,
  taxSeedRuleId,
  userById,
} from '@bf/seed';
import type { INestApplicationContext } from '@nestjs/common';
import { eq } from 'drizzle-orm';

/**
 * Gap B3 (decision D3): a published tax recoverability rule set and three benefit thresholds with
 * fictional rates for the tax approver to review, plus five benefits recorded by finance through the
 * real command (audited, reporting view at the locked plan rate). Idempotent: fixed ids and keys.
 *
 * The rule set is written as a draft, given its rules, then published: the database lets rules
 * change only while their set is a draft, and a published set never changes again.
 */
export async function seedTax(app: INestApplicationContext): Promise<void> {
  const db = app.get<Db>(DB);
  const T = TENANTS.acme;
  const financeAdmin = userById('finance-admin');
  const controller = userById('finance-controller');

  await withTenant(db, { tenantId: T, subject: 'seed' }, async (tx) => {
    const [existing] = await tx
      .select({ id: s.taxRuleSets.id })
      .from(s.taxRuleSets)
      .where(eq(s.taxRuleSets.id, TAX_SEED.ruleSetId));
    if (!existing) {
      await tx.insert(s.taxRuleSets).values({
        id: TAX_SEED.ruleSetId,
        tenantId: T,
        version: 1,
        status: 'draft',
        createdByPersonId: financeAdmin.personId,
      });
      await tx.insert(s.taxRules).values(
        TAX_SEED_RULES.map(
          ([legalEntityId, categoryCode, attendeeType, taxCode, bps, prop], i) => ({
            id: taxSeedRuleId(i),
            tenantId: T,
            ruleSetId: TAX_SEED.ruleSetId,
            legalEntityId,
            categoryCode,
            attendeeType,
            taxCode,
            recoverableBps: bps,
            proportional: prop,
            notes: 'Placeholder for review by the tax approver; not tax advice.',
          }),
        ),
      );
      await tx
        .update(s.taxRuleSets)
        .set({
          status: 'published',
          effectiveFrom: TAX_SEED.effectiveFrom,
          submittedByPersonId: financeAdmin.personId,
          submittedAt: new Date('2025-12-15T10:00:00Z'),
          decidedByPersonId: controller.personId,
          decidedAt: new Date('2025-12-18T10:00:00Z'),
        })
        .where(eq(s.taxRuleSets.id, TAX_SEED.ruleSetId));
    }
    await tx
      .insert(s.benefitThresholds)
      .values(
        BENEFIT_THRESHOLD_SEED.map((t) => ({
          ...t,
          tenantId: T,
          version: 1,
          status: 'published',
          effectiveFrom: TAX_SEED.effectiveFrom,
          createdByPersonId: financeAdmin.personId,
          submittedByPersonId: financeAdmin.personId,
          submittedAt: new Date('2025-12-15T10:00:00Z'),
          decidedByPersonId: controller.personId,
          decidedAt: new Date('2025-12-18T10:00:00Z'),
        })),
      )
      .onConflictDoNothing();
  });

  const actor = await app
    .get(ActorResolver)
    .resolve(financeAdmin.subject, T, financeAdmin.displayName);
  const benefits = app.get(BenefitsService, { strict: false });
  for (const e of BENEFIT_ENTRY_SEED) {
    await benefits.recordManual(
      actor,
      {
        personId: e.personId,
        entryDate: e.entryDate,
        benefitType: e.benefitType,
        amount: { amountMinor: e.amountMinor, currency: e.currency },
        description: e.description,
      },
      { idempotencyKey: `seed:benefit:${e.key}`, requestId: 'seed' },
    );
  }
}
