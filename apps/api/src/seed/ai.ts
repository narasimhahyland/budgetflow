import { AiEvaluationsService } from '@bf/api/ai';
import { DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import { withTenant, type Db } from '@bf/api/db';
import {
  AI_SEED_DOCUMENTS,
  AI_SEED_FEATURES,
  AI_SEED_REPORTED_ANSWERS,
  AI_SEED_SETTINGS,
  TENANTS,
  userById,
} from '@bf/seed';
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
    // Gap B9: the reported answers of 113a, each on its own one-turn conversation.
    for (const r of AI_SEED_REPORTED_ANSWERS) {
      const reporter = userById(r.reporter);
      const reportedAt = new Date(r.reportedAt);
      await tx
        .insert(s.aiConversations)
        .values({
          id: r.conversationId,
          tenantId: TENANTS.acme,
          personId: reporter.personId,
          actorSubject: reporter.subject,
          title: r.question,
          channel: 'web',
          startedAt: reportedAt,
          lastAskedAt: reportedAt,
        })
        .onConflictDoNothing();
      await tx
        .insert(s.aiConversationTurns)
        .values({
          id: r.turnId,
          tenantId: TENANTS.acme,
          conversationId: r.conversationId,
          actorSubject: reporter.subject,
          askedAt: reportedAt,
          question: r.question,
          answer: r.answer,
          outcome: r.reason === 'not_my_scope' ? 'refused_out_of_scope' : 'answered',
        })
        .onConflictDoNothing();
      await tx
        .insert(s.aiReportedAnswers)
        .values({
          id: r.id,
          tenantId: TENANTS.acme,
          reportedAt,
          reporterPersonId: reporter.personId,
          reporterSubject: reporter.subject,
          turnId: r.turnId,
          feature: 'ask',
          channel: 'web',
          reason: r.reason,
          note: r.note,
          includesText: r.includesText,
          question: r.includesText ? r.question : null,
          answer: r.includesText ? r.answer : null,
          textExpiresAt: new Date(reportedAt.getTime() + 90 * 24 * 60 * 60 * 1000),
          status: r.status,
          reviewNote: r.reviewNote,
          reviewedByPersonId: r.reviewer ? userById(r.reviewer).personId : null,
          reviewedAt: r.reviewedAt ? new Date(r.reviewedAt) : null,
        })
        .onConflictDoNothing();
    }
  });
}
