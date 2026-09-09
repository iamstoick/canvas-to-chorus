import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { CreateSongRequest, type SongRecord, type SongStatus, type SongTrack, type SunoModel } from "@artlyrics/shared";
import { config } from "../config.js";
import type { Db } from "../db/client.js";
import { analyses, artworks, songs, type SongRow } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { modelLimiter } from "../middleware/rateLimit.js";
import type { Storage } from "../services/storage.js";
import { applyCallback, buildSunoRequest, callbackToken, mergeTracks, type SunoClient } from "../services/suno.js";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const TERMINAL: SongStatus[] = ["success", "failed"];
const POLL_THROTTLE_MS = 3000;

function playbackUrl(songId: string, index: number, t: SongTrack): string | null {
  if (t.storedPath) return `/api/songs/${songId}/tracks/${index}/audio`;
  // Suno's MP3 outlives the stream URL, which dies once generation completes.
  return t.audioUrl ?? t.streamAudioUrl ?? null;
}

export const toSongRecord = (s: SongRow): SongRecord => ({
  id: s.id,
  analysisId: s.analysisId,
  taskId: s.taskId,
  status: s.status as SongStatus,
  model: s.model as SunoModel,
  instrumental: s.instrumental,
  tracks: s.tracks.map((t, i) => ({ ...t, storedPath: t.storedPath ?? null, playbackUrl: playbackUrl(s.id, i, t) })),
  persisted: s.status === "success" && s.tracks.length > 0 && s.tracks.every((t) => Boolean(t.storedPath) || !t.audioUrl),
  error: s.error,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

/**
 * Copies finished MP3s from Suno's temporary hosting into our storage. Best effort: a failed
 * download leaves storedPath null so the next poll retries. Returns the updated row.
 */
export async function persistTracks(db: Db, storage: Storage, song: SongRow, fetchImpl: typeof fetch = fetch): Promise<SongRow> {
  if (song.status !== "success") return song;
  let changed = false;
  const tracks = await Promise.all(
    song.tracks.map(async (t) => {
      if (t.storedPath || !t.audioUrl) return t;
      try {
        const res = await fetchImpl(t.audioUrl, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) return t;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.byteLength < 1024) return t; // expired/empty placeholder, not a real file
        const storedPath = await storage.save(bytes, "mp3");
        changed = true;
        return { ...t, storedPath };
      } catch (e) {
        console.warn("song persist failed", (e as Error).message);
        return t;
      }
    }),
  );
  if (!changed) return song;
  const [updated] = await db.update(songs).set({ tracks, updatedAt: new Date() }).where(eq(songs.id, song.id)).returning();
  return updated;
}

export function songsRouter(db: Db, storage: Storage, suno: SunoClient) {
  const r = Router();

  async function loadOwnedSong(id: string, sessionId: string): Promise<SongRow> {
    if (!UUID_RE.test(id)) throw notFound();
    const [row] = await db
      .select({ song: songs })
      .from(songs)
      .innerJoin(artworks, eq(artworks.id, songs.artworkId))
      .where(and(eq(songs.id, id), eq(artworks.sessionId, sessionId)))
      .limit(1);
    if (!row) throw notFound("Song not found");
    return row.song;
  }

  /** Start a Suno generation for one analysis (lyrics + style). */
  r.post("/analyses/:analysisId/songs", modelLimiter, async (req, res, next) => {
    try {
      const { analysisId } = req.params;
      if (!UUID_RE.test(analysisId)) throw notFound();
      const body = CreateSongRequest.parse(req.body ?? {});
      const [row] = await db
        .select({ analysis: analyses })
        .from(analyses)
        .innerJoin(artworks, eq(artworks.id, analyses.artworkId))
        .where(and(eq(analyses.id, analysisId), eq(artworks.sessionId, req.sessionId)))
        .limit(1);
      if (!row) throw notFound("Analysis not found");

      const model = (body.model ?? config.suno.model) as SunoModel;
      const instrumental = body.instrumental ?? false;
      const origin = config.suno.publicBaseUrl ?? `${req.protocol}://${req.get("host")}`;
      const callBackUrl = `${origin}/api/songs/callback?token=${callbackToken(config.suno.apiKey ?? "")}`;

      const request = buildSunoRequest(
        { analysis: row.analysis.analysis, lyrics: row.analysis.lyrics, style: row.analysis.style },
        model,
        instrumental,
        callBackUrl,
      );
      const taskId = await suno.generate(request);

      const [song] = await db
        .insert(songs)
        .values({ analysisId, artworkId: row.analysis.artworkId, taskId, model, instrumental, status: "pending" })
        .returning();
      res.status(201).json(toSongRecord(song));
    } catch (e) {
      next(e);
    }
  });

  /** Poll one song. Refreshes from Suno while running (throttled); copies MP3s into storage once done. */
  r.get("/songs/:id", async (req, res, next) => {
    try {
      let song = await loadOwnedSong(req.params.id, req.sessionId);
      const stale = Date.now() - song.updatedAt.getTime() > POLL_THROTTLE_MS;
      if (!TERMINAL.includes(song.status as SongStatus) && stale) {
        const state = await suno.getTask(song.taskId);
        [song] = await db
          .update(songs)
          .set({ status: state.status, sunoStatus: state.sunoStatus ?? null, tracks: mergeTracks(song.tracks, state.tracks), error: state.error, updatedAt: new Date() })
          .where(eq(songs.id, song.id))
          .returning();
      }
      song = await persistTracks(db, storage, song);
      res.json(toSongRecord(song));
    } catch (e) {
      next(e);
    }
  });

  /** Serves our stored copy of a take, with Range support so seeking works. */
  r.get("/songs/:id/tracks/:index/audio", async (req, res, next) => {
    try {
      const song = await loadOwnedSong(req.params.id, req.sessionId);
      const track = song.tracks[Number(req.params.index)];
      if (!track?.storedPath) throw notFound("Audio not stored");
      const bytes = await storage.read(track.storedPath);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "private, max-age=86400");
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), bytes.byteLength - 1) : bytes.byteLength - 1;
        if (start >= bytes.byteLength || start > end) {
          res.status(416).setHeader("Content-Range", `bytes */${bytes.byteLength}`).end();
          return;
        }
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.byteLength}`);
        res.setHeader("Content-Length", String(end - start + 1));
        res.end(bytes.subarray(start, end + 1));
        return;
      }
      res.setHeader("Content-Length", String(bytes.byteLength));
      res.end(bytes);
    } catch (e) {
      next(e);
    }
  });

  /** Suno webhook. Verified by the token embedded in the callback URL. Always 200 so Suno stops retrying. */
  r.post("/songs/callback", async (req, res) => {
    const token = String(req.query.token ?? "");
    if (!config.suno.apiKey || token !== callbackToken(config.suno.apiKey)) {
      res.status(401).json({ error: { code: "unauthorized", message: "bad callback token" } });
      return;
    }
    const result = applyCallback(req.body ?? {});
    if (!result) {
      res.status(200).json({ ok: false, reason: "no task id" });
      return;
    }
    try {
      const [existing] = await db.select().from(songs).where(eq(songs.taskId, result.taskId)).limit(1);
      if (!existing) {
        res.json({ ok: false, reason: "unknown task" });
        return;
      }
      const [updated] = await db
        .update(songs)
        .set({
          status: result.state.status,
          sunoStatus: result.state.sunoStatus ?? null,
          tracks: mergeTracks(existing.tracks, result.state.tracks),
          error: result.state.error,
          updatedAt: new Date(),
        })
        .where(eq(songs.id, existing.id))
        .returning();
      res.json({ ok: true });
      // After responding: copy the MP3s while Suno's links are fresh.
      void persistTracks(db, storage, updated).catch((e) => console.warn("persist after callback failed", e));
    } catch (e) {
      console.error("suno callback failed", e);
      res.status(200).json({ ok: false });
    }
  });

  return r;
}

/** Songs for every analysis of an artwork, newest first, keyed by analysis id. */
export async function songsByAnalysis(db: Db, artworkId: string): Promise<Map<string, SongRecord[]>> {
  const rows = await db.select().from(songs).where(eq(songs.artworkId, artworkId)).orderBy(desc(songs.createdAt));
  const map = new Map<string, SongRecord[]>();
  for (const s of rows) {
    const list = map.get(s.analysisId) ?? [];
    list.push(toSongRecord(s));
    map.set(s.analysisId, list);
  }
  return map;
}

/** Storage paths of every stored take for the given artworks (for cleanup before cascade delete). */
export async function storedTrackPaths(db: Db, artworkIds: string[]): Promise<string[]> {
  const paths: string[] = [];
  for (const id of artworkIds) {
    const rows = await db.select({ tracks: songs.tracks }).from(songs).where(eq(songs.artworkId, id));
    for (const r of rows) for (const t of r.tracks) if (t.storedPath) paths.push(t.storedPath);
  }
  return paths;
}
