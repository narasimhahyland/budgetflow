CREATE TABLE "finance_export_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" varchar(20) NOT NULL,
	"type" varchar(30) NOT NULL,
	"period" varchar(7) NOT NULL,
	"legal_entity_id" uuid,
	"entity_label" text NOT NULL,
	"target" varchar(20) DEFAULT 'file' NOT NULL,
	"status" varchar(20) DEFAULT 'sent' NOT NULL,
	"line_count" integer NOT NULL,
	"person_count" integer,
	"currency" char(3) NOT NULL,
	"debit_total_minor" bigint NOT NULL,
	"credit_total_minor" bigint NOT NULL,
	"reportable_currency" char(3),
	"reportable_total_minor" bigint,
	"duplicate" boolean DEFAULT false NOT NULL,
	"duplicate_reason" text,
	"csv_size_bytes" integer NOT NULL,
	"xlsx_size_bytes" integer NOT NULL,
	"acknowledgement_ref" varchar(200),
	"acknowledged_at" timestamp with time zone,
	"failure_message" text,
	"erp_document_number" varchar(100),
	"posted_at" timestamp with time zone,
	"posted_by_person_id" uuid,
	"created_by_person_id" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT app_now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT app_now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_export_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"source_type" varchar(20) NOT NULL,
	"source_ref" varchar(200) NOT NULL,
	"duplicate" boolean DEFAULT false NOT NULL,
	"journal_id" uuid,
	"ledger_line_id" uuid,
	"journal_line_no" integer,
	"accounting_date" date,
	"period_label" varchar(30),
	"legal_entity_id" uuid NOT NULL,
	"legal_entity_code" varchar(30) NOT NULL,
	"account" varchar(30),
	"account_name" text,
	"cost_center" varchar(50),
	"event_code" varchar(50),
	"description" text NOT NULL,
	"currency" char(3) NOT NULL,
	"debit_minor" bigint NOT NULL,
	"credit_minor" bigint NOT NULL,
	"transaction_currency" char(3) NOT NULL,
	"transaction_amount_minor" bigint NOT NULL,
	"rate" varchar(40),
	"person_id" uuid,
	"person_name" text,
	"benefit" text,
	"tax_year_from" date,
	"tax_year_to" date,
	"reportable_currency" char(3),
	"reportable_minor" bigint,
	"reportable_cumulative_minor" bigint,
	"created_at" timestamp with time zone DEFAULT app_now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_export_batches" ADD CONSTRAINT "finance_export_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_export_lines" ADD CONSTRAINT "finance_export_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_export_lines" ADD CONSTRAINT "finance_export_lines_batch_id_finance_export_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."finance_export_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_export_batches_number" ON "finance_export_batches" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "finance_export_batches_period" ON "finance_export_batches" USING btree ("tenant_id","period","type");--> statement-breakpoint
CREATE INDEX "finance_export_lines_batch" ON "finance_export_lines" USING btree ("batch_id","line_no");--> statement-breakpoint
CREATE INDEX "finance_export_lines_source" ON "finance_export_lines" USING btree ("tenant_id","source_type","source_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_export_lines_once" ON "finance_export_lines" USING btree ("tenant_id","source_type","source_ref") WHERE "finance_export_lines"."duplicate" = false;--> statement-breakpoint
-- Hand-written (gap B5): tenant isolation for both tables; export lines are append-only (an item is
-- exported once, a re-export is a new duplicate line, never an edit).
ALTER TABLE "finance_export_batches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "finance_export_batches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "finance_export_batches" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "finance_export_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "finance_export_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "finance_export_lines" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
CREATE TRIGGER finance_export_lines_append_only BEFORE UPDATE OR DELETE ON "finance_export_lines" FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER finance_export_lines_no_truncate BEFORE TRUNCATE ON "finance_export_lines" FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();
