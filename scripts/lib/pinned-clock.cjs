// Preload for the seed under a pinned clock (scripts/stack.sh seed_cmd). Never loaded in production.
//
// The seed creates records through the same application services the API uses, and those stamp
// times from `Date`. Under BF_PINNED_CLOCK, `Date` here reads that instant instead of the wall clock,
// so seeded requests, decisions, audit entries and notifications carry the same times on every run
// and every real date - matching the API (FIXED_NOW), the database (app.fixed_now) and the browser
// (freezeTime), which are pinned to the same instant.
//
// Each read advances one millisecond, the same tick the database clock uses, so records created one
// after another keep their order instead of tying on a frozen instant.
//
// A seeded value that the API compares with real time - API key and connection expiry, which are
// security checks and stay on the wall clock - must not be pinned, or every seeded credential would
// lapse on one fixed real date. Those read `globalThis.__bfRealDate`, the original Date.
'use strict';

const raw = process.env.BF_PINNED_CLOCK;
const base = raw ? Date.parse(raw) : Number.NaN;
if (Number.isNaN(base)) {
  throw new Error(
    `pinned-clock: BF_PINNED_CLOCK must be an ISO 8601 instant, got ${JSON.stringify(raw)}`,
  );
}

const RealDate = Date;
let tick = 0;
const now = () => base + tick++;

class PinnedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(now());
    else super(...args);
  }
  static now() {
    return now();
  }
}

globalThis.__bfRealDate = RealDate;
globalThis.Date = PinnedDate;
