import { ActorResolver, CoreModule, DB } from '@bf/api/core';
import * as s from '@bf/api/db';
import type { Db } from '@bf/api/db';
import {
  P7_COUNTER_OFFER,
  P7_DOA_DRAFT,
  P7_EXCEPTIONS,
  P7_RULE_SEEDS,
  P7_WORKFLOW_ROUTES,
  seedId,
  TENANTS,
  userById,
} from '@bf/seed';
import { DoaAdminService, RulesModule } from '@bf/api/rules';
import { ApprovalsService } from '@bf/api/approvals';
import { RequestsService, SpendModule } from '@bf/api/spend';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';

@Module({ imports: [CoreModule, RulesModule, SpendModule] })
class RulesSeedModule {}

const T = TENANTS.acme;
/** Fixtures are dated relative to the seed run so ages and the 30-day windows stay realistic. */
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

/**
 * Phase 7 demo data: published policy rules with their version history, the conflicting draft that
 * blocks publishing, approval routes per request kind, a delegation-of-authority version awaiting
 * the CEO, and the post-spend exception queue. Fixed ids with ON CONFLICT DO NOTHING, so a second
 * run replays without duplicating anything.
 */
export async function seedRules(_app: INestApplicationContext): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(RulesSeedModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = ctx.get<Db>(DB);
    await s.withTenant(db, { tenantId: T, subject: 'seed' }, async (tx) => {
      const publisher = (id: string) => userById(id as never).personId;

      for (const rule of P7_RULE_SEEDS) {
        const published = rule.versions;
        const activeVersion = published[published.length - 1];
        const status = rule.draft ? 'active' : 'active';
        await tx
          .insert(s.rules)
          .values({
            id: rule.id,
            tenantId: T,
            code: rule.code,
            name: rule.name,
            family: rule.family,
            templateCode: rule.templateCode,
            status,
            activeVersion: activeVersion.version,
            draftVersion: rule.draft?.version ?? null,
            createdBy: publisher(rule.publishedBy),
          })
          .onConflictDoNothing();

        const versionRow = (
          v: (typeof published)[number],
          index: number,
          state: 'active' | 'expired' | 'draft',
        ) => ({
          id: seedId('81000000', Number(rule.code.replace('R-', '')) * 10 + index),
          tenantId: T,
          ruleId: rule.id,
          version: v.version,
          status: state,
          priority: v.priority,
          effect: v.effect,
          conditions: { kind: 'group', logic: v.logic ?? 'and', conditions: v.conditions },
          actions: [
            v.approvers
              ? { effect: v.effect, approvers: v.approvers, mode: 'sequential' }
              : { effect: v.effect },
          ],
          scope: v.scope ?? {},
          explanation: v.explanation,
          validFrom: v.validFrom,
          validTo: v.validTo ?? null,
          publishedAt: state === 'draft' ? null : new Date(`${v.validFrom}T09:00:00.000Z`),
          publishedBy: state === 'draft' ? null : publisher(rule.publishedBy),
          createdBy: publisher(rule.publishedBy),
        });

        for (const [i, v] of published.entries()) {
          await tx
            .insert(s.ruleVersions)
            .values(versionRow(v, i + 1, v === activeVersion ? 'active' : 'expired'))
            .onConflictDoNothing();
        }
        if (rule.draft) {
          await tx
            .insert(s.ruleVersions)
            .values(versionRow(rule.draft, published.length + 1, 'draft'))
            .onConflictDoNothing();
        }
      }

      for (const route of P7_WORKFLOW_ROUTES) {
        await tx
          .insert(s.workflowTemplates)
          .values({
            id: route.id,
            tenantId: T,
            requestKind: route.requestKind,
            version: 1,
            status: 'active',
            steps: route.steps,
            validFrom: '2026-01-01',
            publishedAt: new Date('2026-01-01T09:00:00.000Z'),
            publishedBy: userById('finance-admin').personId,
          })
          .onConflictDoNothing();
      }

      for (const [i, e] of P7_EXCEPTIONS.entries()) {
        await tx
          .insert(s.postSpendExceptions)
          .values({ ...e, personId: null, raisedAt: daysAgo(3 + i * 4) })
          .onConflictDoNothing();
      }

      // Decisions that let the rules dashboard show a real 30-day decision mix.
      const executions = P7_RULE_SEEDS.flatMap((rule, ruleIndex) =>
        Array.from({ length: 3 + (ruleIndex % 4) }, (_, i) => ({
          id: seedId('85000000', ruleIndex * 10 + i + 1),
          tenantId: T,
          subjectType: 'request',
          subjectId: null,
          ruleId: rule.id,
          effect: rule.versions[rule.versions.length - 1].effect,
          matchedRules: [{ ruleCode: rule.code }],
          facts: {},
          explanation: rule.versions[rule.versions.length - 1].explanation,
          evaluatedAt: daysAgo(i * 5 + 1),
        })),
      );
      await tx.insert(s.ruleExecutions).values(executions).onConflictDoNothing();
    });

    // Submitted through the real command so the audit trail records who submitted it; the CEO can
    // then approve it on screen 070a and Finance cannot approve their own submission.
    const actors = ctx.get(ActorResolver);
    const doa = ctx.get(DoaAdminService);
    const financeAdmin = userById('finance-admin');
    const submitted = await s.withTenant(db, { tenantId: T, subject: 'seed' }, (tx) =>
      tx
        .select({ id: s.doaMatrixVersions.id })
        .from(s.doaMatrixVersions)
        .where(
          and(
            eq(s.doaMatrixVersions.tenantId, T),
            eq(s.doaMatrixVersions.status, 'awaiting_approval'),
          ),
        ),
    );
    if (submitted.length === 0) {
      const actor = await actors.resolve(financeAdmin.subject, T, financeAdmin.displayName);
      await doa.saveDraft(
        actor,
        {
          validFrom: P7_DOA_DRAFT.validFrom,
          submitForApproval: true,
          rows: P7_DOA_DRAFT.limits.map((l) => ({
            role: l.role,
            personId: l.personId,
            spendType: l.spendType,
            legalEntityId: l.legalEntityId,
            limitMinor: l.limitMinor,
            currency: 'USD' as const,
            validFrom: l.validFrom,
          })),
        },
        { idempotencyKey: 'seed:p7:doa-v2', requestId: 'seed' },
      );
    }

    // A request whose approver answered with a smaller amount, so the requester has an offer to
    // accept on screen 065. Both steps run through the real commands, offer included.
    const offer = P7_COUNTER_OFFER;
    const requests = ctx.get(RequestsService);
    const approvals = ctx.get(ApprovalsService);
    const requester = userById(offer.requester);
    const approver = userById(offer.approver);
    const requesterActor = await actors.resolve(requester.subject, T, requester.displayName);
    await requests.create(
      requesterActor,
      {
        kind: 'spending',
        budgetId: offer.budgetId,
        amount: { amountMinor: offer.amountMinor, currency: offer.currency },
        spendType: offer.spendType,
        title: offer.title,
        purpose: offer.purpose,
        category: offer.category,
        submit: true,
      },
      { idempotencyKey: 'seed:p7:counter-offer', requestId: 'seed', fixedId: offer.requestId },
    );
    const approverActor = await actors.resolve(approver.subject, T, approver.displayName);
    const taskId = await s.withTenant(db, { tenantId: T, subject: approverActor.subject }, (tx) =>
      approvals.myTask(tx, approverActor, 'request', offer.requestId),
    );
    if (taskId)
      await approvals.decide(
        approverActor,
        taskId,
        {
          decision: 'request_changes',
          counterOfferAmount: { amountMinor: offer.offerMinor, currency: offer.currency },
          comment: offer.comment,
          noConflictAttested: true,
        },
        { idempotencyKey: 'seed:p7:counter-offer:decide', requestId: 'seed' },
      );
  } finally {
    await ctx.close();
  }
}
