import { auditEvents, withTenant, type Db } from '@bf/api/db';
import { CurrentActor, DB, parseWith, PolicyService, type RequestActor } from '@bf/api/core';
import { AuditEventQuery, type AuditEventList, type AuditVerification } from '@bf/contracts';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { and, asc, eq, gt, type SQL } from 'drizzle-orm';
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
    const after = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString('utf8')) || 0 : 0;
    const filters: SQL[] = [gt(auditEvents.seq, after)];
    if (q.resourceType) filters.push(eq(auditEvents.resourceType, q.resourceType));
    if (q.resourceId) filters.push(eq(auditEvents.resourceId, q.resourceId));
    if (q.action) filters.push(eq(auditEvents.action, q.action));
    const rows = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      (tx) =>
        tx
          .select()
          .from(auditEvents)
          .where(and(...filters))
          .orderBy(asc(auditEvents.seq))
          .limit(limit + 1),
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
