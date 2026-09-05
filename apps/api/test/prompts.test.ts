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
