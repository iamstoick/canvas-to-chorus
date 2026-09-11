import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ComposeRequest } from "@artlyrics/shared";
import GenrePicker from "../components/GenrePicker";
import AnalysisCard from "../components/AnalysisCard";
import ErrorNote from "../components/ErrorNote";
import MediaView from "../components/MediaView";
import LyricsCard from "../components/LyricsCard";
import SongCard from "../components/SongCard";
import StyleCard from "../components/StyleCard";
import { api, type ArtworkDetailResponse } from "../lib/api";

export default function ResultPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRegen, setShowRegen] = useState(false);
  const [prefs, setPrefs] = useState<ComposeRequest>({});

  const detail = useQuery({ queryKey: ["artwork", id], queryFn: () => api.getArtwork(id) });

  const regenerate = useMutation({
    mutationFn: () => api.compose(id, prefs),
    onSuccess: (record) => {
      qc.setQueryData<ArtworkDetailResponse>(["artwork", id], (old) =>
        old ? { ...old, analyses: [record, ...old.analyses] } : old,
      );
      setSelectedId(record.id);
      setShowRegen(false);
    },
  });

  if (detail.isLoading) return <p className="muted pt-10">Loading…</p>;
  if (detail.isError || !detail.data) return <div className="pt-10 space-y-3"><ErrorNote error={detail.error ?? new Error("Artwork not found")} /><Link className="btn btn-ghost" to="/">Start over</Link></div>;

  const { artwork, analyses, questions, songsEnabled } = detail.data;
  if (analyses.length === 0) {
    return (
      <div className="pt-10 space-y-4">
        <p>No composition yet for this artwork.</p>
        <Link className="btn btn-primary" to={`/a/${id}/questions`}>Go compose one</Link>
      </div>
    );
  }
  const current = analyses.find((a) => a.id === selectedId) ?? analyses[0];
  const { analysis, lyrics, style } = current.composition;

  return (
    <div className="space-y-8 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="muted text-sm">{questions.length} question{questions.length === 1 ? "" : "s"} shaped this song</p>
          <h1 className="font-display text-4xl">Your song, from the canvas</h1>
        </div>
        <div className="flex items-center gap-2">
          {analyses.length > 1 && (
            <select
              className="input !w-auto"
              value={current.id}
              onChange={(e) => setSelectedId(e.target.value)}
              aria-label="Choose a version"
            >
              {analyses.map((a, i) => (
                <option key={a.id} value={a.id}>
                  Version {analyses.length - i} · {new Date(a.createdAt).toLocaleTimeString()}
                </option>
              ))}
            </select>
          )}
          <button
            className="btn btn-ghost"
            onClick={() => {
              setPrefs({ genre: current.genrePreference ?? "", styleNotes: current.styleNotes ?? "" });
              setShowRegen((v) => !v);
            }}
            disabled={regenerate.isPending}
          >
            {regenerate.isPending ? "Regenerating…" : showRegen ? "Close" : "Regenerate"}
          </button>
          <Link className="btn btn-ghost" to="/">New artwork</Link>
        </div>
      </div>
      <ErrorNote error={regenerate.error} />

      {showRegen && (
        <section className="card p-5 space-y-4">
          <div>
            <p className="muted text-xs uppercase tracking-wider">Regenerate</p>
            <h2 className="font-display text-2xl">Pick a genre, or let the artwork decide</h2>
          </div>
          <GenrePicker value={prefs} onChange={setPrefs} disabled={regenerate.isPending} />
          <div className="flex justify-end">
            <button className="btn btn-primary" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
              {regenerate.isPending ? "Composing… (20–60 s)" : "Compose again"}
            </button>
          </div>
        </section>
      )}

      {(current.genrePreference || current.styleNotes) && (
        <p className="text-xs flex flex-wrap gap-2 items-center">
          <span className="muted">Your direction:</span>
          {current.genrePreference && <span className="chip">{current.genrePreference}</span>}
          {current.styleNotes && <span className="chip">{current.styleNotes}</span>}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-6">
          <MediaView artwork={artwork} className="max-h-[50vh]" />
          <AnalysisCard analysis={analysis} />
          <StyleCard style={style} />
        </div>
        <div className="space-y-6">
          <LyricsCard lyrics={lyrics} />
          <SongCard analysisId={current.id} artworkId={artwork.id} songs={current.songs} enabled={songsEnabled} />
          <p className="muted text-xs">
            Generated by {current.model}
            {current.inputTokens != null && ` · ${current.inputTokens} in / ${current.outputTokens ?? 0} out tokens`}
          </p>
        </div>
      </div>
    </div>
  );
}
