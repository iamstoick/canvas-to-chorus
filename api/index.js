// Single-project Vercel entry (Root Directory = repo root). vercel.json rewrites /api/* here;
// the React build in apps/web/dist is served as static files on the same domain.
import { createApp } from "../apps/api/dist/app.js";
import { db } from "../apps/api/dist/db/client.js";
import { providerFactory } from "../apps/api/dist/services/providers.js";
import { selectStorage } from "../apps/api/dist/services/storage.js";
import { sunoClient } from "../apps/api/dist/services/suno.js";

const app = createApp({ db, storage: selectStorage(), providers: providerFactory, suno: sunoClient() });

export default app;
