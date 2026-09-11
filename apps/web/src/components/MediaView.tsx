import { useState } from "react";
import type { ArtworkSummary } from "@artlyrics/shared";
import { formatDuration } from "../lib/video";

/** Shows an image, or a video's poster with a clickable frame strip. */
export default function MediaView({ artwork, className = "" }: { artwork: ArtworkSummary; className?: string }) {
  const [index, setIndex] = useState<number | null>(null);
  if (artwork.kind !== "video" || artwork.frameUrls.length === 0) {
    return <img src={artwork.imageUrl} alt={artwork.originalName} className={`card w-full object-contain ${className}`} />;
  }
  const src = index == null ? artwork.imageUrl : artwork.frameUrls[index];
  return (
    <div className="space-y-2">
      <div className="relative">
        <img src={src} alt={`${artwork.originalName}${index != null ? `, frame ${index + 1}` : ""}`} className={`card w-full object-contain ${className}`} />
        <span className="chip absolute top-2 left-2">
          video · {artwork.frameUrls.length} frames{artwork.durationSeconds ? ` · ${formatDuration(artwork.durationSeconds)}` : ""}
        </span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="list" aria-label="Sampled frames">
        {artwork.frameUrls.map((u, i) => (
          <button
            key={u}
            type="button"
            role="listitem"
            onClick={() => setIndex(i)}
            className="shrink-0 rounded-md overflow-hidden"
            style={{ outline: index === i ? "2px solid var(--color-accent)" : "1px solid var(--line)" }}
            aria-label={`Frame ${i + 1}`}
          >
            <img src={u} alt="" className="h-14 w-20 object-cover" loading="lazy" />
          </button>
        ))}
      </div>
    </div>
  );
}
