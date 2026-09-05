import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { ALLOWED_IMAGE_MIME, MAX_UPLOAD_BYTES } from "@artlyrics/shared";

interface Props {
  onSelect: (file: File) => void;
  disabled?: boolean;
}

export default function ArtworkDropzone({ onSelect, disabled }: Props) {
  const [localError, setLocalError] = useState<string | null>(null);

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      setLocalError(null);
      if (rejected.length) {
        setLocalError(rejected[0].errors[0]?.message ?? "That file can't be used.");
        return;
      }
      if (accepted[0]) onSelect(accepted[0]);
    },
    [onSelect],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    disabled,
    maxSize: MAX_UPLOAD_BYTES,
    accept: Object.fromEntries(ALLOWED_IMAGE_MIME.map((m) => [m, []])),
  });

  return (
    <div>
      <div
        {...getRootProps()}
        className={`card cursor-pointer p-12 text-center transition ${isDragActive ? "ring-2" : ""} ${disabled ? "opacity-60" : ""}`}
        style={isDragActive ? { borderColor: "var(--color-accent)" } : undefined}
        aria-label="Upload artwork"
      >
        <input {...getInputProps()} />
        <div className="font-display text-3xl mb-2">Drop an artwork here</div>
        <p className="muted text-sm">or click to choose a file · JPEG, PNG, WebP or GIF · up to 10 MB</p>
      </div>
      {localError && <p role="alert" className="mt-3 text-sm" style={{ color: "var(--color-accent)" }}>{localError}</p>}
    </div>
  );
}
