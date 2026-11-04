import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { z } from 'zod';
import type { RequestActor } from './actor';
import { ApiProblem } from './problem';

/** Minimal request shape used across the API (keeps express types out of the libraries). */
export interface ApiRequest {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
  actor?: RequestActor;
  requestId?: string;
}

export const IS_PUBLIC = 'bf:isPublic';
/** Marks a route as unauthenticated (health, OpenAPI). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export function header(req: ApiRequest, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

export const CurrentActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): RequestActor => {
    const req = ctx.switchToHttp().getRequest<ApiRequest>();
    if (!req.actor) throw new ApiProblem(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    return req.actor;
  },
);

/** Mutations require an Idempotency-Key header (8-200 visible characters). */
export const IdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const key = header(ctx.switchToHttp().getRequest<ApiRequest>(), 'idempotency-key')?.trim();
  if (!key || key.length < 8 || key.length > 200 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new ApiProblem(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Send an Idempotency-Key header (8-200 characters) with every change.',
    );
  }
  return key;
});

export const RequestId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | null =>
    ctx.switchToHttp().getRequest<ApiRequest>().requestId ?? null,
);

/** Parses untrusted input with a contract schema; failures become 400 problems with field paths. */
export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new ApiProblem(
      400,
      'VALIDATION_FAILED',
      'Some fields are missing or invalid.',
      undefined,
      r.error.issues.map((i) => ({ path: i.path.join('.') || '(body)', message: i.message })),
    );
  }
  return r.data;
}
