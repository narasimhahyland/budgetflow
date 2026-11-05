import { personNames, RoutingService } from '@bf/api/approvals';
import { ApiProblem, DB, PolicyService, type RequestActor } from '@bf/api/core';
import { budgets, orgUnits, withTenant, type Db } from '@bf/api/db';
import type { TestWorkflowRouteRequest, TestWorkflowRouteResponse } from '@bf/contracts';
import { evaluateRules, type EvaluationFacts } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { RulesService } from './rules.service';

const TENANT = (actor: RequestActor) => ({ kind: 'tenant' as const, tenantId: actor.tenantId });

/**
 * Screen 070's "test this route": plans the approval route for a made-up request and lists the rule
 * codes that matched, without creating an approval instance or touching any balance.
 */
@Injectable()
export class WorkflowTestService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly routing: RoutingService,
    private readonly rules: RulesService,
  ) {}

  async test(
    actor: RequestActor,
    body: TestWorkflowRouteRequest,
  ): Promise<TestWorkflowRouteResponse> {
    this.policy.assert(actor, 'rules.read', TENANT(actor), 'approval route');
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const [row] = await tx
        .select({ budget: budgets, location: orgUnits.name })
        .from(budgets)
        .leftJoin(orgUnits, eq(orgUnits.id, budgets.orgUnitId))
        .where(and(eq(budgets.tenantId, actor.tenantId), eq(budgets.id, body.budgetId)));
      if (!row) throw ApiProblem.notFound('budget');

      const requesterId = body.requesterPersonId ?? actor.personId;
      if (!requesterId) {
        throw new ApiProblem(
          422,
          'VALIDATION_FAILED',
          'Choose the person the test request comes from.',
          { field: 'requesterPersonId' },
        );
      }

      const facts: EvaluationFacts = {
        amount_reporting_minor: body.amountMinor,
        amount_budget_minor: body.amountMinor,
        amount_per_person_minor: body.amountMinor,
        remaining_pct: 50,
        category: body.spendType,
        spend_type: body.spendType,
        location: row.location ?? 'Unknown',
        legal_entity: 'HYL-US',
        requester_role: 'employee',
        seniority: 3,
        employee_count: 1,
        vendor_status: 'approved',
        attendee_type: 'employee',
        alcohol_requested: false,
        is_cash_equivalent: false,
        request_kind: body.requestKind,
        date: new Date().toISOString().slice(0, 10),
      };
      const evaluation = evaluateRules(await this.rules.activeRules(tx, actor.tenantId), facts);

      const { route } = await this.routing.plan(tx, {
        subject: 'request',
        requesterId,
        beneficiaryIds: [requesterId],
        attendeeIds: [],
        budget: row.budget,
        budgetAmount: {
          amountMinor: body.amountMinor,
          currency: body.currency ?? row.budget.currency,
        },
        spendType: body.spendType,
        reportingCurrency: actor.reportingCurrency,
        remainingPctAfter: null,
        action: 'request.approve',
      });

      const names = await personNames(tx, [
        ...route.steps.map((s) => s.personId),
        ...route.skipped.map((s) => s.personId),
      ]);

      return {
        route: {
          steps: route.steps.map((s) => ({
            stepNo: s.stepNo,
            taskId: null,
            personId: s.personId,
            personName: names.get(s.personId) ?? '',
            resolver: s.resolver,
            reason: s.reason,
            limit: { amountMinor: s.limitMinor, currency: 'USD' as const },
            status: 'waiting' as const,
            decidedAt: null,
            actedByName: null,
            onBehalfOfName: null,
            comment: null,
            channel: null,
            dueAt: null,
          })),
          skipped: route.skipped.map((s) => ({
            personName: names.get(s.personId) ?? '',
            reason: s.reason,
            detail: s.detail,
          })),
          explanation: route.explanation,
        },
        matchedRuleCodes: evaluation.matches.map((m) => m.ruleCode),
      };
    });
  }
}
