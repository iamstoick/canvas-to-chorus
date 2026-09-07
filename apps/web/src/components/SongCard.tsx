import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SunoModel, type SongRecord, type SongTrack } from "@artlyrics/shared";
import ErrorNote from "./ErrorNote";
import { api, type ArtworkDetailResponse } from "../lib/api";

const MODEL_LABEL: Record<SunoModel, string> = {
  V4: "V4 (fast)",
  V4_5: "V4.5",
  V4_5PLUS: "V4.5+",
  V5: "V5",
  V5_5: "V5.5 (newest)",
};

const STATUS_TEXT: Record<SongRecord["status"], string> = {
  pending: "Queued at Suno…",
  text: "Lyrics accepted, composing…",
  first: "First track ready, finishing the second…",
  success: "Ready",
  failed: "Failed",
};

function fmtDuration(s: number | null) {
  if (s == null) return "";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}

function Track({ track, index }: { track: SongTrack; index: number }) {
  const src = track.streamAudioUrl ?? track.audioUrl;
  return (
    <div className="flex gap-4 items-center">
      {track.imageUrl ? (
        <img src={track.imageUrl} alt="" className="h-16 w-16 rounded-lg object-cover shrink-0" />
      ) : (
        <div className="h-16 w-16 rounded-lg shrink-0" style={{ background: "var(--line)" }} />
      )}
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-medium truncate">
          Take {index + 1}
          {track.title ? ` · ${track.title}` : ""}
          {track.duration != null && <span className="muted"> · {fmtDuration(track.duration)}</span>}
        </p>
        {src ? <audio controls preload="none" src={src} className="w-full" /> : <p className="muted text-xs">Rendering…</p>}
        {track.audioUrl && (
          <a className="text-xs underline muted" href={track.audioUrl} target="_blank" rel="noreferrer">
            Open MP3
          </a>
        )}
      </div>
    </div>
  );
}

/** One song row: polls while Suno is still working. */
function SongItem({ song, artworkId }: { song: SongRecord; artworkId: string }) {
  const qc = useQueryClient();
  const terminal = song.status === "success" || song.status === "failed";
  const live = useQuery({
    queryKey: ["song", song.id],
    queryFn: () => api.getSong(song.id),
    initialData: song,
    enabled: !terminal,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "success" || s === "failed" ? false : 5000;
    },
  });
  const current = live.data ?? song;

  // Keep the artwork detail cache in sync so a page reload shows the finished song.
  if (current !== song && (current.status === "success" || current.status === "failed")) {
    qc.setQueryData<ArtworkDetailResponse>(["artwork", artworkId], (old) =>
      old
        ? { ...old, analyses: old.analyses.map((a) => (a.id === current.analysisId ? { ...a, songs: a.songs.map((s) => (s.id === current.id ? current : s)) } : a)) }
        : old,
    );
  }

  return (
    <li className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0" style={{ borderColor: "var(--line)" }}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="chip">{MODEL_LABEL[current.model]}{current.instrumental ? " · instrumental" : ""}</span>
        <span className={current.status === "failed" ? "" : "muted"} style={current.status === "failed" ? { color: "var(--color-accent)" } : undefined}>
          {STATUS_TEXT[current.status]}
          {!terminal && <span className="animate-pulse"> ●</span>}
        </span>
      </div>
      {current.error && <ErrorNote error={new Error(current.error)} />}
      {current.tracks.length > 0 && (
        <div className="space-y-3">
          {current.tracks.map((t, i) => <Track key={t.id || i} track={t} index={i} />)}
        </div>
      )}
      {live.error && <ErrorNote error={live.error} />}
    </li>
  );
}

interface Props {
  analysisId: string;
  artworkId: string;
  songs: SongRecord[];
  enabled: boolean;
}

export default function SongCard({ analysisId, artworkId, songs, enabled }: Props) {
  const qc = useQueryClient();
  const [model, setModel] = useState<SunoModel>("V4_5");
  const [instrumental, setInstrumental] = useState(false);

  const create = useMutation({
    mutationFn: () => api.createSong(analysisId, { model, instrumental }),
    onSuccess: (song) => {
      qc.setQueryData<ArtworkDetailResponse>(["artwork", artworkId], (old) =>
        old ? { ...old, analyses: old.analyses.map((a) => (a.id === analysisId ? { ...a, songs: [song, ...a.songs] } : a)) } : old,
      );
    },
  });

  const busy = create.isPending || songs.some((s) => s.status !== "success" && s.status !== "failed");

  return (
    <section className="card p-6 space-y-5">
      <div>
        <p className="muted text-xs uppercase tracking-wider">Hear it</p>
        <h2 className="font-display text-3xl">Generate the song</h2>
        <p className="muted text-sm mt-1">Sends these lyrics and the recommended style to Suno. Takes one to three minutes and returns two takes.</p>
      </div>

      {!enabled ? (
        <p className="text-sm rounded-xl px-4 py-3" style={{ background: "var(--color-accent-soft)", color: "var(--color-ink)" }}>
          Song generation is off. Set <code>SUNO_API_KEY</code> on the server to enable it.
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm space-y-1">
            <span className="muted text-xs block">Suno model</span>
            <select className="input !w-auto" value={model} onChange={(e) => setModel(e.target.value as SunoModel)} disabled={busy}>
              {SunoModel.options.map((m) => (
                <option key={m} value={m}>{MODEL_LABEL[m]}</option>
              ))}
            </select>
          </label>
          <label className="text-sm flex items-center gap-2 pb-3">
            <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} disabled={busy} />
            Instrumental only
          </label>
          <button className="btn btn-primary" onClick={() => create.mutate()} disabled={busy}>
            {create.isPending ? "Starting…" : songs.length ? "Generate another" : "Generate song"}
          </button>
        </div>
      )}
      <ErrorNote error={create.error} />

      {songs.length > 0 && (
        <ul className="space-y-4">
          {songs.map((s) => <SongItem key={s.id} song={s} artworkId={artworkId} />)}
        </ul>
      )}
    </section>
  );
}
