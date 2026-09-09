import { z } from "zod/v4";
import { Composition, type ComposeRequest, type ProviderSettings } from "@artlyrics/shared";
import { config } from "../config.js";
import { unprocessable, upstream } from "../lib/errors.js";
import { ANALYST_SYSTEM_PROMPT } from "../prompts/analyze.js";
import { COMPOSER_SYSTEM_PROMPT, buildComposePrompt } from "../prompts/lyrics.js";
import type { AnalysisProvider, AnswerResult, ComposeResult, ModelImage, QA, Usage } from "./provider.js";

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

const COMPOSITION_JSON_SCHEMA = z.toJSONSchema(Composition);

/** Strip <think>…</think> blocks some local models emit even when asked not to. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** Pull the first JSON object out of a response that may carry fences or prose around it. */
export function extractJson(text: string): unknown {
  const cleaned = stripThinking(text).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("no JSON object found");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function joinUrl(base: string, path: string) {
  return `${base.replace(/\/+$/, "")}${path}`;
}

export function ollamaProvider(settings: Pick<ProviderSettings, "model" | "baseUrl">, fetchImpl: typeof fetch = fetch): AnalysisProvider {
  const baseUrl = settings.baseUrl || config.ollama.baseUrl;
  const model = settings.model || config.ollama.model;

  async function post<T>(path: string, body: unknown, timeoutMs = config.ollama.timeoutMs): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(joinUrl(baseUrl, path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === "TimeoutError" ? "timed out" : "is unreachable";
      throw upstream(
        "ollama_unreachable",
        `Ollama at ${baseUrl} ${reason}. Is it running? From Docker use http://host.docker.internal:11434 instead of localhost.`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (/multimodal|does not support images|image input/i.test(text)) {
        throw unprocessable(
          "ollama_no_vision",
          `Model "${model}" cannot see images. Switch to a vision model in Model settings, e.g. run: ollama pull qwen2.5vl`,
        );
      }
      if (res.status === 404 || /not found/i.test(text)) {
        throw upstream("ollama_model_missing", `Model "${model}" is not available in Ollama. Run: ollama pull ${model}`);
      }
      throw upstream("ollama_error", `Ollama returned ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  function usageOf(r: OllamaChatResponse): Usage {
    return { inputTokens: r.prompt_eval_count ?? null, outputTokens: r.eval_count ?? null, cacheReadTokens: null };
  }

  async function chat(messages: OllamaMessage[], format?: unknown): Promise<OllamaChatResponse> {
    const r = await post<OllamaChatResponse>("/api/chat", {
      model,
      messages,
      stream: false,
      // Ask thinking models (qwen3, deepseek-r1) to skip the scratchpad; ignored by others.
      think: false,
      ...(format ? { format } : {}),
      options: { temperature: 0.7, num_ctx: 8192 },
    });
    if (r.done_reason === "length") throw upstream("truncated", "The model's response was cut off. Please try again.");
    return r;
  }

  return {
    name: "ollama",

    async test() {
      let tags: { models?: { name: string }[] };
      try {
        const res = await fetchImpl(joinUrl(baseUrl, "/api/tags"), { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        tags = (await res.json()) as typeof tags;
      } catch {
        return {
          ok: false,
          vision: null,
          message: `Could not reach Ollama at ${baseUrl}. From Docker use http://host.docker.internal:11434 instead of localhost.`,
        };
      }
      const availableModels = (tags.models ?? []).map((m) => m.name);
      const present = availableModels.some((n) => n === model || n === `${model}:latest` || n.split(":")[0] === model);
      if (!present) {
        return { ok: false, vision: null, availableModels, message: `Model "${model}" is not installed. Run: ollama pull ${model}` };
      }
      let vision: boolean | null = null;
      try {
        const show = await post<{ capabilities?: string[] }>("/api/show", { model }, 5000);
        vision = show.capabilities ? show.capabilities.includes("vision") : null;
      } catch {
        vision = null;
      }
      const message =
        vision === false
          ? `Connected, but "${model}" cannot see images. Artwork analysis needs a vision model such as qwen2.5vl, gemma3, llava or llama3.2-vision.`
          : `Connected. Model ${model} is available${vision ? " and supports images" : ""}.`;
      return { ok: true, vision, availableModels, message };
    },

    async answerQuestion(image: ModelImage, prior: QA[], question: string): Promise<AnswerResult> {
      const messages: OllamaMessage[] = [
        { role: "system", content: ANALYST_SYSTEM_PROMPT },
        { role: "user", content: "Here is the artwork. I will ask questions about it.", images: [image.data] },
        ...prior.flatMap<OllamaMessage>((q) => [
          { role: "user", content: q.question },
          { role: "assistant", content: q.answer },
        ]),
        { role: "user", content: question },
      ];
      const r = await chat(messages);
      const answer = stripThinking(r.message?.content ?? "");
      if (!answer) throw upstream("empty_answer", "The model returned an empty answer.");
      return { answer, model: `ollama/${r.model ?? model}`, usage: usageOf(r) };
    },

    async compose(image: ModelImage, qa: QA[], prefs?: ComposeRequest): Promise<ComposeResult> {
      const messages: OllamaMessage[] = [
        { role: "system", content: `${COMPOSER_SYSTEM_PROMPT}\n\nRespond with a single JSON object that matches the provided schema. No prose.` },
        { role: "user", content: buildComposePrompt(qa, prefs), images: [image.data] },
      ];
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await chat(messages, COMPOSITION_JSON_SCHEMA);
        let raw: unknown;
        try {
          raw = extractJson(r.message?.content ?? "");
        } catch {
          if (attempt === 0) continue;
          throw upstream("invalid_json", "The model returned malformed output.");
        }
        const parsed = Composition.safeParse(raw);
        if (parsed.success) return { composition: parsed.data, model: `ollama/${r.model ?? model}`, usage: usageOf(r) };
        if (attempt === 0) continue;
        throw unprocessable(
          "schema_mismatch",
          `The model output did not match the expected shape (${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}). A larger or vision-capable model usually fixes this.`,
        );
      }
      throw upstream("compose_failed", "Composition failed.");
    },
  };
}
