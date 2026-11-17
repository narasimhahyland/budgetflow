/**
 * The pinned clock a test stack runs on (`FIXED_NOW`), shared by Postgres and JavaScript.
 *
 * `@bf/api/core` has two readings of it: `nowUtc()`, the API's and the worker's "now" (exactly the
 * pinned instant), and `stampUtc()`, the instant to stamp a stored record with. This file holds the
 * state behind `stampUtc()`, because the database sessions carry the same clock and this library
 * opens them.
 *
 * Production never sets `FIXED_NOW`. Then `pinnedInstant()` is null, sessions open with no extra
 * options, `withTenant` runs the statement it always ran, and both readings are `new Date()`.
 *
 * Under `FIXED_NOW` there is one clock, not two:
 *   - Postgres: every session opens with `app.fixed_now` (`pinnedSessionOptions`, applied by
 *     `createPool`). Timestamp defaults call `app_now()` (migration 0020): the pinned instant plus one
 *     millisecond per call from the shared `app_clock_tick` sequence. The seed's sessions carry the
 *     same setting (scripts/stack.sh), so rows the API and worker write come after the seeded ones.
 *   - JavaScript: `withTenant` reads the database clock (the instant of its latest tick, without
 *     taking a new one) in the statement that sets the tenant, and `pinnedNow()` is the latest such
 *     reading (never before the pinned instant), which `stampUtc()` returns. A stamp written in
 *     JavaScript is then never older than a row the database stamped before the transaction began,
 *     which is what broke when only the database was pinned (an audit entry six days older than the
 *     suggestion it accepted). The sequence is shared, so the API and the worker agree too.
 * The clock only moves a millisecond per database stamp, so a pinned stack stays on its pinned day.
 */

const FIXED_NOW = 'FIXED_NOW';

/** Resolved on first use, not at import, so the environment is read after the process has set it up. */
let resolved: { value: Date | null } | null = null;
/** The latest database clock reading this process has seen, in epoch milliseconds. */
let highWater = Number.NEGATIVE_INFINITY;

function resolveFixedNow(env: NodeJS.ProcessEnv): Date | null {
  const raw = env[FIXED_NOW]?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid ${FIXED_NOW}: ${raw}. Expected an ISO 8601 instant, for example 2026-11-16T09:00:00Z.`,
    );
  }
  return parsed;
}

/** The instant the clock is pinned to, or null on the real clock. */
export function pinnedInstant(env: NodeJS.ProcessEnv = process.env): Date | null {
  resolved ??= { value: resolveFixedNow(env) };
  return resolved.value;
}

/** Pinned "now": the pinned instant, moved on to the latest database clock reading. Null on the real clock. */
export function pinnedNow(env: NodeJS.ProcessEnv = process.env): Date | null {
  const base = pinnedInstant(env);
  if (base === null) return null;
  return new Date(Math.max(base.getTime(), highWater));
}

/** Records a reading of the database clock so JavaScript stamps do not fall behind it. */
export function observeDatabaseNow(at: Date | string): void {
  const ms = new Date(at).getTime();
  if (Number.isFinite(ms) && ms > highWater) highWater = ms;
}

/** Postgres startup options that pin a session's `app_now()`, or undefined on the real clock. */
export function pinnedSessionOptions(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const pinned = pinnedInstant(env);
  return pinned === null ? undefined : `-c app.fixed_now=${pinned.toISOString()}`;
}
