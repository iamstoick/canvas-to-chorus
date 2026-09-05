import "./setup.js";
import request from "supertest";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { Db } from "../src/db/client.js";
import type { AnalysisProvider, ProviderFactory } from "../src/services/provider.js";
import type { Storage } from "../src/services/storage.js";

/**
 * Routes are exercised up to the point where they would touch Postgres; the db stub
 * only answers the health probe. Full DB integration runs against docker compose.
 */
const db = { execute: vi.fn(async () => []) } as unknown as Db;
const storage: Storage = { save: vi.fn(), read: vi.fn(), remove: vi.fn() };
const provider: AnalysisProvider = { name: "claude-cli", answerQuestion: vi.fn(), compose: vi.fn(), test: vi.fn() };
const providers: ProviderFactory = () => provider;
const app = createApp({ db, storage, providers });

describe("health", () => {
  it("reports db ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: "ok" });
  });

  it("reports 503 when the db query fails", async () => {
    (db.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("down"));
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(503);
    expect(res.body.db).toBe("down");
  });
});

describe("session cookie", () => {
  it("is set httpOnly on first request", async () => {
    const res = await request(app).get("/api/health");
    const cookie = res.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toMatch(/^al_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });
});

describe("POST /api/artworks validation", () => {
  it("400 when no file attached", async () => {
    const res = await request(app).post("/api/artworks");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("missing_file");
  });

  it("400 for non-image payload regardless of claimed type", async () => {
    const res = await request(app)
      .post("/api/artworks")
      .attach("file", Buffer.from("not an image"), { filename: "x.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("unsupported_type");
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("400 for oversized upload", async () => {
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const res = await request(app).post("/api/artworks").attach("file", huge, { filename: "big.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("file_too_large");
  });

  it("re-encodes a valid image before saving (smoke: reaches storage)", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#f00" } }).png().toBuffer();
    (storage.save as ReturnType<typeof vi.fn>).mockResolvedValueOnce("2026-09-05/x.png");
    // db.insert is not stubbed, so this ends in a 500 after storage.save is invoked.
    const res = await request(app).post("/api/artworks").attach("file", png, { filename: "a.png", contentType: "image/png" });
    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
  });
});

describe("artwork lookups", () => {
  it("404 for a non-UUID id before touching the db", async () => {
    const res = await request(app).get("/api/artworks/not-a-uuid");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("400 validation error for a too-short question", async () => {
    const res = await request(app)
      .post("/api/artworks/123e4567-e89b-12d3-a456-426614174000/questions")
      .send({ question: "hi" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });

  it("404 JSON envelope for unknown api routes", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });
});

describe("settings validation", () => {
  it("rejects an unknown provider", async () => {
    const res = await request(app).put("/api/settings").send({ provider: "openai", model: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
  });
  it("rejects a malformed base URL", async () => {
    const res = await request(app).put("/api/settings").send({ provider: "ollama", model: "qwen3", baseUrl: "not a url" });
    expect(res.status).toBe(400);
  });
});
