import { AuditService } from '@bf/api/audit';
import { budgetResource } from '@bf/api/budgets';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import {
  actuals,
  aiSuggestions,
  auditEvents,
  budgets,
  people,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  AiFeedbackRequest,
  AiQueryLogEntry,
  AiSourceRef,
  AiSuggestionDecision,
  AiSuggestionDecisionRequest,
  AiFeature,
} from '@bf/contracts';
import type { Action, Resource } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte } from 'drizzle-orm';
import { AiGateway } from './ai-gateway.service';
import type { CommandContext } from './settings.service';

export type SuggestionRow = typeof aiSuggestions.$inferSelect;

/**
 * The permission a person must hold in their own right before their decision on a suggestion counts.
 * An AI suggestion is never itself authorization: accepting one needs the same action as doing the
 * underlying work unaided, and the underlying work still runs through its own command.
 */
const DECISION_ACTIONS: Record<AiFeature, Action> = {
  ask: 'tenant.read',
  ask_chat: 'tenant.read',
  policy_explain: 'tenant.read',
  outlook: 'budget.read',
  allocation_suggestions: 'budget.allocate',
  matching: 'actuals.manage',
  extraction: 'request.create',
  anomaly_flags: 'exception.resolve',
  // Drafted text is a draft: approving a leadership summary needs the same reading rights as
  // writing it by hand, and a variance commentary belongs to the owner who forecasts the budget.
  leadership_summary: 'report.read',
  variance_commentary: 'forecast.submit',
  // The assistant connector (092c) only reads, so it raises no suggestion to decide on. The entry
  // exists so the map stays total; `tenant.read` is the weakest action any signed-in person holds.
  mcp: 'tenant.read',
};

export interface SuggestionInput {
  tenantId: string;
  feature: AiFeature;
  subjectType: string;
  subjectId: string;
  budgetId?: string | null;
  confidence: 'high' | 'medium' | 'low';
  scoreBps?: number;
  payload: Record<string, unknown>;
  sources: readonly AiSourceRef[];
  createdByPersonId: string | null;
  provider: string;
  modelId: string;
  modelVersion: string;
}

/**
 * Stores what a model proposed and what a person then did with it. Nothing here changes a budget, a
 * ledger balance, an approval or a control: applying a suggestion is a separate, normally authorized
 * command, and this service refuses to record an acceptance until that command has actually run.
 */
@Injectable()
export class AiSuggestionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly commands: CommandRunner,
    private readonly audit: AuditService,
    private readonly gateway: AiGateway,
  ) {}

  rateFor(
    actor: RequestActor,
    suggestionId: string,
    req: AiFeedbackRequest,
  ): Promise<AiQueryLogEntry> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.rate(tx, actor, suggestionId, req),
    );
  }

  /** One open suggestion per (feature, subject): re-running a scan refreshes it instead of piling up. */
  async upsert(tx: Tx, input: SuggestionInput): Promise<SuggestionRow> {
    const [row] = await tx
      .insert(aiSuggestions)
      .values({
        tenantId: input.tenantId,
        feature: input.feature,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        budgetId: input.budgetId ?? null,
        confidence: input.confidence,
        scoreBps: input.scoreBps ?? 0,
        payload: input.payload,
        sources: input.sources as unknown as object,
        provider: input.provider,
        modelId: input.modelId,
        modelVersion: input.modelVersion,
        createdByPersonId: input.createdByPersonId,
        status: 'open',
      })
      .onConflictDoUpdate({
        target: [
          aiSuggestions.tenantId,
          aiSuggestions.feature,
          aiSuggestions.subjectType,
          aiSuggestions.subjectId,
        ],
        set: {
          confidence: input.confidence,
          scoreBps: input.scoreBps ?? 0,
          payload: input.payload,
          sources: input.sources as unknown as object,
          provider: input.provider,
          modelId: input.modelId,
          modelVersion: input.modelVersion,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  }

  async row(tx: Tx, tenantId: string, id: string): Promise<SuggestionRow> {
    const [row] = await tx
      .select()
      .from(aiSuggestions)
      .where(and(eq(aiSuggestions.tenantId, tenantId), eq(aiSuggestions.id, id)));
    if (!row) throw ApiProblem.notFound('suggestion');
    return row;
  }

  private async resourceFor(tx: Tx, actor: RequestActor, row: SuggestionRow): Promise<Resource> {
    if (!row.budgetId) return { kind: 'tenant', tenantId: actor.tenantId };
    const [budget] = await tx.select().from(budgets).where(eq(budgets.id, row.budgetId));
    return budget ? budgetResource(budget) : { kind: 'tenant', tenantId: actor.tenantId };
  }

  /**
   * Records a human decision. `accepted` is only recorded once the underlying, separately authorized
   * command has run: the API looks for the audit entry that command wrote on the applied record.
   */
  decide(
    actor: RequestActor,
    suggestionId: string,
    req: AiSuggestionDecisionRequest,
    ctx: CommandContext,
  ): Promise<CommandResult<AiSuggestionDecision>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: `ai.suggestion.decide:${suggestionId}`,
        request: req,
        status: 201,
      },
      async (tx) => {
        const row = await this.row(tx, actor.tenantId, suggestionId);
        const feature = row.feature as AiFeature;
        this.policy.assert(
          actor,
          DECISION_ACTIONS[feature],
          await this.resourceFor(tx, actor, row),
          'suggestion',
        );
        if (row.status !== 'open')
          throw new ApiProblem(
            409,
            'AI_SUGGESTION_NOT_OPEN',
            'That suggestion has already been decided.',
          );
        if (req.decision === 'rejected' && !req.reasonCode)
          throw new ApiProblem(
            422,
            'REASON_REQUIRED',
            'Rejecting a suggestion needs a reason code; the reasons feed the evaluation set.',
          );
        let appliedType: string | null = null;
        let appliedId: string | null = null;
        if (req.decision === 'accepted') {
          const applied = await this.verifyApplied(tx, actor, row, req);
          appliedType = applied.type;
          appliedId = applied.id;
        }
        const now = new Date();
        await tx
          .update(aiSuggestions)
          .set({
            status: req.decision,
            decidedByPersonId: actor.personId,
            decidedAt: now,
            decisionReasonCode: req.reasonCode ?? null,
            decisionReason: req.reason ?? null,
            appliedResourceType: appliedType,
            appliedResourceId: appliedId,
            payload:
              req.decision === 'accepted' && req.confirmedFields
                ? {
                    ...(row.payload as Record<string, unknown>),
                    confirmedFields: req.confirmedFields,
                  }
                : (row.payload as Record<string, unknown>),
            updatedAt: now,
          })
          .where(eq(aiSuggestions.id, row.id));
        const audited = await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: `ai.suggestion.${req.decision}`,
          resourceType: 'ai_suggestion',
          resourceId: row.id,
          requestId: ctx.requestId,
          reason: req.reason ?? null,
          changes: {
            feature: { from: null, to: row.feature },
            status: { from: row.status, to: req.decision },
            modelId: { from: null, to: row.modelId },
            modelVersion: { from: null, to: row.modelVersion },
            appliedResource: {
              from: null,
              to: appliedId ? { type: appliedType, id: appliedId } : null,
            },
            reasonCode: { from: null, to: req.reasonCode ?? null },
          },
        });
        const logged = await this.gateway.logOnly({
          tx,
          actor,
          feature,
          channel: 'web',
          scope: {
            action: DECISION_ACTIONS[feature],
            scope: 'self',
            consideredCount: 1,
            permittedCount: 1,
          },
          sources: (row.sources as AiSourceRef[]) ?? [],
          outcome: req.decision,
          suggestionId: row.id,
          appliedResourceType: appliedType,
          appliedResourceId: appliedId,
          auditEventId: audited.id,
        });
        const decider = actor.personId
          ? (
              await tx
                .select({ name: people.displayName })
                .from(people)
                .where(eq(people.id, actor.personId))
            )[0]?.name
          : null;
        return {
          suggestionId: row.id,
          feature,
          status: req.decision,
          decidedByName: decider ?? null,
          decidedAt: now.toISOString().replace(/\.\d+Z$/, 'Z'),
          appliedResourceType: appliedType,
          appliedResourceId: appliedId,
          auditEventId: audited.id,
          queryLogId: logged.queryLogId,
        } satisfies AiSuggestionDecision;
      },
    );
  }

  /**
   * Proof that a person really applied the suggestion through the normal command: an audit entry on
   * the applied record, written after the suggestion was made. Extraction is the one feature with no
   * separate record to point at, so it records the fields the person confirmed instead.
   */
  private async verifyApplied(
    tx: Tx,
    actor: RequestActor,
    row: SuggestionRow,
    req: AiSuggestionDecisionRequest,
  ): Promise<{ type: string | null; id: string | null }> {
    if (row.feature === 'extraction') {
      if (!req.confirmedFields || Object.keys(req.confirmedFields).length === 0)
        throw new ApiProblem(
          422,
          'VALIDATION_FAILED',
          'Accepting an extraction records the values you checked: send confirmedFields.',
        );
      return { type: 'document', id: row.subjectId };
    }
    if (!req.appliedResourceId || !req.appliedResourceType || req.appliedResourceType === 'none')
      throw new ApiProblem(
        422,
        'VALIDATION_FAILED',
        'Accepting a suggestion records the record you changed: send appliedResourceType and appliedResourceId.',
      );
    const applied = await tx
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, actor.tenantId),
          eq(auditEvents.resourceId, req.appliedResourceId),
          gte(auditEvents.occurredAt, row.createdAt),
        ),
      )
      .limit(1);
    if (applied.length === 0)
      throw new ApiProblem(
        409,
        'AI_SUGGESTION_NOT_APPLIED',
        'Nothing has changed on that record yet. Apply the suggestion through the normal command first; an AI suggestion never changes anything on its own.',
      );
    if (row.feature === 'matching') {
      const [actual] = await tx
        .select({ matchStatus: actuals.matchStatus })
        .from(actuals)
        .where(and(eq(actuals.tenantId, actor.tenantId), eq(actuals.id, req.appliedResourceId)));
      if (!actual || actual.matchStatus === 'unmatched')
        throw new ApiProblem(
          409,
          'AI_SUGGESTION_NOT_APPLIED',
          'That spend line is still unmatched. Match it through the actuals match command first.',
        );
    }
    return { type: req.appliedResourceType, id: req.appliedResourceId };
  }

  /** Helpful or not helpful: logged in the AI query log, never in the audit log (nothing changed). */
  async rate(
    tx: Tx,
    actor: RequestActor,
    suggestionId: string,
    req: AiFeedbackRequest,
  ): Promise<AiQueryLogEntry> {
    const row = await this.row(tx, actor.tenantId, suggestionId);
    const feature = row.feature as AiFeature;
    this.policy.assert(actor, 'tenant.read', await this.resourceFor(tx, actor, row), 'suggestion');
    const logged = await this.gateway.logOnly({
      tx,
      actor,
      feature,
      channel: 'web',
      scope: { action: 'tenant.read', scope: 'self', consideredCount: 1, permittedCount: 1 },
      sources: (row.sources as AiSourceRef[]) ?? [],
      outcome: req.rating === 'helpful' ? 'answered' : 'dismissed',
      suggestionId: row.id,
    });
    return {
      id: logged.queryLogId,
      occurredAt: logged.provenance.generatedAt,
      feature,
      channel: 'web',
      actorName: null,
      actorPersonId: actor.personId,
      outcome: req.rating === 'helpful' ? 'answered' : 'dismissed',
      scope: { action: 'tenant.read', scope: 'self', consideredCount: 1, permittedCount: 1 },
      recordsUsed: ((row.sources as AiSourceRef[]) ?? []).length,
      factRefs: (row.sources as AiSourceRef[]) ?? [],
      sentFields: [],
      modelId: row.modelId,
      modelVersion: row.modelVersion,
      latencyMs: 0,
      suggestionId: row.id,
      appliedResourceType: row.appliedResourceType,
      appliedResourceId: row.appliedResourceId,
      auditEventId: null,
    };
  }
}
