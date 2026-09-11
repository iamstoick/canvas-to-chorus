import { Link } from "react-router-dom";
import type { ArtworkListItem } from "@artlyrics/shared";

export default function ArtworkGrid({ items, emptyText }: { items: ArtworkListItem[]; emptyText: string }) {
  if (items.length === 0) return <p className="muted text-sm italic">{emptyText}</p>;
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((a) => (
        <li key={a.id} className="card overflow-hidden flex flex-col">
          <Link to={a.analysisCount > 0 ? `/a/${a.id}/result` : `/a/${a.id}/questions`} className="block">
            <div className="relative">
              <img src={a.imageUrl} alt={a.originalName} className="w-full h-44 object-cover" loading="lazy" />
              {a.kind === "video" && <span className="chip absolute top-2 left-2">video · {a.frameUrls.length} frames</span>}
            </div>
          </Link>
          <div className="p-4 space-y-2 flex-1 flex flex-col">
            <div>
              <p className="font-display text-lg leading-tight truncate">{a.latestTitle ?? a.originalName}</p>
              <p className="muted text-xs truncate">
                {a.latestTitle ? `${a.originalName} · ` : ""}
                {new Date(a.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="chip">{a.questionCount} question{a.questionCount === 1 ? "" : "s"}</span>
              <span className="chip">{a.analysisCount} composition{a.analysisCount === 1 ? "" : "s"}</span>
              {a.songCount > 0 && <span className="chip">{a.songCount} song{a.songCount === 1 ? "" : "s"}</span>}
            </div>
            <div className="flex gap-2 pt-1 mt-auto">
              <Link className="btn btn-ghost !py-1.5 !px-3 text-xs" to={`/a/${a.id}/questions`}>Questions</Link>
              {a.analysisCount > 0 && <Link className="btn btn-primary !py-1.5 !px-3 text-xs" to={`/a/${a.id}/result`}>Result</Link>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
