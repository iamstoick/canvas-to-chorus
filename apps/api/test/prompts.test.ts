import "./setup.js";
import { describe, expect, it } from "vitest";
import { buildComposePrompt } from "../src/prompts/lyrics.js";

describe("buildComposePrompt", () => {
  it("has a no-questions variant", () => {
    expect(buildComposePrompt([])).toMatch(/Analyze it, write the lyrics/);
  });
  it("includes every Q&A pair in order", () => {
    const p = buildComposePrompt([
      { question: "What mood?", answer: "Melancholy." },
      { question: "What era?", answer: "Romantic." },
    ]);
    expect(p.indexOf("Q1: What mood?")).toBeLessThan(p.indexOf("Q2: What era?"));
    expect(p).toContain("A2: Romantic.");
  });
});

describe("compose preferences", () => {
  it("adds genre and style direction when provided", () => {
    const p = buildComposePrompt([], { genre: "Synthwave", styleNotes: "female vocals" });
    expect(p).toContain("in the Synthwave genre");
    expect(p).toContain('primary_genre "Synthwave"');
    expect(p).toContain('"female vocals"');
    expect(p).toContain("grounded in the artwork");
  });
  it("adds nothing when preferences are empty", () => {
    expect(buildComposePrompt([], { genre: "", styleNotes: "" })).toBe(buildComposePrompt([]));
  });
});

describe("media intro", () => {
  it("describes a video by frame count and duration, and stays plain for images", async () => {
    const { mediaIntro } = await import("../src/prompts/analyze.js");
    expect(mediaIntro({ kind: "image", images: [1] })).toBe("Here is the artwork.");
    expect(mediaIntro({ kind: "video", images: [1, 2, 3, 4], durationSeconds: 17.6 })).toBe("Here is the artwork: 4 frames sampled in order from a 18-second video, first to last.");
    expect(buildComposePrompt([], undefined, mediaIntro({ kind: "video", images: [1, 2] }))).toMatch(/^Here is the artwork: 2 frames/);
  });
});
