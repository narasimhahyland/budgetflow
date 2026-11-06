CREATE TABLE "ai_conversation_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"actor_subject" text NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"outcome" text NOT NULL,
	"query_log_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid,
	"actor_subject" text NOT NULL,
	"title" text NOT NULL,
	"channel" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_asked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"fixture_set" text NOT NULL,
	"metric" text NOT NULL,
	"kind" text,
	"threshold_bps" integer NOT NULL,
	"result_bps" integer NOT NULL,
	"passed" boolean NOT NULL,
	"cases" integer DEFAULT 0 NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"model_version" text NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_outlook_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"currency" char(3) NOT NULL,
	"authorized_minor" bigint NOT NULL,
	"to_date_minor" bigint NOT NULL,
	"likely_minor" bigint,
	"low_minor" bigint,
	"high_minor" bigint,
	"gap_minor" bigint,
	"category" text NOT NULL,
	"confidence" text,
	"drivers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_id" text NOT NULL,
	"model_version" text NOT NULL,
	"suggestion_id" uuid,
	"nudge_sent_at" timestamp with time zone,
	"snoozed_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_query_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"feature" text NOT NULL,
	"channel" text NOT NULL,
	"actor_person_id" uuid,
	"actor_subject" text,
	"outcome" text NOT NULL,
	"scope_action" text NOT NULL,
	"scope_kind" text NOT NULL,
	"considered_count" integer DEFAULT 0 NOT NULL,
	"permitted_count" integer DEFAULT 0 NOT NULL,
	"fact_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sent_fields" text[] DEFAULT '{}' NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"model_version" text NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"suggestion_id" uuid,
	"applied_resource_type" text,
	"applied_resource_id" uuid,
	"audit_event_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"budget_id" uuid,
	"confidence" text NOT NULL,
	"score_bps" integer DEFAULT 0 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"model_version" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by_person_id" uuid,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason_code" text,
	"decision_reason" text,
	"applied_resource_type" text,
	"applied_resource_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversation_turns" ADD CONSTRAINT "ai_conversation_turns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_turns" ADD CONSTRAINT "ai_conversation_turns_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_evaluation_runs" ADD CONSTRAINT "ai_evaluation_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_outlook_snapshots" ADD CONSTRAINT "ai_outlook_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_outlook_snapshots" ADD CONSTRAINT "ai_outlook_snapshots_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_outlook_snapshots" ADD CONSTRAINT "ai_outlook_snapshots_suggestion_id_ai_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."ai_suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_query_log" ADD CONSTRAINT "ai_query_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_query_log" ADD CONSTRAINT "ai_query_log_actor_person_id_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_decided_by_person_id_people_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversation_turns_conversation" ON "ai_conversation_turns" USING btree ("tenant_id","conversation_id","asked_at");--> statement-breakpoint
CREATE INDEX "ai_conversations_person" ON "ai_conversations" USING btree ("tenant_id","actor_subject","last_asked_at");--> statement-breakpoint
CREATE INDEX "ai_evaluation_runs_feature" ON "ai_evaluation_runs" USING btree ("tenant_id","feature","metric","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_outlook_budget_as_of" ON "ai_outlook_snapshots" USING btree ("tenant_id","budget_id","as_of_date");--> statement-breakpoint
CREATE INDEX "ai_outlook_category" ON "ai_outlook_snapshots" USING btree ("tenant_id","category");--> statement-breakpoint
CREATE INDEX "ai_query_log_tenant_time" ON "ai_query_log" USING btree ("tenant_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "ai_query_log_feature" ON "ai_query_log" USING btree ("tenant_id","feature","outcome");--> statement-breakpoint
CREATE INDEX "ai_query_log_suggestion" ON "ai_query_log" USING btree ("tenant_id","suggestion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_suggestions_subject" ON "ai_suggestions" USING btree ("tenant_id","feature","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "ai_suggestions_status" ON "ai_suggestions" USING btree ("tenant_id","feature","status");--> statement-breakpoint
CREATE INDEX "ai_suggestions_budget" ON "ai_suggestions" USING btree ("tenant_id","budget_id");--> statement-breakpoint
-- Hand-written (reviewed): tenant isolation on every new table, forced for the table owner too.
ALTER TABLE "ai_conversation_turns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_conversation_turns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_conversation_turns" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_conversations" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "ai_evaluation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_evaluation_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_evaluation_runs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "ai_outlook_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_outlook_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_outlook_snapshots" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "ai_query_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_query_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_query_log" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "ai_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_suggestions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_suggestions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
-- Hand-written (reviewed): the AI query log is the audit trail of every AI-influenced decision, so it is append-only.
REVOKE UPDATE, DELETE, TRUNCATE ON ai_query_log FROM bf_app, bf_worker;--> statement-breakpoint
CREATE TRIGGER ai_query_log_append_only BEFORE UPDATE OR DELETE ON ai_query_log FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();--> statement-breakpoint
CREATE TRIGGER ai_query_log_no_truncate BEFORE TRUNCATE ON ai_query_log FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();
