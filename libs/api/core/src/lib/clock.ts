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
 * something sets it, it is documented as dev-only in `infra/.env.example`, and pinning the clock
 * logs a warning on first use so a stack running on a frozen clock says so in its own logs. This is
 * the same posture the four wall-clock sweeps already take (`NIGHTLY_LEDGER_CHECK_CRON` and friends
 * default to `off` in Compose and are trusted to the environment).
 *
 * Keep the value in step with `freezeTime` in `apps/web-e2e/visual/screens.json`. If the two
 * disagree the browser and the server are back to disagreeing about "now", which is the whole bug.
 */

const FIXED_NOW = 'FIXED_NOW';

/** Resolved on first use, not at import, so the environment is read after the process has set it up. */
let resolved: { value: Date | null } | null = null;

function resolveFixedNow(env: NodeJS.ProcessEnv): Date | null {
  const raw = env[FIXED_NOW]?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid ${FIXED_NOW}: ${raw}. Expected an ISO 8601 instant, for example 2026-11-16T09:00:00Z.`,
    );
  }
  console.warn(
    `${FIXED_NOW} is set: the API treats now as ${parsed.toISOString()}. ` +
      'Server-computed ages, countdowns and overdue flags are frozen. Development and test only.',
  );
  return parsed;
}

function override(env: NodeJS.ProcessEnv): Date | null {
  resolved ??= { value: resolveFixedNow(env) };
  return resolved.value;
}

/** The instant the API should treat as now. Real time unless the clock has been pinned for a test run. */
export function nowUtc(env: NodeJS.ProcessEnv = process.env): Date {
  const pinned = override(env);
  return pinned === null ? new Date() : new Date(pinned);
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
  return override(env) !== null;
}
