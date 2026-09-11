import "./setup.js";
import { describe, expect, it, vi } from "vitest";
import { extractJson, ollamaProvider, stripThinking } from "../src/services/ollama.js";

const image = { data: "AAAA", mediaType: "image/jpeg" as const };
const media = { kind: "image" as const, images: [image] };
const composition = {
  analysis: { subject: "s", medium: "m", dominant_colors: ["red"], mood: ["calm"], composition: "c", era_or_movement: "e", symbols_and_themes: [], narrative: "n" },
  lyrics: { title: "T", sections: [{ type: "verse", lines: ["a", "b"], delivery: "soft" }, { type: "chorus", lines: ["c", "d"], delivery: "soft" }, { type: "outro", lines: ["e", "f"], delivery: "soft" }], rationale: "r", emotional_core: "Wanting to be seen.", point_of_view: "One person to another", performance_notes: "Small, then open." },
  style: { primary_genre: "g", sub_genres: [], tempo_bpm: { min: 80, max: 90 }, key_suggestion: "C", instrumentation: ["piano"], vocal_style: "v", reference_artists: [], why: "w" },
};

function fakeFetch(handler: (url: string, body: any) => { status?: number; json?: unknown; text?: string }) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const r = handler(url, body);
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
}

describe("helpers", () => {
  it("strips think blocks", () => {
    expect(stripThinking("<think>hmm</think>\nAnswer")).toBe("Answer");
  });
  it("extracts JSON from fences and prose", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
  });
});

describe("ollamaProvider", () => {
  it("answers a question with image + replayed history and strips thinking", async () => {
    const fetch = fakeFetch((url, body) => {
      expect(url).toBe("http://ollama.test:11434/api/chat");
      expect(body.model).toBe("qwen2.5vl");
      expect(body.think).toBe(false);
      expect(body.messages[1].images).toEqual(["AAAA"]);
      expect(body.messages.map((m: any) => m.role)).toEqual(["system", "user", "user", "assistant", "user"]);
      return { json: { model: "qwen2.5vl", message: { role: "assistant", content: "<think>x</think>Melancholy." }, done: true, prompt_eval_count: 10, eval_count: 3 } };
    });
    const p = ollamaProvider({ model: "qwen2.5vl", baseUrl: "http://ollama.test:11434/" }, fetch);
    const r = await p.answerQuestion(media, [{ question: "q1", answer: "a1" }], "What mood?");
    expect(r.answer).toBe("Melancholy.");
    expect(r.model).toBe("ollama/qwen2.5vl");
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 3, cacheReadTokens: null });
  });

  it("composes with a JSON schema format and validates the result", async () => {
    const fetch = fakeFetch((_url, body) => {
      expect(body.format.type).toBe("object");
      expect(body.format.properties.lyrics).toBeDefined();
      return { json: { model: "m", message: { role: "assistant", content: JSON.stringify(composition) }, done: true } };
    });
    const r = await ollamaProvider({ model: "m", baseUrl: "http://x" }, fetch).compose(media, []);
    expect(r.composition.lyrics.title).toBe("T");
  });

  it("retries once on malformed output, then reports schema mismatch", async () => {
    let calls = 0;
    const fetch = fakeFetch(() => {
      calls++;
      return { json: { model: "m", message: { role: "assistant", content: '{"analysis":{}}' }, done: true } };
    });
    await expect(ollamaProvider({ model: "m", baseUrl: "http://x" }, fetch).compose(media, [])).rejects.toMatchObject({ status: 422, code: "schema_mismatch" });
    expect(calls).toBe(2);
  });

  it("maps a missing model to ollama_model_missing", async () => {
    const fetch = fakeFetch(() => ({ status: 404, text: '{"error":"model \\"nope\\" not found"}' }));
    await expect(ollamaProvider({ model: "nope", baseUrl: "http://x" }, fetch).answerQuestion(media, [], "q?")).rejects.toMatchObject({ code: "ollama_model_missing" });
  });

  it("maps a text-only model rejecting the image to 422 ollama_no_vision", async () => {
    const fetch = fakeFetch(() => ({ status: 400, text: '{"error":"Multimodal data provided, but model does not support multimodal requests."}' }));
    await expect(ollamaProvider({ model: "qwen3", baseUrl: "http://x" }, fetch).compose(media, [])).rejects.toMatchObject({ status: 422, code: "ollama_no_vision" });
  });

  it("maps connection failures to ollama_unreachable with the Docker hint", async () => {
    const fetch = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(ollamaProvider({ model: "m", baseUrl: "http://localhost:11434" }, fetch).answerQuestion(media, [], "q?")).rejects.toMatchObject({
      code: "ollama_unreachable",
      message: expect.stringContaining("host.docker.internal"),
    });
  });

  it("test() reports installed models and vision capability", async () => {
    const fetch = fakeFetch((url) => {
      if (url.endsWith("/api/tags")) return { json: { models: [{ name: "qwen3:latest" }, { name: "gemma3:4b" }] } };
      if (url.endsWith("/api/show")) return { json: { capabilities: ["completion", "thinking"] } };
      return { status: 500 };
    });
    const r = await ollamaProvider({ model: "qwen3", baseUrl: "http://x" }, fetch).test();
    expect(r.ok).toBe(true);
    expect(r.vision).toBe(false);
    expect(r.message).toMatch(/cannot see images/);
    expect(r.availableModels).toEqual(["qwen3:latest", "gemma3:4b"]);
  });

  it("test() flags a model that is not installed", async () => {
    const fetch = fakeFetch(() => ({ json: { models: [{ name: "qwen3:latest" }] } }));
    const r = await ollamaProvider({ model: "llava", baseUrl: "http://x" }, fetch).test();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/ollama pull llava/);
  });
});

describe("video frames through Ollama", () => {
  it("sends every frame in the images array with a frames intro", async () => {
    const fetch = fakeFetch((_url, body) => {
      expect(body.messages[1].images).toEqual(["AAAA", "AAAA"]);
      expect(body.messages[1].content).toContain("2 frames sampled in order");
      return { json: { model: "m", message: { role: "assistant", content: "ok" }, done: true } };
    });
    const r = await ollamaProvider({ model: "m", baseUrl: "http://x" }, fetch).answerQuestion({ kind: "video", images: [image, image] }, [], "q?");
    expect(r.answer).toBe("ok");
  });
});
