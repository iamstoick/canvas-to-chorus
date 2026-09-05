import { lt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { artworks } from "../db/schema.js";
import type { Storage } from "../services/storage.js";

/** Deletes artworks (and cascaded questions/analyses) older than `days`, plus their files. */
export async function runRetention(db: Db, storage: Storage, days: number): Promise<number> {
  if (!days || days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const removed = await db
    .delete(artworks)
    .where(lt(artworks.createdAt, cutoff))
    .returning({ storagePath: artworks.storagePath });
  await Promise.all(
    removed.map((r) => storage.remove(r.storagePath).catch((e) => console.warn("retention: file removal failed", e))),
  );
  return removed.length;
}

export function scheduleRetention(db: Db, storage: Storage, days: number, everyMs = 6 * 60 * 60 * 1000) {
  if (!days || days <= 0) return;
  const tick = () =>
    runRetention(db, storage, days)
      .then((n) => n && console.log(`retention: removed ${n} artwork(s) older than ${days}d`))
      .catch((e) => console.error("retention failed", e));
  setTimeout(tick, 30_000).unref();
  setInterval(tick, everyMs).unref();
}
