import { ApiProblem } from '@bf/api/core';
import type { IntegrationErrorClass } from '@bf/contracts';
import { Injectable } from '@nestjs/common';
import { integrationsConfig } from './config';

export interface OutboundRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Attempts in total; failures wait 100ms, 200ms, 400ms between them. */
  attempts?: number;
}

export interface OutboundResponse {
  statusCode: number;
  durationMs: number;
  body: string;
  ok: boolean;
}

/** Classifies a provider failure so 100 can group it and decide whether to retry. */
export function classifyError(statusCode: number | null, message: string): IntegrationErrorClass {
  if (statusCode === 401 || statusCode === 403) return 'authentication';
  if (statusCode === 429) return 'rate_limit';
  if (statusCode === 409 || statusCode === 422 || statusCode === 400) return 'validation';
  if (statusCode === null) return 'provider_unavailable';
  if (statusCode >= 500) return 'provider_unavailable';
  return /mapping|not mapped|no category/i.test(message) ? 'mapping' : 'validation';
}

/** Authentication and validation failures will not fix themselves; everything else is worth a retry. */
export const isRetryable = (errorClass: IntegrationErrorClass): boolean =>
  errorClass === 'rate_limit' || errorClass === 'provider_unavailable';

/** The provider's message, trimmed and with anything credential-shaped removed. */
export function providerMessage(statusCode: number | null, raw: string): string {
  let text = raw.trim();
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    text = parsed.error ?? parsed.message ?? text;
  } catch {
    // Not JSON: use the raw text.
  }
  text = text.replace(/\b(bearer|token|secret)\s+\S+/gi, '$1 [redacted]');
  const trimmed = text.slice(0, 300);
  return statusCode ? `${statusCode} ${trimmed}` : trimmed || 'The provider did not answer.';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The only way out of the API to an external system. The host must be on
 * `INTEGRATIONS_ALLOWED_HOSTS`, so a stored base URL or a customer webhook address can never make
 * BudgetFlow call somewhere it was not configured to reach. Transient failures retry with backoff.
 */
@Injectable()
export class OutboundHttp {
  assertAllowed(rawUrl: string): URL {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'That is not a valid address.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ApiProblem(422, 'VALIDATION_FAILED', 'Use an http or https address.');
    }
    const allowed = integrationsConfig().allowedHosts;
    if (!allowed.includes(url.hostname.toLowerCase())) {
      throw new ApiProblem(
        422,
        'OUTBOUND_HOST_NOT_ALLOWED',
        `BudgetFlow only calls configured hosts. Add ${url.hostname} to the allowed hosts first.`,
        { host: url.hostname },
      );
    }
    return url;
  }

  async send(req: OutboundRequest): Promise<OutboundResponse> {
    this.assertAllowed(req.url);
    const cfg = integrationsConfig();
    const attempts = req.attempts ?? 3;
    let last: OutboundResponse | null = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const started = Date.now();
      try {
        const res = await fetch(req.url, {
          method: req.method ?? 'GET',
          headers: { 'content-type': 'application/json', ...(req.headers ?? {}) },
          body: req.body,
          signal: AbortSignal.timeout(req.timeoutMs ?? cfg.httpTimeoutMs),
        });
        const body = await res.text();
        last = {
          statusCode: res.status,
          durationMs: Date.now() - started,
          body,
          ok: res.ok,
        };
      } catch (e) {
        last = {
          statusCode: 0,
          durationMs: Date.now() - started,
          body: e instanceof Error ? e.message : 'request failed',
          ok: false,
        };
      }
      const retryable = !last.ok && isRetryable(classifyError(last.statusCode || null, last.body));
      if (!retryable || attempt === attempts) return last;
      await sleep(100 * 2 ** (attempt - 1));
    }
    return last!;
  }

  /** Sends and parses JSON, or throws the provider's problem. */
  async json<T>(req: OutboundRequest): Promise<T> {
    const res = await this.send(req);
    if (!res.ok) {
      throw new ApiProblem(
        422,
        'INTEGRATION_TEST_FAILED',
        providerMessage(res.statusCode || null, res.body),
        { statusCode: res.statusCode },
      );
    }
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new ApiProblem(
        422,
        'INTEGRATION_TEST_FAILED',
        'The provider answered with something that is not JSON.',
      );
    }
  }
}
