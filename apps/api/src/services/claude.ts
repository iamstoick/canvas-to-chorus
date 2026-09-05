import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Composition, type ProviderSettings } from "@artlyrics/shared";
import { config } from "../config.js";
import { unprocessable, upstream } from "../lib/errors.js";
import { ANALYST_SYSTEM_PROMPT } from "../prompts/analyze.js";
import { COMPOSER_SYSTEM_PROMPT, buildComposePrompt } from "../prompts/lyrics.js";

import type { AnalysisProvider, AnswerResult, ComposeResult, ModelImage, QA, Usage } from "./provider.js";
export type { AnswerResult, ComposeResult, ModelImage, Usage };

const clients = new Map<string, Anthropic>();
function getClient(baseURL: string | null): Anthropic {
  // Zero-arg constructor reads ANTHROPIC_API_KEY (or an `ant auth login` profile).
  const key = baseURL ?? "";
  let c = clients.get(key);
  if (!c) {
    c = new Anthropic(baseURL ? { baseURL } : {});
    clients.set(key, c);
  }
  return c;
}

/**
 * Server-side refusal fallbacks: on a policy decline the API re-runs the request on a
 * fallback model inside the same call. Enabled by default; set DISABLE_REFUSAL_FALLBACKS=1
 * to turn off.
 */
function fallbackParams() {
  if (config.anthropic.disableFallbacks) return { betas: [] as string[] };
  return { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
}

function imageBlock(image: ModelImage): Anthropic.Beta.BetaImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } };
}

function usageOf(msg: Anthropic.Beta.BetaMessage): Usage {
  return {
    inputTokens: msg.usage?.input_tokens ?? null,
    outputTokens: msg.usage?.output_tokens ?? null,
    cacheReadTokens: msg.usage?.cache_read_input_tokens ?? null,
  };
}

function textOf(msg: Anthropic.Beta.BetaMessage): string {
  return msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

function mapApiError(err: unknown): never {
  if (err instanceof Anthropic.RateLimitError) throw upstream("model_rate_limited", "The model is busy. Please retry shortly.");
  if (err instanceof Anthropic.AuthenticationError) throw upstream("model_auth", "Model credentials are missing or invalid.");
  if (err instanceof Anthropic.BadRequestError) throw upstream("model_bad_request", `The model rejected the request: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionError) throw upstream("model_unreachable", "Could not reach the model.");
  if (err instanceof Anthropic.APIError) throw upstream("model_error", `Model error (${err.status ?? "?"}).`);
  throw err;
}

export function anthropicProvider(settings: Pick<ProviderSettings, "model" | "baseUrl">): AnalysisProvider {
  const model = settings.model || config.anthropic.model;
  const client = () => getClient(settings.baseUrl);
  return {
    name: "anthropic",

    async test() {
      try {
        await client().models.retrieve(model);
        return { ok: true, message: `Connected. Model ${model} is available.`, vision: true };
      } catch (err) {
        if (err instanceof Anthropic.NotFoundError) return { ok: false, message: `Model ${model} was not found.`, vision: null };
        if (err instanceof Anthropic.AuthenticationError) return { ok: false, message: "ANTHROPIC_API_KEY is missing or invalid on the server.", vision: null };
        return { ok: false, message: err instanceof Error ? err.message : String(err), vision: null };
      }
    },

  async answerQuestion(image: ModelImage, prior: QA[], question: string): Promise<AnswerResult> {
    const history: Anthropic.Beta.BetaMessageParam[] = prior.flatMap((q) => [
      { role: "user", content: q.question },
      { role: "assistant", content: q.answer },
    ]);

    let msg: Anthropic.Beta.BetaMessage;
    try {
      msg = await client().beta.messages.create({
        model,
        max_tokens: 2000,
        ...fallbackParams(),
        // Image + system prompt form a stable prefix across the five questions -> cache hits on Q2..Q5.
        cache_control: { type: "ephemeral" },
        system: ANALYST_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [imageBlock(image), { type: "text", text: "Here is the artwork. I will ask questions about it." }],
          },
          ...history,
          { role: "user", content: question },
        ],
      });
    } catch (err) {
      mapApiError(err);
    }

    if (msg.stop_reason === "refusal") {
      throw unprocessable("model_refused", "The model declined to answer this question about the image.");
    }
    const answer = textOf(msg);
    if (!answer) throw upstream("empty_answer", "The model returned an empty answer.");
    return { answer, model: msg.model, usage: usageOf(msg) };
  },

  async compose(image: ModelImage, qa: QA[]): Promise<ComposeResult> {
    const request: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: 16000,
      ...fallbackParams(),
      system: COMPOSER_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [imageBlock(image), { type: "text", text: buildComposePrompt(qa) }],
        },
      ],
      output_config: { format: betaZodOutputFormat(Composition) },
    };

    // Structured output; one retry on a schema mismatch, then 502.
    for (let attempt = 0; attempt < 2; attempt++) {
      let msg: Anthropic.Beta.BetaMessage;
      try {
        msg = await client().beta.messages.create(request);
      } catch (err) {
        mapApiError(err);
      }
      if (msg.stop_reason === "refusal") {
        throw unprocessable("model_refused", "The model declined to compose for this image.");
      }
      if (msg.stop_reason === "max_tokens") {
        throw upstream("truncated", "The model's response was cut off. Please try again.");
      }
      let raw: unknown;
      try {
        raw = JSON.parse(textOf(msg));
      } catch {
        if (attempt === 0) continue;
        throw upstream("invalid_json", "The model returned malformed output.");
      }
      const parsed = Composition.safeParse(raw);
      if (parsed.success) return { composition: parsed.data, model: msg.model, usage: usageOf(msg) };
      if (attempt === 0) continue;
      throw upstream("schema_mismatch", `The model output did not match the expected shape: ${parsed.error.issues[0]?.message ?? ""}`);
    }
    throw upstream("compose_failed", "Composition failed.");
  },
  };
}
