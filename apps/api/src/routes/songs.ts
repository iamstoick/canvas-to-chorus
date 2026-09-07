import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { CreateSongRequest, type SongRecord, type SongStatus, type SunoModel } from "@artlyrics/shared";
import { config } from "../config.js";
import type { Db } from "../db/client.js";
import { analyses, artworks, songs, type SongRow } from "../db/schema.js";
import { notFound } from "../lib/errors.js";
import { modelLimiter } from "../middleware/rateLimit.js";
import { applyCallback, buildSunoRequest, callbackToken, type SunoClient } from "../services/suno.js";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const TERMINAL: SongStatus[] = ["success", "failed"];
const POLL_THROTTLE_MS = 3000;

export const toSongRecord = (s: SongRow): SongRecord => ({
  id: s.id,
  analysisId: s.analysisId,
  taskId: s.taskId,
  status: s.status as SongStatus,
  model: s.model as SunoModel,
  instrumental: s.instrumental,
  tracks: s.tracks,
  error: s.error,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

export function songsRouter(db: Db, suno: SunoClient) {
  const r = Router();

  /** Start a Suno generation for one analysis (lyrics + style). */
  r.post("/analyses/:analysisId/songs", modelLimiter, async (req, res, next) => {
    try {
      const { analysisId } = req.params;
      if (!UUID_RE.test(analysisId)) throw notFound();
      const body = CreateSongRequest.parse(req.body ?? {});
      const [row] = await db
        .select({ analysis: analyses, sessionId: artworks.sessionId })
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

  /** Poll one song. Refreshes from Suno while the task is still running (throttled). */
  r.get("/songs/:id", async (req, res, next) => {
    try {
      if (!UUID_RE.test(req.params.id)) throw notFound();
      const [row] = await db
        .select({ song: songs })
        .from(songs)
        .innerJoin(artworks, eq(artworks.id, songs.artworkId))
        .where(and(eq(songs.id, req.params.id), eq(artworks.sessionId, req.sessionId)))
        .limit(1);
      if (!row) throw notFound("Song not found");
      let song = row.song;

      const stale = Date.now() - song.updatedAt.getTime() > POLL_THROTTLE_MS;
      if (!TERMINAL.includes(song.status as SongStatus) && stale) {
        const state = await suno.getTask(song.taskId);
        [song] = await db
          .update(songs)
          .set({ status: state.status, sunoStatus: state.sunoStatus ?? null, tracks: state.tracks, error: state.error, updatedAt: new Date() })
          .where(eq(songs.id, song.id))
          .returning();
      }
      res.json(toSongRecord(song));
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
      const updated = await db
        .update(songs)
        .set({ status: result.state.status, sunoStatus: result.state.sunoStatus ?? null, tracks: result.state.tracks, error: result.state.error, updatedAt: new Date() })
        .where(eq(songs.taskId, result.taskId))
        .returning({ id: songs.id });
      res.json({ ok: true, updated: updated.length });
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
