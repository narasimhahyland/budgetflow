import { getNumberOfCurrencyDigits } from '@angular/common';
import { inject } from '@angular/core';
import type { AbstractControl } from '@angular/forms';
import type { ErrorStateMatcher } from '@angular/material/core';
import type { ApiResult, BudgetDetail, ProblemDetails } from '@bf/contracts';
import { ApiService } from '@bf/web/data-access';

/** The typed contracts client with the signed-in user's token. */
export const injectApi = () => inject(ApiService).client;

/** A failed API call, keeping the HTTP status and the RFC 9457 problem for the page states. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails | null,
  ) {
    super(problem?.detail ?? `The request failed (HTTP ${status}).`);
  }
}

/** Resolves an API result to its data or throws an ApiError (for `resource` loaders and commands). */
export async function data<T>(call: Promise<ApiResult<T>>): Promise<T> {
  const r = await call;
  if (r.ok) return r.data;
  throw new ApiError(r.status, r.problem ?? null);
}

export const errorStatus = (e: unknown): number => (e instanceof ApiError ? e.status : 0);
export const errorCode = (e: unknown): string | null =>
  e instanceof ApiError ? (e.problem?.code ?? null) : null;

/** Plain-English message for a failed call, with field errors when the API returned them. */
export function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Something went wrong. Try again in a moment.';
  const fields = e.problem?.errors?.map((f) => `${f.path}: ${f.message}`) ?? [];
  return [e.problem?.detail ?? e.message, ...fields.slice(0, 5)].join(' ');
}

/** A resource's value, or undefined while it is idle, loading or failed (value() throws on a failed resource). */
export function valueOf<T>(r: { hasValue(): boolean; value(): T }): T | undefined {
  return r.hasValue() ? r.value() : undefined;
}

/** "1,500.25" or "1500" in major units to minor units (2-decimal currencies); null when invalid. */
export function toMinor(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw)
    .replace(/[,\s]/g, '')
    .replace(/^(USD|\$)/i, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const negative = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const minor = Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
  return Number.isSafeInteger(minor) ? (negative ? -minor : minor) : null;
}

/** Minor units to a plain major-unit string for inputs ("1500.25"). */
export const toMajor = (minor: number): string => (minor / 100).toFixed(2);

export const pct = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

/** The budget-currency balances as plain numbers. */
export function balancesOf(b: BudgetDetail) {
  const c = b.balances.budgetCurrency;
  return {
    authorized: c.authorized.amountMinor,
    allocatedOut: c.allocatedOut.amountMinor,
    held: c.held.amountMinor,
    preEncumbered: c.preEncumbered.amountMinor,
    encumbered: c.encumbered.amountMinor,
    actual: c.actual.amountMinor,
    accrued: c.accrued.amountMinor,
    available: b.balances.available.amountMinor,
    allocationAvailable: b.balances.allocationAvailable.amountMinor,
    committed: c.encumbered.amountMinor + c.preEncumbered.amountMinor + c.held.amountMinor,
  };
}

export const BUDGET_TYPE_LABEL: Record<string, string> = {
  operating: 'Operating',
  event: 'Event',
  shared_event: 'Shared event',
  contingency: 'Contingency',
};

/**
 * Budgets of the same tree the user can see, from the highest one they can read (the program root for
 * leadership and finance, the top of their own subtree for an owner).
 */
export async function sameTree(
  api: ReturnType<typeof injectApi>,
  budget: BudgetDetail,
): Promise<BudgetDetail[]> {
  const tops = (await data(api.listBudgets({ query: { topLevel: 'true', limit: 500 } }))).items;
  const top = tops.find((t) => budget.path.startsWith(t.path)) ?? budget;
  return (await data(api.listBudgets({ query: { rootId: top.id, limit: 500 } }))).items;
}

export const can = (b: BudgetDetail | undefined, action: string): boolean =>
  !!b && b.allowedActions.includes(action);

/** Two initials for `sat-avatar` ("Lena Fischer" → "LF"). */
export const initials = (name: string | null | undefined): string =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/** Integer minor units as a plain major-unit number for an export, by the ISO 4217 exponent. */
export const exportAmount = (minor: number, currency: string): number =>
  minor / 10 ** getNumberOfCurrencyDigits(currency);

/** Downloads rows as CSV (Export only: no on-screen Share). */
export function downloadCsv(name: string, rows: (string | number)[][]): void {
  // A text cell starting with = + - @ (or a tab or carriage return) gets an apostrophe so a
  // spreadsheet shows it as text instead of running it (CSV formula injection); numbers stay numbers.
  const esc = (v: string | number) => {
    const raw = String(v);
    const s = /^-?\d+(\.\d+)?$/.test(raw) || !/^[=+\-@\t\r]/.test(raw) ? raw : `'${raw}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n') + '\n'], {
    type: 'text/csv',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Puts a form field in Material's error state while `flag()` is true (an API-reported block). */
export const flagMatcher = (flag: () => boolean): ErrorStateMatcher => ({
  isErrorState: (control: AbstractControl | null) =>
    flag() || !!(control?.invalid && control.touched),
});
