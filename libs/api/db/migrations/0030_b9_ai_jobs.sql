CREATE TABLE "ai_reported_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reported_at" timestamp with time zone DEFAULT app_now() NOT NULL,
	"reporter_person_id" uuid,
	"reporter_subject" text NOT NULL,
	"turn_id" uuid NOT NULL,
	"query_log_id" uuid,
	"feature" text NOT NULL,
	"channel" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"includes_text" boolean NOT NULL,
	"question" text,
	"answer" text,
	"text_expires_at" timestamp with time zone NOT NULL,
	"text_removed_at" timestamp with time zone,
	"status" text DEFAULT 'new' NOT NULL,
	"review_note" text,
	"reviewed_by_person_id" uuid,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ai_scan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"run_date" date NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"skip_reason" text,
	"budget_ids" uuid[],
	"evaluated_count" integer DEFAULT 0 NOT NULL,
	"result_count" integer DEFAULT 0 NOT NULL,
	"model_calls" integer DEFAULT 0 NOT NULL,
	"failed_model_calls" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"requested_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT app_now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_reported_answers" ADD CONSTRAINT "ai_reported_answers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reported_answers" ADD CONSTRAINT "ai_reported_answers_reporter_person_id_people_id_fk" FOREIGN KEY ("reporter_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_reported_answers" ADD CONSTRAINT "ai_reported_answers_reviewed_by_person_id_people_id_fk" FOREIGN KEY ("reviewed_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_scan_runs" ADD CONSTRAINT "ai_scan_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_scan_runs" ADD CONSTRAINT "ai_scan_runs_requested_by_person_id_people_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_reported_answers_turn" ON "ai_reported_answers" USING btree ("tenant_id","turn_id");--> statement-breakpoint
CREATE INDEX "ai_reported_answers_status" ON "ai_reported_answers" USING btree ("tenant_id","status","reported_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_scan_runs_nightly" ON "ai_scan_runs" USING btree ("tenant_id","feature","run_date") WHERE "ai_scan_runs"."trigger" = 'nightly';--> statement-breakpoint
CREATE INDEX "ai_scan_runs_tenant" ON "ai_scan_runs" USING btree ("tenant_id","feature","run_date","created_at");--> statement-breakpoint
-- Hand-written (gap B9): tenant isolation for the AI scan runs and reported answers.
ALTER TABLE "ai_scan_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_scan_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_scan_runs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "ai_reported_answers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_reported_answers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_reported_answers" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
