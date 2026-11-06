-- Proof that a forecast is not an actual, and that the new tables isolate tenants.
-- Run against the local stack's Postgres as the migration owner.

-- 1. The ledger has no forecast account, so no posting can ever be a forecast.
select unnest(enum_range(NULL::ledger_account))::text as ledger_account;

-- 2. No ledger table references a forecast: the snapshots live beside the ledger, never in it.
select count(*) as ledger_columns_referencing_forecast
from information_schema.columns
where table_name in ('ledger_journals', 'ledger_lines', 'ledger_balances')
  and column_name like '%forecast%';

-- 3. No ledger line was ever written by a forecast command.
select count(*) as forecast_journals
from ledger_journals
where command like 'forecast%' or journal_type::text like '%forecast%';

-- 4. Migration 0015: the new tenant-scoped tables force RLS with the tenant_isolation policy.
select c.relname as "table", c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
       exists (select 1 from pg_policies p
               where p.tablename = c.relname and p.policyname = 'tenant_isolation') as tenant_isolation
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('forecast_cycles', 'forecast_snapshots', 'board_pack_generations')
order by 1;

-- 5. A forecast snapshot always names what it forecasts (migration 0015 check constraint).
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'forecast_snapshots'::regclass and contype = 'c';
