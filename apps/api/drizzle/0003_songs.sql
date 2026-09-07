CREATE TABLE "songs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"artwork_id" uuid NOT NULL,
	"task_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"suno_status" text,
	"model" text NOT NULL,
	"instrumental" boolean DEFAULT false NOT NULL,
	"tracks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "songs_task_id_unique" UNIQUE("task_id")
);
--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "songs" ADD CONSTRAINT "songs_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "songs_analysis_idx" ON "songs" USING btree ("analysis_id","created_at");--> statement-breakpoint
CREATE INDEX "songs_artwork_idx" ON "songs" USING btree ("artwork_id");