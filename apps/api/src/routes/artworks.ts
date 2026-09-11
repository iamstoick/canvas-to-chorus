import { Router } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { analyses, artworks, questions } from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";
import { uploadFields } from "../middleware/upload.js";
import { uploadLimiter } from "../middleware/rateLimit.js";
import { normalizeUpload } from "../services/images.js";
import type { Storage } from "../services/storage.js";
import { toAnalysisRecord, toArtworkSummary, toQuestionAnswer } from "./serializers.js";
import { SUGGESTED_QUESTIONS, SUGGESTED_VIDEO_QUESTIONS } from "../prompts/analyze.js";
import { artworkFilePaths } from "../services/media.js";
import { ALLOWED_VIDEO_MIME, MAX_VIDEO_FRAMES } from "@artlyrics/shared";
import { songsByAnalysis, storedTrackPaths } from "./songs.js";
import { listArtworks } from "./admin.js";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Loads an artwork scoped to the caller's session or throws 404. */
export async function loadOwnedArtwork(db: Db, id: string, sessionId: string) {
  if (!UUID_RE.test(id)) throw notFound();
  const [row] = await db
    .select()
    .from(artworks)
    .where(and(eq(artworks.id, id), eq(artworks.sessionId, sessionId)))
    .limit(1);
  if (!row) throw notFound("Artwork not found");
  return row;
}

export function artworksRouter(db: Db, storage: Storage) {
  const r = Router();

  r.post("/artworks", uploadLimiter, uploadFields, async (req, res, next) => {
    try {
      const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
      const single = files.file?.[0];
      const frames = files.frames ?? [];
      const posterFile = files.poster?.[0];

      if (frames.length > 0) {
        // ---- video: frames extracted in the browser, plus an optional poster ----
        if (frames.length > MAX_VIDEO_FRAMES) throw badRequest("too_many_frames", `At most ${MAX_VIDEO_FRAMES} frames.`);
        const normalized = await Promise.all(frames.map((f) => normalizeUpload(f.buffer)));
        const framePaths = await Promise.all(normalized.map((n) => storage.save(n.bytes, n.ext)));
        let posterPath = framePaths[Math.floor(framePaths.length / 2)];
        let poster = normalized[Math.floor(normalized.length / 2)];
        if (posterFile) {
          poster = await normalizeUpload(posterFile.buffer);
          posterPath = await storage.save(poster.bytes, poster.ext);
        }
        const duration = Number(req.body?.durationSeconds);
        const originalName = String(req.body?.originalName || frames[0].originalname || "video").slice(0, 255);
        const mimeType = String(req.body?.mimeType || "video/mp4");
        if (!(ALLOWED_VIDEO_MIME as readonly string[]).includes(mimeType)) throw badRequest("unsupported_type", `Only ${ALLOWED_VIDEO_MIME.join(", ")} videos are accepted.`);
        const [row] = await db
          .insert(artworks)
          .values({
            sessionId: req.sessionId,
            kind: "video",
            originalName,
            mimeType,
            byteSize: normalized.reduce((n, f) => n + f.bytes.byteLength, 0),
            storagePath: posterPath,
            framePaths,
            durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
            width: poster.width,
            height: poster.height,
          })
          .returning();
        res.status(201).json(toArtworkSummary(row));
        return;
      }

      // ---- still image ----
      if (!single) throw badRequest("missing_file", "Attach an image in the `file` field, or video frames in `frames`.");
      const img = await normalizeUpload(single.buffer);
      const storagePath = await storage.save(img.bytes, img.ext);
      const [row] = await db
        .insert(artworks)
        .values({
          sessionId: req.sessionId,
          kind: "image",
          originalName: single.originalname.slice(0, 255),
          mimeType: img.mimeType,
          byteSize: img.bytes.byteLength,
          storagePath,
          width: img.width,
          height: img.height,
        })
        .returning();
      res.status(201).json(toArtworkSummary(row));
    } catch (e) {
      next(e);
    }
  });

  r.get("/artworks", async (req, res, next) => {
    try {
      res.json({ sessionId: req.sessionId, artworks: await listArtworks(db, req.sessionId) });
    } catch (e) {
      next(e);
    }
  });

  r.get("/artworks/:id", async (req, res, next) => {
    try {
      const art = await loadOwnedArtwork(db, req.params.id, req.sessionId);
      const [qs, an, songMap] = await Promise.all([
        db.select().from(questions).where(eq(questions.artworkId, art.id)).orderBy(asc(questions.position)),
        db.select().from(analyses).where(eq(analyses.artworkId, art.id)).orderBy(desc(analyses.createdAt)),
        songsByAnalysis(db, art.id),
      ]);
      res.json({
        artwork: toArtworkSummary(art),
        questions: qs.map(toQuestionAnswer),
        analyses: an.map((a) => toAnalysisRecord(a, songMap.get(a.id) ?? [])),
        songsEnabled: Boolean(process.env.SUNO_API_KEY),
        suggestedQuestions: art.kind === "video" ? SUGGESTED_VIDEO_QUESTIONS : SUGGESTED_QUESTIONS,
      });
    } catch (e) {
      next(e);
    }
  });

  r.get("/artworks/:id/frames/:index", async (req, res, next) => {
    try {
      const art = await loadOwnedArtwork(db, req.params.id, req.sessionId);
      const p = art.framePaths[Number(req.params.index)];
      if (!p) throw notFound("Frame not found");
      const bytes = await storage.read(p);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.send(bytes);
    } catch (e) {
      next(e);
    }
  });

  r.get("/artworks/:id/image", async (req, res, next) => {
    try {
      const art = await loadOwnedArtwork(db, req.params.id, req.sessionId);
      const bytes = await storage.read(art.storagePath);
      // Video posters are re-encoded frames (JPEG); images keep their own type.
      res.setHeader("Content-Type", art.kind === "video" ? "image/jpeg" : art.mimeType);
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.setHeader("Content-Disposition", "inline");
      res.send(bytes);
    } catch (e) {
      next(e);
    }
  });

  r.delete("/artworks/:id", async (req, res, next) => {
    try {
      const art = await loadOwnedArtwork(db, req.params.id, req.sessionId);
      const trackPaths = await storedTrackPaths(db, [art.id]);
      await db.delete(artworks).where(eq(artworks.id, art.id));
      await Promise.all([...artworkFilePaths(art), ...trackPaths].map((p) => storage.remove(p).catch(() => {})));
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return r;
}
