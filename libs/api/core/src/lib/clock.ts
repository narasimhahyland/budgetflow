/**
 * One definition of "now" for the API.
 *
 * Date-only comparisons are everywhere in this product — an overdue flag, a countdown, a validity
 * window — and each one used to call `new Date()` where it stood. That is fine in production and
 * wrong under test: the visual suite freezes the *browser* clock with `page.clock.setFixedTime`, so
 * anything the server computed from its own clock kept moving while the baseline stood still. The
 * baseline then described the day it was recorded rather than the product, and went red on its own
 * (issue #86: a seeded task turning overdue, a fiscal-year countdown ticking down).
 *
 * So the server gets a clock it can be told about, through `FIXED_NOW`.
 *
 * **`FIXED_NOW` must never be set in a real deployment.** It is deliberately not gated on
 * `NODE_ENV`, because the local stack runs the API bundle with `NODE_ENV=production` and a gate
 * there would defeat the purpose. The protection is instead that the variable does not exist unless
 * something sets it, it is documented as dev-only, and the API warns at startup when the clock is
 * pinned (`apps/api/src/main.ts` calls `clockIsPinned`) so a stack on a frozen clock says so in its
 * own logs. This is the same posture the four wall-clock sweeps already take
 * (`NIGHTLY_LEDGER_CHECK_CRON` and friends default to `off` in Compose, trusted to the environment).
 *
 * Keep the value in step with `freezeTime` in `apps/web-e2e/visual/screens.json`. If the two
 * disagree the browser and the server are back to disagreeing about "now", which is the whole bug.
 */

import { pinnedInstant, pinnedNow } from '@bf/api/db';

/**
 * The instant the API (and the worker) treats as now: today, ages, countdowns, deadlines. Real time
 * unless the clock has been pinned for a test run; then exactly the pinned instant, on every call, so
 * two requests agree on "now" to the millisecond.
 */
export function nowUtc(env: NodeJS.ProcessEnv = process.env): Date {
  const pinned = pinnedInstant(env);
  return pinned === null ? new Date() : new Date(pinned);
}

/**
 * The instant to stamp a stored record with (decided, submitted, updated, audited at), or to measure a
 * window over such stamps. Real time unless the clock is pinned; then the pinned day as the database
 * clock has moved it on (`@bf/api/db` `pinned-clock.ts`), so a stamp written here is never older than
 * a row the database stamped before it, and stamps keep their order.
 *
 * Not for anything that must follow real time: credential and link expiry, signed URLs, retry
 * schedules, break-glass windows (`actor.ts`), durations. Those keep `new Date()` / `Date.now()`.
 */
export function stampUtc(env: NodeJS.ProcessEnv = process.env): Date {
  return pinnedNow(env) ?? new Date();
}

/**
 * Today as `YYYY-MM-DD` in UTC — the shape every date column in this schema uses, so it compares
 * directly against a `date` value without parsing either side.
 */
export function todayUtc(env: NodeJS.ProcessEnv = process.env): string {
  return nowUtc(env).toISOString().slice(0, 10);
}

/** Whether the clock is pinned, so a run can state in its own evidence what "now" it used. */
export function clockIsPinned(env: NodeJS.ProcessEnv = process.env): boolean {
  return pinnedInstant(env) !== null;
}
