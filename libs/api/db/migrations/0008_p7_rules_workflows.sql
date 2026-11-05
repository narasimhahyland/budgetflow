CREATE TABLE "post_spend_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" varchar(40) NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"source_kind" varchar(20) NOT NULL,
	"source_ref" varchar(60) NOT NULL,
	"source_id" uuid,
	"budget_id" uuid NOT NULL,
	"location" varchar(100) NOT NULL,
	"person_id" uuid,
	"person_name" text NOT NULL,
	"transaction_amount_minor" bigint NOT NULL,
	"transaction_currency" char(3) NOT NULL,
	"reporting_amount_minor" bigint NOT NULL,
	"reporting_currency" char(3) NOT NULL,
	"rule_code" varchar(30) NOT NULL,
	"rule_version" integer DEFAULT 1 NOT NULL,
	"summary" text NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"related_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"owner_explanation" text,
	"resolution" varchar(40),
	"resolution_reason_code" varchar(50),
	"resolution_reason" text,
	"repayment_minor" bigint,
	"reclassified_to_gl_code" varchar(30),
	"reversal_journal_id" uuid,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_type" varchar(30) NOT NULL,
	"subject_id" uuid,
	"rule_id" uuid,
	"effect" varchar(30) NOT NULL,
	"matched_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"evaluated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"effect" varchar(30) DEFAULT 'require_approval' NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" text NOT NULL,
	"family" varchar(50) DEFAULT 'general' NOT NULL,
	"template_code" varchar(50),
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"active_version" integer,
	"draft_version" integer,
	"retired_reason" text,
	"retired_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_kind" varchar(50) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "counter_offer_minor" bigint;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "counter_offer_currency" char(3);--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "counter_offered_by" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "counter_offered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "counter_offer_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD COLUMN "revoked_by" uuid;--> statement-breakpoint
ALTER TABLE "post_spend_exceptions" ADD CONSTRAINT "post_spend_exceptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_spend_exceptions" ADD CONSTRAINT "post_spend_exceptions_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_spend_exceptions" ADD CONSTRAINT "post_spend_exceptions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_spend_exceptions" ADD CONSTRAINT "post_spend_exceptions_transaction_currency_currencies_code_fk" FOREIGN KEY ("transaction_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_spend_exceptions" ADD CONSTRAINT "post_spend_exceptions_reporting_currency_currencies_code_fk" FOREIGN KEY ("reporting_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_spend_exceptions" ADD CONSTRAINT "post_spend_exceptions_resolved_by_people_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_executions" ADD CONSTRAINT "rule_executions_evaluated_by_people_id_fk" FOREIGN KEY ("evaluated_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_published_by_people_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_published_by_people_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_spend_exceptions_status" ON "post_spend_exceptions" USING btree ("tenant_id","status","type");--> statement-breakpoint
CREATE INDEX "post_spend_exceptions_budget" ON "post_spend_exceptions" USING btree ("tenant_id","budget_id");--> statement-breakpoint
CREATE INDEX "rule_executions_subject" ON "rule_executions" USING btree ("tenant_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "rule_executions_rule" ON "rule_executions" USING btree ("tenant_id","rule_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_versions_unique" ON "rule_versions" USING btree ("tenant_id","rule_id","version");--> statement-breakpoint
CREATE INDEX "rule_versions_rule_status" ON "rule_versions" USING btree ("tenant_id","rule_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "rules_tenant_code" ON "rules" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "rules_tenant_status" ON "rules" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_kind_version" ON "workflow_templates" USING btree ("tenant_id","request_kind","version");--> statement-breakpoint
CREATE INDEX "workflow_templates_lookup" ON "workflow_templates" USING btree ("tenant_id","request_kind","status");--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_counter_offer_currency_currencies_code_fk" FOREIGN KEY ("counter_offer_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_counter_offered_by_people_id_fk" FOREIGN KEY ("counter_offered_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_revoked_by_people_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-written (reviewed): tenant isolation for Phase 7 tables.
ALTER TABLE "rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "rules" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "rule_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rule_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "rule_versions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "rule_executions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rule_executions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "rule_executions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "workflow_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflow_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "workflow_templates" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "post_spend_exceptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "post_spend_exceptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "post_spend_exceptions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
