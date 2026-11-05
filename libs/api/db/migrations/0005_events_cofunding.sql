CREATE SEQUENCE "public"."contribution_ref_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE SEQUENCE "public"."request_ref_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "approval_action_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"approver_person_id" uuid NOT NULL,
	"action" varchar(20) NOT NULL,
	"subject_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_cost_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"category" varchar(50) NOT NULL,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_minor" bigint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_funding_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"budget_id" uuid NOT NULL,
	"origin_budget_id" uuid NOT NULL,
	"request_id" uuid,
	"contribution_request_id" uuid,
	"mode" "contribution_mode" DEFAULT 'earmark' NOT NULL,
	"seq" integer NOT NULL,
	"funded_minor" bigint NOT NULL,
	"consumed_minor" bigint DEFAULT 0 NOT NULL,
	"returned_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_type" varchar(30) NOT NULL,
	"owner_id" uuid NOT NULL,
	"kind" varchar(30) DEFAULT 'supporting' NOT NULL,
	"file_name" text NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"storage_key" text NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"uploaded_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recharge_schedules" ADD COLUMN "markup_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "recharge_schedules" ADD COLUMN "tax_approver_person_id" uuid;--> statement-breakpoint
ALTER TABLE "recharge_schedules" ADD COLUMN "tax_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD COLUMN "funding_source_id" uuid;--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD COLUMN "budget_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD COLUMN "budget_currency" char(3);--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD COLUMN "rate_type" "rate_type";--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD COLUMN "budget_rate" numeric(24, 12);--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD COLUMN "budget_rate_ids" uuid[];--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD COLUMN "reporting_currency" char(3);--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD COLUMN "reporting_rate" numeric(24, 12);--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD COLUMN "reporting_rate_ids" uuid[];--> statement-breakpoint
ALTER TABLE "commitments" ADD COLUMN "created_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD COLUMN "ref" varchar(20) DEFAULT 'IDC-' || lpad(nextval('contribution_ref_seq')::text, 5, '0') NOT NULL;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD COLUMN "needed_by" date;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD COLUMN "reason_code" varchar(50);--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD COLUMN "message" text;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD COLUMN "funding_source_id" uuid;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD COLUMN "recharge_schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD COLUMN "hold_reason" text;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "venue" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "spend_type" varchar(50) DEFAULT 'employee_events' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "own_funds_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "per_head_limit_minor" bigint;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "ref" varchar(20) DEFAULT 'REQ-' || lpad(nextval('request_ref_seq')::text, 5, '0') NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "category" varchar(50);--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "needed_by" date;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "budget_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "budget_currency" char(3);--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "commitment_id" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "over_budget" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "reason_code" varchar(50);--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "hold_reason" text;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD COLUMN "reason_code" varchar(50);--> statement-breakpoint
ALTER TABLE "approval_actions" ADD COLUMN "no_conflict_attested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_instances" ADD COLUMN "subject_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_instances" ADD COLUMN "current_step" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD COLUMN "doa_limit_minor" bigint;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD COLUMN "doa_currency" char(3);--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_action_tokens" ADD CONSTRAINT "approval_action_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_action_tokens" ADD CONSTRAINT "approval_action_tokens_task_id_approval_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."approval_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_action_tokens" ADD CONSTRAINT "approval_action_tokens_approver_person_id_people_id_fk" FOREIGN KEY ("approver_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_cost_lines" ADD CONSTRAINT "event_cost_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_cost_lines" ADD CONSTRAINT "event_cost_lines_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_cost_lines" ADD CONSTRAINT "event_cost_lines_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_funding_sources" ADD CONSTRAINT "event_funding_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_funding_sources" ADD CONSTRAINT "event_funding_sources_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_funding_sources" ADD CONSTRAINT "event_funding_sources_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_funding_sources" ADD CONSTRAINT "event_funding_sources_origin_budget_id_budgets_id_fk" FOREIGN KEY ("origin_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_funding_sources" ADD CONSTRAINT "event_funding_sources_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_funding_sources" ADD CONSTRAINT "event_funding_sources_contribution_request_id_contribution_requests_id_fk" FOREIGN KEY ("contribution_request_id") REFERENCES "public"."contribution_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_funding_sources" ADD CONSTRAINT "event_funding_sources_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_person_id_people_id_fk" FOREIGN KEY ("uploaded_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_action_tokens_task" ON "approval_action_tokens" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_cost_lines_line" ON "event_cost_lines" USING btree ("tenant_id","event_id","line_no");--> statement-breakpoint
CREATE INDEX "event_funding_sources_event" ON "event_funding_sources" USING btree ("tenant_id","event_id","seq");--> statement-breakpoint
CREATE INDEX "event_funding_sources_budget" ON "event_funding_sources" USING btree ("tenant_id","budget_id");--> statement-breakpoint
CREATE INDEX "documents_owner" ON "documents" USING btree ("tenant_id","owner_type","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_storage_key" ON "documents" USING btree ("storage_key");--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD CONSTRAINT "commitment_funding_lines_budget_currency_currencies_code_fk" FOREIGN KEY ("budget_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD CONSTRAINT "commitment_funding_lines_reporting_currency_currencies_code_fk" FOREIGN KEY ("reporting_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_budget_currency_currencies_code_fk" FOREIGN KEY ("budget_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_doa_currency_currencies_code_fk" FOREIGN KEY ("doa_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recharge_schedules_event" ON "recharge_schedules" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE INDEX "commitment_funding_lines_source" ON "commitment_funding_lines" USING btree ("tenant_id","funding_source_id");--> statement-breakpoint
CREATE INDEX "commitments_tenant_event" ON "commitments" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE INDEX "contribution_requests_event" ON "contribution_requests" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_requests_tenant_ref" ON "contribution_requests" USING btree ("tenant_id","ref");--> statement-breakpoint
CREATE UNIQUE INDEX "event_participants_person" ON "event_participants" USING btree ("tenant_id","event_id","person_id") WHERE "event_participants"."person_id" is not null;--> statement-breakpoint
CREATE INDEX "events_tenant_organizer" ON "events" USING btree ("tenant_id","organizer_person_id");--> statement-breakpoint
CREATE INDEX "requests_tenant_requester" ON "requests" USING btree ("tenant_id","requester_person_id","created_at");--> statement-breakpoint
CREATE INDEX "requests_tenant_event" ON "requests" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requests_tenant_ref" ON "requests" USING btree ("tenant_id","ref");--> statement-breakpoint
CREATE INDEX "approval_tasks_instance" ON "approval_tasks" USING btree ("tenant_id","instance_id","step_no");--> statement-breakpoint
-- Hand-written (reviewed): tenant isolation for the Phase 5 tables.
ALTER TABLE "event_funding_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_funding_sources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_funding_sources" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "event_cost_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_cost_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "event_cost_lines" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "approval_action_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approval_action_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "approval_action_tokens" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "documents" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "event_funding_sources" ADD CONSTRAINT "event_funding_sources_amounts" CHECK ("funded_minor" > 0 AND "consumed_minor" >= 0 AND "returned_minor" >= 0 AND "consumed_minor" + "returned_minor" <= "funded_minor");
