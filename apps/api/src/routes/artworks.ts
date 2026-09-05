import { Router } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { analyses, artworks, questions } from "../db/schema.js";
import { badRequest, notFound } from "../lib/errors.js";
import { upload } from "../middleware/upload.js";
import { uploadLimiter } from "../middleware/rateLimit.js";
import { normalizeUpload } from "../services/images.js";
import type { Storage } from "../services/storage.js";
import { toAnalysisRecord, toArtworkSummary, toQuestionAnswer } from "./serializers.js";
import { SUGGESTED_QUESTIONS } from "../prompts/analyze.js";

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

  r.post("/artworks", uploadLimiter, upload.single("file"), async (req, res, next) => {
    try {
      if (!req.file) throw badRequest("missing_file", "Attach an image in the `file` field.");
      const img = await normalizeUpload(req.file.buffer);
      const storagePath = await storage.save(img.bytes, img.ext);
      const [row] = await db
        .insert(artworks)
        .values({
          sessionId: req.sessionId,
          originalName: req.file.originalname.slice(0, 255),
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

  r.get("/artworks/:id", async (req, res, next) => {
    try {
      const art = await loadOwnedArtwork(db, req.params.id, req.sessionId);
      const [qs, an] = await Promise.all([
        db.select().from(questions).where(eq(questions.artworkId, art.id)).orderBy(asc(questions.position)),
        db.select().from(analyses).where(eq(analyses.artworkId, art.id)).orderBy(desc(analyses.createdAt)),
      ]);
      res.json({
        artwork: toArtworkSummary(art),
        questions: qs.map(toQuestionAnswer),
        analyses: an.map(toAnalysisRecord),
        suggestedQuestions: SUGGESTED_QUESTIONS,
      });
    } catch (e) {
      next(e);
    }
  });

  r.get("/artworks/:id/image", async (req, res, next) => {
    try {
      const art = await loadOwnedArtwork(db, req.params.id, req.sessionId);
      const bytes = await storage.read(art.storagePath);
      res.setHeader("Content-Type", art.mimeType);
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
      await db.delete(artworks).where(eq(artworks.id, art.id));
      await storage.remove(art.storagePath);
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return r;
}
