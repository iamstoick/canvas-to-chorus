import { describe, expect, it } from "vitest";
import { AskQuestionRequest, Composition, StyleRecommendation } from "./schemas.js";

const validComposition = {
  analysis: {
    subject: "A lone figure on a cliff",
    medium: "Oil on canvas",
    dominant_colors: ["slate blue", "ochre"],
    mood: ["melancholy", "awe"],
    composition: "Figure lower-left, horizon high",
    era_or_movement: "Romanticism",
    symbols_and_themes: ["solitude", "nature"],
    narrative: "Someone pauses at the edge of the known world.",
  },
  lyrics: {
    title: "Edge of the Known",
    sections: [
      { type: "verse", lines: ["Line one", "Line two"], delivery: "soft" },
      { type: "chorus", lines: ["Chorus one", "Chorus two"], delivery: "soft" },
      { type: "outro", lines: ["Out one", "Out two"], delivery: "soft" },
    ],
    rationale: "Mirrors the solitude in the image.", emotional_core: "Wanting to be seen.", point_of_view: "One person to another", performance_notes: "Small, then open.",
  },
  style: {
    primary_genre: "Indie folk",
    sub_genres: ["chamber folk"],
    tempo_bpm: { min: 70, max: 84 },
    key_suggestion: "D minor",
    instrumentation: ["acoustic guitar", "cello"],
    vocal_style: "Hushed, close-mic'd",
    reference_artists: ["Bon Iver"],
    why: "Slow, contemplative palette.",
  },
};

describe("Composition schema", () => {
  it("accepts a valid composition", () => {
    expect(Composition.safeParse(validComposition).success).toBe(true);
  });

  it("rejects lyrics with fewer than three sections", () => {
    const bad = { ...validComposition, lyrics: { ...validComposition.lyrics, sections: validComposition.lyrics.sections.slice(0, 2) } };
    expect(Composition.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown section types", () => {
    const bad = { ...validComposition, lyrics: { ...validComposition.lyrics, sections: [...validComposition.lyrics.sections, { type: "rap", lines: ["a", "b"], delivery: "soft" }] } };
    expect(Composition.safeParse(bad).success).toBe(false);
  });
});

describe("StyleRecommendation", () => {
  it("caps reference artists at four", () => {
    const bad = { ...validComposition.style, reference_artists: ["a", "b", "c", "d", "e"] };
    expect(StyleRecommendation.safeParse(bad).success).toBe(false);
  });
});

describe("AskQuestionRequest", () => {
  it("trims and enforces minimum length", () => {
    expect(AskQuestionRequest.safeParse({ question: "  hi  " }).success).toBe(false);
    expect(AskQuestionRequest.parse({ question: "  What mood is this?  " }).question).toBe("What mood is this?");
  });
});

describe("lyricsToText delivery cues", () => {
  it("includes cues only when asked", async () => {
    const { lyricsToText } = await import("./format.js");
    const l = { ...validComposition.lyrics, sections: [{ type: "chorus" as const, lines: ["a", "b"], delivery: "soaring" }, { type: "verse" as const, lines: ["c", "d"], delivery: "hushed" }, { type: "outro" as const, lines: ["e", "f"], delivery: "fading" }] };
    expect(lyricsToText(l, { includeTitle: false })).toContain("[Chorus]\na");
    expect(lyricsToText(l, { includeTitle: false, includeDelivery: true })).toContain("[Chorus – soaring]\na");
    expect(lyricsToText(l, { includeTitle: false, includeDelivery: true })).toContain("[Verse 1 – hushed]");
  });
});
