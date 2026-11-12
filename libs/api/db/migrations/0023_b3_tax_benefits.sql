CREATE TABLE "benefit_thresholds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"jurisdiction" varchar(10) NOT NULL,
	"legal_entity_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"benefit_types" text[] NOT NULL,
	"limit_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"basis" varchar(20) NOT NULL,
	"max_occasions" integer,
	"period_start_month" integer NOT NULL,
	"period_start_day" integer NOT NULL,
	"exceeded" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"comment" text,
	"created_by_person_id" uuid,
	"submitted_by_person_id" uuid,
	"submitted_at" timestamp with time zone,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT app_now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT app_now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"effective_from" date,
	"comment" text,
	"created_by_person_id" uuid,
	"submitted_by_person_id" uuid,
	"submitted_at" timestamp with time zone,
	"decided_by_person_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT app_now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT app_now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"category_code" varchar(50) NOT NULL,
	"attendee_type" varchar(20) NOT NULL,
	"tax_code" varchar(30) NOT NULL,
	"recoverable_bps" integer,
	"proportional" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT app_now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commitment_tax_lines" ADD COLUMN "rule_id" uuid;--> statement-breakpoint
ALTER TABLE "commitment_tax_lines" ADD COLUMN "share_bps" integer;--> statement-breakpoint
ALTER TABLE "commitment_tax_lines" ADD COLUMN "currency" char(3);--> statement-breakpoint
ALTER TABLE "commitment_tax_lines" ADD COLUMN "net_minor" bigint;--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD COLUMN "legal_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD COLUMN "entry_date" date;--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD COLUMN "source_type" varchar(20);--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD COLUMN "reporting_currency" char(3);--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD COLUMN "reporting_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD COLUMN "reversal_of_id" uuid;--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD COLUMN "created_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "tax_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "actual_tax_lines" ADD COLUMN "rule_id" uuid;--> statement-breakpoint
ALTER TABLE "actual_tax_lines" ADD COLUMN "share_bps" integer;--> statement-breakpoint
ALTER TABLE "actual_tax_lines" ADD COLUMN "currency" char(3);--> statement-breakpoint
ALTER TABLE "benefit_thresholds" ADD CONSTRAINT "benefit_thresholds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benefit_thresholds" ADD CONSTRAINT "benefit_thresholds_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rule_sets" ADD CONSTRAINT "tax_rule_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_rule_set_id_tax_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."tax_rule_sets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "benefit_thresholds_version" ON "benefit_thresholds" USING btree ("tenant_id","code","version");--> statement-breakpoint
CREATE INDEX "benefit_thresholds_status" ON "benefit_thresholds" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_rule_sets_version" ON "tax_rule_sets" USING btree ("tenant_id","version");--> statement-breakpoint
CREATE INDEX "tax_rule_sets_status" ON "tax_rule_sets" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "tax_rules_set" ON "tax_rules" USING btree ("tenant_id","rule_set_id");--> statement-breakpoint
ALTER TABLE "employee_benefit_ledger" ADD CONSTRAINT "employee_benefit_ledger_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_benefit_ledger_date" ON "employee_benefit_ledger" USING btree ("tenant_id","entry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_benefit_ledger_source" ON "employee_benefit_ledger" USING btree ("tenant_id","source_type","source_id","person_id") WHERE "employee_benefit_ledger"."source_id" is not null and "employee_benefit_ledger"."reversal_of_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_benefit_ledger_reversal" ON "employee_benefit_ledger" USING btree ("tenant_id","reversal_of_id") WHERE "employee_benefit_ledger"."reversal_of_id" is not null;--> statement-breakpoint
-- Hand-written (gap B3): tenant isolation for the new tables, append-only tax lines and benefit
-- entries, and published tax rules and thresholds that never change.
ALTER TABLE "tax_rule_sets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tax_rule_sets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tax_rule_sets" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "tax_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tax_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tax_rules" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "benefit_thresholds" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "benefit_thresholds" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "benefit_thresholds" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Nothing reads or wrote these three tables before B3, so the append-only guard starts on empty tables.
CREATE TRIGGER commitment_tax_lines_append_only BEFORE UPDATE OR DELETE ON "commitment_tax_lines" FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER commitment_tax_lines_no_truncate BEFORE TRUNCATE ON "commitment_tax_lines" FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER actual_tax_lines_append_only BEFORE UPDATE OR DELETE ON "actual_tax_lines" FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER actual_tax_lines_no_truncate BEFORE TRUNCATE ON "actual_tax_lines" FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER employee_benefit_ledger_append_only BEFORE UPDATE OR DELETE ON "employee_benefit_ledger" FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER employee_benefit_ledger_no_truncate BEFORE TRUNCATE ON "employee_benefit_ledger" FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();
--> statement-breakpoint
-- A published (or superseded) version is immutable: the only change allowed is published → superseded
-- (and, for thresholds, the end date that goes with it). Deleting it is never allowed.
CREATE OR REPLACE FUNCTION app_reject_published_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('published', 'superseded') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION '% version % is published and cannot be deleted', TG_TABLE_NAME, OLD.id USING ERRCODE = 'BF001';
    END IF;
    IF NOT (OLD.status = 'published' AND NEW.status = 'superseded')
       OR (to_jsonb(NEW) - 'status' - 'effective_to' - 'updated_at') <> (to_jsonb(OLD) - 'status' - 'effective_to' - 'updated_at') THEN
      RAISE EXCEPTION '% version % is published and cannot change; draft a new version', TG_TABLE_NAME, OLD.id USING ERRCODE = 'BF001';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER tax_rule_sets_published_immutable BEFORE UPDATE OR DELETE ON "tax_rule_sets" FOR EACH ROW EXECUTE FUNCTION app_reject_published_change();
--> statement-breakpoint
CREATE TRIGGER benefit_thresholds_published_immutable BEFORE UPDATE OR DELETE ON "benefit_thresholds" FOR EACH ROW EXECUTE FUNCTION app_reject_published_change();
--> statement-breakpoint
-- Rules belong to their set: they change only while the set is a draft or returned to finance.
CREATE OR REPLACE FUNCTION app_reject_locked_tax_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  st text;
BEGIN
  SELECT status INTO st FROM tax_rule_sets WHERE id = COALESCE(NEW.rule_set_id, OLD.rule_set_id);
  IF st IS NULL OR st NOT IN ('draft', 'returned') THEN
    RAISE EXCEPTION 'tax rules of a % rule set cannot change', COALESCE(st, 'missing') USING ERRCODE = 'BF001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.rule_set_id <> NEW.rule_set_id THEN
    RAISE EXCEPTION 'a tax rule cannot move to another rule set' USING ERRCODE = 'BF001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER tax_rules_locked BEFORE INSERT OR UPDATE OR DELETE ON "tax_rules" FOR EACH ROW EXECUTE FUNCTION app_reject_locked_tax_rule();
