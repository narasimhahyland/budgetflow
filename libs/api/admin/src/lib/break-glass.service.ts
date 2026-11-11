import { AuditService, BREAK_GLASS_READ_ACTION } from '@bf/api/audit';
import { ApiProblem, CommandRunner, DB, PolicyService, type RequestActor } from '@bf/api/core';
import { auditEvents, breakGlassGrants, withTenant, type Db, type Tx } from '@bf/api/db';
import type {
  BreakGlassDecisionRequest,
  BreakGlassGrant,
  BreakGlassGrantList,
  BreakGlassStatus,
  RequestBreakGlassRequest,
  RevokeBreakGlassRequest,
} from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { assertTenant, canTenant, personNames, type CommandContext } from './admin-reads';

/** Longest window an operator may ask for (112: "at most 4 hours"). */
export const BREAK_GLASS_MAX_MINUTES = 240;
const BREAK_GLASS_MIN_MINUTES = 15;
const SCOPE_LABEL = 'Read-only: budgets and the ledger';
const NOTE =
  "The platform operator cannot see the company's financial data. In an emergency they can request time-limited, read-only access, which an Organization Admin who is not the requester must approve. Everything they do is audited.";

type Row = typeof breakGlassGrants.$inferSelect;

/**
 * Break-glass access (112). A platform operator asks; an Organization Admin who is not the operator
 * approves or declines; an approved grant opens the read-only BREAK_GLASS_READS for its window and
 * can be revoked early. Every step and every request made under a grant is audited.
 *
 * Grant windows use the real time, never the pinned development clock: access has to end when its
 * window really ends.
 */
@Injectable()
export class BreakGlassService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  private canDecide(actor: RequestActor): boolean {
    return canTenant(this.policy, actor, 'break_glass.decide');
  }

  private canRequest(actor: RequestActor): boolean {
    return canTenant(this.policy, actor, 'break_glass.request');
  }

  async list(actor: RequestActor): Promise<BreakGlassGrantList> {
    const readsAll = canTenant(this.policy, actor, 'break_glass.read');
    const canRequest = this.canRequest(actor);
    if (!readsAll && !canRequest) throw ApiProblem.forbidden();
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const rows = await tx
        .select()
        .from(breakGlassGrants)
        .where(readsAll ? undefined : eq(breakGlassGrants.idpSubject, actor.subject))
        .orderBy(desc(breakGlassGrants.createdAt), desc(breakGlassGrants.id))
        .limit(100);
      return {
        items: await this.views(tx, actor, rows),
        canRequest,
        canDecide: this.canDecide(actor),
        maxMinutes: BREAK_GLASS_MAX_MINUTES,
        note: NOTE,
      };
    });
  }

  request(actor: RequestActor, req: RequestBreakGlassRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'admin.break_glass.request',
        request: req,
        status: 201,
      },
      async (tx): Promise<BreakGlassGrant> => {
        assertTenant(this.policy, actor, 'break_glass.request', 'break-glass access');
        if (
          req.durationMinutes < BREAK_GLASS_MIN_MINUTES ||
          req.durationMinutes > BREAK_GLASS_MAX_MINUTES
        )
          throw new ApiProblem(
            422,
            'VALIDATION_FAILED',
            `Break-glass access lasts ${BREAK_GLASS_MIN_MINUTES} to ${BREAK_GLASS_MAX_MINUTES} minutes.`,
          );
        const now = new Date();
        const open = await tx
          .select({ id: breakGlassGrants.id })
          .from(breakGlassGrants)
          .where(
            and(
              eq(breakGlassGrants.idpSubject, actor.subject),
              or(
                eq(breakGlassGrants.status, 'requested'),
                and(
                  eq(breakGlassGrants.status, 'approved'),
                  isNull(breakGlassGrants.revokedAt),
                  sql`${breakGlassGrants.validToTs} > ${now}`,
                ),
              ),
            ),
          )
          .limit(1);
        if (open.length > 0)
          throw new ApiProblem(
            409,
            'CONFLICT',
            'You already have a break-glass request waiting or a grant in force.',
          );
        const [row] = await tx
          .insert(breakGlassGrants)
          .values({
            tenantId: actor.tenantId,
            idpSubject: actor.subject,
            requestedByName: actor.displayName,
            reason: req.reason,
            status: 'requested',
            scope: 'budgets_and_ledger',
            requestedMinutes: req.durationMinutes,
            createdAt: now,
          })
          .returning();
        await this.record(tx, actor, ctx, 'break_glass.requested', row.id, req.reason, {
          requestedMinutes: req.durationMinutes,
          scope: 'budgets_and_ledger',
        });
        return (await this.views(tx, actor, [row]))[0];
      },
    );
  }

  decide(
    actor: RequestActor,
    grantId: string,
    req: BreakGlassDecisionRequest,
    ctx: CommandContext,
  ) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'admin.break_glass.decide',
        request: { grantId, ...req },
        status: 201,
      },
      async (tx): Promise<BreakGlassGrant> => {
        assertTenant(this.policy, actor, 'break_glass.decide', 'break-glass access');
        const row = await this.lock(tx, grantId);
        if (row.idpSubject === actor.subject)
          throw new ApiProblem(
            409,
            'SELF_APPROVAL',
            'You cannot decide your own break-glass request.',
          );
        if (row.status !== 'requested')
          throw new ApiProblem(
            409,
            'CONFLICT',
            'This break-glass request has already been decided.',
          );
        const now = new Date();
        const approve = req.decision === 'approve';
        const [after] = await tx
          .update(breakGlassGrants)
          .set({
            status: approve ? 'approved' : 'declined',
            grantedBy: actor.personId,
            decidedAt: now,
            decisionReason: req.reason,
            validFromTs: approve ? now : null,
            validToTs: approve ? new Date(now.getTime() + row.requestedMinutes * 60_000) : null,
          })
          .where(eq(breakGlassGrants.id, row.id))
          .returning();
        await this.record(
          tx,
          actor,
          ctx,
          approve ? 'break_glass.approved' : 'break_glass.declined',
          row.id,
          req.reason,
          {
            status: { from: 'requested', to: after.status },
            ...(approve
              ? {
                  startsAt: after.validFromTs?.toISOString(),
                  endsAt: after.validToTs?.toISOString(),
                }
              : {}),
          },
        );
        return (await this.views(tx, actor, [after]))[0];
      },
    );
  }

  revoke(actor: RequestActor, grantId: string, req: RevokeBreakGlassRequest, ctx: CommandContext) {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'admin.break_glass.revoke',
        request: { grantId, ...req },
        status: 201,
      },
      async (tx): Promise<BreakGlassGrant> => {
        assertTenant(this.policy, actor, 'break_glass.decide', 'break-glass access');
        const row = await this.lock(tx, grantId);
        const now = new Date();
        if (statusOf(row, now) !== 'active')
          throw new ApiProblem(409, 'CONFLICT', 'Only an active break-glass grant can be revoked.');
        const [after] = await tx
          .update(breakGlassGrants)
          .set({
            status: 'revoked',
            revokedBy: actor.personId,
            revokedAt: now,
            revokeReason: req.reason,
          })
          .where(eq(breakGlassGrants.id, row.id))
          .returning();
        await this.record(tx, actor, ctx, 'break_glass.revoked', row.id, req.reason, {
          status: { from: 'active', to: 'revoked' },
          endsAt: { from: row.validToTs?.toISOString(), to: now.toISOString() },
        });
        return (await this.views(tx, actor, [after]))[0];
      },
    );
  }

  private async lock(tx: Tx, grantId: string): Promise<Row> {
    const [row] = await tx
      .select()
      .from(breakGlassGrants)
      .where(eq(breakGlassGrants.id, grantId))
      .for('update');
    if (!row) throw ApiProblem.notFound('break-glass request');
    return row;
  }

  private async record(
    tx: Tx,
    actor: RequestActor,
    ctx: CommandContext,
    action: string,
    grantId: string,
    reason: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.append(tx, {
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      actorSubject: actor.subject,
      action,
      resourceType: 'break_glass_grant',
      resourceId: grantId,
      requestId: ctx.requestId,
      reason,
      changes,
    });
  }

  private async views(tx: Tx, actor: RequestActor, rows: Row[]): Promise<BreakGlassGrant[]> {
    if (rows.length === 0) return [];
    const now = new Date();
    const names = await personNames(
      tx,
      rows.flatMap((r) => [r.grantedBy, r.revokedBy]),
    );
    const counts = await tx
      .select({ grantId: auditEvents.resourceId, n: count() })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.resourceType, 'break_glass_grant'),
          eq(auditEvents.action, BREAK_GLASS_READ_ACTION),
          inArray(
            auditEvents.resourceId,
            rows.map((r) => r.id),
          ),
        ),
      )
      .groupBy(auditEvents.resourceId);
    const taken = new Map(counts.map((c) => [c.grantId, Number(c.n)]));
    const decides = this.canDecide(actor);
    return rows.map((r) => {
      const status = statusOf(r, now);
      const allowed: BreakGlassGrant['allowedActions'] = [];
      if (decides && status === 'requested' && r.idpSubject !== actor.subject)
        allowed.push('approve', 'decline');
      if (decides && status === 'active') allowed.push('revoke');
      return {
        id: r.id,
        requestedByName: r.requestedByName ?? 'Platform operator',
        reason: r.reason,
        scope: 'budgets_and_ledger',
        scopeLabel: SCOPE_LABEL,
        requestedMinutes: r.requestedMinutes,
        requestedAt: r.createdAt.toISOString(),
        status,
        decidedByName: r.grantedBy ? (names.get(r.grantedBy) ?? null) : null,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        decisionReason: r.decisionReason ?? null,
        startsAt: r.validFromTs?.toISOString() ?? null,
        endsAt: (r.revokedAt ?? r.validToTs)?.toISOString() ?? null,
        revokedByName: r.revokedBy ? (names.get(r.revokedBy) ?? null) : null,
        revokedAt: r.revokedAt?.toISOString() ?? null,
        revokeReason: r.revokeReason ?? null,
        actionsTaken: taken.get(r.id) ?? 0,
        allowedActions: allowed,
      };
    });
  }
}

function statusOf(r: Row, now: Date): BreakGlassStatus {
  if (r.status === 'requested') return 'requested';
  if (r.status === 'declined') return 'declined';
  if (r.status === 'revoked' || r.revokedAt) return 'revoked';
  if (r.validFromTs && r.validToTs && r.validFromTs <= now && now <= r.validToTs) return 'active';
  return 'expired';
}
