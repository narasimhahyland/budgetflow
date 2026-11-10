-- The database's copy of the API clock (libs/api/core/src/lib/clock.ts).
--
-- Every timestamp default used to be now(), the database's wall clock, so seeded rows carried the
-- moment the seed ran and every screen that renders them changed with the real date. app_now() is
-- real now() unless the session carries app.fixed_now. A test stack sets it on the seed's
-- connections only (scripts/stack.sh), to the instant the API and the browser are pinned to, so
-- seeded rows carry the same times on every run. Production never sets it, so production
-- behaviour is unchanged.
--
-- When pinned, each call advances by one millisecond from the pinned instant, so rows created one
-- after another keep that order. A frozen instant would give them all the same timestamp, and any
-- list ordered by time would then fall back to a random id and change from run to run. The tick
-- comes from a sequence, so a reseeded database starts from the same instant every time.
CREATE SEQUENCE IF NOT EXISTS app_clock_tick;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_now() RETURNS timestamptz
  LANGUAGE plpgsql VOLATILE
AS $$
DECLARE
  fixed text := current_setting('app.fixed_now', true);
BEGIN
  IF fixed IS NULL OR fixed = '' THEN
    RETURN now();
  END IF;
  RETURN fixed::timestamptz + nextval('app_clock_tick') * interval '1 millisecond';
END
$$;--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE app_clock_tick TO bf_app, bf_worker;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_now() TO bf_app, bf_worker;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "feature_flags" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "product_analytics_events" ALTER COLUMN "occurred_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "role_grants" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "tenant_settings" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "exchange_rates" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "fiscal_calendars" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "intercompany_policies" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "legal_entities" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "recharge_schedules" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "headcount_snapshots" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "org_unit_versions" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "org_units" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "people" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "budget_change_requests" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "budget_co_owners" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "budget_limits" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "budget_versions" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "budgets" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "budgets" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "plan_version_lines" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "plan_versions" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ledger_balances" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ledger_journals" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ledger_lines" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "commitments" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "commitments" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "contribution_lines" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "contribution_requests" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "contribution_requests" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_participants" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "requests" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "surplus_returns" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "vendors" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "approval_actions" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "approval_delegations" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "approval_instances" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "approval_tasks" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "doa_matrix_versions" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "accruals" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "actual_mapping_rules" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "actuals" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "forecast_cycles" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "forecast_snapshots" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "gl_tieout_runs" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "integrity_check_runs" ALTER COLUMN "requested_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "integrity_flags" ALTER COLUMN "raised_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "period_close_snapshots" ALTER COLUMN "taken_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "prepaids" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "year_end_runs" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "actual_matches" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "import_batches" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "idempotency_keys" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "outbox_messages" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "approval_action_tokens" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_funding_sources" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_funding_sources" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "channel_deliveries" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "channel_deliveries" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "chat_account_links" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "chat_installations" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "digests" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "digests" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "follows" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "follows" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "notification_preferences" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "push_subscriptions" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "policy_configs" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "policy_configs" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "post_spend_exceptions" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "rule_executions" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "rule_versions" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "rules" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "rules" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "workflow_templates" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_agenda_items" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_agenda_items" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_checklists" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_checklists" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_gallery_photos" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_gallery_photos" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_invitations" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_invitations" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_quote_requests" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_quote_requests" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_quotes" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_quotes" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_series" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_series" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_survey_responses" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_surveys" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_surveys" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_templates" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "event_templates" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "board_pack_generations" ALTER COLUMN "requested_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "report_exports" ALTER COLUMN "requested_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "report_saved_views" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "report_saved_views" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "report_schedule_runs" ALTER COLUMN "run_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "report_schedules" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "report_schedules" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "api_key_requests" ALTER COLUMN "at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "inbound_webhook_events" ALTER COLUMN "received_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "integration_connections" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "integration_connections" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "integration_mappings" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "integration_messages" ALTER COLUMN "first_failed_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "integration_messages" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "integration_pushes" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "integration_secrets" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "scim_operations" ALTER COLUMN "at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "sync_runs" ALTER COLUMN "started_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ALTER COLUMN "secret_set_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "period_close_acknowledgements" ALTER COLUMN "acknowledged_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "period_reopen_requests" ALTER COLUMN "requested_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "year_end_commitment_carries" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "year_end_run_lines" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "admin_change_requests" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "legal_holds" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "maintenance_notices" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "owner_invites" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "retention_policies" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "retention_runs" ALTER COLUMN "started_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "retention_runs" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ai_conversation_turns" ALTER COLUMN "asked_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ai_conversations" ALTER COLUMN "started_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ai_conversations" ALTER COLUMN "last_asked_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ai_evaluation_runs" ALTER COLUMN "run_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ai_outlook_snapshots" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ai_query_log" ALTER COLUMN "occurred_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ai_suggestions" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ai_suggestions" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "leadership_summaries" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "leadership_summaries" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "organizer_thank_notes" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "recognition_allowances" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "recognition_allowances" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "recognition_award_types" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "recognition_award_types" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "recognition_awards" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "recognition_awards" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "scenario_changes" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "scenario_collaborators" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "scenarios" ALTER COLUMN "baseline_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "scenarios" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "scenarios" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "variance_commentaries" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "variance_commentaries" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "wallet_claims" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "wallet_claims" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "wallet_programs" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "wallet_programs" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ecosystem_calls" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ecosystem_connections" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ecosystem_surfaces" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "ecosystem_surfaces" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "embedded_widgets" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "embedded_widgets" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "marketplace_bookings" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "marketplace_bookings" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "marketplace_offers" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "marketplace_offers" ALTER COLUMN "updated_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "marketplace_partners" ALTER COLUMN "created_at" SET DEFAULT app_now();--> statement-breakpoint
ALTER TABLE "marketplace_partners" ALTER COLUMN "updated_at" SET DEFAULT app_now();