import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionSummary } from "@artlyrics/shared";
import ArtworkGrid from "../components/ArtworkGrid";
import ErrorNote from "../components/ErrorNote";
import { api } from "../lib/api";

const TOKEN_KEY = "al_admin_token";

function readToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;

export default function SessionsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [token, setToken] = useState(readToken);
  const [draft, setDraft] = useState(token);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  }, [token]);

  const status = useQuery({ queryKey: ["admin-status"], queryFn: api.adminStatus });
  const sessions = useQuery({ queryKey: ["admin-sessions", token], queryFn: () => api.adminSessions(token), enabled: Boolean(token) && status.data?.enabled === true, retry: false });
  const artworks = useQuery({
    queryKey: ["admin-session-artworks", token, expanded],
    queryFn: () => api.adminSessionArtworks(token, expanded!),
    enabled: Boolean(token && expanded),
  });
  const switchTo = useMutation({
    mutationFn: (id: string) => api.adminSwitchSession(token, id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["artworks"] });
      qc.removeQueries({ queryKey: ["artwork"] });
      qc.removeQueries({ queryKey: ["settings"] });
      navigate("/gallery");
    },
  });

  if (status.data && !status.data.enabled) {
    return (
      <div className="pt-6 max-w-xl space-y-3">
        <h1 className="font-display text-4xl">Sessions</h1>
        <p className="text-sm rounded-xl px-4 py-3" style={{ background: "var(--color-accent-soft)", color: "var(--color-ink)" }}>
          This page is off. Set <code>ADMIN_TOKEN</code> on the server to enable it.
        </p>
      </div>
    );
  }

  return (
    <div className="pt-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Sessions</h1>
          <p className="muted text-sm mt-1">Every anonymous browser session that has used this server. Open one to browse its artworks as that session.</p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setToken(draft.trim());
          }}
        >
          <input className="input !w-56" type="password" placeholder="Admin token" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Admin token" />
          <button className="btn btn-ghost" type="submit">{token ? "Update" : "Unlock"}</button>
        </form>
      </div>

      <ErrorNote error={sessions.error} />
      <ErrorNote error={switchTo.error} />

      {sessions.data && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="muted text-xs uppercase tracking-wider text-left">
              <tr>
                <th className="px-4 py-3">Session</th>
                <th className="px-4 py-3">Artworks</th>
                <th className="px-4 py-3">Questions</th>
                <th className="px-4 py-3">Compositions</th>
                <th className="px-4 py-3">Songs</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Last activity</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.map((s: SessionSummary) => (
                <tr key={s.sessionId} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="px-4 py-3 font-mono text-xs" title={s.sessionId}>
                    {short(s.sessionId)}
                    {s.current && <span className="chip ml-2">you</span>}
                  </td>
                  <td className="px-4 py-3">{s.artworkCount}</td>
                  <td className="px-4 py-3">{s.questionCount}</td>
                  <td className="px-4 py-3">{s.analysisCount}</td>
                  <td className="px-4 py-3">{s.songCount}</td>
                  <td className="px-4 py-3 muted text-xs">{s.provider ? `${s.provider} / ${s.model}` : "default"}</td>
                  <td className="px-4 py-3 muted text-xs">{fmt(s.lastSeen)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button className="btn btn-ghost !py-1 !px-3 text-xs mr-2" onClick={() => setExpanded(expanded === s.sessionId ? null : s.sessionId)}>
                      {expanded === s.sessionId ? "Hide" : "Preview"}
                    </button>
                    {!s.current && (
                      <button className="btn btn-primary !py-1 !px-3 text-xs" onClick={() => switchTo.mutate(s.sessionId)} disabled={switchTo.isPending}>
                        Open
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {sessions.data.length === 0 && (
                <tr><td className="px-4 py-6 muted italic" colSpan={8}>No sessions yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {expanded && (
        <section className="space-y-3">
          <h2 className="font-display text-2xl">Artworks in {short(expanded)}</h2>
          <p className="muted text-xs">Previews only. Press Open on the row to browse and play them as that session.</p>
          <ErrorNote error={artworks.error} />
          {artworks.data && <ArtworkGrid items={artworks.data} emptyText="This session has no artworks." />}
        </section>
      )}
    </div>
  );
}
