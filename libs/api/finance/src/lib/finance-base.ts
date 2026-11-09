import { ApiProblem, PolicyService, type RequestActor, todayUtc } from '@bf/api/core';
import type { Action } from '@bf/domain';

export interface CommandContext {
  idempotencyKey: string;
  requestId: string | null;
}

/**
 * Re-exported so this module's callers keep their existing import, with one implementation
 * behind it: `@bf/api/core` owns the clock, which a test run can pin (`FIXED_NOW`).
 */
export { todayUtc };

export const tenantOf = (actor: RequestActor) => ({
  kind: 'tenant' as const,
  tenantId: actor.tenantId,
});

/** Finance master data is tenant-wide reference data: readable by members, maintained by finance. */
export function assertTenant(policy: PolicyService, actor: RequestActor, action: Action): void {
  policy.assert(actor, action, tenantOf(actor));
}

export const duplicate = (what: string) =>
  new ApiProblem(409, 'DUPLICATE_CODE', `${what} already exists.`);

export const invalid = (field: string, detail: string) =>
  new ApiProblem(422, 'VALIDATION_FAILED', detail, { field });
