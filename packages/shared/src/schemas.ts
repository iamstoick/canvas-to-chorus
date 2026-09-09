import { z } from "zod/v4";

// ---------- Claude structured outputs ----------

export const ArtworkAnalysis = z.object({
  subject: z.string().describe("What the artwork depicts, in one or two sentences"),
  medium: z.string().describe("Apparent medium or technique, e.g. oil on canvas, digital, watercolor"),
  dominant_colors: z.array(z.string()).min(1).max(6).describe("Plain-language color names"),
  mood: z.array(z.string()).min(1).max(5).describe("Emotional tones the piece conveys"),
  composition: z.string().describe("How the elements are arranged and where the eye travels"),
  era_or_movement: z.string().describe("Likely art-historical era, movement, or style influence"),
  symbols_and_themes: z.array(z.string()).describe("Recurring motifs, symbols, or themes"),
  narrative: z.string().describe("A 2-3 sentence story the image seems to tell"),
});
export type ArtworkAnalysis = z.infer<typeof ArtworkAnalysis>;

export const LyricSectionType = z.enum(["verse", "pre-chorus", "chorus", "bridge", "outro"]);
export type LyricSectionType = z.infer<typeof LyricSectionType>;

export const LyricSection = z.object({
  type: LyricSectionType,
  lines: z.array(z.string()).min(2).max(8),
  /** How this section should be sung: dynamics, texture, intent. e.g. "barely above a whisper, close to the mic" */
  delivery: z.string().describe("Performance cue for the singer: dynamics, texture, emotional intent, in a few words"),
});
export type LyricSection = z.infer<typeof LyricSection>;

export const Lyrics = z.object({
  title: z.string(),
  /** The single feeling the song is really about, named plainly. */
  emotional_core: z.string().describe("The one true feeling underneath the song, in one sentence, plainly stated"),
  /** Who is singing, to whom, and what they want or cannot say. */
  point_of_view: z.string().describe("Who sings, to whom, and what they want or cannot bring themselves to say"),
  sections: z.array(LyricSection).min(3),
  /** Overall vocal direction: arc of intensity, where to break, breathe, hold back, let go. */
  performance_notes: z.string().describe("Vocal direction across the song: where it stays small, where it opens up, where the voice should crack or breathe"),
  rationale: z.string().describe("How the artwork and the user's questions shaped the lyrics"),
});
export type Lyrics = z.infer<typeof Lyrics>;

export const StyleRecommendation = z.object({
  primary_genre: z.string(),
  sub_genres: z.array(z.string()).max(3),
  tempo_bpm: z.object({ min: z.number().int().min(30).max(300), max: z.number().int().min(30).max(300) }),
  key_suggestion: z.string().describe("e.g. D minor"),
  instrumentation: z.array(z.string()).min(1),
  vocal_style: z.string(),
  reference_artists: z.array(z.string()).max(4).describe("Influences only, not artists to imitate"),
  why: z.string().describe("Why this style fits the artwork's mood, era and palette"),
});
export type StyleRecommendation = z.infer<typeof StyleRecommendation>;

export const Composition = z.object({
  analysis: ArtworkAnalysis,
  lyrics: Lyrics,
  style: StyleRecommendation,
});
export type Composition = z.infer<typeof Composition>;

// ---------- API request / response shapes ----------

export const MAX_QUESTIONS = 5;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

export const AskQuestionRequest = z.object({
  question: z.string().trim().min(3).max(500),
});
export type AskQuestionRequest = z.infer<typeof AskQuestionRequest>;

export const QuestionAnswer = z.object({
  id: z.string().uuid(),
  position: z.number().int().min(1).max(MAX_QUESTIONS),
  question: z.string(),
  answer: z.string(),
  createdAt: z.string(),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswer>;

export const ArtworkSummary = z.object({
  id: z.string().uuid(),
  originalName: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  imageUrl: z.string(),
  createdAt: z.string(),
});
export type ArtworkSummary = z.infer<typeof ArtworkSummary>;

export const AnalysisRecord = z.object({
  id: z.string().uuid(),
  composition: Composition,
  model: z.string(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  createdAt: z.string(),
  /** Songs generated from this analysis, newest first. */
  songs: z.array(z.lazy(() => SongRecord)).default([]),
  /** Genre the user asked for, or null when the artwork decided. */
  genrePreference: z.string().nullable().default(null),
  styleNotes: z.string().nullable().default(null),
});
export type AnalysisRecord = z.infer<typeof AnalysisRecord>;

export const ArtworkDetail = z.object({
  artwork: ArtworkSummary,
  questions: z.array(QuestionAnswer),
  analyses: z.array(AnalysisRecord),
});
export type ArtworkDetail = z.infer<typeof ArtworkDetail>;

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

// ---------- Provider settings ----------

export const ProviderName = z.enum(["claude-cli", "claude-proxy", "anthropic", "ollama"]);
export type ProviderName = z.infer<typeof ProviderName>;

export const CLAUDE_CLI_MODELS = ["haiku", "sonnet", "opus"] as const;

export const ProviderSettings = z.object({
  provider: ProviderName,
  model: z.string().trim().min(1).max(200),
  baseUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .nullable()
    .describe("Optional override. Ollama default http://localhost:11434; Anthropic default is the public API."),
  cliPath: z.string().trim().max(500).nullable().describe("Claude CLI / proxy: absolute path to the claude binary on the host. Null = auto-resolve."),
});
export type ProviderSettings = z.infer<typeof ProviderSettings>;

export const ProviderSettingsUpdate = ProviderSettings.partial({ baseUrl: true, cliPath: true }).extend({
  baseUrl: z.union([z.string().trim().url().max(500), z.literal(""), z.null()]).optional(),
  cliPath: z.union([z.string().trim().max(500), z.null()]).optional(),
});
export type ProviderSettingsUpdate = z.infer<typeof ProviderSettingsUpdate>;

export const ProviderTestResult = z.object({
  ok: z.boolean(),
  provider: ProviderName,
  model: z.string(),
  message: z.string(),
  /** Whether the model can see images. null when unknown. */
  vision: z.boolean().nullable(),
  availableModels: z.array(z.string()).optional(),
});
export type ProviderTestResult = z.infer<typeof ProviderTestResult>;

export const PROVIDER_DEFAULTS: Record<ProviderName, { model: string; baseUrl: string | null }> = {
  "claude-cli": { model: "haiku", baseUrl: null },
  "claude-proxy": { model: "haiku", baseUrl: "http://host.docker.internal:3099" },
  anthropic: { model: "claude-opus-5", baseUrl: null },
  ollama: { model: "qwen3:latest", baseUrl: "http://localhost:11434" },
};

// ---------- Song generation (Suno via sunoapi.org) ----------

export const SunoModel = z.enum(["V4", "V4_5", "V4_5PLUS", "V5", "V5_5"]);
export type SunoModel = z.infer<typeof SunoModel>;

export const SongStatus = z.enum(["pending", "text", "first", "success", "failed"]);
export type SongStatus = z.infer<typeof SongStatus>;

export const SongTrack = z.object({
  id: z.string(),
  title: z.string().nullable(),
  /** Suno-hosted MP3. Temporary: expires after some days. */
  audioUrl: z.string().nullable(),
  /** Suno-hosted stream. Only works while the task is running. */
  streamAudioUrl: z.string().nullable(),
  imageUrl: z.string().nullable(),
  duration: z.number().nullable(),
  /** Our copy of the MP3 in app storage (relative path or blob URL). */
  storedPath: z.string().nullable().default(null),
  /** What the player should use: our copy when available, else Suno's MP3, else the stream. */
  playbackUrl: z.string().nullable().default(null),
});
export type SongTrack = z.infer<typeof SongTrack>;

export const SongRecord = z.object({
  id: z.string().uuid(),
  analysisId: z.string().uuid(),
  taskId: z.string(),
  status: SongStatus,
  model: SunoModel,
  instrumental: z.boolean(),
  tracks: z.array(SongTrack),
  /** True once every finished track has been copied into app storage. */
  persisted: z.boolean().default(false),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SongRecord = z.infer<typeof SongRecord>;

export const CreateSongRequest = z.object({
  model: SunoModel.optional(),
  instrumental: z.boolean().optional(),
});
export type CreateSongRequest = z.infer<typeof CreateSongRequest>;

// ---------- Listing / admin ----------

export const ArtworkListItem = ArtworkSummary.extend({
  questionCount: z.number().int(),
  analysisCount: z.number().int(),
  songCount: z.number().int(),
  latestTitle: z.string().nullable(),
});
export type ArtworkListItem = z.infer<typeof ArtworkListItem>;

export const SessionSummary = z.object({
  sessionId: z.string().uuid(),
  artworkCount: z.number().int(),
  questionCount: z.number().int(),
  analysisCount: z.number().int(),
  songCount: z.number().int(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  firstSeen: z.string().nullable(),
  lastSeen: z.string().nullable(),
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

// ---------- Compose preferences ----------

export const GENRES = [
  "Pop",
  "Indie Pop",
  "Rock",
  "Alternative Rock",
  "Indie Folk",
  "Folk",
  "Country",
  "Blues",
  "Jazz",
  "Soul",
  "R&B",
  "Hip-Hop",
  "Trap",
  "Electronic",
  "Synthwave",
  "House",
  "Lo-fi",
  "Ambient",
  "Classical / Orchestral",
  "Cinematic",
  "Latin",
  "Reggae",
  "K-Pop",
  "OPM",
  "Gospel",
  "Metal",
  "Punk",
  "Bossa Nova",
] as const;

export const ComposeRequest = z.object({
  /** Genre the user wants. Empty/undefined = let the artwork decide. */
  genre: z.string().trim().max(60).optional(),
  /** Free-text direction, e.g. "female vocals, 80s synths, upbeat". */
  styleNotes: z.string().trim().max(240).optional(),
});
export type ComposeRequest = z.infer<typeof ComposeRequest>;
