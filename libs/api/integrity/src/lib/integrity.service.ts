import { AuditService } from '@bf/api/audit';
import {
  ApiProblem,
  CommandRunner,
  DB,
  PolicyService,
  type CommandResult,
  type RequestActor,
} from '@bf/api/core';
import { integrityCheckRuns, outboxMessages, withTenant, type Db } from '@bf/api/db';
import type { z } from 'zod';
import type { IntegrityCheckRun } from '@bf/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { RebuildSummary } from './rebuild.service';

type Run = z.infer<typeof IntegrityCheckRun>;
type RunRow = typeof integrityCheckRuns.$inferSelect;

export const LEDGER_CHECK_TOPIC = 'integrity.ledger-rebuild';

export function runDto(r: RunRow): Run {
  return {
    id: r.id,
    kind: 'ledger_rebuild',
    status: r.status,
    requestedAt: r.requestedAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    flagsRaised: r.flagsRaised,
    summary: (r.summary as RebuildSummary | null) ?? null,
  };
}

/** Queues ledger rebuild checks (through the outbox; the worker runs them) and reads their results. */
@Injectable()
export class IntegrityService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly commands: CommandRunner,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  request(
    actor: RequestActor,
    ctx: { idempotencyKey: string; requestId: string | null },
  ): Promise<CommandResult<Run>> {
    return this.commands.run(
      actor,
      {
        idempotencyKey: ctx.idempotencyKey,
        operation: 'integrity.ledger_check',
        request: {},
        status: 202,
      },
      async (tx) => {
        this.policy.assert(actor, 'integrity.run', { kind: 'tenant', tenantId: actor.tenantId });
        const [run] = await tx
          .insert(integrityCheckRuns)
          .values({ tenantId: actor.tenantId, requestedBy: actor.personId, trigger: 'manual' })
          .returning();
        await tx.insert(outboxMessages).values({
          tenantId: actor.tenantId,
          topic: LEDGER_CHECK_TOPIC,
          payload: { tenantId: actor.tenantId, checkRunId: run.id },
        });
        await this.audit.append(tx, {
          tenantId: actor.tenantId,
          actorPersonId: actor.personId,
          actorSubject: actor.subject,
          action: 'integrity.ledger_check.requested',
          resourceType: 'integrity_check_run',
          resourceId: run.id,
          requestId: ctx.requestId,
          changes: { status: { from: null, to: 'queued' } },
        });
        return runDto(run);
      },
    );
  }

  async get(actor: RequestActor, id: string): Promise<Run> {
    this.policy.assert(actor, 'integrity.read', { kind: 'tenant', tenantId: actor.tenantId });
    const [row] = await withTenant(
      this.db,
      { tenantId: actor.tenantId, subject: actor.subject },
      (tx) => tx.select().from(integrityCheckRuns).where(eq(integrityCheckRuns.id, id)),
    );
    if (!row) throw ApiProblem.notFound('check run');
    return runDto(row);
  }
}
