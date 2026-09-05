import type { AnalysisRecord, ArtworkSummary, QuestionAnswer } from "@artlyrics/shared";
import type { AnalysisRow, ArtworkRow, QuestionRow } from "../db/schema.js";

export const toArtworkSummary = (a: ArtworkRow): ArtworkSummary => ({
  id: a.id,
  originalName: a.originalName,
  mimeType: a.mimeType,
  byteSize: a.byteSize,
  width: a.width,
  height: a.height,
  imageUrl: `/api/artworks/${a.id}/image`,
  createdAt: a.createdAt.toISOString(),
});

export const toQuestionAnswer = (q: QuestionRow): QuestionAnswer => ({
  id: q.id,
  position: q.position,
  question: q.question,
  answer: q.answer,
  createdAt: q.createdAt.toISOString(),
});

export const toAnalysisRecord = (r: AnalysisRow): AnalysisRecord => ({
  id: r.id,
  composition: { analysis: r.analysis, lyrics: r.lyrics, style: r.style },
  model: r.model,
  inputTokens: r.inputTokens,
  outputTokens: r.outputTokens,
  createdAt: r.createdAt.toISOString(),
});
