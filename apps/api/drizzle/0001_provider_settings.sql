CREATE TABLE "provider_settings" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"base_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
