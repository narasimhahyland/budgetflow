import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, createPool } from './client';

/** Applies committed migrations as the owner role. Never `drizzle-kit push`. */
export async function runMigrations(ownerUrl: string, migrationsFolder: string): Promise<void> {
  const pool = createPool(ownerUrl, 1);
  try {
    await migrate(createDb(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
