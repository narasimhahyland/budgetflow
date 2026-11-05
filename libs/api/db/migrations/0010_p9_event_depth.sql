CREATE TABLE "event_agenda_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"start_time" varchar(20) NOT NULL,
	"end_time" varchar(20),
	"title" text NOT NULL,
	"location_room" text,
	"host_name" text,
	"notes" text,
	"visible_to_invitees" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"section" varchar(20) DEFAULT 'before' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"assignee_person_id" uuid,
	"due_date" date,
	"reminder" varchar(30),
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"linked_item_type" varchar(30),
	"linked_item_id" uuid,
	"linked_label" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"comments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_gallery_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"document_id" uuid,
	"caption" text NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_by_person_id" uuid,
	"status" varchar(20) DEFAULT 'visible' NOT NULL,
	"removal_reason" text,
	"removal_requested_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"deadline" timestamp with time zone,
	"capacity" integer,
	"waitlist_enabled" boolean DEFAULT true NOT NULL,
	"auto_promote_waitlist" boolean DEFAULT true NOT NULL,
	"attach_calendar_invite" boolean DEFAULT true NOT NULL,
	"collect_travel_needs" boolean DEFAULT false NOT NULL,
	"reminder_schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'not_sent' NOT NULL,
	"sent_by_person_id" uuid,
	"sent_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"reminders_sent_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_quote_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" varchar(50) DEFAULT 'catering' NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"needed_by" date,
	"respond_by" date,
	"include_dietary_counts" boolean DEFAULT false NOT NULL,
	"emailed" boolean DEFAULT true NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"quote_request_id" uuid NOT NULL,
	"vendor_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'received' NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"budget_amount_minor" bigint DEFAULT 0 NOT NULL,
	"budget_currency" char(3) DEFAULT 'USD' NOT NULL,
	"per_head_minor" bigint DEFAULT 0 NOT NULL,
	"deposit_pct" integer DEFAULT 0 NOT NULL,
	"deposit_minor" bigint DEFAULT 0 NOT NULL,
	"deposit_refundable" boolean DEFAULT true NOT NULL,
	"deposit_terms" text,
	"cancellation_terms" text,
	"valid_until" date,
	"includes_text" text,
	"document_id" uuid,
	"commitment_id" uuid,
	"selection_reason" text,
	"selected_by_person_id" uuid,
	"selected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"template_id" uuid,
	"organizer_person_id" uuid NOT NULL,
	"frequency" varchar(20) NOT NULL,
	"first_date" date NOT NULL,
	"end_count" integer,
	"end_date" date,
	"custom_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_survey_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"respondent_token_hash" varchar(64) NOT NULL,
	"location_org_unit_id" uuid,
	"location_name" text,
	"rating" integer NOT NULL,
	"would_attend_again" boolean NOT NULL,
	"comment" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"comment_hidden" boolean DEFAULT false NOT NULL,
	"comment_hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_surveys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"anonymous" boolean DEFAULT true NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope" varchar(20) DEFAULT 'personal' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"owner_person_id" uuid,
	"name" text NOT NULL,
	"category" varchar(50) DEFAULT 'employee_events' NOT NULL,
	"event_type" varchar(50) DEFAULT 'celebration' NOT NULL,
	"typical_duration" varchar(100) DEFAULT 'Half day' NOT NULL,
	"location_type" varchar(30) DEFAULT 'office' NOT NULL,
	"estimate_per_attendee_minor" bigint DEFAULT 0 NOT NULL,
	"use_location_limit" boolean DEFAULT false NOT NULL,
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"tolerance_bps" integer DEFAULT 500 NOT NULL,
	"cost_split_rule" varchar(30) DEFAULT 'location' NOT NULL,
	"checklist_tasks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agenda_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invitation_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"needs_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"survey_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferred_vendor_ids" uuid[] DEFAULT '{}' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_participants" ADD COLUMN "rsvp_responded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_participants" ADD COLUMN "waitlist_position" integer;--> statement-breakpoint
ALTER TABLE "event_participants" ADD COLUMN "reminders_sent_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_participants" ADD COLUMN "needs_submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_participants" ADD COLUMN "needs_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "attendance_final" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "attendance_final_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "split_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "split_applied_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "split_keep_reason" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "organizer_notes" text;--> statement-breakpoint
ALTER TABLE "event_agenda_items" ADD CONSTRAINT "event_agenda_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_agenda_items" ADD CONSTRAINT "event_agenda_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_checklists" ADD CONSTRAINT "event_checklists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_checklists" ADD CONSTRAINT "event_checklists_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_checklists" ADD CONSTRAINT "event_checklists_assignee_person_id_people_id_fk" FOREIGN KEY ("assignee_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_gallery_photos" ADD CONSTRAINT "event_gallery_photos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_gallery_photos" ADD CONSTRAINT "event_gallery_photos_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_gallery_photos" ADD CONSTRAINT "event_gallery_photos_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_gallery_photos" ADD CONSTRAINT "event_gallery_photos_uploaded_by_person_id_people_id_fk" FOREIGN KEY ("uploaded_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_gallery_photos" ADD CONSTRAINT "event_gallery_photos_removal_requested_by_person_id_people_id_fk" FOREIGN KEY ("removal_requested_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invitations" ADD CONSTRAINT "event_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invitations" ADD CONSTRAINT "event_invitations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_invitations" ADD CONSTRAINT "event_invitations_sent_by_person_id_people_id_fk" FOREIGN KEY ("sent_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_quote_requests" ADD CONSTRAINT "event_quote_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_quote_requests" ADD CONSTRAINT "event_quote_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_quote_requests" ADD CONSTRAINT "event_quote_requests_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_quotes" ADD CONSTRAINT "event_quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_quotes" ADD CONSTRAINT "event_quotes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_quotes" ADD CONSTRAINT "event_quotes_quote_request_id_event_quote_requests_id_fk" FOREIGN KEY ("quote_request_id") REFERENCES "public"."event_quote_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_quotes" ADD CONSTRAINT "event_quotes_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_quotes" ADD CONSTRAINT "event_quotes_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_quotes" ADD CONSTRAINT "event_quotes_budget_currency_currencies_code_fk" FOREIGN KEY ("budget_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_quotes" ADD CONSTRAINT "event_quotes_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_quotes" ADD CONSTRAINT "event_quotes_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_quotes" ADD CONSTRAINT "event_quotes_selected_by_person_id_people_id_fk" FOREIGN KEY ("selected_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_template_id_event_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."event_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_organizer_person_id_people_id_fk" FOREIGN KEY ("organizer_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_survey_responses" ADD CONSTRAINT "event_survey_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_survey_responses" ADD CONSTRAINT "event_survey_responses_survey_id_event_surveys_id_fk" FOREIGN KEY ("survey_id") REFERENCES "public"."event_surveys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_survey_responses" ADD CONSTRAINT "event_survey_responses_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_surveys" ADD CONSTRAINT "event_surveys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_surveys" ADD CONSTRAINT "event_surveys_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_templates" ADD CONSTRAINT "event_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_templates" ADD CONSTRAINT "event_templates_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_templates" ADD CONSTRAINT "event_templates_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_agenda_items_event" ON "event_agenda_items" USING btree ("tenant_id","event_id","sort_order");--> statement-breakpoint
CREATE INDEX "event_checklists_event" ON "event_checklists" USING btree ("tenant_id","event_id","section","sort_order");--> statement-breakpoint
CREATE INDEX "event_gallery_photos_event" ON "event_gallery_photos" USING btree ("tenant_id","event_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "event_invitations_event" ON "event_invitations" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE INDEX "event_quote_requests_event" ON "event_quote_requests" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE INDEX "event_quotes_event" ON "event_quotes" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE INDEX "event_quotes_request" ON "event_quotes" USING btree ("tenant_id","quote_request_id");--> statement-breakpoint
CREATE INDEX "event_series_tenant" ON "event_series" USING btree ("tenant_id","organizer_person_id");--> statement-breakpoint
CREATE INDEX "event_survey_responses_survey" ON "event_survey_responses" USING btree ("tenant_id","survey_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_survey_responses_token" ON "event_survey_responses" USING btree ("tenant_id","survey_id","respondent_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "event_surveys_event" ON "event_surveys" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE INDEX "event_templates_tenant_scope" ON "event_templates" USING btree ("tenant_id","scope","status");--> statement-breakpoint
CREATE INDEX "event_templates_owner" ON "event_templates" USING btree ("tenant_id","owner_person_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_split_applied_by_person_id_people_id_fk" FOREIGN KEY ("split_applied_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-written (reviewed): tenant isolation for the Phase 9 tables.
ALTER TABLE "event_agenda_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_agenda_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_agenda_items" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "event_checklists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_checklists" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_checklists" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "event_gallery_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_gallery_photos" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_gallery_photos" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "event_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_invitations" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "event_quote_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_quote_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_quote_requests" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "event_quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_quotes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_quotes" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "event_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_series" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_series" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "event_survey_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_survey_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_survey_responses" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "event_surveys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_surveys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_surveys" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "event_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_templates" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
