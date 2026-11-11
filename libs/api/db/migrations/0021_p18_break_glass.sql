ALTER TABLE "break_glass_grants" ALTER COLUMN "valid_from" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ALTER COLUMN "valid_to" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD COLUMN "status" varchar(20) DEFAULT 'requested' NOT NULL;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD COLUMN "scope" varchar(40) DEFAULT 'budgets_and_ledger' NOT NULL;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD COLUMN "requested_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD COLUMN "requested_by_name" text;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD COLUMN "decision_reason" text;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD COLUMN "revoked_by" uuid;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "break_glass_grants" ADD COLUMN "revoke_reason" text;--> statement-breakpoint
CREATE INDEX "break_glass_status" ON "break_glass_grants" USING btree ("tenant_id","status");--> statement-breakpoint
-- Before this migration a row was a grant the moment it existed (it always had a window), so every
-- existing row keeps that meaning. Runs as the owner role, which bypasses RLS here.
UPDATE "break_glass_grants" SET "status" = 'approved', "decided_at" = "created_at" WHERE "valid_from" IS NOT NULL;
