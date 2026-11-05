import { AuditService } from '@bf/api/audit';
import { CommandRunner, DB, PolicyService, type RequestActor } from '@bf/api/core';
import { budgets, rolloverPolicies, withTenant, type Db } from '@bf/api/db';
import { BudgetViews } from '@bf/api/budgets';
import type { AssignRolloverPolicyRequest, RolloverPolicy } from '@bf/contracts';
import { ApiProblem } from '@bf/api/core';
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { assertTenant, type CommandContext } from './close-reads';

/** Rollover policies and which budget uses which: what a budget does with money left at year end. */
@Injectable()
export class RolloverPoliciesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly views: BudgetViews,
  ) {}

  list(actor: RequestActor) {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      assertTenant(this.policy, actor, 'ledger.read');
      const rows = await tx.select().from(rolloverPolicies).orderBy(asc(rolloverPolicies.code));
      const counts = await tx
        .select({ id: budgets.rolloverPolicyId, n: sql<string>`count(*)` })
        .from(budgets)
        .groupBy(budgets.rolloverPolicyId);
      const used = new Map(counts.map((c) => [c.id, Number(c.n)]));
      const items: RolloverPolicy[] = rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        mode: r.mode,
        capBps: r.capBps,
        sweepTo: r.sweepTo,
        budgetCount: used.get(r.id) ?? 0,
      }));
      return { items };
    });
  }

  assign(
    actor: RequestActor,
    budgetId: string,
    req: AssignRolloverPolicyRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `close.budgets.rollover_policy:${budgetId}`,
        request: req,
        status: 200,
      },
      async (tx) => {
        const budget = await this.views.row(tx, budgetId);
        // Rollover decides what happens to the budget's money, so it follows the control right.
        const parent = budget.parentId ? await this.views.row(tx, budget.parentId) : undefined;
        this.views.assertControl(actor, budget, parent);
        if (req.rolloverPolicyId) {
          const [p] = await tx
            .select()
            .from(rolloverPolicies)
            .where(eq(rolloverPolicies.id, req.rolloverPolicyId));
          if (!p) throw ApiProblem.notFound('rollover policy');
        }
        await tx
          .update(budgets)
          .set({ rolloverPolicyId: req.rolloverPolicyId, updatedAt: new Date() })
          .where(eq(budgets.id, budget.id));
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'budget.rollover_policy_set',
          resourceType: 'budget',
          resourceId: budget.id,
          legalEntityId: budget.legalEntityId,
          requestId: ctx.requestId,
          reason: req.reason,
          changes: {
            rolloverPolicyId: { from: budget.rolloverPolicyId, to: req.rolloverPolicyId },
          },
        });
        return {
          budgetId: budget.id,
          budgetName: budget.name,
          rolloverPolicyId: req.rolloverPolicyId,
        };
      },
    );
  }
}
