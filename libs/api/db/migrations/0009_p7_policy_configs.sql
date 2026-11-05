CREATE TABLE "policy_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"section" varchar(50) NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy_configs" ADD CONSTRAINT "policy_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_configs" ADD CONSTRAINT "policy_configs_updated_by_people_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_configs_tenant_section" ON "policy_configs" USING btree ("tenant_id","section");--> statement-breakpoint
-- Hand-written (reviewed): tenant isolation for the policy configuration sections.
ALTER TABLE "policy_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "policy_configs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "policy_configs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());