import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";

export const SESSION_COOKIE = "al_session";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare global {
  namespace Express {
    interface Request {
      sessionId: string;
    }
  }
}

/** Anonymous per-browser session. Scopes every artwork; no cross-session reads. */
export const session: RequestHandler = (req, res, next) => {
  const existing = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (existing && UUID_RE.test(existing)) {
    req.sessionId = existing;
  } else {
    req.sessionId = randomUUID();
    res.cookie(SESSION_COOKIE, req.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "0",
      maxAge: 1000 * 60 * 60 * 24 * 365,
      path: "/",
    });
  }
  next();
};
