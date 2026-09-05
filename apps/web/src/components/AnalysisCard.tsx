import type { ArtworkAnalysis } from "@artlyrics/shared";

export default function AnalysisCard({ analysis }: { analysis: ArtworkAnalysis }) {
  return (
    <section className="card p-6 space-y-4">
      <div>
        <p className="muted text-xs uppercase tracking-wider">Analysis</p>
        <h2 className="font-display text-2xl">{analysis.subject}</h2>
        <p className="muted text-sm mt-1">{analysis.medium} · {analysis.era_or_movement}</p>
      </div>
      <div>
        <p className="muted text-xs uppercase tracking-wider mb-1">Palette</p>
        <div className="flex flex-wrap gap-2">{analysis.dominant_colors.map((c) => <span key={c} className="chip">{c}</span>)}</div>
      </div>
      <div>
        <p className="muted text-xs uppercase tracking-wider mb-1">Mood</p>
        <div className="flex flex-wrap gap-2">{analysis.mood.map((m) => <span key={m} className="chip">{m}</span>)}</div>
      </div>
      <p className="text-sm leading-relaxed"><span className="font-medium">Composition. </span>{analysis.composition}</p>
      {analysis.symbols_and_themes.length > 0 && (
        <p className="text-sm leading-relaxed"><span className="font-medium">Themes. </span>{analysis.symbols_and_themes.join(", ")}</p>
      )}
      <p className="text-sm leading-relaxed italic">{analysis.narrative}</p>
    </section>
  );
}
