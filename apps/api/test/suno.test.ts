import "./setup.js";
import { describe, expect, it, vi } from "vitest";
import { applyCallback, buildSunoRequest, callbackToken, mapStatus, sunoClient } from "../src/services/suno.js";

const composition = {
  analysis: { subject: "s", medium: "m", dominant_colors: ["red"], mood: ["calm"], composition: "c", era_or_movement: "e", symbols_and_themes: [], narrative: "n" },
  lyrics: {
    title: "Still Center",
    sections: [
      { type: "verse" as const, lines: ["Rust ground holds me close", "One glow, pale and true"], delivery: "soft" },
      { type: "chorus" as const, lines: ["Hold the horizon", "Hold it for me"], delivery: "soft" },
      { type: "outro" as const, lines: ["Fade", "Away"], delivery: "soft" },
    ],
    rationale: "r", emotional_core: "Wanting to be seen.", point_of_view: "One person to another", performance_notes: "Small, then open.",
  },
  style: {
    primary_genre: "Indie Folk",
    sub_genres: ["chamber folk"],
    tempo_bpm: { min: 65, max: 85 },
    key_suggestion: "D minor",
    instrumentation: ["acoustic guitar", "cello"],
    vocal_style: "hushed, intimate",
    reference_artists: ["Bon Iver"],
    why: "w",
  },
};

describe("buildSunoRequest", () => {
  it("maps lyrics, style and title; excludes artists; tags sections", () => {
    const r = buildSunoRequest(composition, "V4_5", false, "https://x/cb");
    expect(r.prompt.startsWith("[Verse 1 – soft]\nRust ground")).toBe(true);
    expect(r.prompt).toContain("[Chorus – soft]");
    expect(r.prompt).not.toContain("Still Center");
    expect(r.style.startsWith("Indie Folk, emotive, expressive, dynamic human vocal performance, chamber folk, 65-85 BPM, D minor, acoustic guitar, cello, hushed, intimate vocals")).toBe(true);
    expect(r.style).toContain("Small, then open.");
    expect(r.style).not.toContain("Bon Iver");
    expect(r.title).toBe("Still Center");
    expect(r.callBackUrl).toBe("https://x/cb");
  });

  it("clips to V4 limits and blanks the prompt for instrumental", () => {
    const long = { ...composition, style: { ...composition.style, instrumentation: Array(60).fill("very long instrument name") } };
    const r = buildSunoRequest(long, "V4", true, "https://x/cb");
    expect(r.style.length).toBeLessThanOrEqual(200);
    expect(r.style).toContain("instrumental");
    expect(r.prompt).toBe("");
  });
});

describe("mapStatus", () => {
  const withAudio = [{ id: "1", title: null, audioUrl: "https://a.mp3", streamAudioUrl: null, imageUrl: null, duration: 120, storedPath: null, playbackUrl: null }];
  it("maps Suno states", () => {
    expect(mapStatus("PENDING", [])).toBe("pending");
    expect(mapStatus("TEXT_SUCCESS", [])).toBe("text");
    expect(mapStatus("FIRST_SUCCESS", [])).toBe("first");
    expect(mapStatus("SUCCESS", withAudio)).toBe("success");
    expect(mapStatus("SENSITIVE_WORD_ERROR", [])).toBe("failed");
  });
  it("treats CALLBACK_EXCEPTION as success when audio exists", () => {
    expect(mapStatus("CALLBACK_EXCEPTION", withAudio)).toBe("success");
    expect(mapStatus("CALLBACK_EXCEPTION", [])).toBe("failed");
  });
});

describe("applyCallback", () => {
  it("parses a complete callback", () => {
    const r = applyCallback({
      code: 200,
      msg: "All generated successfully.",
      data: { callbackType: "complete", task_id: "t1", data: [{ id: "a", audio_url: "https://a.mp3", stream_audio_url: "https://a/stream", image_url: "https://a.jpg", title: "Still Center", duration: 181.2 }] },
    });
    expect(r?.taskId).toBe("t1");
    expect(r?.state.status).toBe("success");
    expect(r?.state.tracks[0]).toMatchObject({ id: "a", audioUrl: "https://a.mp3", duration: 181.2 });
  });
  it("marks error callbacks failed and ignores bodies without a task id", () => {
    expect(applyCallback({ code: 400, msg: "boom", data: { callbackType: "error", task_id: "t2", data: null } })?.state).toMatchObject({ status: "failed", error: "boom" });
    expect(applyCallback({ code: 200 })).toBeNull();
  });
});

describe("callbackToken", () => {
  it("is stable and does not leak the key", () => {
    expect(callbackToken("sk-abc")).toBe(callbackToken("sk-abc"));
    expect(callbackToken("sk-abc")).not.toContain("sk-abc");
    expect(callbackToken("sk-abc")).not.toBe(callbackToken("sk-xyz"));
  });
});

describe("sunoClient", () => {
  const fakeFetch = (handler: (url: string, init?: RequestInit) => { status?: number; json: unknown }) =>
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const r = handler(String(input), init);
      return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

  it("returns 503 suno_not_configured without a key", async () => {
    await expect(sunoClient(vi.fn() as unknown as typeof fetch, null).generate({ prompt: "p", style: "s", title: "t", model: "V4_5", instrumental: false, callBackUrl: "https://x" })).rejects.toMatchObject({ status: 503, code: "suno_not_configured" });
  });

  it("posts custom-mode generate and returns the taskId", async () => {
    const fetch = fakeFetch((url, init) => {
      expect(url).toBe("https://suno.test/api/v1/generate");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer key-1");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ customMode: true, instrumental: false, model: "V4_5", title: "t", callBackUrl: "https://x/cb" });
      return { json: { code: 200, msg: "success", data: { taskId: "task-9" } } };
    });
    const id = await sunoClient(fetch, "key-1", "https://suno.test/").generate({ prompt: "p", style: "s", title: "t", model: "V4_5", instrumental: false, callBackUrl: "https://x/cb" });
    expect(id).toBe("task-9");
  });

  it("maps record-info into task state", async () => {
    const fetch = fakeFetch((url) => {
      expect(url).toBe("https://suno.test/api/v1/generate/record-info?taskId=task-9");
      return { json: { code: 200, data: { taskId: "task-9", status: "SUCCESS", response: { sunoData: [{ id: "a", audio_url: "https://a.mp3", duration: 120 }] } } } };
    });
    const s = await sunoClient(fetch, "key-1", "https://suno.test").getTask("task-9");
    expect(s.status).toBe("success");
    expect(s.tracks[0].audioUrl).toBe("https://a.mp3");
    expect(s.error).toBeNull();
  });

  it("maps sunoapi.org codes: 429 = credits, 430/405 = rate limit, 401 = auth, 455 = maintenance", async () => {
    const c = (json: unknown, status = 200) => sunoClient(fakeFetch(() => ({ status, json })), "k", "https://s").getTask("t");
    await expect(c({ code: 429, msg: "Insufficient credits" })).rejects.toMatchObject({ status: 402, code: "suno_insufficient_credits", message: expect.stringContaining("no credits") });
    await expect(c({ code: 430, msg: "Your call frequency is too high." })).rejects.toMatchObject({ code: "suno_rate_limited" });
    await expect(c({ code: 405 })).rejects.toMatchObject({ code: "suno_rate_limited" });
    await expect(c({ code: 401, msg: "unauthorized" }, 401)).rejects.toMatchObject({ code: "suno_auth" });
    await expect(c({ code: 455, msg: "maintenance" })).rejects.toMatchObject({ code: "suno_maintenance" });
    await expect(c({ code: 500, msg: "boom" })).rejects.toMatchObject({ code: "suno_error", message: expect.stringContaining("boom") });
  });
});

describe("emotional delivery in the Suno request", () => {
  it("puts delivery cues in section tags and performance notes in the style", () => {
    const withCues = {
      ...composition,
      lyrics: { ...composition.lyrics, sections: composition.lyrics.sections.map((s, i) => ({ ...s, delivery: i === 1 ? "full voice, let it break" : "whispered" })), performance_notes: "Stay small until the chorus." },
    };
    const r = buildSunoRequest(withCues, "V4_5", false, "https://x/cb");
    expect(r.prompt).toContain("[Chorus – full voice, let it break]");
    expect(r.prompt).toContain("[Verse 1 – whispered]");
    expect(r.style).toContain("emotive, expressive, dynamic human vocal performance");
    expect(r.style).toContain("Stay small until the chorus.");
  });
});
