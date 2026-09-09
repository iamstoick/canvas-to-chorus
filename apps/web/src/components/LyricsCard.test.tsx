import { render, screen } from "@testing-library/react";
import LyricsCard, { lyricsToText } from "./LyricsCard";

const lyrics = {
  title: "Edge of the Known",
  sections: [
    { type: "verse" as const, lines: ["Grey light on the water", "Salt in the seams"], delivery: "soft" },
    { type: "chorus" as const, lines: ["Hold the horizon", "Hold it for me"], delivery: "soft" },
    { type: "verse" as const, lines: ["Second verse line", "And another"], delivery: "soft" },
  ],
  rationale: "Mirrors the solitude in the image.", emotional_core: "Wanting to be seen.", point_of_view: "One person to another", performance_notes: "Small, then open.",
};

describe("LyricsCard", () => {
  it("renders title, numbered verses and rationale", () => {
    render(<LyricsCard lyrics={lyrics} />);
    expect(screen.getByRole("heading", { name: "Edge of the Known" })).toBeInTheDocument();
    expect(screen.getByText("Verse 1")).toBeInTheDocument();
    expect(screen.getByText("Verse 2")).toBeInTheDocument();
    expect(screen.getByText("Chorus")).toBeInTheDocument();
    expect(screen.getByText(/Mirrors the solitude/)).toBeInTheDocument();
  });

  it("exports plain text with section labels", () => {
    const text = lyricsToText(lyrics);
    expect(text.startsWith("Edge of the Known\n\n[Verse 1]\nGrey light")).toBe(true);
    expect(text).toContain("[Chorus]\nHold the horizon");
    expect(text).toContain("[Verse 2]");
  });
});
