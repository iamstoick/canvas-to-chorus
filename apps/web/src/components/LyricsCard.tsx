import { useState } from "react";
import { lyricsToText, type Lyrics } from "@artlyrics/shared";
export { lyricsToText };

const LABEL: Record<string, string> = {
  verse: "Verse",
  "pre-chorus": "Pre-chorus",
  chorus: "Chorus",
  bridge: "Bridge",
  outro: "Outro",
};

export default function LyricsCard({ lyrics }: { lyrics: Lyrics }) {
  const [copied, setCopied] = useState(false);
  const text = lyricsToText(lyrics);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }

  function download() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${lyrics.title.replace(/[^\w\- ]+/g, "").trim() || "lyrics"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  let verseNo = 0;
  return (
    <section className="card p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="muted text-xs uppercase tracking-wider">Lyrics</p>
          <h2 className="font-display text-3xl">{lyrics.title}</h2>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          <button className="btn btn-ghost" onClick={download}>Download .txt</button>
        </div>
      </div>
      <div className="space-y-5">
        {lyrics.sections.map((s, i) => {
          if (s.type === "verse") verseNo += 1;
          const label = s.type === "verse" ? `Verse ${verseNo}` : LABEL[s.type] ?? s.type;
          return (
            <div key={i}>
              <p className="muted text-xs uppercase tracking-wider mb-1">{label}</p>
              <p className={`leading-relaxed whitespace-pre-line ${s.type === "chorus" ? "font-medium" : ""}`}>{s.lines.join("\n")}</p>
            </div>
          );
        })}
      </div>
      <p className="muted text-sm mt-6 border-t pt-4" style={{ borderColor: "var(--line)" }}>
        <span className="font-medium">Why these words: </span>{lyrics.rationale}
      </p>
    </section>
  );
}
