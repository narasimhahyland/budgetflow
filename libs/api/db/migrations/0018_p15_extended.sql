CREATE TABLE "leadership_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"period_state" varchar(10) NOT NULL,
	"snapshot_taken_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'ai_draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author_person_id" uuid,
	"approved_by_person_id" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"query_log_id" uuid,
	"suggestion_id" uuid,
	"model_id" varchar(80),
	"model_version" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizer_thank_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"organizer_person_id" uuid NOT NULL,
	"author_person_id" uuid NOT NULL,
	"event_id" uuid,
	"note" text NOT NULL,
	"visibility" varchar(20) DEFAULT 'public' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recognition_allowances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"manager_person_id" uuid NOT NULL,
	"funding_budget_id" uuid NOT NULL,
	"period_key" varchar(20) NOT NULL,
	"granted_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"granted_by_person_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recognition_award_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"name" text NOT NULL,
	"location_org_unit_id" uuid,
	"amount_minor" bigint,
	"currency" char(3),
	"needs_approval" boolean DEFAULT false NOT NULL,
	"funding_budget_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recognition_awards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"award_type_id" uuid,
	"kind" varchar(20) NOT NULL,
	"giver_person_id" uuid NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"message" text NOT NULL,
	"value_tag" varchar(30),
	"visibility" varchar(20) DEFAULT 'private' NOT NULL,
	"amount_minor" bigint,
	"currency" char(3),
	"funding_budget_id" uuid,
	"commitment_id" uuid,
	"legal_entity_id" uuid,
	"status" varchar(20) DEFAULT 'awarded' NOT NULL,
	"journal_ids" uuid[] DEFAULT '{}' NOT NULL,
	"approver_person_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"reward_choice" varchar(30),
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"budget_id" uuid NOT NULL,
	"amount_minor" bigint,
	"percent_bps" integer,
	"currency" char(3),
	"destination" varchar(20),
	"destination_budget_id" uuid,
	"cascade" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"promotion_status" varchar(20),
	"applied_at" timestamp with time zone,
	"journal_id" uuid,
	"audit_event_id" uuid,
	"problem_code" varchar(60),
	"problem_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenario_collaborators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"baseline_at" timestamp with time zone DEFAULT now() NOT NULL,
	"baseline_journal_count" integer DEFAULT 0 NOT NULL,
	"created_by_person_id" uuid,
	"promoted_at" timestamp with time zone,
	"promotion_reason_code" varchar(40),
	"promotion_reason" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variance_commentaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"forecast_snapshot_id" uuid,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"text" text NOT NULL,
	"drivers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unexplained_minor" bigint,
	"currency" char(3),
	"drafted_with_ai" boolean DEFAULT false NOT NULL,
	"attested" boolean DEFAULT false NOT NULL,
	"author_person_id" uuid,
	"query_log_id" uuid,
	"suggestion_id" uuid,
	"model_id" varchar(80),
	"model_version" varchar(40),
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"commitment_id" uuid,
	"category" varchar(60) NOT NULL,
	"merchant" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"budget_amount_minor" bigint NOT NULL,
	"budget_currency" char(3) NOT NULL,
	"claim_date" date NOT NULL,
	"document_id" uuid,
	"note" text,
	"status" varchar(20) DEFAULT 'submitted' NOT NULL,
	"journal_ids" uuid[] DEFAULT '{}' NOT NULL,
	"reviewer_person_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"paid_via" varchar(20),
	"paid_at" timestamp with time zone,
	"taxable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" varchar(40) NOT NULL,
	"name" text NOT NULL,
	"kind" varchar(20) NOT NULL,
	"funding_budget_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"yearly_allowance_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"eligible_employment_types" text[] DEFAULT '{}' NOT NULL,
	"receipt_required" boolean DEFAULT true NOT NULL,
	"taxable" boolean DEFAULT false NOT NULL,
	"carry_unused" boolean DEFAULT false NOT NULL,
	"reviewer_person_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"program_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"allowance_minor" bigint NOT NULL,
	"prorated_allowance_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leadership_summaries" ADD CONSTRAINT "leadership_summaries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_summaries" ADD CONSTRAINT "leadership_summaries_period_id_fiscal_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_summaries" ADD CONSTRAINT "leadership_summaries_author_person_id_people_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leadership_summaries" ADD CONSTRAINT "leadership_summaries_approved_by_person_id_people_id_fk" FOREIGN KEY ("approved_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_thank_notes" ADD CONSTRAINT "organizer_thank_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_thank_notes" ADD CONSTRAINT "organizer_thank_notes_organizer_person_id_people_id_fk" FOREIGN KEY ("organizer_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_thank_notes" ADD CONSTRAINT "organizer_thank_notes_author_person_id_people_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizer_thank_notes" ADD CONSTRAINT "organizer_thank_notes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_allowances" ADD CONSTRAINT "recognition_allowances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_allowances" ADD CONSTRAINT "recognition_allowances_manager_person_id_people_id_fk" FOREIGN KEY ("manager_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_allowances" ADD CONSTRAINT "recognition_allowances_funding_budget_id_budgets_id_fk" FOREIGN KEY ("funding_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_allowances" ADD CONSTRAINT "recognition_allowances_granted_by_person_id_people_id_fk" FOREIGN KEY ("granted_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_award_types" ADD CONSTRAINT "recognition_award_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_award_types" ADD CONSTRAINT "recognition_award_types_location_org_unit_id_org_units_id_fk" FOREIGN KEY ("location_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_award_types" ADD CONSTRAINT "recognition_award_types_funding_budget_id_budgets_id_fk" FOREIGN KEY ("funding_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_awards" ADD CONSTRAINT "recognition_awards_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_awards" ADD CONSTRAINT "recognition_awards_award_type_id_recognition_award_types_id_fk" FOREIGN KEY ("award_type_id") REFERENCES "public"."recognition_award_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_awards" ADD CONSTRAINT "recognition_awards_giver_person_id_people_id_fk" FOREIGN KEY ("giver_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_awards" ADD CONSTRAINT "recognition_awards_recipient_person_id_people_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_awards" ADD CONSTRAINT "recognition_awards_funding_budget_id_budgets_id_fk" FOREIGN KEY ("funding_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_awards" ADD CONSTRAINT "recognition_awards_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_awards" ADD CONSTRAINT "recognition_awards_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recognition_awards" ADD CONSTRAINT "recognition_awards_approver_person_id_people_id_fk" FOREIGN KEY ("approver_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_changes" ADD CONSTRAINT "scenario_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_changes" ADD CONSTRAINT "scenario_changes_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_changes" ADD CONSTRAINT "scenario_changes_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_changes" ADD CONSTRAINT "scenario_changes_destination_budget_id_budgets_id_fk" FOREIGN KEY ("destination_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_collaborators" ADD CONSTRAINT "scenario_collaborators_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_collaborators" ADD CONSTRAINT "scenario_collaborators_scenario_id_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenario_collaborators" ADD CONSTRAINT "scenario_collaborators_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenarios" ADD CONSTRAINT "scenarios_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variance_commentaries" ADD CONSTRAINT "variance_commentaries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variance_commentaries" ADD CONSTRAINT "variance_commentaries_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variance_commentaries" ADD CONSTRAINT "variance_commentaries_author_person_id_people_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_claims" ADD CONSTRAINT "wallet_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_claims" ADD CONSTRAINT "wallet_claims_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_claims" ADD CONSTRAINT "wallet_claims_program_id_wallet_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."wallet_programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_claims" ADD CONSTRAINT "wallet_claims_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_claims" ADD CONSTRAINT "wallet_claims_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_claims" ADD CONSTRAINT "wallet_claims_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_claims" ADD CONSTRAINT "wallet_claims_reviewer_person_id_people_id_fk" FOREIGN KEY ("reviewer_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_programs" ADD CONSTRAINT "wallet_programs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_programs" ADD CONSTRAINT "wallet_programs_funding_budget_id_budgets_id_fk" FOREIGN KEY ("funding_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_programs" ADD CONSTRAINT "wallet_programs_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_programs" ADD CONSTRAINT "wallet_programs_reviewer_person_id_people_id_fk" FOREIGN KEY ("reviewer_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_program_id_wallet_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."wallet_programs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leadership_summaries_period" ON "leadership_summaries" USING btree ("tenant_id","period_id","version");--> statement-breakpoint
CREATE INDEX "leadership_summaries_status" ON "leadership_summaries" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "organizer_thank_notes_organizer" ON "organizer_thank_notes" USING btree ("tenant_id","organizer_person_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_allowances_manager_period" ON "recognition_allowances" USING btree ("tenant_id","manager_person_id","funding_budget_id","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "recognition_award_types_location_kind" ON "recognition_award_types" USING btree ("tenant_id","location_org_unit_id","kind","name");--> statement-breakpoint
CREATE INDEX "recognition_awards_recipient" ON "recognition_awards" USING btree ("tenant_id","recipient_person_id","created_at");--> statement-breakpoint
CREATE INDEX "recognition_awards_giver" ON "recognition_awards" USING btree ("tenant_id","giver_person_id","created_at");--> statement-breakpoint
CREATE INDEX "recognition_awards_status" ON "recognition_awards" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "scenario_changes_scenario" ON "scenario_changes" USING btree ("tenant_id","scenario_id","position","id");--> statement-breakpoint
CREATE UNIQUE INDEX "scenario_collaborators_person" ON "scenario_collaborators" USING btree ("tenant_id","scenario_id","person_id");--> statement-breakpoint
CREATE INDEX "scenarios_tenant_status" ON "scenarios" USING btree ("tenant_id","status","name");--> statement-breakpoint
CREATE INDEX "scenarios_tenant_author" ON "scenarios" USING btree ("tenant_id","created_by_person_id");--> statement-breakpoint
CREATE INDEX "variance_commentaries_budget" ON "variance_commentaries" USING btree ("tenant_id","budget_id","created_at");--> statement-breakpoint
CREATE INDEX "wallet_claims_wallet" ON "wallet_claims" USING btree ("tenant_id","wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "wallet_claims_status" ON "wallet_claims" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_programs_tenant_key" ON "wallet_programs" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_program_person_year" ON "wallets" USING btree ("tenant_id","program_id","person_id","fiscal_year_id");
--> statement-breakpoint
ALTER TABLE "leadership_summaries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "leadership_summaries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "leadership_summaries" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "organizer_thank_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "organizer_thank_notes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "organizer_thank_notes" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "recognition_allowances" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recognition_allowances" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "recognition_allowances" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "recognition_award_types" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recognition_award_types" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "recognition_award_types" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "recognition_awards" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recognition_awards" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "recognition_awards" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "scenario_changes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "scenario_changes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "scenario_changes" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "scenario_collaborators" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "scenario_collaborators" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "scenario_collaborators" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "scenarios" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "scenarios" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "scenarios" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "variance_commentaries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "variance_commentaries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "variance_commentaries" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "wallet_claims" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "wallet_claims" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "wallet_claims" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "wallet_programs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "wallet_programs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "wallet_programs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "wallets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "wallets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "wallets" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Hand-written (reviewed): a thank-you note is somebody's words about a colleague, so it can be
-- hidden but never silently rewritten or erased. Hiding sets `hidden`; the text stays as written.
REVOKE DELETE, TRUNCATE ON organizer_thank_notes FROM bf_app, bf_worker;
--> statement-breakpoint
CREATE TRIGGER organizer_thank_notes_no_delete BEFORE DELETE ON organizer_thank_notes FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER organizer_thank_notes_no_truncate BEFORE TRUNCATE ON organizer_thank_notes FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();
