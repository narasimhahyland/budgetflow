/**
 * Navan's documented limits on reading transactions (16a, docs/architecture/navan-integration.md). Pure functions,
 * so the window arithmetic is the same in the worker and in the scenarios that check it.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** A date filter covers at most this many days. */
export const NAVAN_MAX_WINDOW_DAYS = 93;
/** Results can trail updates by up to this long, so each run re-reads the tail of the last one. */
export const NAVAN_LAG_HOURS = 4;
/** Transactions of every type BudgetFlow reads, by the path segment Navan uses. */
export const NAVAN_TRANSACTION_TYPES = [
  'card-transactions',
  'connect-transactions',
  'manual-transactions',
  'repayments',
  'fees',
  'adjustments',
  'daily-rebates',
  'disputes',
] as const;
export type NavanTransactionType = (typeof NAVAN_TRANSACTION_TYPES)[number];

export interface NavanWindow {
  from: string;
  to: string;
}

/**
 * Splits `[from, to)` into consecutive windows of at most `maxDays` days, each starting where the last
 * ended, so nothing between them is skipped or read twice.
 */
export function navanWindows(from: Date, to: Date, maxDays = NAVAN_MAX_WINDOW_DAYS): NavanWindow[] {
  const out: NavanWindow[] = [];
  const span = maxDays * DAY_MS;
  let start = from.getTime();
  const end = to.getTime();
  while (start < end) {
    const stop = Math.min(start + span, end);
    out.push({ from: new Date(start).toISOString(), to: new Date(stop).toISOString() });
    start = stop;
  }
  return out;
}

/**
 * Where a first run starts when nobody gave a date: the first day of the month two months back,
 * which is as far as Navan's date filters reach.
 */
export function navanDefaultStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
}

/**
 * The cursor the next run starts from: the end of this run's window less the lag, never earlier than
 * where this run started. Re-reading the overlap is harmless because source references are unique.
 */
export function navanNextCursor(windowStart: Date, windowEnd: Date): string {
  const back = windowEnd.getTime() - NAVAN_LAG_HOURS * HOUR_MS;
  return new Date(Math.max(back, windowStart.getTime())).toISOString();
}

/** Parses a stored cursor or a requested date (`YYYY-MM-DD` or a full timestamp). */
export function parseNavanStart(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(d.getTime()) ? null : d;
}
