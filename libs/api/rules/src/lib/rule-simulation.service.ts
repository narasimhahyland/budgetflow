import { ApiProblem, DB, PolicyService, type RequestActor } from '@bf/api/core';
import {
  budgets,
  orgUnits,
  people,
  requests,
  rules,
  ruleVersions,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  BacktestItem,
  BacktestRequest,
  BacktestResponse,
  SimulatedMatch,
  SimulationFactsInput,
  SingleSimulationRequest,
  SingleSimulationResponse,
} from '@bf/contracts';
import {
  evaluateConditionGroup,
  evaluateRules,
  type EvaluableRule,
  type EvaluationFacts,
  type RuleEffect,
} from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { conditionText, formatFactValue, toEvaluable } from './rule-mapping';
import { RulesService } from './rules.service';

const TENANT = (actor: RequestActor) => ({ kind: 'tenant' as const, tenantId: actor.tenantId });

/** The facts the evaluator reads, built from a simulation form or from a historical request. */
function factsFrom(input: SimulationFactsInput, date: string): EvaluationFacts {
  return {
    amount_reporting_minor: input.amountMinor,
    amount_budget_minor: input.amountMinor,
    amount_per_person_minor: Math.round(input.amountMinor / Math.max(1, input.employeeCount)),
    remaining_pct: input.remainingPct,
    category: input.category,
    spend_type: input.spendType,
    location: input.location,
    legal_entity: input.legalEntity,
    requester_role: input.requesterRole,
    seniority: input.seniority,
    employee_count: input.employeeCount,
    vendor_status: input.vendorStatus,
    attendee_type: input.attendeeType,
    alcohol_requested: input.alcoholRequested,
    is_cash_equivalent: input.isCashEquivalent,
    date,
  };
}

const OUTCOME_LABELS: Record<RuleEffect | 'none', string> = {
  block: 'Blocked',
  freeze: 'Blocked (budget frozen)',
  require_approval: 'Approval required',
  warn: 'Warning shown',
  auto_approve: 'Auto-approved',
  none: 'No rule matched',
};

const STRICTNESS: Record<RuleEffect | 'none', number> = {
  block: 5,
  freeze: 4,
  require_approval: 3,
  warn: 2,
  auto_approve: 1,
  none: 0,
};

/**
 * Read-only rule evaluation: screen 069 tests one request against active and draft rules; screen 077
 * replays historical requests so a draft's effect is visible before it is published. Neither writes.
 */
@Injectable()
export class RuleSimulationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly rules: RulesService,
  ) {}

  private assertRead(actor: RequestActor): void {
    this.policy.assert(actor, 'rules.read', TENANT(actor), 'rules');
  }

  /** Active rules, with the named rule's draft swapped in when the caller asked to include drafts. */
  private async rulesForSimulation(
    tx: Tx,
    actor: RequestActor,
    opts: { ruleId?: string; includeDraft: boolean },
  ): Promise<{ evaluables: EvaluableRule[]; draftCodes: Set<string> }> {
    const active = await this.rules.activeRules(tx, actor.tenantId);
    const draftCodes = new Set<string>();
    if (!opts.includeDraft) return { evaluables: active, draftCodes };

    const draftRules = await tx
      .select()
      .from(rules)
      .where(and(eq(rules.tenantId, actor.tenantId), isNotNull(rules.draftVersion)));
    const scoped = opts.ruleId ? draftRules.filter((r) => r.id === opts.ruleId) : draftRules;
    if (!scoped.length) return { evaluables: active, draftCodes };

    const versions = await tx
      .select()
      .from(ruleVersions)
      .where(
        and(
          eq(ruleVersions.tenantId, actor.tenantId),
          inArray(
            ruleVersions.ruleId,
            scoped.map((r) => r.id),
          ),
          eq(ruleVersions.status, 'draft'),
        ),
      );

    const merged = [...active];
    for (const rule of scoped) {
      const draft = versions.find((v) => v.ruleId === rule.id && v.version === rule.draftVersion);
      if (!draft) continue;
      const evaluable = toEvaluable(rule, draft);
      const at = merged.findIndex((r) => r.id === rule.id);
      if (at >= 0) merged[at] = evaluable;
      else merged.push(evaluable);
      draftCodes.add(rule.code);
    }
    return { evaluables: merged, draftCodes };
  }

  /** Screen 069: evaluate one made-up request and explain every condition that was checked. */
  async simulate(
    actor: RequestActor,
    body: SingleSimulationRequest,
  ): Promise<SingleSimulationResponse> {
    this.assertRead(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const date = new Date().toISOString().slice(0, 10);
      const facts = factsFrom(body.facts, date);
      const { evaluables } = await this.rulesForSimulation(tx, actor, {
        ruleId: body.ruleId,
        includeDraft: body.includeDraft ?? true,
      });

      let candidates = evaluables;
      if (body.draftOverride && body.ruleId) {
        // The builder sends unsaved edits so the preview matches what is on screen.
        const override = body.draftOverride;
        candidates = evaluables.map((r) =>
          r.id === body.ruleId
            ? {
                ...r,
                priority: override.priority,
                effect: (override.actions[0]?.effect ?? r.effect) as RuleEffect,
                conditions: override.conditions,
                actions: override.actions,
                scope: override.scope,
                explanation: override.explanation,
                validFrom: override.validFrom,
                validTo: override.validTo ?? null,
              }
            : r,
        );
      }

      const result = evaluateRules(candidates, facts);
      const matches: SimulatedMatch[] = result.matches.map((m) => ({
        ruleId: m.ruleId,
        ruleCode: m.ruleCode,
        ruleName: m.ruleName,
        version: m.version,
        priority: m.priority,
        effect: m.effect,
        approvers: [...(m.approvers ?? [])],
        explanation: m.explanation,
        decisive: result.decisive?.ruleCode === m.ruleCode,
        overridden: result.decisive ? result.decisive.ruleCode !== m.ruleCode : false,
        matchedFacts: m.matchedFacts,
      }));

      // Show every condition of the rule under test, passed or not, so the result is explainable.
      const underTest = body.ruleId
        ? candidates.find((r) => r.id === body.ruleId)
        : candidates.find((r) => r.code === result.decisive?.ruleCode);
      const conditionChecklist = underTest
        ? evaluateConditionGroup(underTest.conditions, facts).checks.map((c) => ({
            label: conditionText({ fact: c.fact, op: c.op, value: c.expected }),
            passed: c.passed,
            actualValue: formatFactValue(c.fact, c.actual),
          }))
        : [];

      return {
        effect: result.effect,
        requiredApprovers: result.requiredApprovers,
        decisiveRuleCode: result.decisive?.ruleCode ?? null,
        explanation: result.explanation,
        matches,
        conditionChecklist,
      };
    });
  }

  /** Screen 077: replay real past requests under the active rules and under the draft. */
  async backtest(actor: RequestActor, body: BacktestRequest): Promise<BacktestResponse> {
    this.assertRead(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const date = new Date().toISOString().slice(0, 10);
      const activeOnly = await this.rules.activeRules(tx, actor.tenantId);
      const { evaluables: withDraft } = await this.rulesForSimulation(tx, actor, {
        ruleId: body.ruleId,
        includeDraft: true,
      });

      let ruleCode = 'All rules';
      let ruleName = 'Every active rule and draft';
      let activeVersion: number | null = null;
      let draftVersion: number | null = null;
      if (body.ruleId) {
        const [rule] = await tx
          .select()
          .from(rules)
          .where(and(eq(rules.tenantId, actor.tenantId), eq(rules.id, body.ruleId)));
        if (!rule) throw ApiProblem.notFound('rule');
        ruleCode = rule.code;
        ruleName = rule.name;
        activeVersion = rule.activeVersion;
        draftVersion = rule.draftVersion;
      }

      const rows = await tx
        .select({
          request: requests,
          budgetName: budgets.name,
          requesterName: people.displayName,
          location: orgUnits.name,
        })
        .from(requests)
        .leftJoin(budgets, eq(budgets.id, requests.budgetId))
        .leftJoin(people, eq(people.id, requests.requesterPersonId))
        .leftJoin(orgUnits, eq(orgUnits.id, budgets.orgUnitId))
        .where(
          and(
            eq(requests.tenantId, actor.tenantId),
            // Decided and in-flight requests only: drafts were never evaluated by the rules.
            inArray(requests.status, [
              'approved',
              'partially_approved',
              'rejected',
              'pending_approval',
            ]),
          ),
        )
        .orderBy(desc(requests.createdAt))
        .limit(200);

      const scoped = body.scopeLocation
        ? rows.filter((r) => (r.location ?? '').toLowerCase() === body.scopeLocation?.toLowerCase())
        : rows;

      const items: BacktestItem[] = [];
      const matrix: Record<string, Record<string, number>> = {};
      let unchangedCount = 0;
      let stricterCount = 0;
      let looserCount = 0;
      let nowBlockedCount = 0;

      for (const row of scoped) {
        const r = row.request;
        const facts: EvaluationFacts = {
          amount_reporting_minor: r.amountMinor,
          amount_budget_minor: r.budgetAmountMinor ?? r.amountMinor,
          amount_per_person_minor: r.amountMinor,
          remaining_pct: 50,
          category: r.category ?? r.spendType,
          spend_type: r.spendType,
          location: row.location ?? 'Unknown',
          legal_entity: 'HYL-US',
          requester_role: 'employee',
          seniority: 3,
          employee_count: 1,
          vendor_status: 'approved',
          attendee_type: 'employee',
          alcohol_requested: false,
          is_cash_equivalent: false,
          request_kind: r.kind,
          date,
        };

        const before = evaluateRules(activeOnly, facts);
        const after = evaluateRules(withDraft, facts);
        const beforeLabel = OUTCOME_LABELS[before.effect];
        const afterLabel = OUTCOME_LABELS[after.effect];
        matrix[beforeLabel] ??= {};
        matrix[beforeLabel][afterLabel] = (matrix[beforeLabel][afterLabel] ?? 0) + 1;

        let changeKind: BacktestItem['changeKind'] = 'unchanged';
        if (after.effect === before.effect) {
          changeKind = 'unchanged';
          unchangedCount++;
        } else if (after.effect === 'block' || after.effect === 'freeze') {
          changeKind = 'blocked';
          nowBlockedCount++;
          stricterCount++;
        } else if (STRICTNESS[after.effect] > STRICTNESS[before.effect]) {
          changeKind = 'stricter';
          stricterCount++;
        } else {
          changeKind = 'looser';
          looserCount++;
        }

        const diffFact =
          after.decisive?.matchedFacts && Object.keys(after.decisive.matchedFacts).length
            ? Object.keys(after.decisive.matchedFacts)[0]
            : 'amount_reporting_minor';

        items.push({
          requestId: r.id,
          ref: r.ref,
          title: r.title || r.purpose.slice(0, 80),
          requesterName: row.requesterName ?? 'Unknown',
          budgetName: row.budgetName ?? 'Unassigned',
          location: row.location ?? 'Unknown',
          amount: { amountMinor: r.amountMinor, currency: r.currency },
          activeOutcome: beforeLabel,
          draftOutcome: afterLabel,
          changeKind,
          diffFact,
          activeExplanation: before.explanation,
          draftExplanation: after.explanation,
        });
      }

      const changed = items.filter((i) => i.changeKind !== 'unchanged');
      return {
        ruleId: body.ruleId ?? null,
        ruleCode,
        ruleName,
        activeVersion,
        draftVersion,
        periodLabel: body.periodLabel ?? 'Last 200 requests',
        totalEvaluated: items.length,
        unchangedCount,
        stricterCount,
        looserCount,
        nowBlockedCount,
        conflictCount: 0,
        matrix,
        // The table shows what changed first; unchanged rows follow for context.
        items: [...changed, ...items.filter((i) => i.changeKind === 'unchanged')].slice(0, 50),
      };
    });
  }
}
