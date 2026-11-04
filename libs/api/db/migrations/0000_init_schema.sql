CREATE TYPE "public"."accrual_status" AS ENUM('proposed', 'approved', 'posted', 'reversed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."actual_kind" AS ENUM('charge', 'refund', 'credit_note', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."actual_match_status" AS ENUM('unmatched', 'partially_matched', 'matched', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."actual_source" AS ENUM('file', 'card', 'expense', 'travel', 'erp', 'ap', 'manual');--> statement-breakpoint
CREATE TYPE "public"."allocation_driver" AS ENUM('fixed', 'per_head');--> statement-breakpoint
CREATE TYPE "public"."approval_channel" AS ENUM('web', 'email', 'slack', 'teams', 'mobile', 'api');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'partially_approved', 'rejected', 'changes_requested', 'escalated', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."budget_status" AS ENUM('draft', 'submitted', 'pending_approval', 'approved', 'active', 'partially_allocated', 'fully_allocated', 'frozen', 'reduced', 'set_to_zero', 'exhausted', 'expired', 'closed', 'revised', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."budget_type" AS ENUM('operating', 'event', 'shared_event', 'contingency');--> statement-breakpoint
CREATE TYPE "public"."calendar_type" AS ENUM('calendar_year', 'non_calendar', '4-4-5', '4-5-4', '5-4-4', '13-period');--> statement-breakpoint
CREATE TYPE "public"."commitment_status" AS ENUM('pre_encumbered', 'encumbered', 'partially_consumed', 'consumed', 'released', 'cancelled', 'expired', 'carried_forward');--> statement-breakpoint
CREATE TYPE "public"."contribution_mode" AS ENUM('earmark', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."contribution_status" AS ENUM('draft', 'submitted', 'pending_approval', 'changes_requested', 'approved_full', 'approved_partial', 'rejected', 'withdrawn', 'earmarked', 'transferred', 'settled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."control_mode" AS ENUM('hard', 'soft', 'track');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('employee', 'contractor', 'intern');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'submitted', 'approved', 'funded', 'in_progress', 'completed', 'reconciling', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."forecast_method" AS ENUM('run_rate', 'committed_pipeline', 'owner_input');--> statement-breakpoint
CREATE TYPE "public"."forecast_status" AS ENUM('draft', 'submitted', 'commentary_required', 'accepted', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."integrity_check_status" AS ENUM('queued', 'running', 'clean', 'drift_detected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."integrity_flag_kind" AS ENUM('split_request', 'duplicate', 'cross_source_duplicate', 'receipt_reuse', 'just_under_threshold', 'ledger_drift', 'journal_unbalanced', 'hierarchy_mismatch', 'plan_tie_mismatch', 'audit_chain_broken');--> statement-breakpoint
CREATE TYPE "public"."integrity_flag_status" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."intercompany_mode" AS ENUM('block', 'recharge_at_cost', 'recharge_with_markup');--> statement-breakpoint
CREATE TYPE "public"."journal_type" AS ENUM('original_budget', 'allocation', 'transfer', 'reduction', 'increase', 'commitment', 'actual', 'accrual', 'contribution', 'recharge', 'surplus_return', 'rollover', 'manual', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('authorized', 'allocated_out', 'held', 'pre_encumbered', 'encumbered', 'actual', 'accrued', 'plan_funding', 'savings', 'obligations', 'earmark_reserve', 'fx_variance', 'intercompany_due_from', 'intercompany_due_to');--> statement-breakpoint
CREATE TYPE "public"."org_unit_kind" AS ENUM('company', 'business_unit', 'department', 'team', 'region', 'location');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('open', 'soft_closed', 'closed', 'locked');--> statement-breakpoint
CREATE TYPE "public"."plan_version_kind" AS ENUM('original', 'current', 'forecast');--> statement-breakpoint
CREATE TYPE "public"."plan_version_status" AS ENUM('draft', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."rate_type" AS ENUM('plan', 'spot', 'month_end', 'monthly_average');--> statement-breakpoint
CREATE TYPE "public"."recharge_status" AS ENUM('proposed', 'pending_tax_approval', 'approved', 'scheduled', 'exported', 'posted', 'blocked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reporting_line_kind" AS ENUM('solid', 'matrix');--> statement-breakpoint
CREATE TYPE "public"."request_kind" AS ENUM('budget', 'spending', 'additional_fund', 'over_budget', 'exception');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('draft', 'submitted', 'pending_approval', 'changes_requested', 'approved', 'partially_approved', 'rejected', 'withdrawn', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."role_id" AS ENUM('super-admin', 'org-admin', 'ceo', 'finance-admin', 'finance-controller', 'budget-owner', 'department-head', 'regional-manager', 'location-manager', 'event-organizer', 'employee', 'auditor', 'integration-admin', 'analyst');--> statement-breakpoint
CREATE TYPE "public"."rollover_mode" AS ENUM('lapse', 'carry_full', 'carry_capped', 'carry_with_approval');--> statement-breakpoint
CREATE TYPE "public"."sweep_target" AS ENUM('parent', 'corporate');--> statement-breakpoint
CREATE TYPE "public"."tieout_status" AS ENUM('draft', 'reconciled', 'exceptions', 'signed_off');--> statement-breakpoint
CREATE TYPE "public"."vendor_status" AS ENUM('approved', 'preferred', 'blocked', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."year_end_run_status" AS ENUM('draft', 'dry_run', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "break_glass_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"idp_subject" varchar(255) NOT NULL,
	"reason" text NOT NULL,
	"granted_by" uuid,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"code" char(3) PRIMARY KEY NOT NULL,
	"exponent" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan" varchar(50) NOT NULL,
	"feature" varchar(100) NOT NULL,
	"limit_value" integer,
	"valid_from" date NOT NULL,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"idp_subject" varchar(255) NOT NULL,
	"person_id" uuid,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_person_id" uuid,
	"name" varchar(100) NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" "role_id" NOT NULL,
	"scope_org_unit_id" uuid,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"reporting_rate_type" "rate_type" DEFAULT 'month_end' NOT NULL,
	"default_intercompany_mode" "intercompany_mode" DEFAULT 'block' NOT NULL,
	"alert_thresholds_pct" integer[] DEFAULT '{50,80,100}' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(63) NOT NULL,
	"reporting_currency" char(3) NOT NULL,
	"default_timezone" text DEFAULT 'UTC' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rate_type" "rate_type" NOT NULL,
	"base_currency" char(3) NOT NULL,
	"quote_currency" char(3) NOT NULL,
	"rate" numeric(24, 12) NOT NULL,
	"effective_date" date NOT NULL,
	"fiscal_year_id" uuid,
	"source" varchar(50) NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"calendar_type" "calendar_type" NOT NULL,
	"start_month" integer,
	"label_by" varchar(5),
	"end_month" integer,
	"end_weekday" integer,
	"week_method" varchar(10),
	"group_calendar_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"fiscal_calendar_id" uuid NOT NULL,
	"period_number" integer NOT NULL,
	"label" varchar(30) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" "period_status" DEFAULT 'open' NOT NULL,
	"status_changed_at" timestamp with time zone,
	"status_changed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "fiscal_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fiscal_calendar_id" uuid NOT NULL,
	"label" varchar(20) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"group_fiscal_year_id" uuid,
	"plan_rates_locked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "intercompany_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_legal_entity_id" uuid,
	"to_legal_entity_id" uuid,
	"mode" "intercompany_mode" NOT NULL,
	"markup_bps" integer DEFAULT 0 NOT NULL,
	"tax_approver_person_id" uuid,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" text NOT NULL,
	"country" varchar(2),
	"functional_currency" char(3) NOT NULL,
	"fiscal_calendar_id" uuid NOT NULL,
	"tax_jurisdiction" varchar(50),
	"erp_company_code" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recharge_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contribution_request_id" uuid,
	"event_id" uuid,
	"from_legal_entity_id" uuid NOT NULL,
	"to_legal_entity_id" uuid NOT NULL,
	"mode" "intercompany_mode" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"markup_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) NOT NULL,
	"status" "recharge_status" DEFAULT 'proposed' NOT NULL,
	"due_period_id" uuid,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"org_unit_id" uuid,
	"valid_from" date NOT NULL,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "headcount_snapshot_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"employment_type" "employment_type" NOT NULL,
	"headcount" integer NOT NULL,
	"prorated_headcount_milli" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "headcount_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"source" varchar(50) NOT NULL,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_unit_closure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ancestor_id" uuid NOT NULL,
	"descendant_id" uuid NOT NULL,
	"depth" integer NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "org_unit_kind" NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"legal_entity_id" uuid,
	"timezone" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" varchar(320) NOT NULL,
	"job_title" text,
	"seniority" integer,
	"location_org_unit_id" uuid,
	"timezone" text,
	"employing_entity_id" uuid,
	"cost_center_id" uuid,
	"employment_type" "employment_type" DEFAULT 'employee' NOT NULL,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reporting_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"manager_person_id" uuid NOT NULL,
	"kind" "reporting_line_kind" DEFAULT 'solid' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "budget_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_co_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_period_allotments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"fiscal_period_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"path" text NOT NULL,
	"depth" integer NOT NULL,
	"name" text NOT NULL,
	"code" varchar(50),
	"status" "budget_status" DEFAULT 'draft' NOT NULL,
	"budget_type" "budget_type" DEFAULT 'operating' NOT NULL,
	"category_id" uuid,
	"legal_entity_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"org_unit_id" uuid,
	"owner_person_id" uuid,
	"currency" char(3) NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"plan_version_id" uuid,
	"control_basis" "ledger_account"[] NOT NULL,
	"control_mode" "control_mode" DEFAULT 'hard' NOT NULL,
	"tolerance_bps" integer DEFAULT 0 NOT NULL,
	"alert_thresholds_pct" integer[] DEFAULT '{50,80,100}' NOT NULL,
	"allocation_driver" "allocation_driver" DEFAULT 'fixed' NOT NULL,
	"driver_config" jsonb,
	"rollover_policy_id" uuid,
	"program_template_id" uuid,
	"expires_on" date,
	"version" integer DEFAULT 1 NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity" varchar(50) NOT NULL,
	"key" varchar(50) NOT NULL,
	"label" text NOT NULL,
	"field_type" varchar(20) NOT NULL,
	"required" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"kind" "plan_version_kind" NOT NULL,
	"label" text NOT NULL,
	"status" "plan_version_status" DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "program_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"kind" varchar(30) NOT NULL,
	"driver" "allocation_driver" DEFAULT 'fixed' NOT NULL,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rollover_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"mode" "rollover_mode" NOT NULL,
	"cap_bps" integer,
	"sweep_to" "sweep_target" DEFAULT 'parent' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_balances" (
	"tenant_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"fiscal_period_id" uuid NOT NULL,
	"bucket" "ledger_account" NOT NULL,
	"budget_amount_minor" bigint DEFAULT 0 NOT NULL,
	"reporting_amount_minor" bigint DEFAULT 0 NOT NULL,
	"line_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_balances_budget_id_fiscal_period_id_bucket_pk" PRIMARY KEY("budget_id","fiscal_period_id","bucket")
);
--> statement-breakpoint
CREATE TABLE "ledger_journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journal_type" "journal_type" NOT NULL,
	"transaction_currency" char(3) NOT NULL,
	"reporting_currency" char(3) NOT NULL,
	"accounting_date" date NOT NULL,
	"fiscal_period_id" uuid NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"original_period_id" uuid,
	"reversal_of_journal_id" uuid,
	"reason_code" varchar(50),
	"reason" text,
	"command" varchar(100) NOT NULL,
	"request_id" varchar(100),
	"idempotency_key" varchar(200),
	"actor_person_id" uuid,
	"actor_subject" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journal_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"budget_id" uuid,
	"account" "ledger_account" NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"gl_account_id" uuid,
	"event_code" varchar(50),
	"fiscal_period_id" uuid NOT NULL,
	"accounting_date" date NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"transaction_currency" char(3) NOT NULL,
	"transaction_amount_minor" bigint NOT NULL,
	"budget_currency" char(3),
	"budget_amount_minor" bigint,
	"reporting_currency" char(3) NOT NULL,
	"reporting_amount_minor" bigint NOT NULL,
	"budget_rate_type" "rate_type",
	"budget_rate" numeric(24, 12),
	"budget_rate_ids" uuid[],
	"reporting_rate_type" "rate_type" NOT NULL,
	"reporting_rate" numeric(24, 12) NOT NULL,
	"reporting_rate_ids" uuid[] NOT NULL,
	"plan_version_id" uuid,
	"commitment_id" uuid,
	"event_id" uuid,
	"contribution_id" uuid,
	"actual_id" uuid,
	"request_id" uuid,
	"approval_id" uuid,
	"import_line_id" uuid,
	"reversal_of_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_lines_budget_bucket_shape" CHECK (("ledger_lines"."account" in ('authorized','allocated_out','held','pre_encumbered','encumbered','actual','accrued')) = ("ledger_lines"."budget_id" is not null and "ledger_lines"."budget_amount_minor" is not null and "ledger_lines"."budget_currency" is not null))
);
--> statement-breakpoint
CREATE TABLE "commitment_funding_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"contribution_request_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commitment_tax_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"tax_code" varchar(30) NOT NULL,
	"rate_bps" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"recoverable" boolean NOT NULL,
	"withholding" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commitments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"request_id" uuid,
	"event_id" uuid,
	"status" "commitment_status" DEFAULT 'pre_encumbered' NOT NULL,
	"vendor_id" uuid,
	"legal_entity_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"gl_account_id" uuid,
	"description" text NOT NULL,
	"service_start" date,
	"service_end" date,
	"accounting_period_id" uuid,
	"amount_minor" bigint NOT NULL,
	"consumed_minor" bigint DEFAULT 0 NOT NULL,
	"released_minor" bigint DEFAULT 0 NOT NULL,
	"fees_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) NOT NULL,
	"non_refundable_deposit_minor" bigint DEFAULT 0 NOT NULL,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contribution_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contribution_request_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contribution_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid,
	"requester_person_id" uuid NOT NULL,
	"giver_budget_id" uuid NOT NULL,
	"receiver_budget_id" uuid,
	"requested_minor" bigint NOT NULL,
	"approved_minor" bigint,
	"currency" char(3) NOT NULL,
	"mode" "contribution_mode" DEFAULT 'earmark' NOT NULL,
	"status" "contribution_status" DEFAULT 'draft' NOT NULL,
	"purpose" text NOT NULL,
	"decision_reason" text,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"intercompany_mode" "intercompany_mode",
	"resubmission_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_benefit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"event_id" uuid,
	"fiscal_year_id" uuid NOT NULL,
	"benefit_type" varchar(50) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"taxable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_co_organizers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"person_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_cost_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"dimension" varchar(20) NOT NULL,
	"dimension_id" uuid NOT NULL,
	"share_weight" integer NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"org_unit_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"person_id" uuid,
	"guest_name" text,
	"is_employee" boolean DEFAULT true NOT NULL,
	"employing_entity_id" uuid,
	"cost_center_id" uuid,
	"location_org_unit_id" uuid,
	"rsvp_status" varchar(20) DEFAULT 'invited' NOT NULL,
	"attendance_status" varchar(20) DEFAULT 'unknown' NOT NULL,
	"needs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"organizer_person_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"event_code" varchar(50) NOT NULL,
	"budget_id" uuid,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"expected_attendance" integer,
	"estimate_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) NOT NULL,
	"tolerance_bps" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "request_kind" NOT NULL,
	"status" "request_status" DEFAULT 'draft' NOT NULL,
	"requester_person_id" uuid NOT NULL,
	"budget_id" uuid,
	"event_id" uuid,
	"amount_minor" bigint NOT NULL,
	"approved_minor" bigint,
	"currency" char(3) NOT NULL,
	"spend_type" varchar(50) NOT NULL,
	"purpose" text NOT NULL,
	"resubmission_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surplus_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"contribution_request_id" uuid,
	"budget_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "vendor_status" DEFAULT 'unknown' NOT NULL,
	"erp_vendor_id" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"on_behalf_of_person_id" uuid,
	"action" varchar(30) NOT NULL,
	"approved_minor" bigint,
	"reason" text,
	"channel" "approval_channel" DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"delegator_person_id" uuid NOT NULL,
	"delegate_person_id" uuid NOT NULL,
	"spend_type" varchar(50),
	"limit_minor" bigint,
	"currency" char(3),
	"valid_from" date NOT NULL,
	"valid_to" date,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_type" varchar(50) NOT NULL,
	"subject_id" uuid NOT NULL,
	"workflow_template_id" uuid,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"explanation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"step_no" integer NOT NULL,
	"assignee_person_id" uuid NOT NULL,
	"resolver" varchar(50) NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"due_at" timestamp with time zone,
	"escalated_from_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doa_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"matrix_version_id" uuid NOT NULL,
	"person_id" uuid,
	"role" "role_id",
	"spend_type" varchar(50) NOT NULL,
	"legal_entity_id" uuid,
	"limit_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "doa_matrix_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reason_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"category" varchar(30) NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accruals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"budget_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"accounting_period_id" uuid NOT NULL,
	"auto_reverse_period_id" uuid,
	"status" "accrual_status" DEFAULT 'proposed' NOT NULL,
	"journal_id" uuid,
	"reversal_journal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "actual_mapping_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"priority" integer NOT NULL,
	"match" jsonb NOT NULL,
	"target_budget_id" uuid,
	"target_event_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "actual_tax_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actual_id" uuid NOT NULL,
	"tax_code" varchar(30) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"recoverable" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "actuals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" "actual_source" NOT NULL,
	"source_ref" varchar(200) NOT NULL,
	"import_batch_id" uuid,
	"kind" "actual_kind" DEFAULT 'charge' NOT NULL,
	"reversal_of_actual_id" uuid,
	"legal_entity_id" uuid NOT NULL,
	"cost_center_id" uuid,
	"gl_account_id" uuid,
	"event_code" varchar(50),
	"vendor_id" uuid,
	"merchant" text,
	"memo" text,
	"transaction_date" date NOT NULL,
	"accounting_date" date NOT NULL,
	"fiscal_period_id" uuid,
	"transaction_currency" char(3) NOT NULL,
	"transaction_amount_minor" bigint NOT NULL,
	"reporting_currency" char(3) NOT NULL,
	"reporting_amount_minor" bigint NOT NULL,
	"actual_rate" numeric(24, 12) NOT NULL,
	"match_status" "actual_match_status" DEFAULT 'unmatched' NOT NULL,
	"matched_minor" bigint DEFAULT 0 NOT NULL,
	"matched_commitment_id" uuid,
	"matched_budget_id" uuid,
	"duplicate_key" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"budget_id" uuid,
	"event_id" uuid,
	"method" "forecast_method" NOT NULL,
	"as_of_date" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"variance_bps" integer,
	"commentary" text,
	"status" "forecast_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gl_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" text NOT NULL,
	"account_type" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gl_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"attendee_type" varchar(10) NOT NULL,
	"gl_account_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "gl_tieout_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fiscal_period_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"status" "tieout_status" DEFAULT 'draft' NOT NULL,
	"totals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signed_off_by" uuid,
	"signed_off_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrity_check_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" varchar(30) DEFAULT 'ledger_rebuild' NOT NULL,
	"status" "integrity_check_status" DEFAULT 'queued' NOT NULL,
	"requested_by" uuid,
	"trigger" varchar(20) DEFAULT 'manual' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"summary" jsonb,
	"flags_raised" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrity_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "integrity_flag_kind" NOT NULL,
	"severity" varchar(10) NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar(100) NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "integrity_flag_status" DEFAULT 'open' NOT NULL,
	"check_run_id" uuid,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_close_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fiscal_period_id" uuid NOT NULL,
	"legal_entity_id" uuid,
	"balances" jsonb NOT NULL,
	"taken_by" uuid,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prepaids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"commitment_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"consumed_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) NOT NULL,
	"service_start" date NOT NULL,
	"service_end" date NOT NULL,
	"non_refundable" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "year_end_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"status" "year_end_run_status" DEFAULT 'draft' NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"commitment_freeze_date" date,
	"summary" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_chain_heads" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"last_seq" bigint NOT NULL,
	"last_hash" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_person_id" uuid,
	"actor_subject" varchar(255),
	"on_behalf_of_person_id" uuid,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar(100) NOT NULL,
	"legal_entity_id" uuid,
	"request_id" varchar(100),
	"reason" text,
	"changes" jsonb NOT NULL,
	"prev_hash" varchar(64) NOT NULL,
	"hash" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" varchar(200) NOT NULL,
	"actor_subject" varchar(255) NOT NULL,
	"operation" varchar(100) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"topic" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_analytics_events" ADD CONSTRAINT "product_analytics_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_reporting_currency_currencies_code_fk" FOREIGN KEY ("reporting_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_base_currency_currencies_code_fk" FOREIGN KEY ("base_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_quote_currency_currencies_code_fk" FOREIGN KEY ("quote_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_calendars" ADD CONSTRAINT "fiscal_calendars_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_fiscal_calendar_id_fiscal_calendars_id_fk" FOREIGN KEY ("fiscal_calendar_id") REFERENCES "public"."fiscal_calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_fiscal_calendar_id_fiscal_calendars_id_fk" FOREIGN KEY ("fiscal_calendar_id") REFERENCES "public"."fiscal_calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_policies" ADD CONSTRAINT "intercompany_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_policies" ADD CONSTRAINT "intercompany_policies_from_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("from_legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intercompany_policies" ADD CONSTRAINT "intercompany_policies_to_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("to_legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_functional_currency_currencies_code_fk" FOREIGN KEY ("functional_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_fiscal_calendar_id_fiscal_calendars_id_fk" FOREIGN KEY ("fiscal_calendar_id") REFERENCES "public"."fiscal_calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recharge_schedules" ADD CONSTRAINT "recharge_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recharge_schedules" ADD CONSTRAINT "recharge_schedules_from_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("from_legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recharge_schedules" ADD CONSTRAINT "recharge_schedules_to_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("to_legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recharge_schedules" ADD CONSTRAINT "recharge_schedules_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recharge_schedules" ADD CONSTRAINT "recharge_schedules_due_period_id_fiscal_periods_id_fk" FOREIGN KEY ("due_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "headcount_snapshot_lines" ADD CONSTRAINT "headcount_snapshot_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "headcount_snapshot_lines" ADD CONSTRAINT "headcount_snapshot_lines_snapshot_id_headcount_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."headcount_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "headcount_snapshot_lines" ADD CONSTRAINT "headcount_snapshot_lines_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "headcount_snapshot_lines" ADD CONSTRAINT "headcount_snapshot_lines_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "headcount_snapshots" ADD CONSTRAINT "headcount_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit_closure" ADD CONSTRAINT "org_unit_closure_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit_closure" ADD CONSTRAINT "org_unit_closure_ancestor_id_org_units_id_fk" FOREIGN KEY ("ancestor_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit_closure" ADD CONSTRAINT "org_unit_closure_descendant_id_org_units_id_fk" FOREIGN KEY ("descendant_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_location_org_unit_id_org_units_id_fk" FOREIGN KEY ("location_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_employing_entity_id_legal_entities_id_fk" FOREIGN KEY ("employing_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_lines" ADD CONSTRAINT "reporting_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_lines" ADD CONSTRAINT "reporting_lines_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reporting_lines" ADD CONSTRAINT "reporting_lines_manager_person_id_people_id_fk" FOREIGN KEY ("manager_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_co_owners" ADD CONSTRAINT "budget_co_owners_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_co_owners" ADD CONSTRAINT "budget_co_owners_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_co_owners" ADD CONSTRAINT "budget_co_owners_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_period_allotments" ADD CONSTRAINT "budget_period_allotments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_period_allotments" ADD CONSTRAINT "budget_period_allotments_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_period_allotments" ADD CONSTRAINT "budget_period_allotments_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_versions" ADD CONSTRAINT "budget_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_versions" ADD CONSTRAINT "budget_versions_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."budget_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_rollover_policy_id_rollover_policies_id_fk" FOREIGN KEY ("rollover_policy_id") REFERENCES "public"."rollover_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_program_template_id_program_templates_id_fk" FOREIGN KEY ("program_template_id") REFERENCES "public"."program_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_templates" ADD CONSTRAINT "program_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rollover_policies" ADD CONSTRAINT "rollover_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_balances" ADD CONSTRAINT "ledger_balances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_balances" ADD CONSTRAINT "ledger_balances_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_balances" ADD CONSTRAINT "ledger_balances_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_transaction_currency_currencies_code_fk" FOREIGN KEY ("transaction_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_reporting_currency_currencies_code_fk" FOREIGN KEY ("reporting_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_journals" ADD CONSTRAINT "ledger_journals_original_period_id_fiscal_periods_id_fk" FOREIGN KEY ("original_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_journal_id_ledger_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."ledger_journals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_transaction_currency_currencies_code_fk" FOREIGN KEY ("transaction_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_budget_currency_currencies_code_fk" FOREIGN KEY ("budget_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_reporting_currency_currencies_code_fk" FOREIGN KEY ("reporting_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD CONSTRAINT "commitment_funding_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD CONSTRAINT "commitment_funding_lines_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD CONSTRAINT "commitment_funding_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_funding_lines" ADD CONSTRAINT "commitment_funding_lines_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_tax_lines" ADD CONSTRAINT "commitment_tax_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitment_tax_lines" ADD CONSTRAINT "commitment_tax_lines_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_accounting_period_id_fiscal_periods_id_fk" FOREIGN KEY ("accounting_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_lines" ADD CONSTRAINT "contribution_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_lines" ADD CONSTRAINT "contribution_lines_contribution_request_id_contribution_requests_id_fk" FOREIGN KEY ("contribution_request_id") REFERENCES "public"."contribution_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_lines" ADD CONSTRAINT "contribution_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_lines" ADD CONSTRAINT "contribution_lines_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD CONSTRAINT "contribution_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD CONSTRAINT "contribution_requests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD CONSTRAINT "contribution_requests_requester_person_id_people_id_fk" FOREIGN KEY ("requester_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD CONSTRAINT "contribution_requests_giver_budget_id_budgets_id_fk" FOREIGN KEY ("giver_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD CONSTRAINT "contribution_requests_receiver_budget_id_budgets_id_fk" FOREIGN KEY ("receiver_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contribution_requests" ADD CONSTRAINT "contribution_requests_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD CONSTRAINT "employee_benefit_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD CONSTRAINT "employee_benefit_ledger_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD CONSTRAINT "employee_benefit_ledger_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD CONSTRAINT "employee_benefit_ledger_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD CONSTRAINT "employee_benefit_ledger_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_co_organizers" ADD CONSTRAINT "event_co_organizers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_co_organizers" ADD CONSTRAINT "event_co_organizers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_co_organizers" ADD CONSTRAINT "event_co_organizers_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_cost_splits" ADD CONSTRAINT "event_cost_splits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_cost_splits" ADD CONSTRAINT "event_cost_splits_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_cost_splits" ADD CONSTRAINT "event_cost_splits_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_locations" ADD CONSTRAINT "event_locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_locations" ADD CONSTRAINT "event_locations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_locations" ADD CONSTRAINT "event_locations_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_employing_entity_id_legal_entities_id_fk" FOREIGN KEY ("employing_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_participants" ADD CONSTRAINT "event_participants_location_org_unit_id_org_units_id_fk" FOREIGN KEY ("location_org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organizer_person_id_people_id_fk" FOREIGN KEY ("organizer_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_person_id_people_id_fk" FOREIGN KEY ("requester_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_returns" ADD CONSTRAINT "surplus_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_returns" ADD CONSTRAINT "surplus_returns_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_returns" ADD CONSTRAINT "surplus_returns_contribution_request_id_contribution_requests_id_fk" FOREIGN KEY ("contribution_request_id") REFERENCES "public"."contribution_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_returns" ADD CONSTRAINT "surplus_returns_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surplus_returns" ADD CONSTRAINT "surplus_returns_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_task_id_approval_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."approval_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_actor_person_id_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegator_person_id_people_id_fk" FOREIGN KEY ("delegator_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegate_person_id_people_id_fk" FOREIGN KEY ("delegate_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_instances" ADD CONSTRAINT "approval_instances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_instance_id_approval_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."approval_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tasks" ADD CONSTRAINT "approval_tasks_assignee_person_id_people_id_fk" FOREIGN KEY ("assignee_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doa_limits" ADD CONSTRAINT "doa_limits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doa_limits" ADD CONSTRAINT "doa_limits_matrix_version_id_doa_matrix_versions_id_fk" FOREIGN KEY ("matrix_version_id") REFERENCES "public"."doa_matrix_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doa_limits" ADD CONSTRAINT "doa_limits_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doa_limits" ADD CONSTRAINT "doa_limits_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doa_limits" ADD CONSTRAINT "doa_limits_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doa_matrix_versions" ADD CONSTRAINT "doa_matrix_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reason_codes" ADD CONSTRAINT "reason_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accruals" ADD CONSTRAINT "accruals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accruals" ADD CONSTRAINT "accruals_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accruals" ADD CONSTRAINT "accruals_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accruals" ADD CONSTRAINT "accruals_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accruals" ADD CONSTRAINT "accruals_accounting_period_id_fiscal_periods_id_fk" FOREIGN KEY ("accounting_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accruals" ADD CONSTRAINT "accruals_auto_reverse_period_id_fiscal_periods_id_fk" FOREIGN KEY ("auto_reverse_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actual_mapping_rules" ADD CONSTRAINT "actual_mapping_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actual_mapping_rules" ADD CONSTRAINT "actual_mapping_rules_target_budget_id_budgets_id_fk" FOREIGN KEY ("target_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actual_mapping_rules" ADD CONSTRAINT "actual_mapping_rules_target_event_id_events_id_fk" FOREIGN KEY ("target_event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actual_tax_lines" ADD CONSTRAINT "actual_tax_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actual_tax_lines" ADD CONSTRAINT "actual_tax_lines_actual_id_actuals_id_fk" FOREIGN KEY ("actual_id") REFERENCES "public"."actuals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_gl_account_id_gl_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_transaction_currency_currencies_code_fk" FOREIGN KEY ("transaction_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_reporting_currency_currencies_code_fk" FOREIGN KEY ("reporting_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_matched_commitment_id_commitments_id_fk" FOREIGN KEY ("matched_commitment_id") REFERENCES "public"."commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actuals" ADD CONSTRAINT "actuals_matched_budget_id_budgets_id_fk" FOREIGN KEY ("matched_budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_mappings" ADD CONSTRAINT "gl_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_mappings" ADD CONSTRAINT "gl_mappings_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_mappings" ADD CONSTRAINT "gl_mappings_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."budget_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_mappings" ADD CONSTRAINT "gl_mappings_gl_account_id_gl_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_tieout_runs" ADD CONSTRAINT "gl_tieout_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_tieout_runs" ADD CONSTRAINT "gl_tieout_runs_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_tieout_runs" ADD CONSTRAINT "gl_tieout_runs_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_check_runs" ADD CONSTRAINT "integrity_check_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_flags" ADD CONSTRAINT "integrity_flags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrity_flags" ADD CONSTRAINT "integrity_flags_check_run_id_integrity_check_runs_id_fk" FOREIGN KEY ("check_run_id") REFERENCES "public"."integrity_check_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_close_snapshots" ADD CONSTRAINT "period_close_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_close_snapshots" ADD CONSTRAINT "period_close_snapshots_fiscal_period_id_fiscal_periods_id_fk" FOREIGN KEY ("fiscal_period_id") REFERENCES "public"."fiscal_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_close_snapshots" ADD CONSTRAINT "period_close_snapshots_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaids" ADD CONSTRAINT "prepaids_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaids" ADD CONSTRAINT "prepaids_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prepaids" ADD CONSTRAINT "prepaids_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_runs" ADD CONSTRAINT "year_end_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "year_end_runs" ADD CONSTRAINT "year_end_runs_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_chain_heads" ADD CONSTRAINT "audit_chain_heads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_messages" ADD CONSTRAINT "outbox_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "break_glass_tenant" ON "break_glass_grants" USING btree ("tenant_id","idp_subject");--> statement-breakpoint
CREATE INDEX "entitlements_tenant" ON "entitlements" USING btree ("tenant_id","feature");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_tenant_key" ON "feature_flags" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_subject" ON "memberships" USING btree ("tenant_id","idp_subject");--> statement-breakpoint
CREATE INDEX "memberships_subject" ON "memberships" USING btree ("idp_subject");--> statement-breakpoint
CREATE INDEX "product_analytics_tenant_name" ON "product_analytics_events" USING btree ("tenant_id","name","occurred_at");--> statement-breakpoint
CREATE INDEX "role_grants_membership" ON "role_grants" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "exchange_rates_lookup" ON "exchange_rates" USING btree ("tenant_id","rate_type","quote_currency","effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_unique" ON "exchange_rates" USING btree ("tenant_id","rate_type","base_currency","quote_currency","effective_date");--> statement-breakpoint
CREATE INDEX "fiscal_calendars_tenant" ON "fiscal_calendars" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "fiscal_periods_tenant_dates" ON "fiscal_periods" USING btree ("tenant_id","fiscal_calendar_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_periods_year_number" ON "fiscal_periods" USING btree ("fiscal_year_id","period_number");--> statement-breakpoint
CREATE INDEX "fiscal_years_tenant" ON "fiscal_years" USING btree ("tenant_id","fiscal_calendar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_years_calendar_label" ON "fiscal_years" USING btree ("fiscal_calendar_id","label");--> statement-breakpoint
CREATE INDEX "intercompany_policies_tenant" ON "intercompany_policies" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_entities_tenant_code" ON "legal_entities" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "recharge_schedules_tenant" ON "recharge_schedules" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centers_tenant_code" ON "cost_centers" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "headcount_snapshot_lines_snapshot" ON "headcount_snapshot_lines" USING btree ("tenant_id","snapshot_id");--> statement-breakpoint
CREATE INDEX "headcount_snapshots_tenant" ON "headcount_snapshots" USING btree ("tenant_id","as_of_date");--> statement-breakpoint
CREATE INDEX "org_unit_closure_ancestor" ON "org_unit_closure" USING btree ("tenant_id","ancestor_id");--> statement-breakpoint
CREATE INDEX "org_unit_closure_descendant" ON "org_unit_closure" USING btree ("tenant_id","descendant_id");--> statement-breakpoint
CREATE INDEX "org_units_tenant_parent" ON "org_units" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_units_tenant_code_from" ON "org_units" USING btree ("tenant_id","code","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "people_tenant_email" ON "people" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "reporting_lines_person" ON "reporting_lines" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_categories_tenant_code" ON "budget_categories" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_co_owners_unique" ON "budget_co_owners" USING btree ("tenant_id","budget_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_period_allotments_unique" ON "budget_period_allotments" USING btree ("tenant_id","budget_id","fiscal_period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_versions_unique" ON "budget_versions" USING btree ("tenant_id","budget_id","version");--> statement-breakpoint
CREATE INDEX "budgets_tenant_parent" ON "budgets" USING btree ("tenant_id","parent_id");--> statement-breakpoint
CREATE INDEX "budgets_tenant_path" ON "budgets" USING btree ("tenant_id","path");--> statement-breakpoint
CREATE INDEX "budgets_tenant_owner" ON "budgets" USING btree ("tenant_id","owner_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_definitions_key" ON "custom_field_definitions" USING btree ("tenant_id","entity","key");--> statement-breakpoint
CREATE INDEX "plan_versions_tenant_year" ON "plan_versions" USING btree ("tenant_id","fiscal_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "program_templates_tenant_code" ON "program_templates" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "rollover_policies_tenant_code" ON "rollover_policies" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "ledger_balances_tenant" ON "ledger_balances" USING btree ("tenant_id","budget_id");--> statement-breakpoint
CREATE INDEX "ledger_journals_tenant_period" ON "ledger_journals" USING btree ("tenant_id","fiscal_period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_journals_one_reversal" ON "ledger_journals" USING btree ("reversal_of_journal_id");--> statement-breakpoint
CREATE INDEX "ledger_lines_tenant_budget" ON "ledger_lines" USING btree ("tenant_id","budget_id","fiscal_period_id","account");--> statement-breakpoint
CREATE INDEX "ledger_lines_journal" ON "ledger_lines" USING btree ("journal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_lines_one_reversal" ON "ledger_lines" USING btree ("reversal_of_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_lines_journal_line" ON "ledger_lines" USING btree ("journal_id","line_no");--> statement-breakpoint
CREATE INDEX "commitment_funding_lines_commitment" ON "commitment_funding_lines" USING btree ("tenant_id","commitment_id");--> statement-breakpoint
CREATE INDEX "commitment_tax_lines_commitment" ON "commitment_tax_lines" USING btree ("tenant_id","commitment_id");--> statement-breakpoint
CREATE INDEX "commitments_tenant_budget" ON "commitments" USING btree ("tenant_id","budget_id","status");--> statement-breakpoint
CREATE INDEX "contribution_lines_request" ON "contribution_lines" USING btree ("tenant_id","contribution_request_id");--> statement-breakpoint
CREATE INDEX "contribution_requests_tenant_status" ON "contribution_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "contribution_requests_giver" ON "contribution_requests" USING btree ("tenant_id","giver_budget_id");--> statement-breakpoint
CREATE INDEX "employee_benefit_ledger_person" ON "employee_benefit_ledger" USING btree ("tenant_id","person_id","fiscal_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_co_organizers_unique" ON "event_co_organizers" USING btree ("tenant_id","event_id","person_id");--> statement-breakpoint
CREATE INDEX "event_cost_splits_event" ON "event_cost_splits" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_locations_unique" ON "event_locations" USING btree ("tenant_id","event_id","org_unit_id");--> statement-breakpoint
CREATE INDEX "event_participants_event" ON "event_participants" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_tenant_code" ON "events" USING btree ("tenant_id","event_code");--> statement-breakpoint
CREATE INDEX "events_tenant_status" ON "events" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "requests_tenant_status" ON "requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "requests_tenant_budget" ON "requests" USING btree ("tenant_id","budget_id");--> statement-breakpoint
CREATE INDEX "surplus_returns_event" ON "surplus_returns" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE INDEX "vendors_tenant_name" ON "vendors" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "approval_actions_task" ON "approval_actions" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE INDEX "approval_delegations_delegator" ON "approval_delegations" USING btree ("tenant_id","delegator_person_id");--> statement-breakpoint
CREATE INDEX "approval_instances_subject" ON "approval_instances" USING btree ("tenant_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "approval_tasks_assignee" ON "approval_tasks" USING btree ("tenant_id","assignee_person_id","status");--> statement-breakpoint
CREATE INDEX "doa_limits_lookup" ON "doa_limits" USING btree ("tenant_id","matrix_version_id","spend_type");--> statement-breakpoint
CREATE UNIQUE INDEX "doa_matrix_versions_unique" ON "doa_matrix_versions" USING btree ("tenant_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "reason_codes_tenant_code" ON "reason_codes" USING btree ("tenant_id","category","code");--> statement-breakpoint
CREATE INDEX "accruals_tenant_status" ON "accruals" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "actual_mapping_rules_tenant" ON "actual_mapping_rules" USING btree ("tenant_id","priority");--> statement-breakpoint
CREATE INDEX "actual_tax_lines_actual" ON "actual_tax_lines" USING btree ("tenant_id","actual_id");--> statement-breakpoint
CREATE UNIQUE INDEX "actuals_source_ref" ON "actuals" USING btree ("tenant_id","source","source_ref");--> statement-breakpoint
CREATE INDEX "actuals_tenant_match" ON "actuals" USING btree ("tenant_id","match_status");--> statement-breakpoint
CREATE INDEX "actuals_duplicate_key" ON "actuals" USING btree ("tenant_id","duplicate_key");--> statement-breakpoint
CREATE INDEX "forecast_snapshots_budget" ON "forecast_snapshots" USING btree ("tenant_id","budget_id","as_of_date");--> statement-breakpoint
CREATE UNIQUE INDEX "gl_accounts_entity_code" ON "gl_accounts" USING btree ("tenant_id","legal_entity_id","code");--> statement-breakpoint
CREATE INDEX "gl_mappings_lookup" ON "gl_mappings" USING btree ("tenant_id","legal_entity_id","category_id");--> statement-breakpoint
CREATE INDEX "gl_tieout_runs_period" ON "gl_tieout_runs" USING btree ("tenant_id","fiscal_period_id","legal_entity_id");--> statement-breakpoint
CREATE INDEX "integrity_check_runs_tenant" ON "integrity_check_runs" USING btree ("tenant_id","requested_at");--> statement-breakpoint
CREATE INDEX "integrity_flags_tenant" ON "integrity_flags" USING btree ("tenant_id","kind","status");--> statement-breakpoint
CREATE INDEX "period_close_snapshots_period" ON "period_close_snapshots" USING btree ("tenant_id","fiscal_period_id");--> statement-breakpoint
CREATE INDEX "prepaids_commitment" ON "prepaids" USING btree ("tenant_id","commitment_id");--> statement-breakpoint
CREATE INDEX "year_end_runs_year" ON "year_end_runs" USING btree ("tenant_id","fiscal_year_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_tenant_seq" ON "audit_events" USING btree ("tenant_id","seq");--> statement-breakpoint
CREATE INDEX "audit_events_resource" ON "audit_events" USING btree ("tenant_id","resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_tenant_key" ON "idempotency_keys" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "outbox_messages_unpublished" ON "outbox_messages" USING btree ("tenant_id","published_at","created_at");