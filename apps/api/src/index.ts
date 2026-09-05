import { createApp } from "./app.js";
import { config } from "./config.js";
import { db, pool } from "./db/client.js";
import { scheduleRetention } from "./jobs/retention.js";
import { providerFactory } from "./services/providers.js";
import { selectStorage } from "./services/storage.js";

const storage = selectStorage();
const app = createApp({ db, storage, providers: providerFactory });

const server = app.listen(config.port, () => {
  console.log(`api listening on :${config.port} (${config.env}), default provider=${config.defaultProvider}`);
});

scheduleRetention(db, storage, config.retentionDays);

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
