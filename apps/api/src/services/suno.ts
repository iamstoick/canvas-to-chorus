import { createHash } from "node:crypto";
import { lyricsToText, type Composition, type SongStatus, type SongTrack, type SunoModel } from "@artlyrics/shared";
import { config } from "../config.js";
import { HttpError, upstream } from "../lib/errors.js";

/** Field limits per model in custom mode (sunoapi.org docs). */
const LIMITS: Record<SunoModel, { prompt: number; style: number; title: number }> = {
  V4: { prompt: 3000, style: 200, title: 80 },
  V4_5: { prompt: 5000, style: 1000, title: 100 },
  V4_5PLUS: { prompt: 5000, style: 1000, title: 100 },
  V5: { prompt: 5000, style: 1000, title: 100 },
  V5_5: { prompt: 5000, style: 1000, title: 100 },
};

const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");

export interface SunoGenerateRequest {
  prompt: string;
  style: string;
  title: string;
  model: SunoModel;
  instrumental: boolean;
  callBackUrl: string;
}

/** Turns a composition into Suno custom-mode fields. Reference artists are deliberately excluded (Suno rejects artist names). */
export function buildSunoRequest(
  composition: Composition,
  model: SunoModel,
  instrumental: boolean,
  callBackUrl: string,
): SunoGenerateRequest {
  const { lyrics, style } = composition;
  const lim = LIMITS[model];
  // "instrumental" goes first so it survives clipping on models with a 200-char style limit.
  const styleParts = [
    ...(instrumental ? ["instrumental"] : []),
    style.primary_genre,
    ...style.sub_genres,
    `${style.tempo_bpm.min}-${style.tempo_bpm.max} BPM`,
    style.key_suggestion,
    ...style.instrumentation,
    ...(instrumental ? [] : [`${style.vocal_style} vocals`]),
  ].filter(Boolean);
  return {
    prompt: instrumental ? "" : clip(lyricsToText(lyrics, { includeTitle: false }), lim.prompt),
    style: clip(styleParts.join(", "), lim.style),
    title: clip(lyrics.title, lim.title),
    model,
    instrumental,
    callBackUrl,
  };
}

/** Raw sunoapi.org track shape (both record-info and callback use it). */
interface RawTrack {
  id?: string;
  title?: string;
  audio_url?: string;
  audioUrl?: string;
  stream_audio_url?: string;
  streamAudioUrl?: string;
  image_url?: string;
  imageUrl?: string;
  duration?: number;
}

export function mapTrack(t: RawTrack): SongTrack {
  return {
    id: t.id ?? "",
    title: t.title ?? null,
    audioUrl: t.audio_url ?? t.audioUrl ?? null,
    streamAudioUrl: t.stream_audio_url ?? t.streamAudioUrl ?? null,
    imageUrl: t.image_url ?? t.imageUrl ?? null,
    duration: typeof t.duration === "number" ? t.duration : null,
  };
}

/** Maps Suno task status to ours. CALLBACK_EXCEPTION means only the webhook failed; audio may exist. */
export function mapStatus(sunoStatus: string | undefined, tracks: SongTrack[]): SongStatus {
  switch (sunoStatus) {
    case "PENDING":
      return "pending";
    case "TEXT_SUCCESS":
      return "text";
    case "FIRST_SUCCESS":
      return "first";
    case "SUCCESS":
      return "success";
    case "CALLBACK_EXCEPTION":
      return tracks.some((t) => t.audioUrl) ? "success" : "failed";
    case "CREATE_TASK_FAILED":
    case "GENERATE_AUDIO_FAILED":
    case "SENSITIVE_WORD_ERROR":
      return "failed";
    default:
      return tracks.some((t) => t.audioUrl) ? "success" : "pending";
  }
}

export function friendlyError(sunoStatus: string | undefined, message?: string): string {
  if (sunoStatus === "SENSITIVE_WORD_ERROR") return "Suno flagged the lyrics or style as containing sensitive words. Regenerate the lyrics and try again.";
  if (sunoStatus === "CREATE_TASK_FAILED") return `Suno could not start the task${message ? `: ${message}` : ""}.`;
  if (sunoStatus === "GENERATE_AUDIO_FAILED") return `Suno failed while generating audio${message ? `: ${message}` : ""}.`;
  return message || "Song generation failed.";
}

/** Callbacks are unauthenticated, so the URL carries a token derived from the API key. */
export function callbackToken(apiKey: string): string {
  return createHash("sha256").update(`artlyrics-suno-callback:${apiKey}`).digest("hex").slice(0, 32);
}

export interface SunoTaskState {
  sunoStatus: string | undefined;
  status: SongStatus;
  tracks: SongTrack[];
  error: string | null;
}

export interface SunoClient {
  readonly configured: boolean;
  generate(req: SunoGenerateRequest): Promise<string>;
  getTask(taskId: string): Promise<SunoTaskState>;
}

export function sunoClient(fetchImpl: typeof fetch = fetch, apiKey = config.suno.apiKey, baseUrl = config.suno.baseUrl): SunoClient {
  async function call<T>(path: string, init: RequestInit): Promise<T> {
    if (!apiKey) throw new HttpError(503, "suno_not_configured", "Song generation is not configured. Set SUNO_API_KEY on the server.");
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw upstream("suno_unreachable", "Could not reach the Suno API.");
    }
    const body = (await res.json().catch(() => ({}))) as { code?: number; msg?: string; data?: T };
    const code = body.code ?? res.status;
    if (code === 200 && res.ok) return body.data as T;
    // sunoapi.org codes: https://docs.sunoapi.org — note 429 is *credits*, not rate limiting.
    const detail = body.msg ? ` (${body.msg})` : "";
    switch (code) {
      case 401:
        throw upstream("suno_auth", `SUNO_API_KEY was rejected by sunoapi.org${detail}.`);
      case 429:
        throw new HttpError(402, "suno_insufficient_credits", `Your sunoapi.org account has no credits left. Top up at sunoapi.org, then try again${detail}.`);
      case 405:
      case 430:
        throw upstream("suno_rate_limited", `Suno rate limit reached. Try again in a moment${detail}.`);
      case 413:
        throw new HttpError(422, "suno_too_long", `Suno rejected the request as too long${detail}. Regenerate shorter lyrics.`);
      case 400:
      case 422:
        throw new HttpError(422, "suno_bad_request", `Suno rejected the request${detail}.`);
      case 455:
        throw upstream("suno_maintenance", `Suno is under maintenance${detail}. Try again later.`);
      default:
        throw upstream("suno_error", `Suno API error ${code}${detail}.`);
    }
  }

  return {
    configured: Boolean(apiKey),

    async generate(req) {
      const data = await call<{ taskId?: string }>("/api/v1/generate", {
        method: "POST",
        body: JSON.stringify({
          customMode: true,
          instrumental: req.instrumental,
          model: req.model,
          prompt: req.prompt,
          style: req.style,
          title: req.title,
          callBackUrl: req.callBackUrl,
        }),
      });
      if (!data?.taskId) throw upstream("suno_error", "Suno did not return a task id.");
      return data.taskId;
    },

    async getTask(taskId) {
      const data = await call<{ status?: string; errorMessage?: string; response?: { sunoData?: RawTrack[] } }>(
        `/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
        { method: "GET" },
      );
      const tracks = (data?.response?.sunoData ?? []).map(mapTrack);
      const status = mapStatus(data?.status, tracks);
      return { sunoStatus: data?.status, status, tracks, error: status === "failed" ? friendlyError(data?.status, data?.errorMessage) : null };
    },
  };
}

/** Body sunoapi.org POSTs to callBackUrl. */
export interface SunoCallbackBody {
  code?: number;
  msg?: string;
  data?: { callbackType?: "text" | "first" | "complete" | "error"; task_id?: string; taskId?: string; data?: RawTrack[] | null };
}

export function applyCallback(body: SunoCallbackBody): { taskId: string; state: SunoTaskState } | null {
  const taskId = body.data?.task_id ?? body.data?.taskId;
  if (!taskId) return null;
  const tracks = (body.data?.data ?? []).map(mapTrack);
  const type = body.data?.callbackType;
  let status: SongStatus;
  if (type === "error" || (body.code !== undefined && body.code !== 200)) status = "failed";
  else if (type === "complete") status = "success";
  else if (type === "first") status = "first";
  else if (type === "text") status = "text";
  else status = tracks.some((t) => t.audioUrl) ? "success" : "pending";
  const sunoStatus = status === "failed" ? "CALLBACK_ERROR" : type ? `CALLBACK_${type.toUpperCase()}` : undefined;
  return { taskId, state: { sunoStatus, status, tracks, error: status === "failed" ? friendlyError(undefined, body.msg) : null } };
}
