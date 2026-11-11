/**
 * The wall clock, even when the seed runs under the pinned-clock preload
 * (`scripts/lib/pinned-clock.cjs`), which replaces `Date` and keeps the original as
 * `globalThis.__bfRealDate`. Without the preload this is simply `Date.now()`.
 *
 * Only for seeded values the API compares with real time: credential expiry is a security check
 * and stays on the wall clock, so a pinned expiry would lapse on one fixed real date.
 */
export const realNow = (): number =>
  ((globalThis as { __bfRealDate?: DateConstructor }).__bfRealDate ?? Date).now();
