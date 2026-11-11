import { ActorResolver, ApiProblem, nowUtc, todayUtc, type RequestActor } from '@bf/api/core';
import {
  legalEntities,
  orgUnits,
  people,
  requests,
  budgets,
  ruleExecutions,
  type Tx,
} from '@bf/api/db';
import {
  benefitSpends,
  capWindowOn,
  factLabel,
  formatFactValue,
  lockCapPeople,
  PolicyConfigService,
  requesterRecentTotal,
  RulesService,
} from '@bf/api/rules';
import type { PolicyCheckView } from '@bf/contracts';
import {
  capFacts,
  capRuleFacts,
  evaluateRules,
  type CapFacts,
  type EvaluationFacts,
  type EvaluationResult,
  type FactKey,
} from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';

type RequestRow = typeof requests.$inferSelect;
type BudgetRow = typeof budgets.$inferSelect;

/** How far back the requester's recent total looks. */
const RECENT_DAYS = 30;

/** The facts the request screen shows: the cap facts and the amounts they rest on. */
const SHOWN_FACTS: readonly FactKey[] = [
  'amount_reporting_minor',
  'employee_ytd_benefit_minor',
  'employee_cap_remaining_minor',
  'employee_cap_used_pct',
  'gift_value_minor',
  'gift_ytd_minor',
  'gift_annual_cap_remaining_minor',
  'alcohol_amount_minor',
  'non_employee_count',
  'is_intercompany',
  'requester_recent_total_minor',
];

const OUTCOME_LABELS: Record<PolicyCheckView['effect'], string> = {
  block: 'Blocked by policy',
  freeze: 'Flagged: budget has nothing left',
  require_approval: 'Policy asks for approval',
  warn: 'Allowed with a warning',
  auto_approve: 'Allowed by policy',
  none: 'No policy rule applied',
};

/** Cap figures only where a cap applies, so a team lunch does not list gift facts. */
function shown(fact: FactKey, facts: Partial<StoredFacts>): boolean {
  if (fact.startsWith('employee_')) return Boolean(facts.cap_person_id);
  if (fact.startsWith('gift_'))
    return Boolean(facts.gift_person_id) || (facts.gift_value_minor ?? 0) > 0;
  if (fact === 'alcohol_amount_minor') return (facts.alcohol_amount_minor ?? 0) > 0;
  if (fact === 'non_employee_count') return (facts.non_employee_count ?? 0) > 0;
  return true;
}

export interface PolicyAmounts {
  /** The amount being decided in the reporting and budget currencies (plan rate). */
  reportingMinor: number;
  budgetMinor: number;
  alcoholReportingMinor: number;
  remainingPct: number;
}

interface StoredFacts extends EvaluationFacts {
  cap_person_id?: string | null;
  gift_person_id?: string | null;
  stage?: 'submit' | 'approve';
}

/**
 * Runs the rules engine on a request (gap A2): builds the facts, including the employee annual cap,
 * the annual gift cap, alcohol, non-employees, intercompany and the requester's recent total from the
 * ledger, evaluates the active rule versions, records the decision with its rule versions and facts,
 * and refuses the command when a rule blocks. Called after the request's own posting, so the ledger
 * already counts this request.
 */
@Injectable()
export class RequestPolicyService {
  constructor(
    private readonly rules: RulesService,
    private readonly policyConfig: PolicyConfigService,
    private readonly actors: ActorResolver,
  ) {}

  async enforce(
    tx: Tx,
    actor: RequestActor,
    r: RequestRow,
    budget: BudgetRow,
    amounts: PolicyAmounts,
    stage: 'submit' | 'approve',
  ): Promise<EvaluationResult> {
    const recipients = r.benefitRecipientIds ?? [];
    await lockCapPeople(tx, actor.tenantId, recipients);
    const facts = await this.facts(tx, r, budget, amounts);
    const evaluation = evaluateRules(await this.rules.activeRules(tx, actor.tenantId), facts.rule);
    const block = evaluation.matches.find((m) => m.effect === 'block');
    if (block) {
      throw new ApiProblem(409, 'POLICY_BLOCKED', block.explanation, {
        stage,
        ruleCode: block.ruleCode,
        ruleName: block.ruleName,
        ruleVersion: block.version,
        employeeYtdBenefitMinor: facts.rule.employee_ytd_benefit_minor,
        employeeCapRemainingMinor: facts.rule.employee_cap_remaining_minor,
        giftYtdMinor: facts.rule.gift_ytd_minor,
        giftAnnualCapRemainingMinor: facts.rule.gift_annual_cap_remaining_minor,
        capPersonId: facts.cap.capPersonId ?? facts.cap.giftPersonId,
      });
    }
    const stored: StoredFacts = {
      ...facts.rule,
      cap_person_id: facts.cap.capPersonId,
      gift_person_id: facts.cap.giftPersonId,
      stage,
    };
    await tx.insert(ruleExecutions).values({
      tenantId: actor.tenantId,
      subjectType: 'request',
      subjectId: r.id,
      ruleId: evaluation.decisive?.ruleId ?? null,
      effect: evaluation.effect,
      matchedRules: evaluation.matches.map((m) => ({
        ruleId: m.ruleId,
        ruleCode: m.ruleCode,
        ruleName: m.ruleName,
        version: m.version,
        priority: m.priority,
        effect: m.effect,
        explanation: m.explanation,
        matchedFacts: m.matchedFacts,
        decisive: m === evaluation.decisive,
      })),
      facts: stored,
      explanation: evaluation.explanation,
      evaluatedBy: actor.personId,
    });
    return evaluation;
  }

  private async facts(
    tx: Tx,
    r: RequestRow,
    budget: BudgetRow,
    amounts: PolicyAmounts,
  ): Promise<{ rule: EvaluationFacts; cap: CapFacts }> {
    const recipients = r.benefitRecipientIds ?? [];
    const others = r.nonEmployeeCount ?? 0;
    const settings = await this.policyConfig.capSettings(tx, r.tenantId);
    const window = (await capWindowOn(tx, todayUtc())) ?? {
      fromDate: `${todayUtc().slice(0, 4)}-01-01`,
      toDate: `${todayUtc().slice(0, 4)}-12-31`,
    };
    // One transaction, one connection: the reads run one after another.
    const benefits = await benefitSpends(tx, {
      spendTypes: settings.employeeCap.includedCategories,
      window,
      recipientIds: recipients,
      includeRequestId: r.id,
    });
    const gifts = await benefitSpends(tx, {
      spendTypes: [settings.giftCap.giftSpendType],
      window,
      recipientIds: recipients,
      includeRequestId: r.id,
    });
    const recent = await requesterRecentTotal(tx, {
      requesterId: r.requesterPersonId,
      since: new Date(nowUtc().getTime() - RECENT_DAYS * 86_400_000),
      includeRequestId: r.id,
    });
    const persons = await tx
      .select({
        id: people.id,
        entity: people.employingEntityId,
        seniority: people.seniority,
        location: people.locationOrgUnitId,
        locationName: orgUnits.name,
      })
      .from(people)
      .leftJoin(orgUnits, eq(orgUnits.id, people.locationOrgUnitId))
      .where(inArray(people.id, [r.requesterPersonId, ...recipients]));
    const requester = persons.find((p) => p.id === r.requesterPersonId);
    const intercompany = persons.some((p) => p.entity && p.entity !== budget.legalEntityId);
    const [entity] = await tx
      .select({ code: legalEntities.code })
      .from(legalEntities)
      .where(eq(legalEntities.id, budget.legalEntityId));

    // A person can hold several roles; the fact carries the first in a stable order.
    const requesterRole =
      [...(await this.actors.rolesForPerson(tx, r.requesterPersonId, todayUtc()))].sort()[0] ??
      'employee';
    const cap = capFacts({
      spendType: r.spendType,
      recipientIds: recipients,
      nonEmployeeCount: others,
      amountReportingMinor: amounts.reportingMinor,
      alcoholReportingMinor: amounts.alcoholReportingMinor,
      benefitSpends: benefits,
      giftSpends: gifts,
      requesterRecentTotalMinor: recent,
      intercompany,
      employeeCap: settings.employeeCap,
      giftCap: settings.giftCap,
    });
    const heads = Math.max(1, recipients.length + others);
    const rule: EvaluationFacts = {
      amount_reporting_minor: amounts.reportingMinor,
      amount_budget_minor: amounts.budgetMinor,
      amount_per_person_minor: Math.floor(amounts.reportingMinor / heads),
      remaining_pct: amounts.remainingPct,
      category: r.category ?? r.spendType,
      spend_type: r.spendType,
      location: requester?.locationName ?? 'Unknown',
      legal_entity: entity?.code ?? '',
      requester_role: requesterRole,
      seniority: requester?.seniority ?? 0,
      employee_count: Math.max(1, recipients.length),
      vendor_status: 'none',
      attendee_type: others > 0 ? 'client' : 'employee',
      alcohol_requested: amounts.alcoholReportingMinor > 0,
      is_cash_equivalent: r.spendType.toLowerCase() === 'cash_gift_cards',
      ...capRuleFacts(cap),
      org_unit_ids: [budget.orgUnitId, requester?.location].filter((x): x is string => Boolean(x)),
      request_kind: r.kind,
      date: todayUtc(),
    };
    return { rule, cap };
  }

  /** The latest decision on a request as the request screen shows it. */
  async latest(tx: Tx, tenantId: string, requestId: string): Promise<PolicyCheckView | null> {
    const [row] = await tx
      .select()
      .from(ruleExecutions)
      .where(
        and(
          eq(ruleExecutions.tenantId, tenantId),
          eq(ruleExecutions.subjectType, 'request'),
          eq(ruleExecutions.subjectId, requestId),
        ),
      )
      .orderBy(desc(ruleExecutions.evaluatedAt), desc(ruleExecutions.id))
      .limit(1);
    if (!row) return null;
    const facts = (row.facts ?? {}) as Partial<StoredFacts>;
    const matched = (row.matchedRules ?? []) as {
      ruleCode: string;
      ruleName: string;
      version: number;
      effect: PolicyCheckView['matches'][number]['effect'];
      explanation: string;
      decisive?: boolean;
    }[];
    const capPerson = facts.cap_person_id ?? facts.gift_person_id ?? null;
    let capPersonName: string | null = null;
    if (capPerson) {
      const [p] = await tx
        .select({ name: people.displayName })
        .from(people)
        .where(eq(people.id, capPerson));
      capPersonName = p?.name ?? null;
    }
    const effect = row.effect as PolicyCheckView['effect'];
    return {
      stage: facts.stage ?? 'submit',
      effect,
      outcomeLabel: OUTCOME_LABELS[effect] ?? effect,
      explanation: row.explanation,
      evaluatedAt: row.evaluatedAt.toISOString(),
      matches: matched.map((m) => ({
        ruleCode: m.ruleCode,
        ruleName: m.ruleName,
        version: m.version,
        effect: m.effect,
        explanation: m.explanation,
        decisive: Boolean(m.decisive),
      })),
      facts: SHOWN_FACTS.filter((f) => facts[f] !== undefined && shown(f, facts)).map((f) => ({
        fact: f,
        label: factLabel(f),
        value: formatFactValue(f, facts[f]),
      })),
      capPersonName,
    };
  }
}
