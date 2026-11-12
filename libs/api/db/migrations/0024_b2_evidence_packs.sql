CREATE TABLE "evidence_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_type" varchar(20) NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_label" text NOT NULL,
	"contents" text[] DEFAULT '{}' NOT NULL,
	"include_attendees" boolean DEFAULT false NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"step" varchar(40),
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"storage_key" text,
	"file_name" text,
	"size_bytes" integer,
	"manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"manifest_sha256" varchar(64),
	"chain" jsonb,
	"error" text,
	"requested_by_person_id" uuid,
	"requested_at" timestamp with time zone DEFAULT app_now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence_packs" ADD CONSTRAINT "evidence_packs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_packs" ADD CONSTRAINT "evidence_packs_requested_by_person_id_people_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_packs_tenant" ON "evidence_packs" USING btree ("tenant_id","requested_at");--> statement-breakpoint
CREATE INDEX "evidence_packs_subject" ON "evidence_packs" USING btree ("tenant_id","subject_type","subject_id");--> statement-breakpoint
ALTER TABLE "evidence_packs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "evidence_packs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "evidence_packs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
