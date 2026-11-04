import { runMigrations } from '@bf/api/db';
import { join } from 'node:path';

// Applies committed Drizzle migrations as the owner role (Compose runs this before the API starts).
const ownerUrl = process.env.DATABASE_URL_OWNER;
if (!ownerUrl) {
  console.error('migrate: DATABASE_URL_OWNER is not set');
  process.exit(1);
}
runMigrations(ownerUrl, process.env.MIGRATIONS_DIR ?? join(__dirname, 'migrations'))
  .then(() => console.log('migrate: database is at the latest migration'))
  .catch((e: Error) => {
    console.error(`migrate: failed: ${e.message}`);
    process.exit(1);
  });
