import { DB, type RequestActor } from '@bf/api/core';
import { ruleExecutions, rules, ruleVersions, withTenant, type Db, type Tx } from '@bf/api/db';
import type { AiSourceRef, PolicyExplainRequest, PolicyExplanation } from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { AiGateway } from '../ai-gateway.service';
import type { Fact } from '../provider/ai-provider';
import { AiRetrieval } from '../retrieval.service';
import { AiSettingsService } from '../settings.service';
import { searchTerms } from './ask.service';

const PolicyOutput = z
  .object({
    explanation: z.string().min(1).max(1200),
    options: z.array(z.string().max(200)).max(6),
    confidence: z.enum(['high', 'medium', 'low']),
  })
  .strict();

/**
 * Advice that would help someone get around a control is never shown. If the model produces it the
 * explanation is discarded and the rule list stands on its own, exactly as it does when AI is off.
 */
const WORKAROUND =
  /\b(split (it |the )?(request|invoice|order)|stay under the limit|avoid (the )?(limit|approval)|just under|break (it|this) (up|into)|two smaller)\b/i;

const EFFECT_OUTCOMES: Record<string, PolicyExplanation['outcome']> = {
  block: 'blocked',
  freeze: 'blocked',
  require_approval: 'needs_approval',
  warn: 'needs_approval',
  auto_approve: 'allowed',
  allow: 'allowed',
  none: 'allowed',
};

/**
 * 069a: the rules engine decides, the assistant only puts its decision in plain English. This service
 * never re-evaluates a rule, never changes an outcome and never proposes a route around a control.
 */
@Injectable()
export class AiPolicyAssistantService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: AiSettingsService,
    private readonly retrieval: AiRetrieval,
    private readonly gateway: AiGateway,
  ) {}

  explain(actor: RequestActor, req: PolicyExplainRequest): Promise<PolicyExplanation> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.explainInTx(tx, actor, req),
    );
  }

  private async explainInTx(
    tx: Tx,
    actor: RequestActor,
    req: PolicyExplainRequest,
  ): Promise<PolicyExplanation> {
    await this.settings.assertEnabled(tx, actor.tenantId, 'policy_explain');
    const facts: Fact[] = [];
    const sources: AiSourceRef[] = [];
    const displayFacts: { label: string; value: string }[] = [];
    let outcome: PolicyExplanation['outcome'] = 'not_covered';
    let headline = 'No BudgetFlow policy limits this. Normal approval applies.';
    let scope = {
      action: 'request.create' as const,
      scope: this.retrieval.scopeKind(actor, 'request.create'),
      consideredCount: 0,
      permittedCount: 0,
    };

    if (req.requestId) {
      const found = await this.retrieval.requestFacts(tx, actor, { ids: [req.requestId] });
      scope = { ...scope, ...found.scope, action: 'request.create' };
      if (!found.rows.length) {
        const logged = await this.gateway.logOnly({
          tx,
          actor,
          feature: 'policy_explain',
          channel: req.channel ?? 'web',
          scope,
          sources: [],
          outcome: 'refused_out_of_scope',
        });
        return {
          outcome: 'not_covered',
          headline: 'I can only explain your own requests or requests you are deciding.',
          explanation: null,
          facts: [],
          options: [],
          sources: [],
          confidence: null,
          refusal: {
            kind: 'other_person',
            message: "I can only explain your own requests or requests you're deciding.",
            redirect: null,
          },
          provenance: logged.provenance,
        };
      }
      const request = found.rows[0];
      facts.push(...found.facts);
      sources.push(...found.sources);
      displayFacts.push(
        { label: 'Request', value: request.ref },
        { label: 'Amount', value: `${request.currency} ${(request.amountMinor / 100).toFixed(2)}` },
        { label: 'Category', value: request.category ?? 'not set' },
        { label: 'Status', value: request.status },
      );
      const [execution] = await tx
        .select()
        .from(ruleExecutions)
        .where(
          and(
            eq(ruleExecutions.tenantId, actor.tenantId),
            eq(ruleExecutions.subjectType, 'request'),
            eq(ruleExecutions.subjectId, request.id),
          ),
        )
        .orderBy(desc(ruleExecutions.evaluatedAt), desc(ruleExecutions.id))
        .limit(1);
      if (execution) {
        outcome = EFFECT_OUTCOMES[execution.effect] ?? 'needs_approval';
        headline = execution.explanation || `Decided by the rules engine: ${execution.effect}.`;
        const matched = (execution.matchedRules as { ruleCode?: string; version?: number }[]) ?? [];
        const ruleFacts = await this.ruleFacts(
          tx,
          actor.tenantId,
          matched.map((m) => m.ruleCode).filter((c): c is string => Boolean(c)),
          outcome,
        );
        facts.push(...ruleFacts.facts);
        sources.push(...ruleFacts.sources);
        displayFacts.push(...ruleFacts.display);
      } else {
        outcome = request.overBudget ? 'needs_approval' : 'allowed';
        headline = request.overBudget
          ? 'This request is above the budget available, so it needs an over-budget approval.'
          : 'No rule blocked this request; it follows the normal approval route.';
      }
    }

    if (req.question) {
      const ruleFacts = await this.ruleFacts(
        tx,
        actor.tenantId,
        [],
        outcome,
        searchTerms(req.question),
      );
      facts.push(...ruleFacts.facts.filter((f) => !facts.some((x) => x.id === f.id)));
      sources.push(...ruleFacts.sources.filter((s) => !sources.some((x) => x.id === s.id)));
      displayFacts.push(...ruleFacts.display);
      scope = { ...scope, consideredCount: scope.consideredCount + ruleFacts.facts.length };
    }

    const result = await this.gateway.run({
      tx,
      actor,
      feature: 'policy_explain',
      channel: req.channel ?? 'web',
      task: 'policy_explain',
      facts,
      sources,
      scope,
      prompt: req.question,
      schema: PolicyOutput,
      successOutcome: 'answered',
      narrative: (out) => [out.explanation, ...out.options],
    });
    const safe =
      result.output &&
      !WORKAROUND.test([result.output.explanation, ...result.output.options].join(' '))
        ? result.output
        : null;
    return {
      outcome,
      headline,
      explanation: safe?.explanation ?? null,
      facts: displayFacts,
      options: (safe?.options ?? []).map((label) => ({
        label,
        resourceType: null,
        resourceId: null,
      })),
      sources,
      confidence: safe?.confidence ?? null,
      refusal: safe
        ? null
        : {
            kind: 'unreliable',
            message:
              'I could not produce a reliable explanation, so the matched rules are shown instead.',
            redirect: null,
          },
      provenance: result.provenance,
    };
  }

  /**
   * The policies that apply to the asker: code, name, version and the limit they set. Nothing about
   * other people's requests or anyone's delegation-of-authority limit is read here.
   */
  private async ruleFacts(
    tx: Tx,
    tenantId: string,
    codes: readonly string[],
    outcome: PolicyExplanation['outcome'],
    terms: readonly string[] = [],
  ): Promise<{
    facts: Fact[];
    sources: AiSourceRef[];
    display: { label: string; value: string }[];
  }> {
    const rows = await tx
      .select({ rule: rules, version: ruleVersions })
      .from(rules)
      .innerJoin(
        ruleVersions,
        and(eq(ruleVersions.ruleId, rules.id), eq(ruleVersions.version, rules.activeVersion)),
      )
      .where(
        and(
          eq(rules.tenantId, tenantId),
          eq(rules.status, 'active'),
          isNotNull(rules.activeVersion),
          codes.length ? inArray(rules.code, [...codes]) : undefined,
        ),
      )
      .orderBy(rules.name, rules.code, rules.id);
    const matching = codes.length
      ? rows
      : rows
          .filter((r) => terms.some((t) => r.rule.name.toLowerCase().includes(t.toLowerCase())))
          .slice(0, 3);
    return {
      facts: matching.map((r) => ({
        type: 'rule',
        id: r.rule.id,
        label: `${r.rule.name} v${r.version.version}`,
        fields: {
          outcome,
          ruleCode: r.rule.code,
          ruleVersion: r.version.version,
          policyTitle: r.rule.name,
        },
      })),
      sources: matching.map((r) => ({
        type: 'rule' as const,
        id: r.rule.id,
        label: `${r.rule.name} v${r.version.version}`,
      })),
      display: matching.map((r) => ({
        label: 'Rule',
        value: `${r.rule.name} (${r.rule.code} v${r.version.version})`,
      })),
    };
  }
}
