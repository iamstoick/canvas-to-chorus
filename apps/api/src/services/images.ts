import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { ALLOWED_IMAGE_MIME, type AllowedImageMime } from "@artlyrics/shared";
import { badRequest } from "../lib/errors.js";

export interface NormalizedImage {
  bytes: Buffer;
  mimeType: AllowedImageMime;
  ext: string;
  width: number;
  height: number;
}

const EXT: Record<AllowedImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Validates by magic bytes (never trusts the client MIME), then re-encodes with sharp.
 * Re-encoding strips EXIF/metadata and defuses malformed files. GIFs keep only the first
 * frame; animation is irrelevant to analysis.
 */
export async function normalizeUpload(input: Buffer): Promise<NormalizedImage> {
  const detected = await fileTypeFromBuffer(input);
  if (!detected || !(ALLOWED_IMAGE_MIME as readonly string[]).includes(detected.mime)) {
    throw badRequest("unsupported_type", `Only ${ALLOWED_IMAGE_MIME.join(", ")} are accepted.`);
  }
  const mimeType = detected.mime as AllowedImageMime;

  let pipeline = sharp(input, { failOn: "error", animated: false }).rotate();
  switch (mimeType) {
    case "image/jpeg":
      pipeline = pipeline.jpeg({ quality: 92, mozjpeg: true });
      break;
    case "image/png":
      pipeline = pipeline.png({ compressionLevel: 8 });
      break;
    case "image/webp":
      pipeline = pipeline.webp({ quality: 92 });
      break;
    case "image/gif":
      pipeline = pipeline.gif();
      break;
  }
  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true }).catch(() => {
    throw badRequest("invalid_image", "The file could not be decoded as an image.");
  });
  return { bytes: data, mimeType, ext: EXT[mimeType], width: info.width, height: info.height };
}

/** Downscale for the vision model: longest edge 1568px, JPEG. Cuts tokens, keeps detail. */
export async function toModelImage(input: Buffer): Promise<{ data: string; mediaType: "image/jpeg" }> {
  const out = await sharp(input, { animated: false })
    .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 88 })
    .toBuffer();
  return { data: out.toString("base64"), mediaType: "image/jpeg" };
}
