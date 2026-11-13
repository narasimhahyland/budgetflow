import { AiEvaluationsService } from '@bf/api/ai';
import { DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import { withTenant, type Db } from '@bf/api/db';
import { AI_SEED_DOCUMENTS, AI_SEED_FEATURES, AI_SEED_SETTINGS, TENANTS, userById } from '@bf/seed';
import type { INestApplicationContext } from '@nestjs/common';
import { eq } from 'drizzle-orm';

/**
 * Phase 13 fixtures: the AI feature switches and settings of 113a, the receipt and quote files the
 * offline recorded provider has recorded answers for, and one evaluation run per feature so the
 * accuracy tab has figures the moment the stack comes up. Idempotent.
 *
 * Switches are seeded for Hyland and the two scenario tenants so cross-tenant checks can ask as a
 * Globex user and get only Globex data.
 */
export async function seedAi(app: INestApplicationContext): Promise<void> {
  const db = app.get<Db>(DB);
  const evaluations = app.get(AiEvaluationsService);
  const employee = userById('employee');

  for (const tenantId of [TENANTS.acme, TENANTS.globex, TENANTS.sandbox]) {
    await withTenant(db, { tenantId, subject: 'seed' }, async (tx) => {
      for (const feature of AI_SEED_FEATURES) {
        await tx
          .insert(s.featureFlags)
          .values({ tenantId, key: feature.key, enabled: feature.enabled })
          .onConflictDoUpdate({
            target: [s.featureFlags.tenantId, s.featureFlags.key],
            set: { enabled: feature.enabled },
          });
      }
      const [row] = await tx
        .select({ settings: s.tenantSettings.settings })
        .from(s.tenantSettings)
        .where(eq(s.tenantSettings.tenantId, tenantId));
      const settings = { ...((row?.settings ?? {}) as Record<string, unknown>) };
      settings['ai'] = { ...((settings['ai'] as object) ?? {}), settings: AI_SEED_SETTINGS };
      await tx
        .insert(s.tenantSettings)
        .values({ tenantId, settings })
        .onConflictDoUpdate({ target: s.tenantSettings.tenantId, set: { settings } });
    });
  }

  await withTenant(db, { tenantId: TENANTS.acme, subject: 'seed' }, async (tx) => {
    await tx
      .insert(s.documents)
      .values(
        AI_SEED_DOCUMENTS.map((d) => ({
          ...d,
          uploadedByPersonId: employee.personId,
          verifiedAt: new Date('2026-11-05T09:00:00Z'),
        })),
      )
      .onConflictDoNothing();
    await evaluations.seedRun(tx, TENANTS.acme);
  });
}
