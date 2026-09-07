import type { Lyrics } from "./schemas.js";

const LABEL: Record<string, string> = {
  verse: "Verse",
  "pre-chorus": "Pre-Chorus",
  chorus: "Chorus",
  bridge: "Bridge",
  outro: "Outro",
};

/** Lyrics as plain text with [Section] tags — the format both humans and Suno expect. */
export function lyricsToText(l: Lyrics, { includeTitle = true }: { includeTitle?: boolean } = {}): string {
  let verse = 0;
  const body = l.sections
    .map((s) => {
      if (s.type === "verse") verse += 1;
      const label = s.type === "verse" ? `Verse ${verse}` : LABEL[s.type] ?? s.type;
      return `[${label}]\n${s.lines.join("\n")}`;
    })
    .join("\n\n");
  return includeTitle ? `${l.title}\n\n${body}` : body;
}
