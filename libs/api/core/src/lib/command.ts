import { idempotencyKeys, withTenant, type Db, type Tx } from '@bf/api/db';
import { canonicalJson } from '@bf/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { RequestActor } from './actor';
import { DB } from './db.module';
import { ApiProblem } from './problem';

export const sha256Hex = (input: string): string =>
  createHash('sha256').update(input, 'utf8').digest('hex');

export interface CommandResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * Runs a money or state mutation as one transaction: tenant context (RLS), idempotency key, then the
 * command body (ordered row locks, domain call, journal, audit entry, outbox). A replay with the same
 * key and request returns the first response without running the body again. Business failures roll back.
 */
@Injectable()
export class CommandRunner {
  constructor(@Inject(DB) private readonly db: Db) {}

  async run<T>(
    actor: RequestActor,
    input: { idempotencyKey: string; operation: string; request: unknown; status: number },
    body: (tx: Tx) => Promise<T>,
  ): Promise<CommandResult<T>> {
    const requestHash = sha256Hex(
      canonicalJson({ operation: input.operation, request: input.request ?? null }),
    );
    return withTenant(this.db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
      const inserted = await tx
        .insert(idempotencyKeys)
        .values({
          tenantId: actor.tenantId,
          key: input.idempotencyKey,
          actorSubject: actor.subject,
          operation: input.operation,
          requestHash,
        })
        .onConflictDoNothing({ target: [idempotencyKeys.tenantId, idempotencyKeys.key] })
        .returning({ id: idempotencyKeys.id });
      if (inserted.length === 0) {
        const [prior] = await tx
          .select()
          .from(idempotencyKeys)
          .where(
            and(
              eq(idempotencyKeys.tenantId, actor.tenantId),
              eq(idempotencyKeys.key, input.idempotencyKey),
            ),
          );
        if (
          !prior ||
          prior.requestHash !== requestHash ||
          prior.actorSubject !== actor.subject ||
          prior.operation !== input.operation
        ) {
          throw new ApiProblem(
            422,
            'IDEMPOTENCY_KEY_REUSED',
            'This Idempotency-Key was already used for a different request.',
          );
        }
        if (prior.responseStatus === null)
          throw new ApiProblem(
            409,
            'IDEMPOTENCY_IN_PROGRESS',
            'The first request with this key is still running.',
          );
        return { status: prior.responseStatus, body: prior.responseBody as T, replayed: true };
      }
      const result = await body(tx);
      await tx
        .update(idempotencyKeys)
        .set({ responseStatus: input.status, responseBody: sql`${JSON.stringify(result)}::jsonb` })
        .where(eq(idempotencyKeys.id, inserted[0].id));
      return { status: input.status, body: result, replayed: false };
    });
  }
}
