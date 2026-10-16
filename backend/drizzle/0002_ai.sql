CREATE TABLE "ai_connection" (
	"id" text PRIMARY KEY DEFAULT 'chatgpt' NOT NULL,
	"host_id" text NOT NULL,
	"client_id" text,
	"sealed_tokens" text,
	"expires_at" timestamp with time zone,
	"earliest_refresh_at" timestamp with time zone,
	"account_email" text,
	"broken" boolean DEFAULT false NOT NULL,
	"model" text,
	"hourly_token_limit" integer DEFAULT 50000 NOT NULL,
	"daily_token_limit" integer DEFAULT 300000 NOT NULL,
	"max_output_tokens" integer DEFAULT 2000 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"minute" timestamp with time zone PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_owner" boolean DEFAULT false NOT NULL;