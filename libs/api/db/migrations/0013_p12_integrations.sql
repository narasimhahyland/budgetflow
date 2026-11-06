CREATE TABLE "api_key_rate_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"api_key_id" uuid NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_key_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"api_key_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" varchar(10) NOT NULL,
	"path" varchar(300) NOT NULL,
	"status" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" varchar(20) DEFAULT 'public_api' NOT NULL,
	"name" text NOT NULL,
	"prefix" varchar(40) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"owner_person_id" uuid,
	"allowed_cidrs" text[] DEFAULT '{}' NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 120 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"rotated_from_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_event_id" varchar(200) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sync_run_id" uuid,
	"records_applied" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" varchar(40) NOT NULL,
	"category" varchar(20) NOT NULL,
	"display_name" text NOT NULL,
	"mode" varchar(10) DEFAULT 'mock' NOT NULL,
	"status" varchar(20) DEFAULT 'connected' NOT NULL,
	"attention" text,
	"base_url" text,
	"account_ref" varchar(120),
	"client_id" varchar(200),
	"secret_ref" uuid,
	"secret_set_at" timestamp with time zone,
	"secret_set_by" uuid,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cursors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_by" uuid,
	"last_sync_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" varchar(30) NOT NULL,
	"external_value" varchar(200) NOT NULL,
	"internal_id" uuid,
	"internal_value" varchar(200),
	"approved" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"sync_run_id" uuid,
	"direction" varchar(10) NOT NULL,
	"item" text NOT NULL,
	"error_class" varchar(30) NOT NULL,
	"last_error" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"first_failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_retry_at" timestamp with time zone,
	"moved_to_dead_letter_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'retrying' NOT NULL,
	"discard_reason_code" varchar(40),
	"discard_reason" text,
	"payload_redacted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_pushes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"event_id" uuid,
	"commitment_id" uuid,
	"reference" varchar(120) NOT NULL,
	"amount_minor" bigint,
	"currency" char(3),
	"valid_from" date,
	"valid_to" date,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"external_id" varchar(200),
	"last_error" text,
	"idempotency_key" varchar(200) NOT NULL,
	"pushed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purpose" varchar(40) NOT NULL,
	"algorithm" varchar(20) DEFAULT 'aes-256-gcm' NOT NULL,
	"iv" varchar(48) NOT NULL,
	"auth_tag" varchar(48) NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scim_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation" varchar(20) NOT NULL,
	"external_id" varchar(120) NOT NULL,
	"person_id" uuid,
	"result" varchar(20) NOT NULL,
	"detail" text NOT NULL,
	"token_id" uuid
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"object" varchar(30) NOT NULL,
	"direction" varchar(10) NOT NULL,
	"mode" varchar(10) NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"records_read" integer DEFAULT 0 NOT NULL,
	"records_applied" integer DEFAULT 0 NOT NULL,
	"records_skipped_duplicate" integer DEFAULT 0 NOT NULL,
	"records_failed" integer DEFAULT 0 NOT NULL,
	"cursor" varchar(200),
	"idempotency_key" varchar(200) NOT NULL,
	"import_batch_id" uuid,
	"error_summary" text,
	"triggered_by" uuid
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" varchar(60) NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"status_code" integer,
	"duration_ms" integer,
	"next_retry_at" timestamp with time zone,
	"error" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"events" text[] DEFAULT '{}' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"secret_ref" uuid,
	"previous_secret_ref" uuid,
	"secret_set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"secret_rotated_at" timestamp with time zone,
	"previous_secret_valid_until" timestamp with time zone,
	"failing_since" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_key_rate_windows" ADD CONSTRAINT "api_key_rate_windows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_rate_windows" ADD CONSTRAINT "api_key_rate_windows_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_requests" ADD CONSTRAINT "api_key_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_requests" ADD CONSTRAINT "api_key_requests_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_webhook_events" ADD CONSTRAINT "inbound_webhook_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_webhook_events" ADD CONSTRAINT "inbound_webhook_events_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_webhook_events" ADD CONSTRAINT "inbound_webhook_events_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_mappings" ADD CONSTRAINT "integration_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_mappings" ADD CONSTRAINT "integration_mappings_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_messages" ADD CONSTRAINT "integration_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_messages" ADD CONSTRAINT "integration_messages_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_messages" ADD CONSTRAINT "integration_messages_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_pushes" ADD CONSTRAINT "integration_pushes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_pushes" ADD CONSTRAINT "integration_pushes_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_pushes" ADD CONSTRAINT "integration_pushes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_pushes" ADD CONSTRAINT "integration_pushes_commitment_id_commitments_id_fk" FOREIGN KEY ("commitment_id") REFERENCES "public"."commitments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_secrets" ADD CONSTRAINT "integration_secrets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_operations" ADD CONSTRAINT "scim_operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scim_operations" ADD CONSTRAINT "scim_operations_token_id_api_keys_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_keys"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_rate_windows_window" ON "api_key_rate_windows" USING btree ("api_key_id","window_start");--> statement-breakpoint
CREATE INDEX "api_key_requests_key_at" ON "api_key_requests" USING btree ("tenant_id","api_key_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_tenant_kind" ON "api_keys" USING btree ("tenant_id","kind","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_webhook_events_external" ON "inbound_webhook_events" USING btree ("connection_id","external_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_provider" ON "integration_connections" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE INDEX "integration_connections_category" ON "integration_connections" USING btree ("tenant_id","category","status");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_mappings_entry" ON "integration_mappings" USING btree ("connection_id","kind","external_value");--> statement-breakpoint
CREATE INDEX "integration_mappings_tenant" ON "integration_mappings" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "integration_messages_status" ON "integration_messages" USING btree ("tenant_id","status","next_retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_messages_key" ON "integration_messages" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_pushes_key" ON "integration_pushes" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_pushes_connection" ON "integration_pushes" USING btree ("tenant_id","connection_id","kind");--> statement-breakpoint
CREATE INDEX "integration_secrets_tenant" ON "integration_secrets" USING btree ("tenant_id","purpose");--> statement-breakpoint
CREATE INDEX "scim_operations_tenant_at" ON "scim_operations" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX "sync_runs_tenant_started" ON "sync_runs" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "sync_runs_connection" ON "sync_runs" USING btree ("tenant_id","connection_id","object","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_runs_idempotency" ON "sync_runs" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint" ON "webhook_deliveries" USING btree ("tenant_id","endpoint_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_attempt" ON "webhook_deliveries" USING btree ("endpoint_id","event_id","attempt");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_tenant" ON "webhook_endpoints" USING btree ("tenant_id","status");
--> statement-breakpoint
-- Hand-written (reviewed): tenant isolation for the Phase 12 integration tables. The generator drops
-- these blocks, so re-append them after every `db:generate` run (db/rls-policies.spec.ts proves they exist).
ALTER TABLE "api_key_rate_windows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_key_rate_windows" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "api_key_rate_windows" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "api_key_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_key_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "api_key_requests" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "api_keys" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "inbound_webhook_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inbound_webhook_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "inbound_webhook_events" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "integration_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "integration_connections" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "integration_mappings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_mappings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "integration_mappings" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "integration_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "integration_messages" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "integration_pushes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_pushes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "integration_pushes" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "integration_secrets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integration_secrets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "integration_secrets" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "scim_operations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "scim_operations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "scim_operations" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "sync_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sync_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "sync_runs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "webhook_deliveries" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "webhook_endpoints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "webhook_endpoints" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Hand-written (reviewed): the key-usage and provisioning logs are append-only evidence.
REVOKE UPDATE, DELETE, TRUNCATE ON api_key_requests, scim_operations FROM bf_app, bf_worker;
--> statement-breakpoint
CREATE TRIGGER api_key_requests_append_only BEFORE UPDATE OR DELETE ON api_key_requests FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER api_key_requests_no_truncate BEFORE TRUNCATE ON api_key_requests FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER scim_operations_append_only BEFORE UPDATE OR DELETE ON scim_operations FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER scim_operations_no_truncate BEFORE TRUNCATE ON scim_operations FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();
