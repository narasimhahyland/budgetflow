CREATE TYPE "public"."close_check_code" AS ENUM('gl_tieout_signed_off', 'journals_balanced', 'ledger_check_clean', 'audit_chain_verified', 'actuals_imported', 'unmatched_actuals_cleared', 'accruals_reviewed', 'prepaids_recognized', 'commitments_accrued');--> statement-breakpoint
CREATE TYPE "public"."reopen_action" AS ENUM('reopen', 'unlock');--> statement-breakpoint
CREATE TYPE "public"."reopen_request_status" AS ENUM('pending', 'approved', 'declined');--> statement-breakpoint
CREATE TYPE "public"."year_end_line_status" AS ENUM('planned', 'awaiting_approval', 'approved', 'declined', 'blocked', 'executed');--> statement-breakpoint
CREATE TABLE "period_close_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fiscal_period_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"check_code" "close_check_code" NOT NULL,
	"reason_code" varchar(50) NOT NULL,
	"reason" text NOT NULL,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"close_attempt" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_reopen_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fiscal_period_id" uuid NOT NULL,
	"action" "reopen_action" NOT NULL,
	"reason_code" varchar(50) NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "reopen_request_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text
);
--> statement-breakpoint
CREATE TABLE "year_end_commitment_carries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"source_commitment_id" uuid NOT NULL,
	"carried_commitment_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"release_journal_id" uuid,
	"carry_journal_id" uuid,
	"accounting_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "year_end_run_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"available_minor" bigint DEFAULT 0 NOT NULL,
	"authorized_minor" bigint DEFAULT 0 NOT NULL,
	"rollover_policy_id" uuid,
	"carry_minor" bigint DEFAULT 0 NOT NULL,
	"lapse_minor" bigint DEFAULT 0 NOT NULL,
	"sweep_to_budget_id" uuid,
	"open_commitment_count" integer DEFAULT 0 NOT NULL,
	"open_commitment_minor" bigint DEFAULT 0 NOT NULL,
	"target_budget_id" uuid,
	"status" "year_end_line_status" DEFAULT 'planned' NOT NULL,
	"blocked_reason" text,
	"approved_carry_minor" bigint,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"journal_ids" uuid[] DEFAULT '{}' NOT NULL,
	"executed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commitments" ADD COLUMN "carried_from_commitment_id" uuid;--> statement-breakpoint
ALTER TABLE "period_close_snapshots" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "period_close_snapshots" ADD COLUMN "currency" char(3);--> statement-breakpoint
ALTER TABLE "period_close_snapshots" ADD COLUMN "budget_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "year_end_runs" ADD COLUMN "target_fiscal_year_id" uuid;--> statement-breakpoint
ALTER TABLE "year_end_runs" ADD COLUMN "target_plan_version_id" uuid;--> statement-breakpoint
ALTER TABLE "year_end_runs" ADD COLUMN "root_budget_id" uuid;--> statement-breakpoint
ALTER TABLE "year_end_runs" ADD COLUMN "executed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "year_end_runs" ADD COLUMN "executed_by" uuid;--> statement-breakpoint
ALTER TABLE "year_end_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "period_close_acknowledgements" ADD CONSTRAINT "period_close_acknowledgements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_close_acknowledgements" ADD CONSTRAINT "period_close_acknowledgements_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_close_acknowledgements" ADD CONSTRAINT "period_close_acknowledgements_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_reopen_requests" ADD CONSTRAINT "period_reopen_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_reopen_requests" ADD CONSTRAINT "period_reopen_requests_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_commitment_carries" ADD CONSTRAINT "year_end_commitment_carries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_commitment_carries" ADD CONSTRAINT "year_end_commitment_carries_run_id_year_end_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."year_end_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_commitment_carries" ADD CONSTRAINT "year_end_commitment_carries_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_run_lines" ADD CONSTRAINT "year_end_run_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_run_lines" ADD CONSTRAINT "year_end_run_lines_run_id_year_end_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."year_end_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_run_lines" ADD CONSTRAINT "year_end_run_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_run_lines" ADD CONSTRAINT "year_end_run_lines_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_run_lines" ADD CONSTRAINT "year_end_run_lines_rollover_policy_id_rollover_policies_id_fk" FOREIGN KEY ("rollover_policy_id") REFERENCES "public"."rollover_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_run_lines" ADD CONSTRAINT "year_end_run_lines_sweep_to_budget_id_budgets_id_fk" FOREIGN KEY ("sweep_to_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_run_lines" ADD CONSTRAINT "year_end_run_lines_target_budget_id_budgets_id_fk" FOREIGN KEY ("target_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "period_close_acks_period" ON "period_close_acknowledgements" USING btree ("tenant_id","fiscal_period_id","legal_entity_id","close_attempt");--> statement-breakpoint
CREATE INDEX "period_reopen_requests_period" ON "period_reopen_requests" USING btree ("tenant_id","fiscal_period_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "year_end_commitment_carries_source" ON "year_end_commitment_carries" USING btree ("tenant_id","source_commitment_id");--> statement-breakpoint
CREATE INDEX "year_end_commitment_carries_run" ON "year_end_commitment_carries" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "year_end_run_lines_run_budget" ON "year_end_run_lines" USING btree ("tenant_id","run_id","budget_id");--> statement-breakpoint
CREATE INDEX "year_end_run_lines_run" ON "year_end_run_lines" USING btree ("tenant_id","run_id","status");--> statement-breakpoint
ALTER TABLE "year_end_runs" ADD CONSTRAINT "year_end_runs_target_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("target_fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_runs" ADD CONSTRAINT "year_end_runs_root_budget_id_budgets_id_fk" FOREIGN KEY ("root_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "period_close_snapshots_version" ON "period_close_snapshots" USING btree ("tenant_id","fiscal_period_id","legal_entity_id","version");
--> statement-breakpoint
-- Hand-written (reviewed): tenant isolation for the Phase 11 tables.
--> statement-breakpoint
ALTER TABLE "period_close_acknowledgements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "period_close_acknowledgements" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "period_close_acknowledgements" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "period_reopen_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "period_reopen_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "period_reopen_requests" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "year_end_run_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "year_end_run_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "year_end_run_lines" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "year_end_commitment_carries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "year_end_commitment_carries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "year_end_commitment_carries" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Hand-written (reviewed): acknowledgements and commitment carries are append-only evidence.
-- A later close attempt writes new rows; nothing rewrites what a close was judged on.
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "period_close_acknowledgements" FROM bf_app, bf_worker;
--> statement-breakpoint
CREATE TRIGGER period_close_acknowledgements_append_only BEFORE UPDATE OR DELETE ON "period_close_acknowledgements" FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER period_close_acknowledgements_no_truncate BEFORE TRUNCATE ON "period_close_acknowledgements" FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "year_end_commitment_carries" FROM bf_app, bf_worker;
--> statement-breakpoint
CREATE TRIGGER year_end_commitment_carries_append_only BEFORE UPDATE OR DELETE ON "year_end_commitment_carries" FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER year_end_commitment_carries_no_truncate BEFORE TRUNCATE ON "year_end_commitment_carries" FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();
