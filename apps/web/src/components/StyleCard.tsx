import type { StyleRecommendation } from "@artlyrics/shared";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 text-sm">
      <dt className="muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function StyleCard({ style }: { style: StyleRecommendation }) {
  return (
    <section className="card p-6">
      <p className="muted text-xs uppercase tracking-wider">Recommended sound</p>
      <h2 className="font-display text-3xl mb-1">{style.primary_genre}</h2>
      {style.sub_genres.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {style.sub_genres.map((g) => <span key={g} className="chip">{g}</span>)}
        </div>
      )}
      <dl className="space-y-2">
        <Row label="Tempo">{style.tempo_bpm.min}–{style.tempo_bpm.max} BPM</Row>
        <Row label="Key">{style.key_suggestion}</Row>
        <Row label="Instruments">{style.instrumentation.join(", ")}</Row>
        <Row label="Vocals">{style.vocal_style}</Row>
        {style.reference_artists.length > 0 && <Row label="Influences">{style.reference_artists.join(", ")}</Row>}
      </dl>
      <p className="muted text-sm mt-5 border-t pt-4" style={{ borderColor: "var(--line)" }}>{style.why}</p>
    </section>
  );
}
