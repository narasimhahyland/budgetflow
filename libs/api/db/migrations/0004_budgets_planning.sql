CREATE TABLE "budget_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" varchar(30) NOT NULL,
	"budget_id" uuid NOT NULL,
	"source_budget_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"approved_amount_minor" bigint,
	"reason" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"category_code" varchar(50),
	"org_unit_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"mode" varchar(10) DEFAULT 'hard' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_version_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"budget_id" uuid,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"legal_entity_id" uuid,
	"cost_center_id" uuid,
	"owner_person_id" uuid,
	"category_code" varchar(50),
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "phasing_method" varchar(20);--> statement-breakpoint
ALTER TABLE "plan_versions" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD COLUMN "source" varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "budget_change_requests" ADD CONSTRAINT "budget_change_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_change_requests" ADD CONSTRAINT "budget_change_requests_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_change_requests" ADD CONSTRAINT "budget_change_requests_source_budget_id_budgets_id_fk" FOREIGN KEY ("source_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_change_requests" ADD CONSTRAINT "budget_change_requests_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_limits" ADD CONSTRAINT "budget_limits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_limits" ADD CONSTRAINT "budget_limits_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_limits" ADD CONSTRAINT "budget_limits_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_version_lines" ADD CONSTRAINT "plan_version_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_version_lines" ADD CONSTRAINT "plan_version_lines_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_version_lines" ADD CONSTRAINT "plan_version_lines_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_version_lines" ADD CONSTRAINT "plan_version_lines_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_change_requests_budget" ON "budget_change_requests" USING btree ("tenant_id","budget_id");--> statement-breakpoint
CREATE INDEX "budget_change_requests_source" ON "budget_change_requests" USING btree ("tenant_id","source_budget_id","status");--> statement-breakpoint
CREATE INDEX "budget_limits_budget" ON "budget_limits" USING btree ("tenant_id","budget_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_version_lines_no" ON "plan_version_lines" USING btree ("tenant_id","plan_version_id","line_no");--> statement-breakpoint
CREATE INDEX "plan_version_lines_budget" ON "plan_version_lines" USING btree ("tenant_id","budget_id");--> statement-breakpoint
ALTER TABLE "budget_change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "budget_change_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "budget_change_requests" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "budget_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "budget_limits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "budget_limits" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "plan_version_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "plan_version_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "plan_version_lines" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
