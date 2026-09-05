import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

/**
 * Minimal file storage abstraction. Local disk for Docker/dev, Vercel Blob when
 * BLOB_READ_WRITE_TOKEN is present. `storagePath` is whatever the backend needs to
 * find the file again (a relative path, or a blob URL).
 */
export interface Storage {
  save(bytes: Buffer, ext: string): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
  remove(storagePath: string): Promise<void>;
}

function safeJoin(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid storage path");
  return abs;
}

const objectKey = (ext: string) => path.posix.join(new Date().toISOString().slice(0, 10), `${randomUUID()}.${ext}`);

export const localStorage: Storage = {
  async save(bytes, ext) {
    const rel = objectKey(ext);
    const abs = safeJoin(config.uploadDir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    return rel;
  },
  async read(rel) {
    return readFile(safeJoin(config.uploadDir, rel));
  },
  async remove(rel) {
    await unlink(safeJoin(config.uploadDir, rel)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
  },
};

/** Vercel Blob. Objects get an unguessable random suffix; the stored path is the blob URL. */
export const vercelBlobStorage: Storage = {
  async save(bytes, ext) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`artworks/${objectKey(ext)}`, bytes, { access: "public", addRandomSuffix: true, contentType: `image/${ext === "jpg" ? "jpeg" : ext}` });
    return blob.url;
  },
  async read(url) {
    const res = await fetch(url);
    if (!res.ok) throw Object.assign(new Error(`blob fetch failed: ${res.status}`), { code: "ENOENT" });
    return Buffer.from(await res.arrayBuffer());
  },
  async remove(url) {
    const { del } = await import("@vercel/blob");
    await del(url);
  },
};

export function selectStorage(): Storage {
  return process.env.BLOB_READ_WRITE_TOKEN ? vercelBlobStorage : localStorage;
}
