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
      { type: "verse", lines: ["Line one", "Line two"] },
      { type: "chorus", lines: ["Chorus one", "Chorus two"] },
      { type: "outro", lines: ["Out one", "Out two"] },
    ],
    rationale: "Mirrors the solitude in the image.",
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
    const bad = { ...validComposition, lyrics: { ...validComposition.lyrics, sections: [...validComposition.lyrics.sections, { type: "rap", lines: ["a", "b"] }] } };
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
