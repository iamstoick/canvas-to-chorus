import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import ArtworkDropzone from "../components/ArtworkDropzone";
import ErrorNote from "../components/ErrorNote";
import { api } from "../lib/api";
import { formatBytes, prepareImage } from "../lib/image";

export default function UploadPage() {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (original: File) => {
      setNote("Preparing image…");
      const prepared = await prepareImage(original);
      setNote(prepared.resized ? `Shrunk from ${formatBytes(prepared.originalBytes)} to ${formatBytes(prepared.file.size)}` : null);
      return api.uploadArtwork(prepared.file, setProgress);
    },
    onSuccess: (art) => navigate(`/a/${art.id}/questions`),
  });

  function onSelect(file: File) {
    setPreview(URL.createObjectURL(file));
    setProgress(0);
    uploadMutation.mutate(file);
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] items-start pt-6">
      <div className="space-y-6">
        <h1 className="font-display text-5xl leading-tight">
          Every painting has a song<br />waiting inside it.
        </h1>
        <p className="muted max-w-prose">
          Upload an artwork. Ask up to five questions about it. Then get an analysis, original lyrics
          written from the image, and a recommended musical style to bring them to life.
        </p>
        <ol className="muted text-sm space-y-1 list-decimal pl-5">
          <li>Upload a JPEG, PNG, WebP or GIF</li>
          <li>Ask up to five questions about what you see</li>
          <li>Compose lyrics and a sound</li>
        </ol>
      </div>
      <div className="space-y-4">
        <ArtworkDropzone onSelect={onSelect} disabled={uploadMutation.isPending} />
        {preview && (
          <div className="card p-3 flex items-center gap-4">
            <img src={preview} alt="Selected artwork preview" className="h-20 w-20 rounded-lg object-cover" />
            <div className="flex-1">
              <p className="text-sm font-medium">{uploadMutation.isPending ? (progress > 0 ? "Uploading…" : note ?? "Preparing…") : uploadMutation.isError ? "Upload failed" : "Uploaded"}</p>
              {note && progress > 0 && <p className="muted text-xs">{note}</p>}
              <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
                <div className="h-full transition-all" style={{ width: `${progress}%`, background: "var(--color-accent)" }} />
              </div>
            </div>
          </div>
        )}
        <ErrorNote error={uploadMutation.error} />
      </div>
    </div>
  );
}
