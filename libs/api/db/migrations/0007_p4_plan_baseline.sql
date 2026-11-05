ALTER TABLE "plan_versions" ADD COLUMN "new_money_finance_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD COLUMN "new_money_finance_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD COLUMN "new_money_ceo_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD COLUMN "new_money_ceo_approved_by" uuid;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_plan_version_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pv_status text;
BEGIN
  SELECT status::text INTO pv_status FROM plan_versions WHERE id = COALESCE(NEW.plan_version_id, OLD.plan_version_id);
  IF pv_status IS DISTINCT FROM 'draft' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'plan_version_line_immutable: lines of an approved plan version cannot be added';
    ELSIF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'plan_version_line_immutable: lines of an approved plan version cannot be removed';
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.budget_id IS NOT NULL AND NEW.budget_id IS DISTINCT FROM OLD.budget_id THEN
        RAISE EXCEPTION 'plan_version_line_immutable: budget link cannot change once set';
      END IF;
      IF NEW.plan_version_id IS DISTINCT FROM OLD.plan_version_id
        OR NEW.line_no IS DISTINCT FROM OLD.line_no
        OR NEW.code IS DISTINCT FROM OLD.code
        OR NEW.name IS DISTINCT FROM OLD.name
        OR NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id
        OR NEW.cost_center_id IS DISTINCT FROM OLD.cost_center_id
        OR NEW.owner_person_id IS DISTINCT FROM OLD.owner_person_id
        OR NEW.category_code IS DISTINCT FROM OLD.category_code
        OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
        OR NEW.currency IS DISTINCT FROM OLD.currency
        OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
        RAISE EXCEPTION 'plan_version_line_immutable: only linking budget_id is allowed on approved plan lines';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER plan_version_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON plan_version_lines
  FOR EACH ROW EXECUTE FUNCTION app_plan_version_line_guard();
