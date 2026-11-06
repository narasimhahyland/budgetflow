CREATE TYPE "public"."board_pack_status" AS ENUM('queued', 'running', 'ready', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."forecast_cycle_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "forecast_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"as_of_date" date NOT NULL,
	"due_date" date NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"scope_root_budget_id" uuid,
	"status" "forecast_cycle_status" DEFAULT 'open' NOT NULL,
	"currency" char(3) NOT NULL,
	"variance_threshold_bps" integer DEFAULT 1000 NOT NULL,
	"variance_threshold_minor" bigint DEFAULT 100000 NOT NULL,
	"default_method_operating" "forecast_method" DEFAULT 'run_rate' NOT NULL,
	"default_method_event" "forecast_method" DEFAULT 'committed_pipeline' NOT NULL,
	"include_open_events" boolean DEFAULT true NOT NULL,
	"reminder_days_before" integer[] DEFAULT '{3,1}' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "board_pack_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fiscal_period_id" uuid NOT NULL,
	"source_kind" varchar(30) DEFAULT 'close_snapshot' NOT NULL,
	"snapshot_version" integer,
	"snapshot_taken_at" timestamp with time zone,
	"draft" boolean DEFAULT false NOT NULL,
	"pages" text[] DEFAULT '{}' NOT NULL,
	"formats" text[] DEFAULT '{"pdf","xlsx"}' NOT NULL,
	"constant_currency" boolean DEFAULT true NOT NULL,
	"root_budget_id" uuid,
	"forecast_cycle_id" uuid,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"status" "board_pack_status" DEFAULT 'queued' NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failed_page" varchar(40),
	"error" text,
	"requested_by_person_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD COLUMN "cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD COLUMN "authorized_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD COLUMN "actual_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD COLUMN "committed_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD COLUMN "pending_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD COLUMN "planned_events_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD COLUMN "variance_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD COLUMN "commentary_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD COLUMN "commentary_note" text;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD COLUMN "system_generated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "forecast_cycles" ADD CONSTRAINT "forecast_cycles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_cycles" ADD CONSTRAINT "forecast_cycles_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_cycles" ADD CONSTRAINT "forecast_cycles_scope_root_budget_id_budgets_id_fk" FOREIGN KEY ("scope_root_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_cycles" ADD CONSTRAINT "forecast_cycles_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_pack_generations" ADD CONSTRAINT "board_pack_generations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_pack_generations" ADD CONSTRAINT "board_pack_generations_requested_by_person_id_people_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_cycles_name" ON "forecast_cycles" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "forecast_cycles_year" ON "forecast_cycles" USING btree ("tenant_id","fiscal_year_id","status");--> statement-breakpoint
CREATE INDEX "board_pack_generations_tenant" ON "board_pack_generations" USING btree ("tenant_id","requested_at");--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_cycle_id_forecast_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."forecast_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_snapshots_cycle_budget" ON "forecast_snapshots" USING btree ("tenant_id","cycle_id","budget_id");--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_snapshots_cycle_event" ON "forecast_snapshots" USING btree ("tenant_id","cycle_id","event_id");--> statement-breakpoint
CREATE INDEX "forecast_snapshots_cycle" ON "forecast_snapshots" USING btree ("tenant_id","cycle_id","status");--> statement-breakpoint
-- Hand-written (reviewed): tenant isolation for the two new tenant-scoped tables. The generator
-- does not emit it, so it is re-appended with every migration that adds a tenant-owned table.
--> statement-breakpoint
ALTER TABLE "forecast_cycles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "forecast_cycles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "forecast_cycles" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "board_pack_generations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "board_pack_generations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "board_pack_generations" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Hand-written (reviewed): a forecast snapshot always says what it forecasts. The unique indexes
-- above keep one line per budget and per event in a cycle; this keeps a line from naming neither.
-- Added NOT VALID then validated, so the migration is safe on a populated table.
--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_budget_or_event"
  CHECK ((budget_id IS NOT NULL) OR (event_id IS NOT NULL)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "forecast_snapshots" VALIDATE CONSTRAINT "forecast_snapshots_budget_or_event";
