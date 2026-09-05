import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

/**
 * Minimal file storage abstraction. Local disk today; swap for S3/GCS by
 * implementing the same three functions.
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

export const localStorage: Storage = {
  async save(bytes, ext) {
    const rel = path.join(new Date().toISOString().slice(0, 10), `${randomUUID()}.${ext}`);
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
