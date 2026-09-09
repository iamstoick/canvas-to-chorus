import type { Lyrics } from "./schemas.js";

const LABEL: Record<string, string> = {
  verse: "Verse",
  "pre-chorus": "Pre-Chorus",
  chorus: "Chorus",
  bridge: "Bridge",
  outro: "Outro",
};

export interface LyricsTextOptions {
  includeTitle?: boolean;
  /** Put the delivery cue inside the section tag, e.g. "[Chorus – soaring, full voice]". Suno reads these. */
  includeDelivery?: boolean;
}

/** Lyrics as plain text with [Section] tags — the format both humans and Suno expect. */
export function lyricsToText(l: Lyrics, { includeTitle = true, includeDelivery = false }: LyricsTextOptions = {}): string {
  let verse = 0;
  const body = l.sections
    .map((s) => {
      if (s.type === "verse") verse += 1;
      const label = s.type === "verse" ? `Verse ${verse}` : LABEL[s.type] ?? s.type;
      const cue = includeDelivery && s.delivery ? ` – ${s.delivery}` : "";
      return `[${label}${cue}]\n${s.lines.join("\n")}`;
    })
    .join("\n\n");
  return includeTitle ? `${l.title}\n\n${body}` : body;
}
