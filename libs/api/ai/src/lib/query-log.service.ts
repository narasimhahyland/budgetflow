import { ApiProblem, DB, PolicyService, type RequestActor } from '@bf/api/core';
import { aiQueryLog, people, withTenant, type Db, type Tx } from '@bf/api/db';
import type {
  AiChannel,
  AiFeature,
  AiOutcome,
  AiQueryLogEntry,
  AiQueryLogList,
  AiSourceRef,
} from '@bf/contracts';
import type { Action } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';

export type ScopeKind = 'tenant' | 'owned' | 'self' | 'none';

/** The authorization that was applied before anything was retrieved for a model call. */
export interface ScopeSummary {
  action: Action;
  scope: ScopeKind;
  consideredCount: number;
  permittedCount: number;
}

export interface QueryLogAppend {
  tenantId: string;
  feature: AiFeature;
  channel: AiChannel;
  actorPersonId: string | null;
  actorSubject: string;
  outcome: AiOutcome;
  scope: ScopeSummary;
  factRefs: readonly AiSourceRef[];
  sentFields: readonly string[];
  provider: string;
  modelId: string;
  modelVersion: string;
  latencyMs: number;
  suggestionId?: string | null;
  appliedResourceType?: string | null;
  appliedResourceId?: string | null;
  auditEventId?: string | null;
}

/**
 * The append-only AI query log (113a): who used which feature over which records, under which
 * authorization scope, what came out, and what a person later confirmed. Never the question or the
 * answer text, and never a figure. It is what an auditor reads to reconstruct an AI-influenced decision.
 */
@Injectable()
export class AiQueryLogService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
  ) {}

  listFor(
    actor: RequestActor,
    query: {
      feature?: AiFeature;
      outcome?: AiOutcome;
      suggestionId?: string;
      cursor?: string;
      limit?: number;
    },
  ): Promise<AiQueryLogList> {
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, (tx) =>
      this.list(tx, actor, query),
    );
  }

  async append(tx: Tx, entry: QueryLogAppend): Promise<string> {
    const [row] = await tx
      .insert(aiQueryLog)
      .values({
        tenantId: entry.tenantId,
        feature: entry.feature,
        channel: entry.channel,
        actorPersonId: entry.actorPersonId,
        actorSubject: entry.actorSubject,
        outcome: entry.outcome,
        scopeAction: entry.scope.action,
        scopeKind: entry.scope.scope,
        consideredCount: entry.scope.consideredCount,
        permittedCount: entry.scope.permittedCount,
        factRefs: entry.factRefs as unknown as object,
        sentFields: [...entry.sentFields],
        provider: entry.provider,
        modelId: entry.modelId,
        modelVersion: entry.modelVersion,
        latencyMs: entry.latencyMs,
        suggestionId: entry.suggestionId ?? null,
        appliedResourceType: entry.appliedResourceType ?? null,
        appliedResourceId: entry.appliedResourceId ?? null,
        auditEventId: entry.auditEventId ?? null,
      })
      .returning({ id: aiQueryLog.id });
    return row.id;
  }

  /** Reading the log needs `audit.read` (Auditor, Finance, CEO) or `tenant.settings.manage` (Org Admin). */
  assertCanRead(actor: RequestActor): void {
    const tenant = { kind: 'tenant' as const, tenantId: actor.tenantId };
    if (
      this.policy.can(actor, 'audit.read', tenant).allowed ||
      this.policy.can(actor, 'tenant.settings.manage', tenant).allowed
    )
      return;
    throw ApiProblem.forbidden('Reading the AI query log needs audit or tenant settings access.');
  }

  async list(
    tx: Tx,
    actor: RequestActor,
    query: {
      feature?: AiFeature;
      outcome?: AiOutcome;
      suggestionId?: string;
      cursor?: string;
      limit?: number;
    },
  ): Promise<AiQueryLogList> {
    this.assertCanRead(actor);
    const limit = Math.min(query.limit ?? 50, 200);
    const cursor = decodeCursor(query.cursor);
    const where = and(
      eq(aiQueryLog.tenantId, actor.tenantId),
      query.feature ? eq(aiQueryLog.feature, query.feature) : undefined,
      query.outcome ? eq(aiQueryLog.outcome, query.outcome) : undefined,
      query.suggestionId ? eq(aiQueryLog.suggestionId, query.suggestionId) : undefined,
      cursor
        ? or(
            lt(aiQueryLog.occurredAt, cursor.occurredAt),
            and(eq(aiQueryLog.occurredAt, cursor.occurredAt), lt(aiQueryLog.id, cursor.id)),
          )
        : undefined,
    );
    const rows = await tx
      .select({ log: aiQueryLog, actorName: people.displayName })
      .from(aiQueryLog)
      .leftJoin(people, eq(people.id, aiQueryLog.actorPersonId))
      .where(where)
      .orderBy(desc(aiQueryLog.occurredAt), desc(aiQueryLog.feature), desc(aiQueryLog.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => toEntry(r.log, r.actorName)),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(`${last.log.occurredAt.toISOString()}|${last.log.id}`).toString('base64url')
          : null,
    };
  }

  /** Questions this person has asked in the last hour, for the per-person rate limit (113a). */
  async countRecentAsks(tx: Tx, tenantId: string, actorSubject: string): Promise<number> {
    const res = await tx.execute<{ n: string }>(sql`
      select count(*)::text as n from ${aiQueryLog}
      where ${aiQueryLog.tenantId} = ${tenantId} and ${aiQueryLog.actorSubject} = ${actorSubject}
        and ${aiQueryLog.feature} in ('ask', 'ask_chat')
        and ${aiQueryLog.occurredAt} > now() - interval '1 hour'`);
    return Number(res.rows[0]?.n ?? 0);
  }

  /** Production acceptance: how many shown suggestions a person accepted in the last 30 days (113a). */
  async acceptanceCounts(
    tx: Tx,
    tenantId: string,
    feature: AiFeature,
  ): Promise<{ shown: number; accepted: number }> {
    const res = await tx.execute<{ shown: string; accepted: string }>(sql`
      select count(*) filter (where outcome = 'suggested')::text as shown,
             count(*) filter (where outcome = 'accepted')::text as accepted
      from ${aiQueryLog}
      where ${aiQueryLog.tenantId} = ${tenantId} and ${aiQueryLog.feature} = ${feature}
        and ${aiQueryLog.occurredAt} > now() - interval '30 days'`);
    const row = res.rows[0];
    return { shown: Number(row?.shown ?? 0), accepted: Number(row?.accepted ?? 0) };
  }
}

function decodeCursor(cursor?: string): { occurredAt: Date; id: string } | null {
  if (!cursor) return null;
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const occurredAt = new Date(at);
  if (!id || Number.isNaN(occurredAt.getTime()))
    throw new ApiProblem(400, 'VALIDATION_FAILED', 'The cursor is not valid.');
  return { occurredAt, id };
}

function toEntry(row: typeof aiQueryLog.$inferSelect, actorName: string | null): AiQueryLogEntry {
  const factRefs = (row.factRefs as AiSourceRef[]) ?? [];
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString().replace(/\.\d+Z$/, 'Z'),
    feature: row.feature as AiFeature,
    channel: row.channel as AiChannel,
    actorName,
    actorPersonId: row.actorPersonId,
    outcome: row.outcome as AiOutcome,
    scope: {
      action: row.scopeAction,
      scope: row.scopeKind as ScopeKind,
      consideredCount: row.consideredCount,
      permittedCount: row.permittedCount,
    },
    recordsUsed: factRefs.length,
    factRefs,
    sentFields: row.sentFields,
    modelId: row.modelId,
    modelVersion: row.modelVersion,
    latencyMs: row.latencyMs,
    suggestionId: row.suggestionId,
    appliedResourceType: row.appliedResourceType,
    appliedResourceId: row.appliedResourceId,
    auditEventId: row.auditEventId,
  };
}
