import { getNumberOfCurrencyDigits } from '@angular/common';
import { inject } from '@angular/core';
import type { ApiResult, ProblemDetails } from '@bf/contracts';
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

/** Plain-English message for a failed call, with field errors when the API returned them. */
export function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Something went wrong. Try again in a moment.';
  const fields = e.problem?.errors?.map((f) => `${f.path}: ${f.message}`) ?? [];
  return [e.problem?.detail ?? e.message, ...fields.slice(0, 5)].join(' ');
}

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** A resource's value, or undefined while it is idle, loading or failed (value() throws on a failed resource). */
export function valueOf<T>(r: { hasValue(): boolean; value(): T }): T | undefined {
  return r.hasValue() ? r.value() : undefined;
}

/** Parses a typed amount ("1,250.50") into integer minor units of the currency, without floating point. */
export function toMinor(text: string, currency: string): number | undefined {
  const v = text.trim().replace(/[\s,]/g, '');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) return undefined;
  const digits = getNumberOfCurrencyDigits(currency);
  const n = Number(m[1] + (m[2] ?? '').padEnd(digits, '0').slice(0, digits));
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
