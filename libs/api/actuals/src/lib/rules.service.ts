import { actualMappingRules, budgets, events, withTenant, type Db, type Tx } from '@bf/api/db';
import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import type { MappingRule, MappingRuleList } from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { tenantOf, type CommandContext } from './actuals-reads';

type RuleInput = {
  name: string;
  priority: number;
  match: MappingRule['match'];
  targetBudgetId?: string;
  targetEventId?: string;
};

/** Actual-to-budget mapping rules (entity, cost center, GL, event code, vendor, card program, merchant, memo). */
@Injectable()
export class RulesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  list(actor: RequestActor): Promise<MappingRuleList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      this.policy.assert(actor, 'actuals.read', tenantOf(actor));
      const rows = await tx
        .select()
        .from(actualMappingRules)
        .orderBy(asc(actualMappingRules.priority), asc(actualMappingRules.createdAt));
      return { items: await Promise.all(rows.map((r) => this.dto(tx, r))) };
    });
  }

  create(
    actor: RequestActor,
    req: RuleInput,
    ctx: CommandContext,
  ): Promise<CommandResult<MappingRule>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'actuals.mapping_rule.create',
        request: req,
        status: 201,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        if (
          req.targetBudgetId &&
          !(
            await tx
              .select({ id: budgets.id })
              .from(budgets)
              .where(eq(budgets.id, req.targetBudgetId))
          )[0]
        )
          throw ApiProblem.notFound('budget');
        if (
          req.targetEventId &&
          !(
            await tx.select({ id: events.id }).from(events).where(eq(events.id, req.targetEventId))
          )[0]
        )
          throw ApiProblem.notFound('event');
        const [r] = await tx
          .insert(actualMappingRules)
          .values({
            tenantId: actor.tenantId,
            name: req.name,
            priority: req.priority,
            match: req.match,
            targetBudgetId: req.targetBudgetId ?? null,
            targetEventId: req.targetEventId ?? null,
            createdBy: actor.personId,
          })
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'actuals.mapping_rule.created',
          resourceType: 'actual_mapping_rule',
          resourceId: r.id,
          requestId: ctx.requestId,
          changes: {
            name: { from: null, to: r.name },
            priority: { from: null, to: r.priority },
            match: { from: null, to: r.match },
          },
        });
        return this.dto(tx, r);
      },
    );
  }

  update(
    actor: RequestActor,
    ruleId: string,
    req: { name?: string; priority?: number; active?: boolean },
    ctx: CommandContext,
  ): Promise<CommandResult<MappingRule>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `actuals.mapping_rule.update:${ruleId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        this.policy.assert(actor, 'actuals.manage', tenantOf(actor));
        const [before] = await tx
          .select()
          .from(actualMappingRules)
          .where(eq(actualMappingRules.id, ruleId))
          .for('update');
        if (!before) throw ApiProblem.notFound('mapping rule');
        const [r] = await tx
          .update(actualMappingRules)
          .set(req)
          .where(eq(actualMappingRules.id, ruleId))
          .returning();
        const changes: Record<string, unknown> = {};
        for (const k of Object.keys(req) as (keyof typeof req)[])
          changes[k] = { from: before[k], to: r[k] };
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'actuals.mapping_rule.updated',
          resourceType: 'actual_mapping_rule',
          resourceId: r.id,
          requestId: ctx.requestId,
          changes,
        });
        return this.dto(tx, r);
      },
    );
  }

  private async dto(tx: Tx, r: typeof actualMappingRules.$inferSelect): Promise<MappingRule> {
    const [b] = r.targetBudgetId
      ? await tx
          .select({ name: budgets.name })
          .from(budgets)
          .where(eq(budgets.id, r.targetBudgetId))
      : [];
    const [e] = r.targetEventId
      ? await tx
          .select({ code: events.eventCode })
          .from(events)
          .where(eq(events.id, r.targetEventId))
      : [];
    return {
      id: r.id,
      name: r.name,
      priority: r.priority,
      active: r.active,
      match: r.match as MappingRule['match'],
      targetBudgetId: r.targetBudgetId,
      targetBudgetName: b?.name ?? null,
      targetEventId: r.targetEventId,
      targetEventCode: e?.code ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
