import type { z } from 'zod';

/**
 * The API surface. OpenAPI and the typed client are generated from this registry; controllers parse
 * with the same schemas. Mutations require an `Idempotency-Key` header.
 */
export interface Endpoint {
  operationId: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  summary: string;
  tags: string[];
  auth: boolean;
  idempotent?: boolean;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  response: { status: number; schema: z.ZodType };
  errors: number[];
}
