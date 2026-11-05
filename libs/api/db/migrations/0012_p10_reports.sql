CREATE TABLE "report_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_id" varchar(40) NOT NULL,
	"format" varchar(10) NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"document_id" uuid,
	"size_bytes" bigint,
	"schedule_id" uuid,
	"requested_by_person_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE TABLE "report_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_id" varchar(40) NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"favourite" boolean DEFAULT false NOT NULL,
	"owner_person_id" uuid,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "report_schedule_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trigger" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"status" varchar(20) DEFAULT 'delivered' NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"channel_count" integer DEFAULT 0 NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"export_ids" uuid[] DEFAULT '{}' NOT NULL,
	"error" text
);--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"report_id" varchar(40) NOT NULL,
	"saved_view_id" uuid,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"formats" text[] DEFAULT '{"pdf"}' NOT NULL,
	"frequency" varchar(30) DEFAULT 'weekly' NOT NULL,
	"weekday" integer,
	"day_of_month" integer,
	"send_time" varchar(5) DEFAULT '08:00' NOT NULL,
	"timezone" varchar(60) DEFAULT 'UTC' NOT NULL,
	"recipient_person_ids" uuid[] DEFAULT '{}' NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message" text,
	"owner_person_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"paused_reason" text,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"last_run_status" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_requested_by_person_id_people_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_saved_views" ADD CONSTRAINT "report_saved_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_saved_views" ADD CONSTRAINT "report_saved_views_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedule_runs" ADD CONSTRAINT "report_schedule_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedule_runs" ADD CONSTRAINT "report_schedule_runs_schedule_id_report_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_saved_view_id_report_saved_views_id_fk" FOREIGN KEY ("saved_view_id") REFERENCES "public"."report_saved_views"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_exports_tenant_requested" ON "report_exports" USING btree ("tenant_id","requested_at");--> statement-breakpoint
CREATE INDEX "report_saved_views_owner" ON "report_saved_views" USING btree ("tenant_id","owner_person_id","report_id");--> statement-breakpoint
CREATE INDEX "report_schedule_runs_schedule" ON "report_schedule_runs" USING btree ("tenant_id","schedule_id","run_at");--> statement-breakpoint
CREATE INDEX "report_schedules_owner" ON "report_schedules" USING btree ("tenant_id","owner_person_id");--> statement-breakpoint
CREATE INDEX "report_schedules_due" ON "report_schedules" USING btree ("tenant_id","active","next_run_at");--> statement-breakpoint
-- Hand-written (reviewed): tenant isolation for the Phase 10 reporting tables.
ALTER TABLE "report_exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_exports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "report_exports" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "report_saved_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_saved_views" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "report_saved_views" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "report_schedule_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_schedule_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "report_schedule_runs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "report_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "report_schedules" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
