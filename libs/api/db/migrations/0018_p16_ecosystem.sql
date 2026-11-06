CREATE TABLE "ecosystem_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid,
	"widget_id" uuid,
	"surface" varchar(20) NOT NULL,
	"operation" varchar(80) NOT NULL,
	"outcome" varchar(30) NOT NULL,
	"records_returned" integer DEFAULT 0 NOT NULL,
	"refused_origin" varchar(200),
	"actor_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecosystem_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"person_id" uuid,
	"client_key" varchar(120) NOT NULL,
	"label" text NOT NULL,
	"token_prefix" varchar(40) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"grants" text[] DEFAULT '{}' NOT NULL,
	"consent_text" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ecosystem_surfaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"surface" varchar(20) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embedded_widgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" varchar(30) NOT NULL,
	"allowed_origins" text[] DEFAULT '{}' NOT NULL,
	"show_amounts" boolean DEFAULT true NOT NULL,
	"event_count" integer DEFAULT 3 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"offer_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"requested_by_person_id" uuid,
	"people_count" integer NOT NULL,
	"requested_date" date NOT NULL,
	"notes" text,
	"status" varchar(30) DEFAULT 'waiting_for_partner' NOT NULL,
	"partner_reference" varchar(120),
	"quoted_price_per_head_minor" bigint,
	"quoted_currency" char(3),
	"decline_reason" text,
	"alternatives" text[] DEFAULT '{}' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"external_ref" varchar(120) NOT NULL,
	"title" text NOT NULL,
	"category" varchar(30) NOT NULL,
	"city" varchar(80) NOT NULL,
	"price_per_head_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"capacity_min" integer DEFAULT 1 NOT NULL,
	"capacity_max" integer DEFAULT 1 NOT NULL,
	"rating_bps" integer,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"includes" text[] DEFAULT '{}' NOT NULL,
	"cancellation_terms" text DEFAULT '' NOT NULL,
	"delivery_countries" text[] DEFAULT '{}' NOT NULL,
	"status" varchar(20) DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(60) NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"cities" text[] DEFAULT '{}' NOT NULL,
	"vendor_id" uuid,
	"mode" varchar(10) DEFAULT 'mock' NOT NULL,
	"status" varchar(20) DEFAULT 'paused' NOT NULL,
	"base_url" text,
	"last_synced_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ecosystem_calls" ADD CONSTRAINT "ecosystem_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem_connections" ADD CONSTRAINT "ecosystem_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ecosystem_surfaces" ADD CONSTRAINT "ecosystem_surfaces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embedded_widgets" ADD CONSTRAINT "embedded_widgets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_bookings" ADD CONSTRAINT "marketplace_bookings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_bookings" ADD CONSTRAINT "marketplace_bookings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_offers" ADD CONSTRAINT "marketplace_offers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_partners" ADD CONSTRAINT "marketplace_partners_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ecosystem_calls_connection" ON "ecosystem_calls" USING btree ("tenant_id","connection_id","created_at");--> statement-breakpoint
CREATE INDEX "ecosystem_calls_surface" ON "ecosystem_calls" USING btree ("tenant_id","surface","created_at");--> statement-breakpoint
CREATE INDEX "ecosystem_calls_widget" ON "ecosystem_calls" USING btree ("tenant_id","widget_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ecosystem_connections_token" ON "ecosystem_connections" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "ecosystem_connections_person" ON "ecosystem_connections" USING btree ("tenant_id","kind","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ecosystem_surfaces_surface" ON "ecosystem_surfaces" USING btree ("tenant_id","surface");--> statement-breakpoint
CREATE INDEX "embedded_widgets_tenant" ON "embedded_widgets" USING btree ("tenant_id","status","name");--> statement-breakpoint
CREATE INDEX "marketplace_bookings_event" ON "marketplace_bookings" USING btree ("tenant_id","event_id","status");--> statement-breakpoint
CREATE INDEX "marketplace_bookings_offer" ON "marketplace_bookings" USING btree ("tenant_id","offer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_offers_external" ON "marketplace_offers" USING btree ("tenant_id","partner_id","external_ref");--> statement-breakpoint
CREATE INDEX "marketplace_offers_browse" ON "marketplace_offers" USING btree ("tenant_id","status","city","category");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_partners_slug" ON "marketplace_partners" USING btree ("tenant_id","slug");--> statement-breakpoint
ALTER TABLE "ecosystem_calls" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ecosystem_calls" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ecosystem_calls" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "ecosystem_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ecosystem_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ecosystem_connections" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "ecosystem_surfaces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ecosystem_surfaces" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ecosystem_surfaces" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "embedded_widgets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "embedded_widgets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "embedded_widgets" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "marketplace_bookings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "marketplace_bookings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "marketplace_bookings" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "marketplace_offers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "marketplace_offers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "marketplace_offers" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "marketplace_partners" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "marketplace_partners" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "marketplace_partners" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Hand-written (reviewed): the call log is what an admin reads to see what an outside tool actually
-- did with a connection, so it is append-only. Nothing rewrites or trims it.
REVOKE UPDATE, DELETE, TRUNCATE ON ecosystem_calls FROM bf_app, bf_worker;
--> statement-breakpoint
CREATE TRIGGER ecosystem_calls_append_only BEFORE UPDATE OR DELETE ON ecosystem_calls FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER ecosystem_calls_no_truncate BEFORE TRUNCATE ON ecosystem_calls FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();
