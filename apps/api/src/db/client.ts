import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { config } from "../config.js";
import * as schema from "./schema.js";

// Serverless instances each hold their own pool, so keep it small there (Neon pooled URL recommended).
const max = Number(process.env.DB_POOL_MAX ?? (process.env.VERCEL ? 2 : 10));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max,
  idleTimeoutMillis: 30_000,
  ssl: /sslmode=require|neon\.tech|vercel-storage\.com/.test(config.databaseUrl) ? { rejectUnauthorized: false } : undefined,
});
export const db = drizzle(pool, { schema });
export type Db = typeof db;
