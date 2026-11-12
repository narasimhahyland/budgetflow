import { ApiProblem } from '@bf/api/core';
import type { NavanRegion } from '@bf/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { OutboundHttp, providerMessage, type OutboundResponse } from '../http';

/**
 * Values the public Navan documentation describes without naming. They are kept here, in one place,
 * and listed in docs/architecture/navan-integration.md as values to confirm before a live connection.
 */
export const NAVAN_TOKEN_PATH = '/v1/oauth/token';
export const NAVAN_API_PATH = '/v1/expense';
export const NAVAN_REGION_HEADER = 'x-navan-region';
export const NAVAN_WRITE_SCOPE = 'expense:write';

/** Navan's documented batch limits. */
export const NAVAN_MAX_PATCH = 100;
export const NAVAN_MAX_JOB_OPERATIONS = 5000;
export const NAVAN_MAX_LOOKUP = 100;

/** 429s are retried this many times, waiting `Retry-After` (or a doubling backoff) between them. */
const RATE_LIMIT_ATTEMPTS = 5;
const MAX_WAIT_MS = 30_000;
/** A cached token is renewed this long before it expires. */
const TOKEN_EARLY_MS = 5 * 60_000;
const JOB_POLL_MS = 250;
const JOB_MAX_POLLS = 240;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What one call needs: where Navan is, who we are, and the account's region. */
export interface NavanConnection {
  connectionId: string;
  /** Changes when the secret is replaced, so a cached token for the old secret is never reused. */
  secretRef: string;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  region: NavanRegion;
}

interface CachedToken {
  accessToken: string;
  scopes: string[];
  expiresAt: number;
}

export interface NavanPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface NavanJobResult {
  value: string;
  action: string;
  status: 'SUCCEEDED' | 'FAILED';
  error: string | null;
}

export interface NavanOperation {
  action: 'CREATE' | 'UPDATE';
  value: string;
  label: string;
  active: boolean;
}

/** Counts a run reports in its evidence: calls made, pages read, 429s waited out. */
export interface NavanCallStats {
  calls: number;
  pages: number;
  rateLimited: number;
  tokensFetched: number;
}

export const emptyStats = (): NavanCallStats => ({
  calls: 0,
  pages: 0,
  rateLimited: 0,
  tokensFetched: 0,
});

/**
 * The Navan Expense API client (16a). OAuth 2.0 client credentials with tokens cached per connection
 * and secret until shortly before they expire (about 12 hours); no `scope` parameter is ever sent,
 * because sending one can strip the Expense: Write scope. EU accounts carry the region header on
 * every call. 429s back off and retry; everything goes through `OutboundHttp`, so only allowlisted
 * hosts are reached.
 */
@Injectable()
export class NavanClient {
  private readonly log = new Logger('NavanClient');
  private readonly tokens = new Map<string, CachedToken>();

  constructor(private readonly http: OutboundHttp) {}

  private cacheKey(c: NavanConnection): string {
    return `${c.connectionId}:${c.secretRef}`;
  }

  /** Drops cached tokens for a connection, e.g. after its credential was replaced. */
  forget(connectionId: string): void {
    for (const key of this.tokens.keys())
      if (key.startsWith(`${connectionId}:`)) this.tokens.delete(key);
  }

  async token(c: NavanConnection, stats?: NavanCallStats): Promise<CachedToken> {
    const key = this.cacheKey(c);
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt - TOKEN_EARLY_MS > Date.now()) return cached;
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: c.clientId,
      client_secret: c.clientSecret,
    });
    const res = await this.http.send({
      url: `${c.baseUrl}${NAVAN_TOKEN_PATH}`,
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(c.region === 'eu' ? { [NAVAN_REGION_HEADER]: 'eu' } : {}),
      },
      body: form.toString(),
      attempts: 1,
    });
    if (stats) stats.tokensFetched += 1;
    if (!res.ok) throw this.problem(res);
    const body = this.parse<{ access_token?: string; expires_in?: number; scope?: string }>(res);
    if (!body.access_token) {
      throw new ApiProblem(422, 'INTEGRATION_TEST_FAILED', 'Navan did not return an access token.');
    }
    const token: CachedToken = {
      accessToken: body.access_token,
      scopes: (body.scope ?? '').split(/\s+/).filter(Boolean),
      expiresAt: Date.now() + Math.max(60, Number(body.expires_in ?? 3600)) * 1000,
    };
    this.tokens.set(key, token);
    return token;
  }

  async hasWriteScope(c: NavanConnection): Promise<boolean> {
    return (await this.token(c)).scopes.includes(NAVAN_WRITE_SCOPE);
  }

  /**
   * One API call. A 401 on a cached token renews it once; a 429 waits and retries; anything else that
   * is not a success becomes a problem carrying Navan's own words and status code.
   */
  async call<T>(
    c: NavanConnection,
    req: {
      method?: 'GET' | 'POST' | 'PATCH';
      path: string;
      query?: Record<string, string | number | undefined>;
      body?: unknown;
    },
    stats: NavanCallStats = emptyStats(),
  ): Promise<T> {
    const url = new URL(`${c.baseUrl}${NAVAN_API_PATH}${req.path}`);
    for (const [k, v] of Object.entries(req.query ?? {}))
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    let renewed = false;
    for (let attempt = 1; ; attempt++) {
      const token = await this.token(c, stats);
      stats.calls += 1;
      const res = await this.http.send({
        url: url.toString(),
        method: req.method ?? 'GET',
        headers: {
          authorization: `Bearer ${token.accessToken}`,
          ...(c.region === 'eu' ? { [NAVAN_REGION_HEADER]: 'eu' } : {}),
        },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        // Retries here are Navan-aware (Retry-After, token renewal); the shared retry stays off.
        attempts: 1,
      });
      if (res.ok) return this.parse<T>(res);
      if (res.statusCode === 401 && !renewed) {
        renewed = true;
        this.tokens.delete(this.cacheKey(c));
        attempt -= 1;
        continue;
      }
      if (res.statusCode === 429 && attempt < RATE_LIMIT_ATTEMPTS) {
        stats.rateLimited += 1;
        const wait = this.retryAfterMs(res, attempt);
        this.log.warn(`Navan rate limit on ${req.path}; waiting ${wait} ms (attempt ${attempt})`);
        await sleep(wait);
        continue;
      }
      throw this.problem(res);
    }
  }

  /** Reads every page of a cursor-paged list. */
  async *pages<T>(
    c: NavanConnection,
    path: string,
    query: Record<string, string | number | undefined>,
    pageSize: number,
    stats: NavanCallStats,
  ): AsyncGenerator<T[]> {
    let cursor: string | undefined;
    do {
      const page = await this.call<NavanPage<T>>(
        c,
        { path, query: { ...query, limit: pageSize, cursor } },
        stats,
      );
      stats.pages += 1;
      yield page.data ?? [];
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  /** Bulk id lookup through the generic transactions endpoint, at most 100 ids per call. */
  async lookup<T>(c: NavanConnection, ids: readonly string[], stats: NavanCallStats): Promise<T[]> {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += NAVAN_MAX_LOOKUP) {
      const page = await this.call<NavanPage<T>>(
        c,
        { path: '/transactions', query: { ids: ids.slice(i, i + NAVAN_MAX_LOOKUP).join(',') } },
        stats,
      );
      out.push(...(page.data ?? []));
    }
    return out;
  }

  /** Batch PATCH in calls of at most `batchSize` (never more than Navan's 100). */
  async patchTransactions(
    c: NavanConnection,
    items: readonly Record<string, unknown>[],
    batchSize: number,
    stats: NavanCallStats,
  ): Promise<number> {
    const size = Math.min(Math.max(1, batchSize), NAVAN_MAX_PATCH);
    let calls = 0;
    for (let i = 0; i < items.length; i += size) {
      await this.call(
        c,
        {
          method: 'PATCH',
          path: '/transactions',
          body: { transactions: items.slice(i, i + size) },
        },
        stats,
      );
      calls += 1;
    }
    return calls;
  }

  /**
   * Changes a list field's options through Navan's async batch jobs: submit up to 5,000 operations,
   * then poll the job until it completes. Returns every operation's own result.
   */
  async runOptionJobs(
    c: NavanConnection,
    fieldId: string,
    operations: readonly NavanOperation[],
    stats: NavanCallStats,
  ): Promise<NavanJobResult[]> {
    const results: NavanJobResult[] = [];
    for (let i = 0; i < operations.length; i += NAVAN_MAX_JOB_OPERATIONS) {
      const chunk = operations.slice(i, i + NAVAN_MAX_JOB_OPERATIONS);
      const submitted = await this.call<{ jobId: string }>(
        c,
        {
          method: 'POST',
          path: `/custom-fields/${encodeURIComponent(fieldId)}/options/batch`,
          body: { operations: chunk },
        },
        stats,
      );
      let done: { status: string; results: NavanJobResult[] | null } | null = null;
      for (let poll = 0; poll < JOB_MAX_POLLS; poll++) {
        const job = await this.call<{ status: string; results: NavanJobResult[] | null }>(
          c,
          { path: `/custom-fields/jobs/${encodeURIComponent(submitted.jobId)}` },
          stats,
        );
        if (job.status === 'COMPLETED' || job.status === 'FAILED') {
          done = job;
          break;
        }
        await sleep(JOB_POLL_MS);
      }
      if (!done) {
        throw new ApiProblem(
          422,
          'INTEGRATION_TEST_FAILED',
          `Navan did not finish option job ${submitted.jobId} in time; the next run checks again.`,
          { statusCode: 0 },
        );
      }
      results.push(
        ...(done.results ??
          chunk.map((op) => ({
            value: op.value,
            action: op.action,
            status: 'FAILED' as const,
            error: 'The job failed without per-option results.',
          }))),
      );
    }
    return results;
  }

  /** Downloads a presigned receipt link. Expired links answer 403 and are reported, not retried. */
  async download(
    url: string,
  ): Promise<{ ok: boolean; body: Buffer; contentType: string; message: string }> {
    this.http.assertAllowed(url);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const body = Buffer.from(await res.arrayBuffer());
      return {
        ok: res.ok,
        body,
        contentType: res.headers.get('content-type') ?? 'application/octet-stream',
        message: res.ok ? '' : providerMessage(res.status, body.toString('utf8')),
      };
    } catch (e) {
      return {
        ok: false,
        body: Buffer.alloc(0),
        contentType: '',
        message: e instanceof Error ? e.message : 'download failed',
      };
    }
  }

  private retryAfterMs(res: OutboundResponse, attempt: number): number {
    const header = res.headers?.['retry-after'];
    const seconds = header ? Number(header) : NaN;
    const base = Number.isFinite(seconds) ? seconds * 1000 : 250 * 2 ** (attempt - 1);
    return Math.min(Math.max(base, 50), MAX_WAIT_MS);
  }

  private parse<T>(res: OutboundResponse): T {
    try {
      return JSON.parse(res.body || '{}') as T;
    } catch {
      throw new ApiProblem(
        422,
        'INTEGRATION_TEST_FAILED',
        'Navan answered with something that is not JSON.',
      );
    }
  }

  private problem(res: OutboundResponse): ApiProblem {
    const statusCode = res.statusCode || null;
    const message = providerMessage(statusCode, res.body);
    return new ApiProblem(
      422,
      statusCode === 429 ? 'RATE_LIMIT_EXCEEDED' : 'INTEGRATION_TEST_FAILED',
      `Navan: ${message}`,
      { statusCode: statusCode ?? 0 },
    );
  }
}
