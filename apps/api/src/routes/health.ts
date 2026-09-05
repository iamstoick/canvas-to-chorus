import { Router } from "express";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

export function healthRouter(db: Db) {
  const r = Router();
  r.get("/health", async (_req, res) => {
    try {
      await db.execute(sql`select 1`);
      res.json({ ok: true, db: "ok" });
    } catch {
      res.status(503).json({ ok: false, db: "down" });
    }
  });
  return r;
}
