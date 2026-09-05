import { Router } from "express";
import { ProviderSettingsUpdate } from "@artlyrics/shared";
import type { Db } from "../db/client.js";
import type { ProviderFactory } from "../services/provider.js";
import { getSettings, saveSettings } from "../services/settings.js";

export function settingsRouter(db: Db, providers: ProviderFactory) {
  const r = Router();

  r.get("/settings", async (req, res, next) => {
    try {
      res.json(await getSettings(db, req.sessionId));
    } catch (e) {
      next(e);
    }
  });

  r.put("/settings", async (req, res, next) => {
    try {
      const update = ProviderSettingsUpdate.parse(req.body);
      res.json(await saveSettings(db, req.sessionId, update));
    } catch (e) {
      next(e);
    }
  });

  /** Checks connectivity for the submitted (unsaved) settings, or the saved ones if body is empty. */
  r.post("/settings/test", async (req, res, next) => {
    try {
      const settings =
        req.body && Object.keys(req.body).length > 0
          ? (() => {
              const u = ProviderSettingsUpdate.parse(req.body);
              return { provider: u.provider, model: u.model, baseUrl: u.baseUrl ? u.baseUrl : null, cliPath: u.cliPath ? u.cliPath : null };
            })()
          : await getSettings(db, req.sessionId);
      const result = await providers(settings).test();
      res.json({ provider: settings.provider, model: settings.model, ...result });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
