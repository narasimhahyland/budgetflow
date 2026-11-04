import { bigint, char, date, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Shared column builders. Money is bigint minor units with a char(3) ISO 4217 code; timestamps are timestamptz (UTC). */
export const pk = () => uuid('id').primaryKey().defaultRandom();
export const tenantRef = () => uuid('tenant_id').notNull();
export const minor = (name: string) => bigint(name, { mode: 'number' });
export const ccy = (name: string) => char(name, { length: 3 });
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const createdAt = () => ts('created_at').notNull().defaultNow();
export const updatedAt = () => ts('updated_at').notNull().defaultNow();
export const day = (name: string) => date(name, { mode: 'string' });
export const validFrom = () => day('valid_from').notNull();
export const validTo = () => day('valid_to');
