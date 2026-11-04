ALTER TYPE "public"."integrity_flag_kind" ADD VALUE 'negative_bucket';--> statement-breakpoint
ALTER TYPE "public"."integrity_flag_kind" ADD VALUE 'over_allocated';--> statement-breakpoint
ALTER TYPE "public"."integrity_flag_kind" ADD VALUE 'triplet_mismatch';--> statement-breakpoint
-- Reviewed: the (tenant_id, id) keys are created before the composite foreign keys that reference them.
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_tenant_id_key" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_cost_center_id_cost_centers_id_fk";
--> statement-breakpoint
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_org_unit_id_org_units_id_fk";
--> statement-breakpoint
ALTER TABLE "budgets" DROP CONSTRAINT "budgets_owner_person_id_people_id_fk";
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_parent_same_tenant_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "public"."budgets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_cost_center_same_tenant_fk" FOREIGN KEY ("tenant_id","cost_center_id") REFERENCES "public"."cost_centers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_org_unit_same_tenant_fk" FOREIGN KEY ("tenant_id","org_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_owner_same_tenant_fk" FOREIGN KEY ("tenant_id","owner_person_id") REFERENCES "public"."people"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-written (reviewed): a journal's lines are written in the transaction that created the journal;
-- nobody, the application role included, can append lines to a committed journal. A journal row is
-- visible only to its tenant (RLS) and its xmin is the inserting transaction, which cannot be forged.
-- Journals and their lines must be inserted in the same transaction level (no savepoint around the
-- journal insert), because xmin of a row written inside a savepoint is the subtransaction's id.
CREATE OR REPLACE FUNCTION app_reject_lines_on_committed_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  creator xid;
BEGIN
  SELECT j.xmin INTO creator FROM ledger_journals j WHERE j.id = NEW.journal_id;
  IF creator IS NULL OR creator <> pg_current_xact_id()::xid THEN
    RAISE EXCEPTION 'ledger_lines: journal % was not created in this transaction; lines are written with their journal and corrections are reversals', NEW.journal_id USING ERRCODE = 'BF001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_lines_same_transaction_as_journal BEFORE INSERT ON ledger_lines FOR EACH ROW EXECUTE FUNCTION app_reject_lines_on_committed_journal();
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_reject_lines_on_committed_journal() TO bf_app, bf_worker;
