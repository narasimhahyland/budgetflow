CREATE TABLE "burn_rate_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"fiscal_period_id" uuid NOT NULL,
	"level" varchar(20) NOT NULL,
	"burn_bps" integer NOT NULL,
	"spent_minor" bigint NOT NULL,
	"phased_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"owner_person_id" uuid,
	"run_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT app_now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "burn_rate_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"trigger" varchar(20) DEFAULT 'manual' NOT NULL,
	"evaluated_count" integer DEFAULT 0 NOT NULL,
	"alerts_raised" integer DEFAULT 0 NOT NULL,
	"requested_by" uuid,
	"error" text,
	"created_at" timestamp with time zone DEFAULT app_now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reclaim_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'collecting' NOT NULL,
	"criteria" jsonb NOT NULL,
	"started_on" date NOT NULL,
	"respond_by" date NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT app_now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT app_now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reclaim_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"pool_minor" bigint NOT NULL,
	"allocated_minor" bigint NOT NULL,
	"remainder_minor" bigint NOT NULL,
	"legs" jsonb NOT NULL,
	"journal_ids" uuid[] DEFAULT '{}' NOT NULL,
	"reason_code" varchar(50) NOT NULL,
	"reason" text NOT NULL,
	"executed_by" uuid,
	"created_at" timestamp with time zone DEFAULT app_now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reclaim_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"owner_person_id" uuid,
	"parent_owner_person_id" uuid,
	"forecast_unused_minor" bigint NOT NULL,
	"proposed_minor" bigint NOT NULL,
	"floor_minor" bigint NOT NULL,
	"max_reclaimable_minor" bigint NOT NULL,
	"status" varchar(20) DEFAULT 'sent' NOT NULL,
	"choice" varchar(20),
	"released_minor" bigint DEFAULT 0 NOT NULL,
	"kept_minor" bigint DEFAULT 0 NOT NULL,
	"reason" text,
	"plan" text,
	"responded_as" varchar(20),
	"responded_by" uuid,
	"responded_at" timestamp with time zone,
	"escalated_by" uuid,
	"escalated_at" timestamp with time zone,
	"execution_id" uuid,
	"created_at" timestamp with time zone DEFAULT app_now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "burn_rate_alerts" ADD CONSTRAINT "burn_rate_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "burn_rate_alerts" ADD CONSTRAINT "burn_rate_alerts_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "burn_rate_alerts" ADD CONSTRAINT "burn_rate_alerts_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "burn_rate_alerts" ADD CONSTRAINT "burn_rate_alerts_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "burn_rate_alerts" ADD CONSTRAINT "burn_rate_alerts_run_id_burn_rate_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."burn_rate_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "burn_rate_runs" ADD CONSTRAINT "burn_rate_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclaim_campaigns" ADD CONSTRAINT "reclaim_campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclaim_campaigns" ADD CONSTRAINT "reclaim_campaigns_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclaim_executions" ADD CONSTRAINT "reclaim_executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclaim_executions" ADD CONSTRAINT "reclaim_executions_campaign_id_reclaim_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."reclaim_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclaim_executions" ADD CONSTRAINT "reclaim_executions_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclaim_executions" ADD CONSTRAINT "reclaim_executions_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclaim_notices" ADD CONSTRAINT "reclaim_notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclaim_notices" ADD CONSTRAINT "reclaim_notices_campaign_id_reclaim_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."reclaim_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclaim_notices" ADD CONSTRAINT "reclaim_notices_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclaim_notices" ADD CONSTRAINT "reclaim_notices_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclaim_notices" ADD CONSTRAINT "reclaim_notices_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "burn_rate_alerts_once" ON "burn_rate_alerts" USING btree ("tenant_id","budget_id","fiscal_period_id","level");--> statement-breakpoint
CREATE INDEX "burn_rate_alerts_run" ON "burn_rate_alerts" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE INDEX "burn_rate_runs_tenant" ON "burn_rate_runs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "reclaim_campaigns_tenant" ON "reclaim_campaigns" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reclaim_executions_pool" ON "reclaim_executions" USING btree ("tenant_id","campaign_id","legal_entity_id","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "reclaim_notices_campaign_budget" ON "reclaim_notices" USING btree ("tenant_id","campaign_id","budget_id");--> statement-breakpoint
CREATE INDEX "reclaim_notices_owner" ON "reclaim_notices" USING btree ("tenant_id","owner_person_id","status");--> statement-breakpoint
-- Hand-written (gap B4): tenant isolation for the reclaim campaign and burn-rate tables.
ALTER TABLE "reclaim_campaigns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reclaim_campaigns" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "reclaim_campaigns" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "reclaim_notices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reclaim_notices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "reclaim_notices" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "reclaim_executions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reclaim_executions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "reclaim_executions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "burn_rate_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "burn_rate_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "burn_rate_runs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "burn_rate_alerts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "burn_rate_alerts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "burn_rate_alerts" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
