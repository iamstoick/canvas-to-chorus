import { Router } from "express";
import { config } from "../config.js";
import type { Db } from "../db/client.js";
import { runRetention } from "../jobs/retention.js";
import type { Storage } from "../services/storage.js";

/**
 * GET /api/jobs/retention — for schedulers such as Vercel Cron. Requires
 * `Authorization: Bearer $CRON_SECRET` (Vercel adds this header automatically when CRON_SECRET is set).
 */
export function jobsRouter(db: Db, storage: Storage) {
  const r = Router();
  r.get("/jobs/retention", async (req, res, next) => {
    try {
      const secret = process.env.CRON_SECRET;
      if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
        res.status(401).json({ error: { code: "unauthorized", message: "CRON_SECRET required" } });
        return;
      }
      const removed = await runRetention(db, storage, config.retentionDays);
      res.json({ ok: true, removed, retentionDays: config.retentionDays });
    } catch (e) {
      next(e);
    }
  });
  return r;
}
