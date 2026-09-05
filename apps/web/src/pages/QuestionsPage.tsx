import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MAX_QUESTIONS } from "@artlyrics/shared";
import ErrorNote from "../components/ErrorNote";
import QuestionThread from "../components/QuestionThread";
import { api, type ArtworkDetailResponse } from "../lib/api";

export default function QuestionsPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");

  const detail = useQuery({ queryKey: ["artwork", id], queryFn: () => api.getArtwork(id) });

  const ask = useMutation({
    mutationFn: (question: string) => api.askQuestion(id, question),
    onSuccess: (qa) => {
      qc.setQueryData<ArtworkDetailResponse>(["artwork", id], (old) =>
        old ? { ...old, questions: [...old.questions, qa] } : old,
      );
      setDraft("");
    },
  });

  const compose = useMutation({
    mutationFn: () => api.compose(id),
    onSuccess: (record) => {
      qc.setQueryData<ArtworkDetailResponse>(["artwork", id], (old) =>
        old ? { ...old, analyses: [record, ...old.analyses] } : old,
      );
      navigate(`/a/${id}/result`);
    },
  });

  if (detail.isLoading) return <p className="muted pt-10">Loading…</p>;
  if (detail.isError || !detail.data) return <div className="pt-10 space-y-3"><ErrorNote error={detail.error ?? new Error("Artwork not found")} /><Link className="btn btn-ghost" to="/">Start over</Link></div>;

  const { artwork, questions, suggestedQuestions } = detail.data;
  const asked = questions.length;
  const atCap = asked >= MAX_QUESTIONS;
  const busy = ask.isPending || compose.isPending;
  const unusedSuggestions = suggestedQuestions.filter((s) => !questions.some((q) => q.question === s));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    if (q.length < 3 || atCap || busy) return;
    ask.mutate(q);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] pt-4">
      <div className="space-y-4 lg:sticky lg:top-6 self-start">
        <img src={artwork.imageUrl} alt={artwork.originalName} className="card w-full object-contain max-h-[70vh]" />
        <p className="muted text-xs truncate">{artwork.originalName}</p>
      </div>

      <div className="space-y-6">
        <div className="flex items-baseline justify-between">
          <h1 className="font-display text-3xl">Ask about the artwork</h1>
          <span className="muted text-sm">Question {Math.min(asked + 1, MAX_QUESTIONS)} of {MAX_QUESTIONS}</span>
        </div>

        <div className="card p-5 max-h-[50vh] overflow-y-auto">
          <QuestionThread items={questions} pending={ask.isPending ? ask.variables ?? null : null} />
        </div>

        {!atCap && unusedSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {unusedSuggestions.slice(0, 4).map((s) => (
              <button key={s} type="button" className="chip hover:brightness-95 disabled:opacity-50" disabled={busy} onClick={() => ask.mutate(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={submit} className="flex gap-2">
          <input
            className="input"
            placeholder={atCap ? "You've asked all five questions" : "What would you like to know?"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={atCap || busy}
            maxLength={500}
            aria-label="Your question"
          />
          <button type="submit" className="btn btn-primary" disabled={atCap || busy || draft.trim().length < 3}>
            Ask
          </button>
        </form>
        <ErrorNote error={ask.error} />
        <ErrorNote error={compose.error} />

        <div className="flex items-center justify-between gap-4 border-t pt-5" style={{ borderColor: "var(--line)" }}>
          <p className="muted text-sm">
            {asked === 0 ? "You can compose right away, but questions give the song more to work with." : atCap ? "All five asked. Ready to compose." : "Compose whenever you're ready."}
          </p>
          <button className="btn btn-primary" onClick={() => compose.mutate()} disabled={busy}>
            {compose.isPending ? "Composing… (20–60 s)" : "Analyze & compose"}
          </button>
        </div>
      </div>
    </div>
  );
}
