/**
 * Browser-side image preparation. Large photos are downscaled and re-encoded as JPEG so
 * uploads stay small (Vercel rejects bodies over 4.5 MB; the analysis model only sees 1568 px
 * anyway). Small files pass through untouched. Any failure falls back to the original file.
 */
export const UPLOAD_TARGET_BYTES = 3.5 * 1024 * 1024;
export const MAX_EDGE_PX = 2560;
export const CLIENT_MAX_INPUT_BYTES = 80 * 1024 * 1024;

export interface PrepareResult {
  file: File;
  resized: boolean;
  originalBytes: number;
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("decode failed"));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
}

export async function prepareImage(file: File): Promise<PrepareResult> {
  const originalBytes = file.size;
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await decode(file);
  } catch {
    return { file, resized: false, originalBytes };
  }
  const w = "naturalWidth" in bitmap ? bitmap.naturalWidth : bitmap.width;
  const h = "naturalHeight" in bitmap ? bitmap.naturalHeight : bitmap.height;
  const longest = Math.max(w, h);
  const needsResize = longest > MAX_EDGE_PX || file.size > UPLOAD_TARGET_BYTES;
  if (!needsResize || file.type === "image/gif") {
    if ("close" in bitmap) bitmap.close();
    return { file, resized: false, originalBytes };
  }

  const scale = Math.min(1, MAX_EDGE_PX / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return { file, resized: false, originalBytes };
  ctx.fillStyle = "#ffffff"; // flatten transparency for JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if ("close" in bitmap) bitmap.close();

  // Step quality down until under target.
  let blob: Blob | null = null;
  for (const q of [0.92, 0.85, 0.78, 0.7, 0.6]) {
    blob = await toBlob(canvas, q);
    if (blob && blob.size <= UPLOAD_TARGET_BYTES) break;
  }
  if (!blob) return { file, resized: false, originalBytes };
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return { file: new File([blob], name, { type: "image/jpeg", lastModified: Date.now() }), resized: true, originalBytes };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
