CREATE TYPE "public"."import_batch_status" AS ENUM('review', 'posted', 'discarded');--> statement-breakpoint
CREATE TABLE "actual_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actual_id" uuid NOT NULL,
	"commitment_id" uuid,
	"budget_id" uuid NOT NULL,
	"transaction_amount_minor" bigint NOT NULL,
	"transaction_currency" char(3) NOT NULL,
	"budget_amount_minor" bigint NOT NULL,
	"budget_currency" char(3) NOT NULL,
	"relief_minor" bigint DEFAULT 0 NOT NULL,
	"released_minor" bigint DEFAULT 0 NOT NULL,
	"excess_minor" bigint DEFAULT 0 NOT NULL,
	"fit" varchar(30),
	"rule" varchar(30),
	"prepaid" boolean DEFAULT false NOT NULL,
	"journal_ids" uuid[] NOT NULL,
	"reversed_at" timestamp with time zone,
	"reversal_journal_ids" uuid[],
	"reversal_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gl_tieout_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"gl_account_id" uuid,
	"gl_minor" bigint NOT NULL,
	"budgetflow_minor" bigint NOT NULL,
	"difference_minor" bigint NOT NULL,
	"within_tolerance" boolean NOT NULL,
	"explanation" text,
	"explained_by" uuid,
	"explained_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" "actual_source" NOT NULL,
	"file_name" text NOT NULL,
	"file_hash" varchar(64) NOT NULL,
	"status" "import_batch_status" DEFAULT 'review' NOT NULL,
	"line_count" integer NOT NULL,
	"imported_count" integer NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"column_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" uuid,
	"posted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accruals" ADD COLUMN "accrual_date" date;--> statement-breakpoint
ALTER TABLE "accruals" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "accruals" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accruals" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "accruals" ADD COLUMN "exported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accruals" ADD COLUMN "reversal_trigger" varchar(20);--> statement-breakpoint
ALTER TABLE "actual_mapping_rules" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "actual_mapping_rules" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "line_no" integer;--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "reference" varchar(100);--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "original_ref" varchar(200);--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "card_program" varchar(50);--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "plan_rate" numeric(24, 12);--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "actual_rate_type" varchar(20);--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "actual_reporting_minor" bigint;--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "fx_effect_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "budget_currency" char(3);--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "budget_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "proposed_commitment_id" uuid;--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "proposed_budget_id" uuid;--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "match_rule" varchar(30);--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "match_confidence" integer;--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "match_note" text;--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "over_budget_request_id" uuid;--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "excluded_reason" text;--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "duplicate_of_actual_id" uuid;--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "matched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "actuals" ADD COLUMN "matched_by" uuid;--> statement-breakpoint
ALTER TABLE "gl_tieout_runs" ADD COLUMN "tolerance_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gl_tieout_runs" ADD COLUMN "currency" char(3);--> statement-breakpoint
ALTER TABLE "gl_tieout_runs" ADD COLUMN "prepared_by" uuid;--> statement-breakpoint
ALTER TABLE "gl_tieout_runs" ADD COLUMN "source_file_name" text;--> statement-breakpoint
ALTER TABLE "gl_tieout_runs" ADD COLUMN "sign_off_comment" text;--> statement-breakpoint
ALTER TABLE "prepaids" ADD COLUMN "actual_id" uuid;--> statement-breakpoint
ALTER TABLE "prepaids" ADD COLUMN "budget_id" uuid;--> statement-breakpoint
ALTER TABLE "prepaids" ADD COLUMN "recognized_through" date;--> statement-breakpoint
ALTER TABLE "prepaids" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "actual_matches" ADD CONSTRAINT "actual_matches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actual_matches" ADD CONSTRAINT "actual_matches_actual_id_actuals_id_fk" FOREIGN KEY ("actual_id") REFERENCES "public"."actuals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actual_matches" ADD CONSTRAINT "actual_matches_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actual_matches" ADD CONSTRAINT "actual_matches_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actual_matches" ADD CONSTRAINT "actual_matches_transaction_currency_currencies_code_fk" FOREIGN KEY ("transaction_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actual_matches" ADD CONSTRAINT "actual_matches_budget_currency_currencies_code_fk" FOREIGN KEY ("budget_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_tieout_lines" ADD CONSTRAINT "gl_tieout_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_tieout_lines" ADD CONSTRAINT "gl_tieout_lines_run_id_gl_tieout_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."gl_tieout_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_tieout_lines" ADD CONSTRAINT "gl_tieout_lines_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_tieout_lines" ADD CONSTRAINT "gl_tieout_lines_gl_account_id_gl_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actual_matches_actual" ON "actual_matches" USING btree ("tenant_id","actual_id");--> statement-breakpoint
CREATE INDEX "actual_matches_commitment" ON "actual_matches" USING btree ("tenant_id","commitment_id");--> statement-breakpoint
CREATE INDEX "gl_tieout_lines_run" ON "gl_tieout_lines" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_file_hash" ON "import_batches" USING btree ("tenant_id","file_hash");--> statement-breakpoint
CREATE INDEX "import_batches_tenant_created" ON "import_batches" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "prepaids" ADD CONSTRAINT "prepaids_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "actuals_batch" ON "actuals" USING btree ("tenant_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "actuals_event_code" ON "actuals" USING btree ("tenant_id","event_code");--> statement-breakpoint
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_matched_within_amount" CHECK (abs("actuals"."matched_minor") <= abs("actuals"."transaction_amount_minor"));--> statement-breakpoint
-- Hand-written (reviewed): tenant isolation for the Phase 6 tables.
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_batches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "import_batches" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "actual_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "actual_matches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "actual_matches" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "gl_tieout_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gl_tieout_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "gl_tieout_lines" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
