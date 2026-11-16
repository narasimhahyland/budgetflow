CREATE TABLE "expense_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" varchar(200) NOT NULL,
	"status" varchar(20) DEFAULT 'draft_created' NOT NULL,
	"fields" jsonb NOT NULL,
	"claimed_minor" bigint,
	"claimed_currency" char(3),
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT app_now() NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT app_now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_handoffs" ADD CONSTRAINT "expense_handoffs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_handoffs" ADD CONSTRAINT "expense_handoffs_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_handoffs" ADD CONSTRAINT "expense_handoffs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_handoffs" ADD CONSTRAINT "expense_handoffs_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_handoffs_request" ON "expense_handoffs" USING btree ("tenant_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_handoffs_external" ON "expense_handoffs" USING btree ("tenant_id","connection_id","external_id");--> statement-breakpoint
-- Hand-written (gap B7): tenant isolation for the hand-off table.
ALTER TABLE "expense_handoffs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "expense_handoffs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "expense_handoffs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
