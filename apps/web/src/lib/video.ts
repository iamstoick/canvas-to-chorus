import { DEFAULT_VIDEO_FRAMES } from "@artlyrics/shared";

export const MAX_VIDEO_INPUT_BYTES = 800 * 1024 * 1024;
export const FRAME_MAX_EDGE = 1280;
const SEEK_TIMEOUT_MS = 8000;

/** Evenly spaced sample times that avoid the very first and very last instants (often black or fading). */
export function frameTimestamps(duration: number, count: number): number[] {
  const n = Math.max(1, Math.min(count, Math.round(count)));
  if (!Number.isFinite(duration) || duration <= 0) return Array(n).fill(0);
  return Array.from({ length: n }, (_, i) => Math.min(duration - 0.05, ((i + 0.5) / n) * duration));
}

/** More frames for longer clips, capped by the server limit. */
export function frameCountFor(duration: number): number {
  if (duration > 90) return 12;
  if (duration > 30) return 10;
  return DEFAULT_VIDEO_FRAMES;
}

export interface ExtractedFrames {
  frames: File[];
  poster: File;
  duration: number;
  width: number;
  height: number;
}

function once<T extends Event>(el: HTMLVideoElement, ev: string, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => {
      cleanup();
      rej(new Error(`timed out waiting for ${ev}`));
    }, ms);
    const onErr = () => {
      cleanup();
      rej(new Error("The browser could not decode this video. Try exporting it as MP4 (H.264)."));
    };
    const onEv = (e: Event) => {
      cleanup();
      res(e as T);
    };
    const cleanup = () => {
      clearTimeout(t);
      el.removeEventListener(ev, onEv);
      el.removeEventListener("error", onErr);
    };
    el.addEventListener(ev, onEv, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

/**
 * Samples frames from a video entirely in the browser. Nothing but small JPEGs leave the device.
 * `onProgress(done, total)` fires per frame.
 */
export async function extractFrames(file: File, onProgress?: (done: number, total: number) => void, count?: number): Promise<ExtractedFrames> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  try {
    await once(video, "loadedmetadata", 15000);
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("Could not read the video's duration.");
    const total = count ?? frameCountFor(duration);
    const times = frameTimestamps(duration, total);

    const scale = Math.min(1, FRAME_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser.");

    const frames: File[] = [];
    const base = file.name.replace(/\.[^.]+$/, "");
    for (let i = 0; i < times.length; i++) {
      video.currentTime = times[i];
      await once(video, "seeked", SEEK_TIMEOUT_MS);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
      if (!blob) throw new Error("Could not encode a frame.");
      frames.push(new File([blob], `${base}-frame-${String(i + 1).padStart(2, "0")}.jpg`, { type: "image/jpeg" }));
      onProgress?.(i + 1, times.length);
    }
    const poster = frames[Math.floor(frames.length / 2)];
    return { frames, poster, duration, width: video.videoWidth, height: video.videoHeight };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export function formatDuration(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return "";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, "0")}`;
}
