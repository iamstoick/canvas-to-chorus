import cookieParser from "cookie-parser";
import express from "express";
import type { Db } from "./db/client.js";
import { errorHandler } from "./middleware/errors.js";
import { session } from "./middleware/session.js";
import { artworksRouter } from "./routes/artworks.js";
import { composeRouter } from "./routes/compose.js";
import { healthRouter } from "./routes/health.js";
import { questionsRouter } from "./routes/questions.js";
import type { ProviderFactory } from "./services/provider.js";
import { settingsRouter } from "./routes/settings.js";
import type { Storage } from "./services/storage.js";

export interface AppDeps {
  db: Db;
  storage: Storage;
  providers: ProviderFactory;
}

export function createApp({ db, storage, providers }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use(session);

  app.use("/api", healthRouter(db));
  app.use("/api", artworksRouter(db, storage));
  app.use("/api", settingsRouter(db, providers));
  app.use("/api", questionsRouter(db, storage, providers));
  app.use("/api", composeRouter(db, storage, providers));

  app.use("/api", (_req, res) => res.status(404).json({ error: { code: "not_found", message: "Route not found" } }));
  app.use(errorHandler);
  return app;
}
