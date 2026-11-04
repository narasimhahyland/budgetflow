import { defineConfig } from 'drizzle-kit';

// Generation only (`npx nx run db:generate -- --name <verb_noun>`). Migrations are applied by the
// API's migrate entry point as the owner role; `drizzle-kit push` is blocked by a project hook.
export default defineConfig({
  dialect: 'postgresql',
  schema: './libs/api/db/src/schema/index.ts',
  out: process.env.DRIZZLE_OUT ?? './libs/api/db/migrations',
  strict: true,
});
