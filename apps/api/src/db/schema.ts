import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { ArtworkAnalysis, Lyrics, SongTrack, StyleRecommendation } from "@artlyrics/shared";

export const artworks = pgTable(
  "artworks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    storagePath: text("storage_path").notNull(),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("artworks_session_idx").on(t.sessionId, t.createdAt)],
);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artworkId: uuid("artwork_id")
      .notNull()
      .references(() => artworks.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("questions_artwork_position_uq").on(t.artworkId, t.position),
    check("questions_position_range", sql`${t.position} BETWEEN 1 AND 5`),
  ],
);

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artworkId: uuid("artwork_id")
      .notNull()
      .references(() => artworks.id, { onDelete: "cascade" }),
    analysis: jsonb("analysis").$type<ArtworkAnalysis>().notNull(),
    lyrics: jsonb("lyrics").$type<Lyrics>().notNull(),
    style: jsonb("style").$type<StyleRecommendation>().notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    genrePreference: text("genre_preference"),
    styleNotes: text("style_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("analyses_artwork_idx").on(t.artworkId, t.createdAt)],
);

export type ArtworkRow = typeof artworks.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;
export type AnalysisRow = typeof analyses.$inferSelect;

export const providerSettings = pgTable("provider_settings", {
  sessionId: uuid("session_id").primaryKey(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  baseUrl: text("base_url"),
  cliPath: text("cli_path"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type ProviderSettingsRow = typeof providerSettings.$inferSelect;

export const songs = pgTable(
  "songs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    artworkId: uuid("artwork_id")
      .notNull()
      .references(() => artworks.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull().unique(),
    status: text("status").notNull().default("pending"),
    sunoStatus: text("suno_status"),
    model: text("model").notNull(),
    instrumental: boolean("instrumental").notNull().default(false),
    tracks: jsonb("tracks").$type<SongTrack[]>().notNull().default([]),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("songs_analysis_idx").on(t.analysisId, t.createdAt), index("songs_artwork_idx").on(t.artworkId)],
);
export type SongRow = typeof songs.$inferSelect;
