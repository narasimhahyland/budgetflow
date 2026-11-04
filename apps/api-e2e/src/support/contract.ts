// Every response is validated against its libs/contracts schema.
import { expect, type APIResponse } from '@playwright/test';
import { ProblemDetails } from '@bf/contracts';
import type { z } from 'zod';

export async function expectContract<S extends z.ZodType>(
  res: APIResponse,
  status: number,
  schema: S,
): Promise<z.output<S>> {
  const body = await res.json().catch(() => null);
  expect(res.status(), JSON.stringify(body)).toBe(status);
  const parsed = schema.safeParse(body);
  expect(
    parsed.success,
    parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 5)),
  ).toBe(true);
  return parsed.data as z.output<S>;
}

/** Asserts an RFC 9457 problem with the stable code; returns it for further checks. */
export async function expectProblem(
  res: APIResponse,
  status: number,
  code: string,
): Promise<z.output<typeof ProblemDetails>> {
  const p = await expectContract(res, status, ProblemDetails);
  expect(p.code).toBe(code);
  expect(res.headers()['content-type']).toContain('application/problem+json');
  return p;
}
