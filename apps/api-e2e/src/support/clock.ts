// The same "now" the stack is running on, so a scenario's dates and the API's agree.
//
// `scripts/stack.sh` pins the API's clock (`FIXED_NOW`) to `freezeTime` in
// `apps/web-e2e/visual/screens.json`, which is also the instant the visual suite freezes the browser
// to. The test process is started separately from the stack, so it does not inherit that variable:
// it reads the same file instead. One source of truth, not a second copy that can fall out of step —
// which is the whole point of issue #86.
//
// A scenario that builds a date from the real clock while the API answers from a pinned one will
// disagree with it, and the failure looks like a broken business rule rather than a clock mismatch:
// a delegation created `validFrom`/`validTo` today is simply not in force on the API's today.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCREENS = join(__dirname, '../../../web-e2e/visual/screens.json');

function resolveNow(): Date {
  const override = process.env.BF_FIXED_NOW?.trim();
  if (override && override !== 'real') return new Date(override);
  if (override === 'real') return new Date();
  try {
    const { freezeTime } = JSON.parse(readFileSync(SCREENS, 'utf8')) as { freezeTime?: string };
    if (typeof freezeTime === 'string' && freezeTime) return new Date(freezeTime);
  } catch {
    // No screens.json (or unreadable): the stack is on the real clock, so the scenario is too.
  }
  return new Date();
}

const now = resolveNow();

/** The instant the API treats as now. Resolved once, so a long run cannot straddle midnight. */
export const nowUtc = (): Date => new Date(now);

/** Today as `YYYY-MM-DD` in UTC, matching the API's `todayUtc`. */
export const todayUtc = (): string => nowUtc().toISOString().slice(0, 10);

/** A date `n` days from the API's today, for building windows either side of it. */
export const daysFromToday = (n: number): string =>
  new Date(now.getTime() + n * 86_400_000).toISOString().slice(0, 10);
