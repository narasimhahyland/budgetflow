import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createPool(connectionString: string, max = 10): Pool {
  return new Pool({ connectionString, max, application_name: 'budgetflow' });
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
    await tx.execute(
      sql`select set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.subject', ${ctx.subject ?? ''}, true)`,
    );
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
    await tx.execute(
      sql`select set_config('app.subject', ${subject}, true), set_config('app.tenant_id', '', true)`,
    );
    return fn(tx);
  });
}
