import { Router } from "express";
import { asc, eq } from "drizzle-orm";
import { AskQuestionRequest, MAX_QUESTIONS } from "@artlyrics/shared";
import type { Db } from "../db/client.js";
import { questions } from "../db/schema.js";
import { conflict } from "../lib/errors.js";
import { modelLimiter } from "../middleware/rateLimit.js";
import type { ProviderFactory } from "../services/provider.js";
import { getSettings } from "../services/settings.js";
import { toModelImage } from "../services/images.js";
import type { Storage } from "../services/storage.js";
import { loadOwnedArtwork } from "./artworks.js";
import { toQuestionAnswer } from "./serializers.js";

export function questionsRouter(db: Db, storage: Storage, providers: ProviderFactory) {
  const r = Router();

  r.post("/artworks/:id/questions", modelLimiter, async (req, res, next) => {
    try {
      const { question } = AskQuestionRequest.parse(req.body);
      const art = await loadOwnedArtwork(db, req.params.id, req.sessionId);

      const prior = await db.select().from(questions).where(eq(questions.artworkId, art.id)).orderBy(asc(questions.position));
      if (prior.length >= MAX_QUESTIONS) {
        throw conflict("question_limit", `You have already asked ${MAX_QUESTIONS} questions about this artwork.`);
      }

      const image = await toModelImage(await storage.read(art.storagePath));
      const provider = providers(await getSettings(db, req.sessionId));
      const result = await provider.answerQuestion(image, prior, question);

      const position = prior.length + 1;
      let row;
      try {
        [row] = await db
          .insert(questions)
          .values({ artworkId: art.id, position, question, answer: result.answer })
          .returning();
      } catch (e: unknown) {
        // Unique (artwork_id, position) violation => concurrent request hit the cap first.
        if ((e as { code?: string }).code === "23505") {
          throw conflict("question_limit", `You have already asked ${MAX_QUESTIONS} questions about this artwork.`);
        }
        throw e;
      }
      res.status(201).json({ ...toQuestionAnswer(row), remaining: MAX_QUESTIONS - position });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
