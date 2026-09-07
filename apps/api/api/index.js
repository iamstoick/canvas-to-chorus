// Vercel serverless entry. `vercel.json` rewrites every path here; Express sees the original URL.
// Built output is used so the function needs no TypeScript resolution at runtime.
import { createApp } from "../dist/app.js";
import { db } from "../dist/db/client.js";
import { providerFactory } from "../dist/services/providers.js";
import { selectStorage } from "../dist/services/storage.js";
import { sunoClient } from "../dist/services/suno.js";

const app = createApp({ db, storage: selectStorage(), providers: providerFactory, suno: sunoClient() });

export default app;
