import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../schema';
import { observeDatabaseNow, pinnedInstant, pinnedSessionOptions } from './pinned-clock';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Under a pinned clock (`FIXED_NOW`, test stacks only) every session opens with `app.fixed_now`, so
 * database timestamp defaults follow the same clock as the API (see `pinned-clock.ts`). Without it the
 * pool is exactly what it always was.
 */
export function createPool(connectionString: string, max = 10): Pool {
  const options = pinnedSessionOptions();
  return new Pool({
    connectionString,
    max,
    application_name: 'budgetflow',
    ...(options ? { options } : {}),
  });
}

/**
 * The database clock as of the latest stamp, read without advancing it: `app_now()` would take the
 * next tick (`nextval`), which a read-only transaction may not do and which would move the clock on
 * every read. This is the instant of the newest row the database has stamped, so a JavaScript stamp
 * taken from it is never older than one.
 */
const DATABASE_CLOCK = sql.raw(
  `(current_setting('app.fixed_now')::timestamptz + (select last_value from app_clock_tick) * interval '1 millisecond')`,
);

/**
 * The statement that opens every tenant or subject transaction. Under a pinned clock it also reads
 * the database clock, so JavaScript stamps in the transaction are never older than rows already
 * stamped by the database (`observeDatabaseNow`). On the real clock it is the statement it always was.
 */
async function setSession(tx: Tx, tenantId: string, subject: string): Promise<void> {
  if (pinnedInstant() === null) {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.subject', ${subject}, true)`,
    );
    return;
  }
  const result = await tx.execute<{ now: Date | string }>(
    sql`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.subject', ${subject}, true), ${DATABASE_CLOCK} as now`,
  );
  const now = result.rows[0]?.now;
  if (now !== undefined) observeDatabaseNow(now);
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}

export interface TenantContext {
  tenantId: string;
  subject?: string | null;
}

export interface TxOptions {
  isolationLevel?: 'read committed' | 'repeatable read' | 'serializable';
  accessMode?: 'read only' | 'read write';
}

/**
 * Runs `fn` in one transaction with `app.tenant_id` (and `app.subject`) set locally, so every
 * query is filtered by row-level security. The application role has no BYPASSRLS.
 */
export async function withTenant<T>(
  db: Db,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
  options?: TxOptions,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setSession(tx, ctx.tenantId, ctx.subject ?? '');
    return fn(tx);
  }, options);
}

/** Membership lookups before a tenant is chosen: only `app.subject` is set (RLS lets users see their own memberships). */
export async function withSubject<T>(
  db: Db,
  subject: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await setSession(tx, '', subject);
    return fn(tx);
  });
}
