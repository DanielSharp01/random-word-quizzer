ALTER TABLE "attempts" ADD COLUMN "ranges" jsonb;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "scope_label" text;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "blank_rules" integer;