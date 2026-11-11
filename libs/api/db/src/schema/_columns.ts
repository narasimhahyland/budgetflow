import { sql } from 'drizzle-orm';
import { bigint, char, date, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Shared column builders. Money is bigint minor units with a char(3) ISO 4217 code; timestamps are timestamptz (UTC). */
export const pk = () => uuid('id').primaryKey().defaultRandom();
export const tenantRef = () => uuid('tenant_id').notNull();
export const minor = (name: string) => bigint(name, { mode: 'number' });
export const ccy = (name: string) => char(name, { length: 3 });
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * The database's "now" for a column default: `app_now()` (migration 0020), which is real `now()`
 * unless the session carries `app.fixed_now`. It is the database's copy of the API clock in
 * `libs/api/core/src/lib/clock.ts`, and exists for the same reason: a test stack pins it so that
 * seeded rows carry the same timestamps on every run and every real date. Use it instead of
 * `defaultNow()` for any timestamp default; a plain `now()` default reads the wall clock and drifts.
 */
export const appNow = sql`app_now()`;
export const createdAt = () => ts('created_at').notNull().default(appNow);
export const updatedAt = () => ts('updated_at').notNull().default(appNow);
export const day = (name: string) => date(name, { mode: 'string' });
export const validFrom = () => day('valid_from').notNull();
export const validTo = () => day('valid_to');
