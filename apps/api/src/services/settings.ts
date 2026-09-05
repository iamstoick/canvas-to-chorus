import { eq } from "drizzle-orm";
import { PROVIDER_DEFAULTS, type ProviderSettings, type ProviderSettingsUpdate } from "@artlyrics/shared";
import { config } from "../config.js";
import type { Db } from "../db/client.js";
import { providerSettings } from "../db/schema.js";

/** Server defaults come from env; a session may override them via the settings screen. */
export function defaultSettings(): ProviderSettings {
  switch (config.defaultProvider) {
    case "ollama":
      return { provider: "ollama", model: config.ollama.model, baseUrl: config.ollama.baseUrl, cliPath: null };
    case "claude-cli":
      return { provider: "claude-cli", model: config.claudeCli.model, baseUrl: null, cliPath: config.claudeCli.path };
    case "claude-proxy":
      return { provider: "claude-proxy", model: config.claudeCli.model, baseUrl: config.claudeProxy.url, cliPath: config.claudeCli.path };
    default:
      return { provider: "anthropic", model: config.anthropic.model, baseUrl: null, cliPath: null };
  }
}

export async function getSettings(db: Db, sessionId: string): Promise<ProviderSettings> {
  const [row] = await db.select().from(providerSettings).where(eq(providerSettings.sessionId, sessionId)).limit(1);
  if (!row) return defaultSettings();
  return { provider: row.provider as ProviderSettings["provider"], model: row.model, baseUrl: row.baseUrl, cliPath: row.cliPath };
}

export async function saveSettings(db: Db, sessionId: string, update: ProviderSettingsUpdate): Promise<ProviderSettings> {
  const provider = update.provider;
  const model = update.model?.trim() || PROVIDER_DEFAULTS[provider].model;
  const baseUrl = update.baseUrl === undefined || update.baseUrl === "" || update.baseUrl === null ? null : update.baseUrl;
  const cliPath = update.cliPath === undefined || update.cliPath === "" || update.cliPath === null ? null : update.cliPath;
  const [row] = await db
    .insert(providerSettings)
    .values({ sessionId, provider, model, baseUrl, cliPath })
    .onConflictDoUpdate({ target: providerSettings.sessionId, set: { provider, model, baseUrl, cliPath, updatedAt: new Date() } })
    .returning();
  return { provider: row.provider as ProviderSettings["provider"], model: row.model, baseUrl: row.baseUrl, cliPath: row.cliPath };
}
