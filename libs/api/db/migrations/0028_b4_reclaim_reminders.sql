CREATE TABLE "reclaim_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"notice_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"as_of" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT app_now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reclaim_reminders" ADD CONSTRAINT "reclaim_reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclaim_reminders" ADD CONSTRAINT "reclaim_reminders_notice_id_reclaim_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."reclaim_notices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reclaim_reminders_once" ON "reclaim_reminders" USING btree ("tenant_id","notice_id","kind");--> statement-breakpoint
-- Hand-written (gap B4 follow-ups): tenant isolation for reminders.
ALTER TABLE "reclaim_reminders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reclaim_reminders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "reclaim_reminders" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
