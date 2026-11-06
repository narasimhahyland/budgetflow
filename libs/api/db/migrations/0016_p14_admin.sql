CREATE TABLE "admin_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" varchar(30) NOT NULL,
	"subject_key" varchar(160) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"requested_by_person_id" uuid,
	"requested_by_subject" varchar(255),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"needs_confirmation" boolean DEFAULT false NOT NULL,
	"confirmed_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope_kind" varchar(20) NOT NULL,
	"scope_ref_id" uuid,
	"scope_from" date,
	"scope_to" date,
	"reason" text NOT NULL,
	"placed_by_person_id" uuid,
	"confirmed_by_person_id" uuid,
	"confirmed_at" timestamp with time zone,
	"status" varchar(25) DEFAULT 'pending_confirmation' NOT NULL,
	"released_by_person_id" uuid,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"message" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"show_from" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"created_by_person_id" uuid,
	"cancelled_by_person_id" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" text NOT NULL,
	"proposed_role" varchar(40) NOT NULL,
	"org_unit_id" uuid,
	"status" varchar(20) DEFAULT 'invited' NOT NULL,
	"invited_by_person_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" varchar(60) NOT NULL,
	"period_days" integer,
	"action" varchar(20) NOT NULL,
	"minimum_days" integer,
	"locked" boolean DEFAULT false NOT NULL,
	"signoff_status" varchar(20) DEFAULT 'provisional' NOT NULL,
	"signoff_note" text,
	"updated_by_person_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retention_run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"category" varchar(60) NOT NULL,
	"action" varchar(20) NOT NULL,
	"cutoff_at" timestamp with time zone,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"applied_count" integer DEFAULT 0 NOT NULL,
	"skipped_hold_count" integer DEFAULT 0 NOT NULL,
	"hold_ids" uuid[] DEFAULT '{}' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "retention_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mode" varchar(10) NOT NULL,
	"trigger" varchar(10) DEFAULT 'manual' NOT NULL,
	"status" varchar(20) DEFAULT 'completed' NOT NULL,
	"categories" text[] NOT NULL,
	"dry_run_id" uuid,
	"scope_key" text NOT NULL,
	"requested_by_person_id" uuid,
	"confirmed_by_person_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feature_flags" ADD COLUMN "rollout_mode" varchar(20) DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD COLUMN "pilot_org_unit_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD COLUMN "pilot_role_ids" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD COLUMN "updated_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_change_requests" ADD CONSTRAINT "admin_change_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_change_requests" ADD CONSTRAINT "admin_change_requests_requested_by_person_id_people_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_change_requests" ADD CONSTRAINT "admin_change_requests_confirmed_by_person_id_people_id_fk" FOREIGN KEY ("confirmed_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_placed_by_person_id_people_id_fk" FOREIGN KEY ("placed_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_confirmed_by_person_id_people_id_fk" FOREIGN KEY ("confirmed_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_released_by_person_id_people_id_fk" FOREIGN KEY ("released_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_notices" ADD CONSTRAINT "maintenance_notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_notices" ADD CONSTRAINT "maintenance_notices_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_notices" ADD CONSTRAINT "maintenance_notices_cancelled_by_person_id_people_id_fk" FOREIGN KEY ("cancelled_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_invites" ADD CONSTRAINT "owner_invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_invites" ADD CONSTRAINT "owner_invites_invited_by_person_id_people_id_fk" FOREIGN KEY ("invited_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_updated_by_person_id_people_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_run_items" ADD CONSTRAINT "retention_run_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_run_items" ADD CONSTRAINT "retention_run_items_run_id_retention_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."retention_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_requested_by_person_id_people_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_runs" ADD CONSTRAINT "retention_runs_confirmed_by_person_id_people_id_fk" FOREIGN KEY ("confirmed_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_change_requests_subject" ON "admin_change_requests" USING btree ("tenant_id","kind","subject_key","created_at");--> statement-breakpoint
CREATE INDEX "admin_change_requests_status" ON "admin_change_requests" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "legal_holds_tenant_status" ON "legal_holds" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "legal_holds_scope" ON "legal_holds" USING btree ("tenant_id","scope_kind","scope_ref_id");--> statement-breakpoint
CREATE INDEX "maintenance_notices_window" ON "maintenance_notices" USING btree ("tenant_id","status","show_from");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_invites_tenant_email" ON "owner_invites" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "owner_invites_batch" ON "owner_invites" USING btree ("tenant_id","batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_policies_tenant_category" ON "retention_policies" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "retention_run_items_run_category" ON "retention_run_items" USING btree ("run_id","category");--> statement-breakpoint
CREATE INDEX "retention_runs_tenant_started" ON "retention_runs" USING btree ("tenant_id","started_at");--> statement-breakpoint
ALTER TABLE "admin_change_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "admin_change_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "admin_change_requests" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "legal_holds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "legal_holds" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "legal_holds" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "maintenance_notices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "maintenance_notices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "maintenance_notices" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "owner_invites" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "owner_invites" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "owner_invites" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "retention_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retention_policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "retention_policies" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "retention_run_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retention_run_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "retention_run_items" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "retention_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "retention_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "retention_runs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Hand-written (reviewed): a retention run report is evidence of an irreversible deletion, so it is
-- append-only. Each run and its per-category report are written once, inside the transaction that
-- did the work.
REVOKE UPDATE, DELETE, TRUNCATE ON retention_runs, retention_run_items FROM bf_app, bf_worker;
--> statement-breakpoint
CREATE TRIGGER retention_runs_append_only BEFORE UPDATE OR DELETE ON retention_runs FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER retention_runs_no_truncate BEFORE TRUNCATE ON retention_runs FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER retention_run_items_append_only BEFORE UPDATE OR DELETE ON retention_run_items FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER retention_run_items_no_truncate BEFORE TRUNCATE ON retention_run_items FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();
