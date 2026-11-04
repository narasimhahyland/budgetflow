// Direct database access for database-level guarantees (RLS, append-only, closed periods, balance) as the
// application role, and owner-only helpers for deliberate drift and tamper scenarios in the sandbox tenant.
import { Client } from 'pg';
import { env, PG } from './env';

type Role = 'app' | 'owner';

function client(role: Role): Client {
  return role === 'app'
    ? new Client({ ...PG, user: 'bf_app', password: env('BF_PG_APP_PASSWORD') })
    : new Client({ ...PG, user: env('BF_PG_OWNER_USER'), password: env('BF_PG_OWNER_PASSWORD') });
}

/**
 * Runs `fn` as the application role inside a transaction with `app.tenant_id` set (or unset).
 * `commit: true` commits so deferred constraints fire; otherwise it rolls back.
 */
export async function asAppRole<T>(
  tenantId: string | null,
  fn: (c: Client) => Promise<T>,
  opts: { commit?: boolean } = {},
): Promise<T> {
  const c = client('app');
  await c.connect();
  try {
    await c.query('begin');
    if (tenantId) await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    const out = await fn(c);
    await c.query(opts.commit ? 'commit' : 'rollback');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
}

/** Owner connection (superuser in the local stack). Only for deliberate drift/tamper scenarios that restore state. */
export async function asOwner<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = client('owner');
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Resolves with the Postgres error (code, message) of a failing statement, or null if it succeeded. */
export async function pgError(
  p: Promise<unknown>,
): Promise<{ code: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { code: err.code ?? 'unknown', message: err.message ?? '' };
  }
}
