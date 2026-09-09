import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { ComposeRequest } from "@artlyrics/shared";
import type { Db } from "../db/client.js";
import { analyses, questions } from "../db/schema.js";
import { modelLimiter } from "../middleware/rateLimit.js";
import type { ProviderFactory } from "../services/provider.js";
import { getSettings } from "../services/settings.js";
import { toModelImage } from "../services/images.js";
import type { Storage } from "../services/storage.js";
import { loadOwnedArtwork } from "./artworks.js";
import { toAnalysisRecord } from "./serializers.js";

export function composeRouter(db: Db, storage: Storage, providers: ProviderFactory) {
  const r = Router();

  r.post("/artworks/:id/compose", modelLimiter, async (req, res, next) => {
    try {
      const prefs = ComposeRequest.parse(req.body ?? {});
      const art = await loadOwnedArtwork(db, req.params.id, req.sessionId);
      const qa = await db.select().from(questions).where(eq(questions.artworkId, art.id)).orderBy(asc(questions.position));
      const image = await toModelImage(await storage.read(art.storagePath));

      const provider = providers(await getSettings(db, req.sessionId));
      const result = await provider.compose(image, qa, prefs);

      const [row] = await db
        .insert(analyses)
        .values({
          artworkId: art.id,
          analysis: result.composition.analysis,
          lyrics: result.composition.lyrics,
          style: result.composition.style,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          genrePreference: prefs.genre || null,
          styleNotes: prefs.styleNotes || null,
        })
        .returning();
      res.status(201).json(toAnalysisRecord(row));
    } catch (e) {
      next(e);
    }
  });

  return r;
}
