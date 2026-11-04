# libs/api/db — schema, migrations, RLS

- Drizzle schema files are the source; migrations are generated with drizzle-kit, reviewed as SQL, and committed. Never `drizzle-kit push` (the agent hook blocks it).
- Merged migrations are immutable; fix forward with a new migration. Migration numbers are assigned by the integrator during parallel waves.
- Every tenant-owned table: `tenant_id`, RLS policy on `app.tenant_id`, `FORCE ROW LEVEL SECURITY`, and an RLS policy check in `apps/api-e2e/src/db/`.
- Ledger and audit tables reject `UPDATE` and `DELETE` through triggers; closed accounting periods reject inserts.
- `npx nx run db:db-check` (or the project's equivalent name) runs drizzle-kit check plus the migration lint.

Use `/db-migration`. Rules: `.cursor/rules/db-drizzle-rls.mdc`, `ledger-accounting.mdc`.
