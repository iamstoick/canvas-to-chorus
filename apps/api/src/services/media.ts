import type { ArtworkRow } from "../db/schema.js";
import { toModelImage } from "./images.js";
import type { ModelMedia } from "./provider.js";
import type { Storage } from "./storage.js";

/** Frames are sent at a smaller size than a single image to keep 8-12 of them affordable. */
export const VIDEO_FRAME_MAX_EDGE = 1024;

/** Loads what the model should look at for an artwork: the image, or every sampled frame in order. */
export async function loadModelMedia(storage: Storage, art: ArtworkRow): Promise<ModelMedia> {
  if (art.kind === "video" && art.framePaths.length > 0) {
    const images = await Promise.all(art.framePaths.map(async (p) => toModelImage(await storage.read(p), VIDEO_FRAME_MAX_EDGE)));
    return { kind: "video", images, durationSeconds: art.durationSeconds ?? null };
  }
  return { kind: "image", images: [await toModelImage(await storage.read(art.storagePath))] };
}

/** Every stored file behind an artwork (poster/image plus frames). */
export function artworkFilePaths(art: Pick<ArtworkRow, "storagePath" | "framePaths">): string[] {
  return Array.from(new Set([art.storagePath, ...(art.framePaths ?? [])]));
}
