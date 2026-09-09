import "./setup.js";
import { describe, expect, it, vi } from "vitest";
import { persistTracks, toSongRecord } from "../src/routes/songs.js";
import { mergeTracks } from "../src/services/suno.js";
import type { SongRow } from "../src/db/schema.js";
import type { Storage } from "../src/services/storage.js";

const base: SongRow = {
  id: "11111111-1111-4111-8111-111111111111",
  analysisId: "22222222-2222-4222-8222-222222222222",
  artworkId: "33333333-3333-4333-8333-333333333333",
  taskId: "t1",
  status: "success",
  sunoStatus: "SUCCESS",
  model: "V4_5",
  instrumental: false,
  tracks: [
    { id: "a", title: "A", audioUrl: "https://tempfile/a.mp3", streamAudioUrl: "https://stream/a", imageUrl: null, duration: 100, storedPath: null, playbackUrl: null },
    { id: "b", title: "B", audioUrl: "https://tempfile/b.mp3", streamAudioUrl: "https://stream/b", imageUrl: null, duration: 100, storedPath: "2026/b.mp3", playbackUrl: null },
  ],
  error: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("toSongRecord", () => {
  it("prefers our stored copy, then Suno's MP3, never the dead stream URL when an MP3 exists", () => {
    const rec = toSongRecord(base);
    expect(rec.tracks[0].playbackUrl).toBe("https://tempfile/a.mp3");
    expect(rec.tracks[1].playbackUrl).toBe(`/api/songs/${base.id}/tracks/1/audio`);
    expect(rec.persisted).toBe(false);
  });
  it("falls back to the stream only while no MP3 exists yet", () => {
    const rec = toSongRecord({ ...base, status: "first", tracks: [{ ...base.tracks[0], audioUrl: null }] });
    expect(rec.tracks[0].playbackUrl).toBe("https://stream/a");
  });
});

describe("mergeTracks", () => {
  it("keeps storedPath across refreshes from Suno", () => {
    const fresh = base.tracks.map((t) => ({ ...t, storedPath: null }));
    expect(mergeTracks(base.tracks, fresh)[1].storedPath).toBe("2026/b.mp3");
  });
});

describe("persistTracks", () => {
  const storage: Storage = { save: vi.fn(async () => "2026/new.mp3"), read: vi.fn(), remove: vi.fn() };
  const db = { update: () => ({ set: (v: unknown) => ({ where: () => ({ returning: async () => [{ ...base, ...(v as object) }] }) }) }) } as never;

  it("downloads missing MP3s into storage and skips ones already stored", async () => {
    const fetch = vi.fn(async () => new Response(Buffer.alloc(4096, 1))) as unknown as typeof fetch;
    const out = await persistTracks(db, storage, base, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(out.tracks[0].storedPath).toBe("2026/new.mp3");
    expect(out.tracks[1].storedPath).toBe("2026/b.mp3");
    expect(toSongRecord(out).persisted).toBe(true);
  });

  it("leaves storedPath null on empty or failed downloads so the next poll retries", async () => {
    const fetch = vi.fn(async () => new Response(Buffer.alloc(0))) as unknown as typeof fetch;
    const out = await persistTracks(db, { ...storage, save: vi.fn() }, base, fetch);
    expect(out.tracks[0].storedPath).toBeNull();
  });

  it("does nothing for songs that are not finished", async () => {
    const fetch = vi.fn() as unknown as typeof fetch;
    await persistTracks(db, storage, { ...base, status: "pending" }, fetch);
    expect(fetch).not.toHaveBeenCalled();
  });
});
