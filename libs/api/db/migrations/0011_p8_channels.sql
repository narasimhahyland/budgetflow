CREATE TABLE "channel_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channel" varchar(20) NOT NULL,
	"recipient_person_id" uuid,
	"kind" varchar(60) NOT NULL,
	"subject_type" varchar(30),
	"subject_id" uuid,
	"status" varchar(20) DEFAULT 'sent' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"external_message_id" varchar(120),
	"error_message" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_account_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"provider_user_id" varchar(120) NOT NULL,
	"handle" varchar(120) NOT NULL,
	"verified_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"workspace_id" varchar(100) NOT NULL,
	"workspace_name" text NOT NULL,
	"status" varchar(30) DEFAULT 'not_connected' NOT NULL,
	"status_detail" text,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allowed_channels" text[] DEFAULT '{}' NOT NULL,
	"secret_ref" varchar(120) DEFAULT 'secret-store://chat/default' NOT NULL,
	"installed_by_person_id" uuid,
	"installed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_type" varchar(20) NOT NULL,
	"item_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"author_person_id" uuid NOT NULL,
	"body" text NOT NULL,
	"mentions" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by_person_id" uuid
);
--> statement-breakpoint
CREATE TABLE "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"audience_roles" text[] DEFAULT '{}' NOT NULL,
	"frequency" varchar(30) DEFAULT 'weekly' NOT NULL,
	"weekday" integer,
	"send_time" varchar(10) DEFAULT '08:30' NOT NULL,
	"channels_allowed" text[] DEFAULT '{"email"}' NOT NULL,
	"intro_line" text DEFAULT '' NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skip_when_empty" boolean DEFAULT true NOT NULL,
	"status" varchar(20) DEFAULT 'published' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"item_type" varchar(20) NOT NULL,
	"item_id" uuid NOT NULL,
	"level" varchar(30) DEFAULT 'all' NOT NULL,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"matrix" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"digest_frequency" varchar(20) DEFAULT 'daily' NOT NULL,
	"digest_channel" varchar(20) DEFAULT 'email' NOT NULL,
	"digest_send_time" varchar(10) DEFAULT '08:30' NOT NULL,
	"digest_template_id" uuid,
	"bundle_non_urgent" boolean DEFAULT false NOT NULL,
	"quiet_start" varchar(10) DEFAULT '20:00' NOT NULL,
	"quiet_end" varchar(10) DEFAULT '08:00' NOT NULL,
	"weekend_quiet" boolean DEFAULT true NOT NULL,
	"show_amounts_in_push" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"area" varchar(30) NOT NULL,
	"type" varchar(60) NOT NULL,
	"tone" varchar(20) DEFAULT 'neutral' NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"item_type" varchar(30),
	"item_id" uuid,
	"item_ref" varchar(40),
	"comment_id" uuid,
	"channels_delivered" text[] DEFAULT '{"in_app"}' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"device_label" text NOT NULL,
	"user_agent_family" varchar(80) NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_deliveries" ADD CONSTRAINT "channel_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_deliveries" ADD CONSTRAINT "channel_deliveries_recipient_person_id_people_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_account_links" ADD CONSTRAINT "chat_account_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_account_links" ADD CONSTRAINT "chat_account_links_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_installations" ADD CONSTRAINT "chat_installations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_installations" ADD CONSTRAINT "chat_installations_installed_by_person_id_people_id_fk" FOREIGN KEY ("installed_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_person_id_people_id_fk" FOREIGN KEY ("author_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_removed_by_person_id_people_id_fk" FOREIGN KEY ("removed_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digests" ADD CONSTRAINT "digests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_person_id_people_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_deliveries_tenant_created" ON "channel_deliveries" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "channel_deliveries_subject" ON "channel_deliveries" USING btree ("tenant_id","subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_account_links_person_provider" ON "chat_account_links" USING btree ("tenant_id","person_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_account_links_provider_user" ON "chat_account_links" USING btree ("tenant_id","provider","provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_installations_provider" ON "chat_installations" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE INDEX "comments_item_created" ON "comments" USING btree ("tenant_id","item_type","item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "digests_tenant_code" ON "digests" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "follows_person_item" ON "follows" USING btree ("tenant_id","person_id","item_type","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_person" ON "notification_preferences" USING btree ("tenant_id","person_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_created" ON "notifications" USING btree ("tenant_id","recipient_person_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread" ON "notifications" USING btree ("tenant_id","recipient_person_id","read_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_person" ON "push_subscriptions" USING btree ("tenant_id","person_id");--> statement-breakpoint
-- Hand-written (reviewed): tenant isolation for the Phase 8 tables.
ALTER TABLE "channel_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "channel_deliveries" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "chat_account_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_account_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "chat_account_links" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "chat_installations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_installations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "chat_installations" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "comments" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "digests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "digests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "digests" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "follows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "follows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "follows" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notification_preferences" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notifications" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "push_subscriptions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
