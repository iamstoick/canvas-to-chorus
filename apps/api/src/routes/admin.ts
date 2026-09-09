import { Router, type RequestHandler } from "express";
import { count, desc, eq, inArray, sql } from "drizzle-orm";
import type { ArtworkListItem, SessionSummary } from "@artlyrics/shared";
import { config } from "../config.js";
import type { Db } from "../db/client.js";
import { analyses, artworks, providerSettings, questions, songs } from "../db/schema.js";
import { HttpError, notFound } from "../lib/errors.js";
import { SESSION_COOKIE } from "../middleware/session.js";
import { toArtworkSummary } from "./serializers.js";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!config.adminToken) return next(new HttpError(503, "admin_not_configured", "Set ADMIN_TOKEN on the server to enable the Sessions page."));
  if (req.headers.authorization !== `Bearer ${config.adminToken}`) return next(new HttpError(401, "unauthorized", "Invalid admin token."));
  next();
};

/** Artworks of one session with activity counts and the latest composition title. */
export async function listArtworks(db: Db, sessionId: string): Promise<ArtworkListItem[]> {
  const arts = await db.select().from(artworks).where(eq(artworks.sessionId, sessionId)).orderBy(desc(artworks.createdAt));
  if (arts.length === 0) return [];
  const ids = arts.map((a) => a.id);

  const [qCounts, aRows, sCounts] = await Promise.all([
    db.select({ artworkId: questions.artworkId, n: count() }).from(questions).where(inArray(questions.artworkId, ids)).groupBy(questions.artworkId),
    db
      .select({ artworkId: analyses.artworkId, title: sql<string | null>`${analyses.lyrics}->>'title'`, createdAt: analyses.createdAt })
      .from(analyses)
      .where(inArray(analyses.artworkId, ids))
      .orderBy(desc(analyses.createdAt)),
    db.select({ artworkId: songs.artworkId, n: count() }).from(songs).where(inArray(songs.artworkId, ids)).groupBy(songs.artworkId),
  ]);

  const q = new Map(qCounts.map((r) => [r.artworkId, Number(r.n)]));
  const s = new Map(sCounts.map((r) => [r.artworkId, Number(r.n)]));
  const aCount = new Map<string, number>();
  const latest = new Map<string, string | null>();
  for (const r of aRows) {
    aCount.set(r.artworkId, (aCount.get(r.artworkId) ?? 0) + 1);
    if (!latest.has(r.artworkId)) latest.set(r.artworkId, r.title); // rows are newest first
  }

  return arts.map((a) => ({
    ...toArtworkSummary(a),
    questionCount: q.get(a.id) ?? 0,
    analysisCount: aCount.get(a.id) ?? 0,
    songCount: s.get(a.id) ?? 0,
    latestTitle: latest.get(a.id) ?? null,
  }));
}

export function adminRouter(db: Db) {
  const r = Router();

  /** Whether the admin token is configured (lets the UI show a hint instead of a form). */
  r.get("/admin/status", (_req, res) => res.json({ enabled: Boolean(config.adminToken) }));

  r.get("/admin/sessions", requireAdmin, async (req, res, next) => {
    try {
      const rows = await db.execute(sql`
        with s as (
          select session_id from ${artworks}
          union
          select session_id from ${providerSettings}
        )
        select s.session_id,
          (select count(*) from ${artworks} a where a.session_id = s.session_id)::int as artwork_count,
          (select count(*) from ${questions} q join ${artworks} a on a.id = q.artwork_id where a.session_id = s.session_id)::int as question_count,
          (select count(*) from ${analyses} n join ${artworks} a on a.id = n.artwork_id where a.session_id = s.session_id)::int as analysis_count,
          (select count(*) from ${songs} g join ${artworks} a on a.id = g.artwork_id where a.session_id = s.session_id)::int as song_count,
          (select p.provider from ${providerSettings} p where p.session_id = s.session_id) as provider,
          (select p.model from ${providerSettings} p where p.session_id = s.session_id) as model,
          (select min(created_at) from ${artworks} a where a.session_id = s.session_id) as first_seen,
          (select max(created_at) from ${artworks} a where a.session_id = s.session_id) as last_seen
        from s
        order by last_seen desc nulls last
      `);
      const list: SessionSummary[] = (rows.rows as Record<string, unknown>[]).map((x) => ({
        sessionId: String(x.session_id),
        artworkCount: Number(x.artwork_count),
        questionCount: Number(x.question_count),
        analysisCount: Number(x.analysis_count),
        songCount: Number(x.song_count),
        provider: (x.provider as string | null) ?? null,
        model: (x.model as string | null) ?? null,
        firstSeen: x.first_seen ? new Date(x.first_seen as string).toISOString() : null,
        lastSeen: x.last_seen ? new Date(x.last_seen as string).toISOString() : null,
        current: String(x.session_id) === req.sessionId,
      }));
      res.json(list);
    } catch (e) {
      next(e);
    }
  });

  r.get("/admin/sessions/:id/artworks", requireAdmin, async (req, res, next) => {
    try {
      if (!UUID_RE.test(req.params.id)) throw notFound();
      res.json(await listArtworks(db, req.params.id));
    } catch (e) {
      next(e);
    }
  });

  /** Makes this browser act as the given session (sets the session cookie). */
  r.post("/admin/sessions/:id/switch", requireAdmin, (req, res) => {
    if (!UUID_RE.test(req.params.id)) {
      res.status(404).json({ error: { code: "not_found", message: "Not found" } });
      return;
    }
    res.cookie(SESSION_COOKIE, req.params.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "0",
      maxAge: 1000 * 60 * 60 * 24 * 365,
      path: "/",
    });
    res.json({ ok: true, sessionId: req.params.id });
  });

  return r;
}
