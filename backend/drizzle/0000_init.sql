CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_sub" text,
	"email" text,
	"name" text,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_googleSub_unique" UNIQUE("google_sub"),
	CONSTRAINT "users_inviteTokenHash_unique" UNIQUE("invite_token_hash")
);
