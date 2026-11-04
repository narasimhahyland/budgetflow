import type { z } from 'zod';
import type { ProblemDetails } from './common';
import { endpoints, type Endpoint, type Endpoints, type OperationId } from './endpoints';

type ParamsOf<E> = E extends { params: infer P extends z.ZodType }
  ? { params: z.input<P> }
  : unknown;
type QueryOf<E> = E extends { query: infer Q extends z.ZodType } ? { query?: z.input<Q> } : unknown;
type BodyOf<E> = E extends { body: infer B extends z.ZodType } ? { body: z.input<B> } : unknown;

export type RequestOf<K extends OperationId> = ParamsOf<Endpoints[K]> &
  QueryOf<Endpoints[K]> &
  BodyOf<Endpoints[K]> & { idempotencyKey?: string };
export type ResponseOf<K extends OperationId> = z.output<Endpoints[K]['response']['schema']>;

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; problem: ProblemDetails };

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Authorization and X-Tenant-Id; the web adds them in data-access, tests per role. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
}

export type ApiClient = {
  [K in OperationId]: (request: RequestOf<K>) => Promise<ApiResult<ResponseOf<K>>>;
};

/** Typed client derived from the endpoint registry (no code generation step). */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetch ?? fetch;
  const call = async (e: Endpoint, req: Record<string, unknown>): Promise<ApiResult<unknown>> => {
    const params = (req['params'] ?? {}) as Record<string, string>;
    let path = e.path.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(params[k] ?? ''));
    const query = req['query'] as Record<string, unknown> | undefined;
    if (query) {
      const qs = new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      );
      if ([...qs].length) path += `?${qs}`;
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(await options.headers?.()),
    };
    if (e.idempotent)
      headers['idempotency-key'] =
        (req['idempotencyKey'] as string | undefined) ?? crypto.randomUUID();
    if (req['body'] !== undefined) headers['content-type'] = 'application/json';
    const res = await doFetch(`${options.baseUrl}${path}`, {
      method: e.method.toUpperCase(),
      headers,
      body: req['body'] !== undefined ? JSON.stringify(req['body']) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    return res.ok
      ? { ok: true, status: res.status, data: json }
      : { ok: false, status: res.status, problem: json as ProblemDetails };
  };
  return Object.fromEntries(
    Object.entries(endpoints).map(([k, e]) => [
      k,
      (req: Record<string, unknown>) => call(e, req ?? {}),
    ]),
  ) as unknown as ApiClient;
}
