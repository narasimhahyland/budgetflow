import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  nowUtc,
  PolicyService,
  type RequestActor,
} from '@bf/api/core';
import {
  aiConversations,
  aiConversationTurns,
  aiQueryLog,
  aiReportedAnswers,
  people,
  tenants,
  withTenant,
  type Db,
  type Tx,
} from '@bf/api/db';
import type {
  AiChannel,
  AiFeature,
  AiReportAnswerRequest,
  AiReportedAnswer,
  AiReportedAnswerList,
  AiReviewReportRequest,
  AiSourceRef,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { AiQueryLogService } from './query-log.service';
import type { CommandContext } from './settings.service';

/** Question and answer text of a report is kept this long (113a). */
export const REPORT_TEXT_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (d: Date | null) => (d ? d.toISOString().replace(/\.\d+Z$/, 'Z') : null);

type Row = typeof aiReportedAnswers.$inferSelect;

/**
 * 011a "Report a problem" and 113a Query log > Reported answers. A person reports one of their
 * own answers; only when they choose "Include my question and the answer" is any text kept, and
 * only for 90 days. Reading the reports follows the query log (audit or AI administration);
 * marking one reviewed needs AI administration. A report changes nothing the model did or decided.
 */
@Injectable()
export class AiReportedAnswersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly log: AiQueryLogService,
  ) {}

  private canReview(actor: RequestActor): boolean {
    return this.policy.can(actor, 'tenant.settings.manage', {
      kind: 'tenant',
      tenantId: actor.tenantId,
    }).allowed;
  }

  private async view(tx: Tx, rows: Row[]): Promise<AiReportedAnswer[]> {
    const personIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.reporterPersonId, r.reviewedByPersonId])
          .filter((v): v is string => !!v),
      ),
    ];
    const logIds = rows.map((r) => r.queryLogId).filter((v): v is string => !!v);
    const names = personIds.length
      ? new Map(
          (
            await tx
              .select({ id: people.id, name: people.displayName })
              .from(people)
              .where(inArray(people.id, personIds))
          ).map((p) => [p.id, p.name]),
        )
      : new Map<string, string>();
    const logs = logIds.length
      ? new Map(
          (await tx.select().from(aiQueryLog).where(inArray(aiQueryLog.id, logIds))).map((l) => [
            l.id,
            l,
          ]),
        )
      : new Map<string, typeof aiQueryLog.$inferSelect>();
    // Text past its 90 days is never shown, even before the nightly removal has run.
    const now = nowUtc();
    return rows.map((r) => {
      const log = r.queryLogId ? logs.get(r.queryLogId) : undefined;
      const expired = r.textExpiresAt <= now;
      return {
        id: r.id,
        reportedAt: iso(r.reportedAt)!,
        reporterName: r.reporterPersonId ? (names.get(r.reporterPersonId) ?? null) : null,
        feature: r.feature as AiFeature,
        channel: r.channel as AiChannel,
        reason: r.reason as AiReportedAnswer['reason'],
        note: expired ? null : r.note,
        includesText: r.includesText,
        question: expired ? null : r.question,
        answer: expired ? null : r.answer,
        recordsUsed: ((log?.factRefs as AiSourceRef[] | undefined) ?? []).length,
        queryLogId: r.queryLogId,
        modelId: log?.modelId ?? null,
        modelVersion: log?.modelVersion ?? null,
        status: r.status as AiReportedAnswer['status'],
        reviewNote: r.reviewNote,
        reviewedByName: r.reviewedByPersonId ? (names.get(r.reviewedByPersonId) ?? null) : null,
        reviewedAt: iso(r.reviewedAt),
        textExpiresAt: iso(r.textExpiresAt)!,
      };
    });
  }

  list(actor: RequestActor, q: { status?: 'new' | 'reviewed' }): Promise<AiReportedAnswerList> {
    this.log.assertCanRead(actor);
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const rows = await tx
        .select()
        .from(aiReportedAnswers)
        .where(q.status ? eq(aiReportedAnswers.status, q.status) : undefined)
        .orderBy(desc(aiReportedAnswers.reportedAt), desc(aiReportedAnswers.id))
        .limit(200);
      const counts = await tx
        .select({ status: aiReportedAnswers.status, n: sql<number>`count(*)::int` })
        .from(aiReportedAnswers)
        .groupBy(aiReportedAnswers.status);
      const count = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
      return {
        items: await this.view(tx, rows),
        canReview: this.canReview(actor),
        counts: { new: count('new'), reviewed: count('reviewed') },
      };
    });
  }

  /** Reports one of the caller's own answers. Someone else's turn is "not found", never readable. */
  report(actor: RequestActor, req: AiReportAnswerRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'ai.answer.report',
        request: req,
        status: 201,
      },
      async (tx) => {
        const [turn] = await tx
          .select({ turn: aiConversationTurns, channel: aiConversations.channel })
          .from(aiConversationTurns)
          .innerJoin(aiConversations, eq(aiConversations.id, aiConversationTurns.conversationId))
          .where(
            and(
              eq(aiConversationTurns.id, req.turnId),
              eq(aiConversationTurns.actorSubject, actor.subject),
            ),
          );
        if (!turn) throw ApiProblem.notFound('answer');
        const [log] = turn.turn.queryLogId
          ? await tx.select().from(aiQueryLog).where(eq(aiQueryLog.id, turn.turn.queryLogId))
          : [];
        const now = nowUtc();
        const inserted = await tx
          .insert(aiReportedAnswers)
          .values({
            tenantId: actor.tenantId,
            reportedAt: now,
            reporterPersonId: actor.personId,
            reporterSubject: actor.subject,
            turnId: turn.turn.id,
            queryLogId: turn.turn.queryLogId,
            feature: log?.feature ?? 'ask',
            channel: turn.channel,
            reason: req.reason,
            note: req.note?.length ? req.note : null,
            includesText: req.includeText,
            question: req.includeText ? turn.turn.question : null,
            answer: req.includeText ? turn.turn.answer : null,
            textExpiresAt: new Date(now.getTime() + REPORT_TEXT_DAYS * DAY_MS),
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted.length)
          throw new ApiProblem(
            409,
            'AI_ANSWER_ALREADY_REPORTED',
            'You already reported this answer.',
          );
        const row = inserted[0];
        // Audit holds the reason and whether text was included; never the text itself.
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ai.answer.reported',
          resourceType: 'ai_reported_answer',
          resourceId: row.id,
          requestId: ctx.requestId,
          changes: {
            status: { from: null, to: 'new' },
            reason: { from: null, to: req.reason },
            includesText: { from: null, to: req.includeText },
          },
        });
        return (await this.view(tx, [row]))[0];
      },
    );
  }

  review(actor: RequestActor, reportId: string, req: AiReviewReportRequest, ctx: CommandContext) {
    this.log.assertCanRead(actor);
    if (!this.canReview(actor))
      throw ApiProblem.forbidden('Marking a reported answer reviewed needs AI administration.');
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'ai.answer.review',
        request: { reportId, ...req },
        status: 200,
      },
      async (tx) => {
        const [row] = await tx
          .select()
          .from(aiReportedAnswers)
          .where(eq(aiReportedAnswers.id, reportId))
          .for('update');
        if (!row) throw ApiProblem.notFound('reported answer');
        if (row.status === 'reviewed')
          throw new ApiProblem(
            409,
            'AI_REPORT_ALREADY_REVIEWED',
            'This report was already reviewed.',
          );
        const [updated] = await tx
          .update(aiReportedAnswers)
          .set({
            status: 'reviewed',
            reviewNote: req.note,
            reviewedByPersonId: actor.personId,
            reviewedAt: nowUtc(),
          })
          .where(eq(aiReportedAnswers.id, reportId))
          .returning();
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'ai.answer.reviewed',
          resourceType: 'ai_reported_answer',
          resourceId: row.id,
          requestId: ctx.requestId,
          // The review note stays on the report; free text never enters the immutable audit chain.
          reason: 'Reported answer reviewed',
          changes: { status: { from: 'new', to: 'reviewed' } },
        });
        return (await this.view(tx, [updated]))[0];
      },
    );
  }

  /** Nightly (worker): every tenant in turn, each under its own tenant context. */
  async removeExpiredTextAllTenants(): Promise<number> {
    const all = await this.db.transaction((tx) => tx.select({ id: tenants.id }).from(tenants));
    let removed = 0;
    for (const t of all) removed += await this.removeExpiredText(t.id);
    return removed;
  }

  /** Nightly (worker): removes question, answer and note text past its 90 days; the report stays. */
  async removeExpiredText(tenantId: string): Promise<number> {
    return withTenant(this.db, { tenantId, subject: 'system:ai-scan' }, async (tx) => {
      const now = nowUtc();
      const rows = await tx
        .update(aiReportedAnswers)
        .set({ question: null, answer: null, note: null, textRemovedAt: now })
        .where(
          and(isNull(aiReportedAnswers.textRemovedAt), lte(aiReportedAnswers.textExpiresAt, now)),
        )
        .returning({ id: aiReportedAnswers.id });
      return rows.length;
    });
  }
}
