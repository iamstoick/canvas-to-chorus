import rateLimit from "express-rate-limit";
import { config } from "../config.js";

const keyBySession = (req: { sessionId?: string; ip?: string }) => req.sessionId ?? req.ip ?? "anon";

export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.rateLimits.uploadsPerHour,
  keyGenerator: keyBySession,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many uploads. Try again later." } },
});

export const modelLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.rateLimits.modelCallsPerHour,
  keyGenerator: keyBySession,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many requests. Try again later." } },
});
