import { auditEvents, people, withTenant, type Db } from '@bf/api/db';
import { CurrentActor, DB, parseWith, PolicyService, type RequestActor } from '@bf/api/core';
import { AuditEventQuery, type AuditEventList, type AuditVerification } from '@bf/contracts';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lt, type SQL } from 'drizzle-orm';
import { AuditService } from './audit.service';

@Controller('api/audit')
export class AuditController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  @Get('events')
  async list(
    @CurrentActor() actor: RequestActor,
    @Query() rawQuery: unknown,
  ): Promise<AuditEventList> {
    const q = parseWith(AuditEventQuery, rawQuery);
    this.policy.assert(actor, 'audit.read', { kind: 'tenant', tenantId: actor.tenantId });
    const limit = q.limit ?? 50;
    const newestFirst = q.order === 'desc';
    const after = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString('utf8')) || 0 : 0;
    const filters: SQL[] = newestFirst
      ? after
        ? [lt(auditEvents.seq, after)]
        : []
      : [gt(auditEvents.seq, after)];
    if (q.resourceType) filters.push(eq(auditEvents.resourceType, q.resourceType));
    if (q.resourceId) filters.push(eq(auditEvents.resourceId, q.resourceId));
    if (q.action) filters.push(eq(auditEvents.action, q.action));
    const { rows, names } = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      async (tx) => {
        const rows = await tx
          .select()
          .from(auditEvents)
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(newestFirst ? desc(auditEvents.seq) : asc(auditEvents.seq))
          .limit(limit + 1);
        const ids = [
          ...new Set(
            rows
              .flatMap((r) => [r.actorPersonId, r.onBehalfOfPersonId])
              .filter((x): x is string => Boolean(x)),
          ),
        ];
        const found = ids.length
          ? await tx
              .select({ id: people.id, name: people.displayName })
              .from(people)
              .where(inArray(people.id, ids))
          : [];
        return { rows, names: new Map(found.map((p) => [p.id, p.name])) };
      },
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        seq: r.seq,
        occurredAt: r.occurredAt.toISOString(),
        actorPersonId: r.actorPersonId,
        actorSubject: r.actorSubject,
        onBehalfOfPersonId: r.onBehalfOfPersonId,
        actorName: r.actorPersonId ? (names.get(r.actorPersonId) ?? null) : null,
        onBehalfOfName: r.onBehalfOfPersonId ? (names.get(r.onBehalfOfPersonId) ?? null) : null,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        legalEntityId: r.legalEntityId,
        requestId: r.requestId,
        reason: r.reason,
        changes: r.changes as Record<string, unknown>,
        prevHash: r.prevHash,
        hash: r.hash,
      })),
      nextCursor:
        rows.length > limit
          ? Buffer.from(String(page[page.length - 1].seq), 'utf8').toString('base64url')
          : null,
    };
  }

  @Get('verification')
  async verify(@CurrentActor() actor: RequestActor): Promise<AuditVerification> {
    this.policy.assert(actor, 'audit.read', { kind: 'tenant', tenantId: actor.tenantId });
    const v = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      (tx) => this.audit.verify(tx),
    );
    return { ...v, verifiedAt: new Date().toISOString() };
  }
}
