import { auditChainHeads, auditEvents, type Tx } from '@bf/api/db';
import { sha256Hex } from '@bf/api/core';
import {
  AUDIT_GENESIS_HASH,
  auditHash,
  verifyAuditChain,
  type AuditPayload,
  type ChainVerification,
  type StoredAuditEvent,
} from '@bf/domain';
import { Injectable } from '@nestjs/common';
import { asc, eq, gt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

export interface AuditEntry {
  tenantId: string;
  actorPersonId: string | null;
  actorSubject: string | null;
  onBehalfOfPersonId?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  legalEntityId?: string | null;
  requestId?: string | null;
  reason?: string | null;
  /** Changed fields only; references instead of personal data or secrets. */
  changes: Record<string, unknown>;
}

type AuditRow = typeof auditEvents.$inferSelect;

export function toPayload(row: AuditRow): AuditPayload {
  return {
    tenantId: row.tenantId,
    seq: row.seq,
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    actorId: row.actorPersonId ?? row.actorSubject,
    onBehalfOfId: row.onBehalfOfPersonId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    legalEntityId: row.legalEntityId,
    requestId: row.requestId,
    reason: row.reason,
    changes: row.changes,
  };
}

/**
 * Appends exactly one hash-chained audit event in the caller's transaction. Writers serialize on the
 * tenant's chain head row, so the chain is strictly sequential under concurrency.
 */
@Injectable()
export class AuditService {
  async append(tx: Tx, entry: AuditEntry): Promise<{ id: string; seq: number; hash: string }> {
    await tx
      .insert(auditChainHeads)
      .values({ tenantId: entry.tenantId, lastSeq: 0, lastHash: AUDIT_GENESIS_HASH })
      .onConflictDoNothing();
    const [head] = await tx
      .select()
      .from(auditChainHeads)
      .where(eq(auditChainHeads.tenantId, entry.tenantId))
      .for('update');
    const occurredAt = new Date(new Date().toISOString());
    const row: AuditRow = {
      id: randomUUID(),
      tenantId: entry.tenantId,
      seq: head.lastSeq + 1,
      occurredAt,
      actorPersonId: entry.actorPersonId,
      actorSubject: entry.actorSubject,
      onBehalfOfPersonId: entry.onBehalfOfPersonId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      legalEntityId: entry.legalEntityId ?? null,
      requestId: entry.requestId ?? null,
      reason: entry.reason ?? null,
      changes: JSON.parse(JSON.stringify(entry.changes)) as Record<string, unknown>,
      prevHash: head.lastHash,
      hash: '',
    };
    row.hash = auditHash(head.lastHash, toPayload(row), sha256Hex);
    await tx.insert(auditEvents).values(row);
    await tx
      .update(auditChainHeads)
      .set({ lastSeq: row.seq, lastHash: row.hash })
      .where(eq(auditChainHeads.tenantId, entry.tenantId));
    return { id: row.id, seq: row.seq, hash: row.hash };
  }

  /** Walks the tenant's chain in batches and reports the first broken link (tenant context set by the caller). */
  async verify(tx: Tx): Promise<ChainVerification> {
    const events: StoredAuditEvent[] = [];
    let after = 0;
    for (;;) {
      const batch = await tx
        .select()
        .from(auditEvents)
        .where(gt(auditEvents.seq, after))
        .orderBy(asc(auditEvents.seq))
        .limit(2000);
      if (batch.length === 0) break;
      for (const r of batch) events.push({ ...toPayload(r), prevHash: r.prevHash, hash: r.hash });
      after = batch[batch.length - 1].seq;
    }
    return verifyAuditChain(events, sha256Hex);
  }

  async count(tx: Tx): Promise<number> {
    const [r] = await tx.select({ n: sql<string>`count(*)` }).from(auditEvents);
    return Number(r.n);
  }
}
