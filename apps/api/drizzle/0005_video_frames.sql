ALTER TABLE "artworks" ADD COLUMN "kind" text DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "frame_paths" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "duration_seconds" real;