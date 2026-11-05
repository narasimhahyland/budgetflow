import { inject } from '@angular/core';
import type { ApiResult, ProblemDetails } from '@bf/contracts';
import { ApiService } from '@bf/web/data-access';

export const injectApi = () => inject(ApiService).client;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails | null,
  ) {
    super(problem?.detail ?? `The request failed (HTTP ${status}).`);
  }
}

export async function data<T>(call: Promise<ApiResult<T>>): Promise<T> {
  const r = await call;
  if (r.ok) return r.data;
  throw new ApiError(r.status, r.problem ?? null);
}

export const errorStatus = (e: unknown): number => (e instanceof ApiError ? e.status : 0);

export function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return 'Something went wrong. Try again in a moment.';
  const fields = e.problem?.errors?.map((f) => `${f.path}: ${f.message}`) ?? [];
  return [e.problem?.detail ?? e.message, ...fields.slice(0, 5)].join(' ');
}

export function valueOf<T>(r: { hasValue(): boolean; value(): T }): T | undefined {
  return r.hasValue() ? r.value() : undefined;
}
