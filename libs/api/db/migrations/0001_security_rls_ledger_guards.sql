-- Security and ledger guards (hand-written, reviewed). Every later migration that adds a tenant table
-- must enable and force RLS with the tenant_isolation policy; apps/api-e2e/src/db/rls-policies.spec.ts fails otherwise.

-- Application roles. Local dev gives them LOGIN and passwords in infra/postgres/init; neither bypasses RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bf_app') THEN
    CREATE ROLE bf_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bf_worker') THEN
    CREATE ROLE bf_worker NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_subject() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.subject', true), '')
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO bf_app, bf_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bf_app, bf_worker;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bf_app, bf_worker;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bf_app, bf_worker;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO bf_app, bf_worker;
--> statement-breakpoint
-- Append-only tables: no UPDATE, DELETE or TRUNCATE for the application roles (triggers below as well).
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_journals, ledger_lines, audit_events, budget_versions, period_close_snapshots FROM bf_app, bf_worker;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON currencies FROM bf_app, bf_worker;
--> statement-breakpoint
-- Tenant isolation: every table with a tenant_id column.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenants USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());
--> statement-breakpoint
-- Before a tenant is chosen, users may read their own memberships, grants and those tenants' names.
CREATE POLICY membership_self ON memberships FOR SELECT USING (idp_subject = app_current_subject());
--> statement-breakpoint
CREATE POLICY role_grants_self ON role_grants FOR SELECT
  USING (membership_id IN (SELECT m.id FROM memberships m WHERE m.idp_subject = app_current_subject()));
--> statement-breakpoint
CREATE POLICY tenant_member_read ON tenants FOR SELECT
  USING (id IN (SELECT m.tenant_id FROM memberships m WHERE m.idp_subject = app_current_subject()));
--> statement-breakpoint
-- The worker iterates tenants explicitly for scheduled jobs and sets the tenant context per tenant.
CREATE POLICY worker_list_tenants ON tenants FOR SELECT TO bf_worker USING (true);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed; post a reversal instead', TG_TABLE_NAME, TG_OP USING ERRCODE = 'BF001';
END $$;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_journals', 'ledger_lines', 'audit_events', 'budget_versions', 'period_close_snapshots']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_reject_mutation()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation()', t || '_no_truncate', t);
  END LOOP;
END $$;
--> statement-breakpoint
-- Nothing posts to a Closed or Locked period (late items go to the next open period with a flag).
CREATE OR REPLACE FUNCTION app_reject_closed_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s period_status;
BEGIN
  SELECT status INTO s FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
  IF s IS NULL THEN
    RAISE EXCEPTION 'unknown fiscal period %', NEW.fiscal_period_id USING ERRCODE = 'BF002';
  END IF;
  IF s IN ('closed', 'locked') THEN
    RAISE EXCEPTION 'fiscal period % is %; late items post to the next open period', NEW.fiscal_period_id, s USING ERRCODE = 'BF002';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_journals_open_period BEFORE INSERT ON ledger_journals FOR EACH ROW EXECUTE FUNCTION app_reject_closed_period();
--> statement-breakpoint
CREATE TRIGGER ledger_lines_open_period BEFORE INSERT ON ledger_lines FOR EACH ROW EXECUTE FUNCTION app_reject_closed_period();
--> statement-breakpoint
-- Every journal balances (transaction and reporting currency), has at least two lines and one currency per view; checked at commit.
CREATE OR REPLACE FUNCTION app_assert_journal_balanced(jid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  n int;
  st bigint;
  sr bigint;
  ct int;
  cr int;
BEGIN
  SELECT count(*), coalesce(sum(transaction_amount_minor), 0), coalesce(sum(reporting_amount_minor), 0),
         count(DISTINCT transaction_currency), count(DISTINCT reporting_currency)
    INTO n, st, sr, ct, cr
    FROM ledger_lines WHERE journal_id = jid;
  IF n < 2 THEN
    RAISE EXCEPTION 'journal % has % line(s); a journal needs at least two', jid, n USING ERRCODE = 'BF003';
  END IF;
  IF ct <> 1 OR cr <> 1 THEN
    RAISE EXCEPTION 'journal % mixes currencies within a currency view', jid USING ERRCODE = 'BF003';
  END IF;
  IF st <> 0 OR sr <> 0 THEN
    RAISE EXCEPTION 'journal % does not balance (transaction %, reporting %)', jid, st, sr USING ERRCODE = 'BF003';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_check_line_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_assert_journal_balanced(NEW.journal_id);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_check_journal_has_balanced_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_assert_journal_balanced(NEW.id);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_lines_balanced AFTER INSERT ON ledger_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_check_line_journal_balance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_journals_balanced AFTER INSERT ON ledger_journals
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_check_journal_has_balanced_lines();
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO bf_app, bf_worker;
--> statement-breakpoint
-- pg-boss job tables live in their own schema owned by the worker role.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION bf_worker;
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO bf_worker', current_database());
END $$;
