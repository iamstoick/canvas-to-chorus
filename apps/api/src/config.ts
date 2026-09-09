function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

import { existsSync } from "node:fs";
import { resolveClaudeCli } from "./services/claudeCliResolve.js";

type ProviderName = "claude-cli" | "claude-proxy" | "anthropic" | "ollama";

const inDocker = existsSync("/.dockerenv");

function pickDefaultProvider(): ProviderName {
  const explicit = process.env.DEFAULT_PROVIDER as ProviderName | undefined;
  if (explicit) return explicit;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  // Serverless hosts have neither a local CLI nor a reachable host proxy.
  if (process.env.VERCEL) return "anthropic";
  if (!inDocker && resolveClaudeCli(process.env.CLAUDE_CLI_PATH)) return "claude-cli";
  if (inDocker) return "claude-proxy";
  return "ollama";
}

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  uploadDir: process.env.UPLOAD_DIR ?? "./data/uploads",
  retentionDays: Number(process.env.RETENTION_DAYS ?? 30),
  inDocker,
  /** Provider used for sessions that have not saved their own settings. */
  defaultProvider: pickDefaultProvider(),
  claudeProxy: {
    url: process.env.CLAUDE_PROXY_URL ?? (inDocker ? "http://host.docker.internal:3099" : "http://localhost:3099"),
    token: process.env.CLAUDE_PROXY_TOKEN || undefined,
  },
  claudeCli: {
    path: process.env.CLAUDE_CLI_PATH ?? null,
    model: process.env.CLAUDE_CLI_MODEL ?? "haiku",
    timeoutMs: Number(process.env.CLAUDE_CLI_TIMEOUT_MS ?? 10 * 60 * 1000),
  },
  anthropic: {
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
    // Set to "1" to disable the server-side refusal fallback parameter.
    disableFallbacks: process.env.DISABLE_REFUSAL_FALLBACKS === "1",
  },
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
    model: process.env.OLLAMA_MODEL ?? "qwen3:latest",
    timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS ?? 10 * 60 * 1000),
  },
  suno: {
    apiKey: process.env.SUNO_API_KEY || null,
    baseUrl: process.env.SUNO_BASE_URL ?? "https://api.sunoapi.org",
    model: process.env.SUNO_MODEL ?? "V4_5",
    /** Public origin of this deployment for Suno's completion callback. Derived from the request when unset. */
    publicBaseUrl: process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") || null,
  },
  /** Bearer token for the Sessions admin page. Unset = admin endpoints disabled. */
  adminToken: process.env.ADMIN_TOKEN || null,
  rateLimits: {
    uploadsPerHour: Number(process.env.RATE_UPLOADS_PER_HOUR ?? 20),
    modelCallsPerHour: Number(process.env.RATE_MODEL_CALLS_PER_HOUR ?? process.env.RATE_CLAUDE_PER_HOUR ?? 60),
  },
} as const;
