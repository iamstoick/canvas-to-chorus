import type { Composition, ProviderName, ProviderSettings, QuestionAnswer } from "@artlyrics/shared";

export interface ModelImage {
  data: string; // base64
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
}

export interface AnswerResult {
  answer: string;
  model: string;
  usage: Usage;
}

export interface ComposeResult {
  composition: Composition;
  model: string;
  usage: Usage;
}

export type QA = Pick<QuestionAnswer, "question" | "answer">;

/** One vision-capable text model behind a common surface. Implemented by Anthropic and Ollama. */
export interface AnalysisProvider {
  readonly name: ProviderName;
  answerQuestion(image: ModelImage, prior: QA[], question: string): Promise<AnswerResult>;
  compose(image: ModelImage, qa: QA[]): Promise<ComposeResult>;
  /** Connectivity + model check used by the settings screen. */
  test(): Promise<{ ok: boolean; message: string; vision: boolean | null; availableModels?: string[] }>;
}

/** Builds a provider for a session's saved settings. */
export type ProviderFactory = (settings: ProviderSettings) => AnalysisProvider;
