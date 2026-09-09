import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ArtworkGrid from "../components/ArtworkGrid";
import ErrorNote from "../components/ErrorNote";
import { api } from "../lib/api";

export default function GalleryPage() {
  const list = useQuery({ queryKey: ["artworks"], queryFn: api.listArtworks });

  return (
    <div className="pt-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">My artworks</h1>
          {list.data && <p className="muted text-xs mt-1">Session {list.data.sessionId}</p>}
        </div>
        <Link className="btn btn-primary" to="/">Upload another</Link>
      </div>
      {list.isLoading && <p className="muted">Loading…</p>}
      <ErrorNote error={list.error} />
      {list.data && <ArtworkGrid items={list.data.artworks} emptyText="Nothing here yet. Upload an artwork to get started." />}
    </div>
  );
}
