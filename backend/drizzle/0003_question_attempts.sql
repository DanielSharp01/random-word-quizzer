CREATE TYPE "public"."attempt_kind" AS ENUM('blanks', 'questions');--> statement-breakpoint
CREATE TYPE "public"."checked_by" AS ENUM('match', 'ai');--> statement-breakpoint
CREATE TABLE "questions" (
	"attempt_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"source_block" integer NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"key_points" jsonb NOT NULL,
	"guess" text,
	"verdict" "verdict",
	"feedback" text,
	"checked_by" "checked_by",
	"answered_at" timestamp with time zone,
	CONSTRAINT "questions_attempt_id_position_pk" PRIMARY KEY("attempt_id","position")
);
--> statement-breakpoint
ALTER TABLE "attempts" ALTER COLUMN "seed" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attempts" ALTER COLUMN "percent" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attempts" ALTER COLUMN "min_length" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "kind" "attempt_kind" DEFAULT 'blanks' NOT NULL;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "from_block" integer;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "to_block" integer;--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "item_count" integer;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;