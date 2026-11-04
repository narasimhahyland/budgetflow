---
name: db-migration
description: Changes the BudgetFlow PostgreSQL schema safely with Drizzle - schema edit, generated migration, tenant RLS policies, append-only triggers for ledger and audit tables, safe rollout on populated tables, and functional RLS policy checks in apps/api-e2e (Testcontainers Postgres and the running API). Use when adding or changing tables, columns, indexes, constraints, RLS policies or seed data.
---

# Database migration

Rule: `.cursor/rules/db-drizzle-rls.mdc`. Schema and migrations in `libs/api/db` are shared files: the task must own them.

```text
- [ ] 1 Design: tables, tenant ownership, RLS, constraints, rollout
- [ ] 2 Edit the Drizzle schema; generate the migration (never push)
- [ ] 3 RLS policies and triggers in the same migration
- [ ] 4 Seed data (fictional, idempotent, deterministic)
- [ ] 5 Functional checks: migration, RLS, invariants
- [ ] 6 Gates and report
```

## 1. Design

Every tenant-owned table has `tenant_id uuid not null`, a composite index starting with `tenant_id`, and RLS enabled and forced. Money columns are `bigint` minor units with a `char(3)` currency; timestamps `timestamptz` (UTC). Ledger and audit tables are append-only. Plan the rollout for populated tables: add nullable, backfill, then constrain; indexes concurrently in their own migration.

## 2. Schema and migration

Edit `libs/api/db/src/schema/*.ts`, then `npx nx run db:generate -- --name <verb_noun>` (drizzle-kit generate). Review the SQL by hand. `drizzle-kit push` is blocked by a project hook: schema changes always go through a reviewed migration. `npx nx run db:db-check` must pass (drift and migration lint).

## 3. RLS and triggers (same migration)

```sql
alter table budget enable row level security;
alter table budget force row level security;
create policy tenant_isolation on budget
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
```

Ledger and audit tables also get `before update or delete` triggers that raise, and the application role gets no `update`/`delete` grants on them. The API sets `app.tenant_id` per transaction (`set_config(..., true)`).

## 4. Seed

Extend the deterministic seed (company Hyland, all other data fictional; fixed ids and amounts) so functional checks and visual baselines can reach every new state. Seeds are idempotent.

## 5. Functional checks (`apps/api-e2e/src/db/` and the affected area)

- Migration: apply from empty and from the previous release with seed data in a Testcontainers Postgres 16; both succeed and `db-check` stays clean.
- RLS policy checks: as the application role with `app.tenant_id` = tenant A, select, insert, update and delete tenant B rows all fail; through the API with tenant A's token and a forged `X-Tenant-Id` for tenant B, nothing of tenant B is visible.
- Append-only: update and delete on ledger and audit rows are rejected.
- The scenarios for invariants touched by the change (`docs/testing/invariant-scenarios.md`).
  Run `npx nx run api-e2e:functional-api -- -g "<area>"` after `scripts/stack.sh up && scripts/stack.sh reset`.

## 6. Gates and report

`scripts/gate.sh static functional-api`. Report: tables and policies changed, migration name, rollout notes, scenarios added with results, evidence path.
