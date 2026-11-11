ALTER TABLE "requests" ADD COLUMN "benefit_recipient_ids" uuid[];--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "non_employee_count" integer;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "alcohol_amount_minor" bigint;