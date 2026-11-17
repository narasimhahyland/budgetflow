import type { RequestActor } from '@bf/api/core';
import { idempotencyKeys, withTenant, type Db } from '@bf/api/db';
import { canonicalJson } from '@bf/domain';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';

/**
 * The stored response of a finished command with this key, operation and actor, or null. Commands
 * that call an external system first use it so a replay returns the first result without calling
 * the provider again; the command runner still decides anything else (a reused key, a conflict).
 */
export async function storedResponse(
  db: Db,
  actor: RequestActor,
  key: string,
  operation: string,
  request: unknown,
): Promise<unknown> {
  // Same hash as CommandRunner, so a different request under the key still reaches its refusal.
  const requestHash = createHash('sha256')
    .update(canonicalJson({ operation, request: request ?? null }))
    .digest('hex');
  return withTenant(db, { tenantId: actor.tenantId, subject: actor.subject }, async (tx) => {
    const [prior] = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.operation, operation)));
    if (
      !prior ||
      prior.responseStatus === null ||
      prior.actorSubject !== actor.subject ||
      prior.requestHash !== requestHash
    )
      return null;
    return prior.responseBody;
  });
}
