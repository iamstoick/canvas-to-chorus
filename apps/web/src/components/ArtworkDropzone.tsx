import { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { ALLOWED_IMAGE_MIME } from "@artlyrics/shared";
import { CLIENT_MAX_INPUT_BYTES, formatBytes } from "../lib/image";

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
        const err = rejected[0].errors[0];
        const msg =
          err?.code === "file-too-large"
            ? `That file is ${formatBytes(rejected[0].file.size)}. The limit is ${formatBytes(CLIENT_MAX_INPUT_BYTES)}.`
            : err?.code === "file-invalid-type"
              ? "Only JPEG, PNG, WebP or GIF images are accepted."
              : err?.message ?? "That file can't be used.";
        setLocalError(msg);
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
    maxSize: CLIENT_MAX_INPUT_BYTES,
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
        <p className="muted text-sm">or click to choose a file · JPEG, PNG, WebP or GIF · large photos are shrunk in your browser before upload</p>
      </div>
      {localError && <p role="alert" className="mt-3 text-sm" style={{ color: "var(--color-accent)" }}>{localError}</p>}
    </div>
  );
}
