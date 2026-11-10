// Fixed templates that turn the API's own figures into the sentences Home opens with. No model is
// involved: every number here comes from /api/budgets/summary, /api/dashboards/health or
// /api/approvals/inbox, and every branch is a written template.
import type {
  ApprovalTaskSummary,
  BudgetHealthOverview,
  BudgetSummary,
  FiscalYearRef,
  HealthLevel,
} from '@bf/contracts';
import { formatMoney } from '@bf/web/ui';

/** Where the fiscal year stands on the API's "as of" date. */
export interface YearProgress {
  label: string;
  /** Whole days from "as of" to the last day of the fiscal year, never below zero. */
  daysLeft: number;
  /** Share of the fiscal year already elapsed, in basis points. */
  elapsedBps: number;
  /** "45 days left" / "3 months left" / "the year has ended". */
  leftText: string;
}

const DAY = 24 * 60 * 60 * 1000;

/** The fiscal year containing `asOf` (ISO date), else the latest one that started on or before it. */
export function currentFiscalYear(
  years: readonly FiscalYearRef[],
  asOf: string,
): FiscalYearRef | null {
  const containing = years.find((y) => y.startDate <= asOf && y.endDate >= asOf);
  if (containing) return containing;
  const started = years.filter((y) => y.startDate <= asOf);
  return started.length ? started[started.length - 1] : null;
}

export function yearProgress(year: FiscalYearRef, asOf: string): YearProgress {
  const start = Date.parse(`${year.startDate}T00:00:00Z`);
  const end = Date.parse(`${year.endDate}T00:00:00Z`);
  const now = Date.parse(`${asOf}T00:00:00Z`);
  const total = Math.max(1, Math.round((end - start) / DAY) + 1);
  const elapsed = Math.min(total, Math.max(0, Math.round((now - start) / DAY)));
  const daysLeft = Math.max(0, Math.round((end - now) / DAY));
  return {
    label: year.label,
    daysLeft,
    elapsedBps: Math.round((elapsed / total) * 10000),
    leftText: leftText(daysLeft),
  };
}

function leftText(daysLeft: number): string {
  if (daysLeft <= 0) return 'the year has ended';
  if (daysLeft === 1) return '1 day left';
  // Months only once they are whole enough to be the clearer unit; days stay exact below that.
  if (daysLeft < 60) return `${daysLeft} days left`;
  const months = Math.round(daysLeft / 30);
  return `${months} months left`;
}

/** The buckets Home reads off the roll-up, with committed as held + pre-encumbered + encumbered. */
export interface Buckets {
  currency: string;
  authorized: number;
  committed: number;
  actual: number;
  available: number;
  /** Committed + actual as a share of authorized, in basis points; 0 when nothing is authorized. */
  usedBps: number;
}

export function buckets(summary: BudgetSummary): Buckets {
  const authorized = summary.authorized.amountMinor;
  const committed =
    summary.held.amountMinor + summary.preEncumbered.amountMinor + summary.encumbered.amountMinor;
  const actual = summary.actual.amountMinor;
  return {
    currency: summary.currency,
    authorized,
    committed,
    actual,
    available: summary.available.amountMinor,
    usedBps: shareBps(committed + actual, authorized),
  };
}

/** A share of a whole in basis points; 0 when the whole is zero, so a tile never divides by zero. */
export function shareBps(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 10000) : 0;
}

/**
 * A basis-point figure as a percentage, the way every percentage on Home reads: one decimal below
 * 10% so a small but non-zero share does not round to 0%, whole percent above it.
 */
export function pct(bps: number): string {
  const value = bps / 100;
  return `${value > 0 && value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}
const pctText = pct;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The opening sentence: where the year stands, and how many budgets need attention. Each branch is
 * a template chosen by which sections the API served this user, so a missing section drops its
 * clause instead of printing a gap.
 */
export function answerLine(input: {
  year: YearProgress | null;
  buckets: Buckets | null;
  health: BudgetHealthOverview | null;
}): string {
  const { year, buckets: b, health } = input;
  const attention = health ? health.summary.watch + health.summary.atRisk : null;
  const needs =
    attention === null
      ? ''
      : attention === 0
        ? 'every budget is pacing as planned.'
        : attention === health!.summary.budgets
          ? `all ${plural(attention, 'budget needs', 'budgets need')} attention.`
          : `${attention} of the ${health!.summary.budgets} budgets need attention.`;

  if (!b || b.authorized === 0) {
    if (needs) return capitalize(needs);
    return year
      ? `${year.label} has ${year.leftText}, and there are no budget figures in your scope yet.`
      : 'There are no budget figures in your scope yet.';
  }

  const head = year
    ? `${pctText(b.usedBps)} of the ${year.label} budget is committed or spent with ${year.leftText}`
    : `${pctText(b.usedBps)} of the budget in scope is committed or spent`;
  return needs ? `${head}, and ${needs}` : `${head}.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The Satori status tone for a health level: watch is a soft signal, at risk a hard one. */
export function levelTone(level: HealthLevel): 'warning' | 'important' | 'success' {
  if (level === 'at_risk') return 'important';
  return level === 'watch' ? 'warning' : 'success';
}

export function levelLabel(level: HealthLevel): string {
  return level === 'at_risk' ? 'At risk' : level === 'watch' ? 'Watch' : 'Healthy';
}

/** What waits on this user's decision, from the inbox the API returned. */
export interface WaitingOnYou {
  count: number;
  escalated: number;
  /** The total only when every task shares one currency; mixed currencies have no honest total. */
  total: { amountMinor: number; currency: string } | null;
  oldestAt: string | null;
}

export function waitingOnYou(
  items: readonly ApprovalTaskSummary[],
  escalated: number,
): WaitingOnYou {
  const currencies = new Set(items.map((i) => i.amount.currency));
  const total =
    items.length && currencies.size === 1
      ? {
          amountMinor: items.reduce((s, i) => s + i.amount.amountMinor, 0),
          currency: [...currencies][0],
        }
      : null;
  const oldestAt = items.reduce<string | null>(
    (oldest, i) => (oldest === null || i.createdAt < oldest ? i.createdAt : oldest),
    null,
  );
  return { count: items.length, escalated, total, oldestAt };
}

/** "USD 1,200.00 across 3 requests" — the tile's one-line summary, or null when nothing waits. */
export function waitingSummary(w: WaitingOnYou): string | null {
  if (w.count === 0) return null;
  const requests = plural(w.count, 'request', 'requests');
  return w.total
    ? `${formatMoney(w.total.amountMinor, w.total.currency)} across ${requests}`
    : `${requests} in more than one currency`;
}
