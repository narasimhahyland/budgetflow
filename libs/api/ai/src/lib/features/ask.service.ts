import { ApiProblem, DB, type RequestActor } from '@bf/api/core';
import { aiConversations, aiConversationTurns, withTenant, type Db, type Tx } from '@bf/api/db';
import type {
  AiChannel,
  AiConversationDetail,
  AiConversationList,
  AiFeature,
  AiFigure,
  AiProvenance,
  AiRefusal,
  AiSourceRef,
  AskAnswer,
  AskRequest,
  BudgetDetail,
  Money,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AiGateway } from '../ai-gateway.service';
import { AiQueryLogService, type ScopeSummary } from '../query-log.service';
import { AiRetrieval } from '../retrieval.service';
import { AiSettingsService } from '../settings.service';
import type { Fact } from '../provider/ai-provider';

/** What the model may return. Anything that fails this shape is discarded, never shown. */
const AskOutput = z
  .object({
    answer: z.string().min(1).max(2000),
    why: z.array(z.string().max(400)).max(5),
    followUps: z.array(z.string().max(120)).max(5),
    confidence: z.enum(['high', 'medium', 'low']),
  })
  .strict();

/** Asking the assistant to act. The assistant never acts: it links to the screen that does. */
const ACTION_INTENTS: readonly { pattern: RegExp; message: string; resourceType: string }[] = [
  {
    pattern: /\b(approve|reject|decline|sign off|authorise|authorize)\b/i,
    message: "I can't approve or reject requests. Open the request to decide.",
    resourceType: 'request',
  },
  {
    pattern: /\b(move|transfer|shift|reallocate)\b.*\b(money|budget|funds|usd|eur|gbp|inr)\b/i,
    message: "I can't move money. You can start a transfer and check it before you submit.",
    resourceType: 'budget-transfer',
  },
  {
    pattern: /\b(freeze|unfreeze|set to zero|zero out|reduce)\b.*\bbudget\b/i,
    message: "I can't change budget controls. Open the budget to apply a control.",
    resourceType: 'budget-control',
  },
  {
    pattern: /\b(post|book|journal)\b.*\b(ledger|entry|journal)\b/i,
    message: "I can't post to the ledger. Finance posts journals from the ledger screens.",
    resourceType: 'ledger',
  },
];

const STOP_WORDS = new Set([
  'How',
  'What',
  'Where',
  'Which',
  'Who',
  'Why',
  'When',
  'Can',
  'Is',
  'Are',
  'Do',
  'Does',
  'Did',
  'My',
  'The',
  'I',
  'Show',
  'Tell',
  'List',
  'Please',
  'Ask',
  'In',
  'Of',
  'And',
  'For',
]);

/**
 * 011a and 061f: plain-language questions answered only from records the asker may already read.
 * The assistant explains and suggests; for anything that would change money or a decision it refuses
 * and links to the screen where the person does it themselves, through the normal checks.
 */
@Injectable()
export class AiAskService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: AiSettingsService,
    private readonly retrieval: AiRetrieval,
    private readonly gateway: AiGateway,
    private readonly log: AiQueryLogService,
  ) {}

  ask(actor: RequestActor, req: AskRequest): Promise<AskAnswer> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.askInTx(tx, actor, req),
    );
  }

  private async askInTx(tx: Tx, actor: RequestActor, req: AskRequest): Promise<AskAnswer> {
    const channel: AiChannel = req.channel ?? 'web';
    const feature: AiFeature = channel === 'slack' || channel === 'teams' ? 'ask_chat' : 'ask';
    await this.settings.assertEnabled(tx, actor.tenantId, feature);

    const settings = await this.settings.settings(tx, actor.tenantId);
    const asked = await this.log.countRecentAsks(tx, actor.tenantId, actor.subject);
    const noScope: ScopeSummary = {
      action: 'budget.read',
      scope: this.retrieval.scopeKind(actor, 'budget.read'),
      consideredCount: 0,
      permittedCount: 0,
    };
    if (asked >= settings.questionsPerPersonPerHour) {
      const logged = await this.gateway.logOnly({
        tx,
        actor,
        feature,
        channel,
        scope: noScope,
        sources: [],
        outcome: 'rate_limited',
      });
      throw new ApiProblem(
        429,
        'RATE_LIMIT_EXCEEDED',
        `You have asked ${settings.questionsPerPersonPerHour} questions in the last hour. Try again later. (${logged.queryLogId})`,
      );
    }

    const intent = ACTION_INTENTS.find((i) => i.pattern.test(req.question));
    if (intent) {
      const logged = await this.gateway.logOnly({
        tx,
        actor,
        feature,
        channel,
        scope: noScope,
        sources: [],
        outcome: 'refused_action',
      });
      return this.turn(tx, actor, req, channel, {
        outcome: 'refused_action',
        answer: null,
        why: [],
        figures: [],
        sources: [],
        followUps: [],
        confidence: null,
        refusal: {
          kind: 'action',
          message: intent.message,
          redirect: {
            label: 'Open the screen',
            resourceType: intent.resourceType,
            resourceId: null,
          },
        },
        provenance: logged.provenance,
      });
    }

    const retrieved = await this.retrieve(tx, actor, req);
    if (retrieved.refusal) {
      const logged = await this.gateway.logOnly({
        tx,
        actor,
        feature,
        channel,
        scope: retrieved.scope,
        sources: [],
        outcome: 'refused_out_of_scope',
      });
      return this.turn(tx, actor, req, channel, {
        outcome: 'refused_out_of_scope',
        answer: null,
        why: [],
        figures: [],
        sources: [],
        followUps: [],
        confidence: null,
        refusal: retrieved.refusal,
        provenance: logged.provenance,
      });
    }

    const result = await this.gateway.run({
      tx,
      actor,
      feature,
      channel,
      task: 'ask',
      facts: retrieved.facts,
      sources: retrieved.sources,
      scope: retrieved.scope,
      prompt: req.question,
      schema: AskOutput,
      successOutcome: 'answered',
      narrative: (out) => [out.answer, ...out.why],
    });
    if (!result.output) {
      const unreliable = result.outcome === 'discarded_unreliable';
      return this.turn(tx, actor, req, channel, {
        outcome: result.outcome,
        answer: null,
        why: [],
        figures: [],
        sources: retrieved.sources,
        followUps: [],
        confidence: null,
        refusal: {
          kind: unreliable ? 'unreliable' : 'other_person',
          message: unreliable
            ? 'I could not produce a reliable answer. Try asking about one budget or one period.'
            : 'AI answers are unavailable right now. Everything else works as usual.',
          redirect: null,
        },
        provenance: result.provenance,
      });
    }
    return this.turn(tx, actor, req, channel, {
      outcome: 'answered',
      answer: result.output.answer,
      why: result.output.why,
      figures: figuresFor(retrieved.budgets),
      sources: retrieved.sources,
      followUps: result.output.followUps,
      confidence: result.output.confidence,
      refusal: null,
      provenance: result.provenance,
    });
  }

  /** Terms from the question, resolved through PolicyService-scoped reads only. */
  private async retrieve(
    tx: Tx,
    actor: RequestActor,
    req: AskRequest,
  ): Promise<{
    facts: Fact[];
    sources: AiSourceRef[];
    budgets: BudgetDetail[];
    scope: ScopeSummary;
    refusal: AiRefusal | null;
  }> {
    const terms = searchTerms(req.question);
    const refs = req.question.match(/\bREQ-[A-Z0-9-]+/gi) ?? [];
    const facts: Fact[] = [];
    const sources: AiSourceRef[] = [];
    const budgets: BudgetDetail[] = [];
    let considered = 0;
    let permitted = 0;
    let scope = this.retrieval.scopeKind(actor, 'budget.read');

    const take = (r: Awaited<ReturnType<AiRetrieval['budgetFacts']>>) => {
      considered += r.scope.consideredCount;
      permitted += r.scope.permittedCount;
      scope = r.scope.scope;
      for (const f of r.facts) if (!facts.some((x) => x.id === f.id)) facts.push(f);
      for (const s of r.sources) if (!sources.some((x) => x.id === s.id)) sources.push(s);
      for (const b of r.rows) if (!budgets.some((x) => x.id === b.id)) budgets.push(b);
    };

    if (req.context?.type === 'budget')
      take(await this.retrieval.budgetFacts(tx, actor, { ids: [req.context.id] }));
    for (const term of terms) take(await this.retrieval.budgetFacts(tx, actor, { search: term }));
    if (!terms.length && !req.context)
      take(await this.retrieval.budgetFacts(tx, actor, { limit: 5 }));

    for (const term of terms) {
      const found = await this.retrieval.eventFacts(tx, actor, { search: term });
      considered += found.scope.consideredCount;
      permitted += found.scope.permittedCount;
      facts.push(...found.facts.filter((f) => !facts.some((x) => x.id === f.id)));
      sources.push(...found.sources.filter((s) => !sources.some((x) => x.id === s.id)));
    }
    for (const ref of refs) {
      const found = await this.retrieval.requestFacts(tx, actor, { ref });
      considered += found.scope.consideredCount;
      permitted += found.scope.permittedCount;
      facts.push(...found.facts.filter((f) => !facts.some((x) => x.id === f.id)));
      sources.push(...found.sources.filter((s) => !sources.some((x) => x.id === s.id)));
    }

    const summary: ScopeSummary = {
      action: 'budget.read',
      scope,
      consideredCount: considered,
      permittedCount: permitted,
    };
    if (facts.length === 0) {
      const named = [...terms, ...refs][0];
      return {
        facts,
        sources,
        budgets,
        scope: summary,
        refusal: {
          kind: 'out_of_scope',
          message: named
            ? `I can only answer about records you can see. I found nothing you have access to called "${named}".`
            : 'I can only answer about records you can see, and I found nothing in your scope.',
          redirect: null,
        },
      };
    }
    return { facts, sources, budgets, scope: summary, refusal: null };
  }

  // Conversations -----------------------------------------------------------------------------

  private async turn(
    tx: Tx,
    actor: RequestActor,
    req: AskRequest,
    channel: AiChannel,
    answer: Omit<AskAnswer, 'conversationId' | 'turnId' | 'asOf'> & { provenance: AiProvenance },
  ): Promise<AskAnswer> {
    const conversationId = await this.conversation(tx, actor, req, channel);
    const [turn] = await tx
      .insert(aiConversationTurns)
      .values({
        tenantId: actor.tenantId,
        conversationId,
        actorSubject: actor.subject,
        question: req.question,
        answer: answer.answer,
        outcome: answer.outcome,
        queryLogId: answer.provenance.queryLogId,
      })
      .returning({ id: aiConversationTurns.id });
    await tx
      .update(aiConversations)
      .set({ lastAskedAt: new Date() })
      .where(eq(aiConversations.id, conversationId));
    return {
      ...answer,
      conversationId,
      turnId: turn.id,
      asOf: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    };
  }

  private async conversation(
    tx: Tx,
    actor: RequestActor,
    req: AskRequest,
    channel: AiChannel,
  ): Promise<string> {
    if (req.conversationId) {
      const [existing] = await tx
        .select({ id: aiConversations.id })
        .from(aiConversations)
        .where(
          and(
            eq(aiConversations.tenantId, actor.tenantId),
            eq(aiConversations.id, req.conversationId),
            eq(aiConversations.actorSubject, actor.subject),
          ),
        );
      if (!existing) throw ApiProblem.notFound('conversation');
      return existing.id;
    }
    const [created] = await tx
      .insert(aiConversations)
      .values({
        tenantId: actor.tenantId,
        personId: actor.personId,
        actorSubject: actor.subject,
        title: req.question.slice(0, 80),
        channel,
      })
      .returning({ id: aiConversations.id });
    return created.id;
  }

  async conversations(actor: RequestActor): Promise<AiConversationList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.conversationsInTx(tx, actor),
    );
  }

  private async conversationsInTx(tx: Tx, actor: RequestActor): Promise<AiConversationList> {
    const settings = await this.settings.settings(tx, actor.tenantId);
    const rows = await tx
      .select({
        c: aiConversations,
        turnCount: sql<string>`(select count(*)::text from ${aiConversationTurns} t where t.conversation_id = ${aiConversations.id})`,
      })
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.tenantId, actor.tenantId),
          eq(aiConversations.actorSubject, actor.subject),
          sql`${aiConversations.lastAskedAt} > now() - make_interval(days => ${settings.conversationHistoryDays})`,
        ),
      )
      .orderBy(desc(aiConversations.lastAskedAt), aiConversations.title, aiConversations.id);
    return {
      items: rows.map((r) => ({
        id: r.c.id,
        title: r.c.title,
        channel: r.c.channel as AiChannel,
        turnCount: Number(r.turnCount),
        startedAt: r.c.startedAt.toISOString().replace(/\.\d+Z$/, 'Z'),
        lastAskedAt: r.c.lastAskedAt.toISOString().replace(/\.\d+Z$/, 'Z'),
      })),
    };
  }

  async conversation_(actor: RequestActor, id: string): Promise<AiConversationDetail> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const list = await this.conversationsInTx(tx, actor);
      const conversation = list.items.find((c) => c.id === id);
      if (!conversation) throw ApiProblem.notFound('conversation');
      const turns = await tx
        .select()
        .from(aiConversationTurns)
        .where(
          and(
            eq(aiConversationTurns.tenantId, actor.tenantId),
            eq(aiConversationTurns.conversationId, id),
            eq(aiConversationTurns.actorSubject, actor.subject),
          ),
        )
        .orderBy(aiConversationTurns.askedAt, aiConversationTurns.id);
      return {
        conversation,
        turns: turns.map((t) => ({
          id: t.id,
          askedAt: t.askedAt.toISOString().replace(/\.\d+Z$/, 'Z'),
          question: t.question,
          answer: t.answer,
          outcome: t.outcome as AskAnswer['outcome'],
        })),
      };
    });
  }

  async deleteConversation(actor: RequestActor, id: string): Promise<AiConversationList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const deleted = await tx
        .delete(aiConversations)
        .where(
          and(
            eq(aiConversations.tenantId, actor.tenantId),
            eq(aiConversations.id, id),
            eq(aiConversations.actorSubject, actor.subject),
          ),
        )
        .returning({ id: aiConversations.id });
      if (!deleted.length) throw ApiProblem.notFound('conversation');
      return this.conversationsInTx(tx, actor);
    });
  }
}

/** Capitalized phrases in the question: the names a person uses for records. */
export function searchTerms(question: string): string[] {
  const matches = question.match(/\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*/g) ?? [];
  const terms = matches
    .map((m) =>
      m
        .split(/\s+/)
        .filter((w) => !STOP_WORDS.has(w))
        .join(' ')
        .trim(),
    )
    .filter((m) => m.length >= 3 && !/^REQ-/i.test(m));
  return [...new Set(terms)].sort();
}

const money = (m: Money): Money => ({ amountMinor: m.amountMinor, currency: m.currency });

/** Figures are rendered by BudgetFlow from the read models, never written by the model. */
function figuresFor(budgets: readonly BudgetDetail[]): AiFigure[] {
  return budgets.flatMap((b) => {
    const source: AiSourceRef = { type: 'budget', id: b.id, label: b.name };
    const bal = b.balances.budgetCurrency;
    return [
      { key: 'authorized', label: 'Authorized', amount: money(bal.authorized), source },
      { key: 'pending', label: 'Pending', amount: money(bal.preEncumbered), source },
      { key: 'committed', label: 'Committed', amount: money(bal.encumbered), source },
      { key: 'actual', label: 'Actual', amount: money(bal.actual), source },
      {
        key: 'available',
        label: "Available under this budget's rules",
        amount: money(b.available.underRules),
        source,
      },
    ];
  });
}
