CREATE TABLE "org_unit_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"manager_person_id" uuid,
	"legal_entity_id" uuid,
	"timezone" text,
	"change_kind" varchar(20) NOT NULL,
	"reason" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_units" ADD COLUMN "manager_person_id" uuid;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "org_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "category" varchar(50);--> statement-breakpoint
ALTER TABLE "vendors" ADD COLUMN "country" varchar(2);--> statement-breakpoint
ALTER TABLE "org_unit_versions" ADD CONSTRAINT "org_unit_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit_versions" ADD CONSTRAINT "org_unit_versions_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit_versions" ADD CONSTRAINT "org_unit_versions_parent_id_org_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit_versions" ADD CONSTRAINT "org_unit_versions_manager_person_id_people_id_fk" FOREIGN KEY ("manager_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_unit_versions" ADD CONSTRAINT "org_unit_versions_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_unit_versions_unit_from" ON "org_unit_versions" USING btree ("tenant_id","org_unit_id","valid_from");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-written (reviewed): tenant isolation for the new table and non-overlapping effective-dated ranges.
ALTER TABLE "org_unit_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_unit_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "org_unit_versions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "org_unit_versions" ADD CONSTRAINT "org_unit_versions_range_valid" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");--> statement-breakpoint
ALTER TABLE "org_unit_versions" ADD CONSTRAINT "org_unit_versions_no_overlap" EXCLUDE USING gist ("tenant_id" WITH =, "org_unit_id" WITH =, daterange("valid_from", "valid_to", '[]') WITH &&);--> statement-breakpoint
ALTER TABLE "gl_mappings" ADD CONSTRAINT "gl_mappings_no_overlap" EXCLUDE USING gist ("tenant_id" WITH =, "legal_entity_id" WITH =, "category_id" WITH =, "attendee_type" WITH =, daterange("valid_from", "valid_to", '[]') WITH &&);--> statement-breakpoint
ALTER TABLE "reporting_lines" ADD CONSTRAINT "reporting_lines_solid_no_overlap" EXCLUDE USING gist ("tenant_id" WITH =, "person_id" WITH =, daterange("valid_from", "valid_to", '[]') WITH &&) WHERE ("kind" = 'solid');
