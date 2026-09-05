# Implementation Plan: Artwork → Lyrics & Musical Style

## 1. Idea

A user uploads an artwork image, asks five questions about it, then the app analyzes the
artwork, generates song lyrics inspired by it, and recommends a musical style.

**Assumption (flagged):** "ask five questions" is read as *the user asks Claude up to five
questions about the artwork* (a short, capped Q&A). The Q&A transcript then feeds the lyric
generation so the lyrics reflect what the user cared about. If the intended reading is
*the app asks the user five questions* (mood, audience, language, etc.), only the
`/questions` step changes direction; the rest of the plan is unchanged.

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | SPA, served by Nginx in prod |
| Backend | Node 22 + Express + TypeScript | Same language as frontend; one npm workspace (pnpm was not available on the build machine) |
| AI | `@anthropic-ai/sdk` (Claude Opus 5, `claude-opus-5`) | Vision + structured outputs (Zod) |
| DB | PostgreSQL 16 | Sessions, artworks, Q&A, analysis, lyrics |
| ORM / migrations | Drizzle ORM + drizzle-kit | Type-safe, SQL-first migrations |
| File storage | Local Docker volume (`/data/uploads`) | Swap for S3/GCS later behind one interface |
| Containers | Docker + Docker Compose | `web`, `api`, `db` services |
| Validation | Zod (shared package) | Same schemas on client, server, and Claude output |

## 3. User Flow

```
Upload artwork ──► Ask Q1..Q5 (each answered by Claude) ──► "Analyze & Compose"
      │                        │                                     │
      ▼                        ▼                                     ▼
 POST /artworks        POST /artworks/:id/questions        POST /artworks/:id/compose
 (store file + row)    (vision Q&A, stored)                (analysis + lyrics + style, stored)
                                                                     │
                                                                     ▼
                                                          Result page: analysis card,
                                                          lyrics, style recommendation,
                                                          copy / regenerate
```

## 4. Repository Layout

```
.
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── package.json                 # npm workspaces root
├── packages/
│   └── shared/                  # Zod schemas + TS types shared by web and api
│       └── src/schemas.ts
├── apps/
│   ├── web/                     # React + Vite
│   │   ├── Dockerfile           # multi-stage: build → nginx
│   │   ├── nginx.conf           # SPA fallback + /api proxy
│   │   └── src/
│   │       ├── pages/UploadPage.tsx
│   │       ├── pages/QuestionsPage.tsx
│   │       ├── pages/ResultPage.tsx
│   │       ├── components/ArtworkDropzone.tsx
│   │       ├── components/QuestionThread.tsx
│   │       ├── components/LyricsCard.tsx
│   │       ├── components/StyleCard.tsx
│   │       └── lib/api.ts       # typed fetch client
│   └── api/                     # Express
│       ├── Dockerfile
│       ├── drizzle/             # generated SQL migrations
│       └── src/
│           ├── index.ts         # server bootstrap
│           ├── db/schema.ts     # Drizzle tables
│           ├── db/client.ts
│           ├── routes/artworks.ts
│           ├── routes/questions.ts
│           ├── routes/compose.ts
│           ├── services/claude.ts      # all Anthropic calls
│           ├── services/storage.ts     # file save/read abstraction
│           ├── prompts/analyze.ts
│           ├── prompts/lyrics.ts
│           └── middleware/{upload,errors,rateLimit}.ts
└── docs/IMPLEMENTATION_PLAN.md
```

## 5. Database Schema (PostgreSQL)

```sql
CREATE TABLE artworks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL,                 -- anonymous browser session (cookie)
  original_name TEXT NOT NULL,
  mime_type     TEXT NOT NULL,                 -- image/jpeg | image/png | image/webp | image/gif
  byte_size     INTEGER NOT NULL,
  storage_path  TEXT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artwork_id  UUID NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  position    SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 5),
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (artwork_id, position)                -- enforces the five-question cap
);

CREATE TABLE analyses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artwork_id   UUID NOT NULL REFERENCES artworks(id) ON DELETE CASCADE,
  analysis     JSONB NOT NULL,                 -- ArtworkAnalysis (see §6)
  lyrics       JSONB NOT NULL,                 -- Lyrics
  style        JSONB NOT NULL,                 -- StyleRecommendation
  model        TEXT NOT NULL,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX analyses_artwork_idx ON analyses(artwork_id, created_at DESC);
```

Multiple `analyses` rows per artwork allow "Regenerate" without losing history.

## 6. Shared Zod Schemas (`packages/shared/src/schemas.ts`)

These drive request validation, Claude structured outputs, and UI typing.

```ts
import { z } from "zod";

export const ArtworkAnalysis = z.object({
  subject: z.string(),
  medium: z.string(),
  dominant_colors: z.array(z.string()).min(1).max(6),
  mood: z.array(z.string()).min(1).max(5),
  composition: z.string(),
  era_or_movement: z.string(),
  symbols_and_themes: z.array(z.string()),
  narrative: z.string(),               // 2–3 sentence story the image tells
});

export const Lyrics = z.object({
  title: z.string(),
  sections: z.array(z.object({
    type: z.enum(["verse", "chorus", "bridge", "outro", "pre-chorus"]),
    lines: z.array(z.string()).min(2).max(8),
  })).min(3),
  rationale: z.string(),               // how the artwork shaped the lyrics
});

export const StyleRecommendation = z.object({
  primary_genre: z.string(),
  sub_genres: z.array(z.string()).max(3),
  tempo_bpm: z.object({ min: z.number(), max: z.number() }),
  key_suggestion: z.string(),
  instrumentation: z.array(z.string()),
  vocal_style: z.string(),
  reference_artists: z.array(z.string()).max(4),
  why: z.string(),
});

export const Composition = z.object({
  analysis: ArtworkAnalysis,
  lyrics: Lyrics,
  style: StyleRecommendation,
});
```

## 7. API Endpoints

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/artworks` | multipart `file` | `{ id, url, width, height }` | 10 MB cap, MIME allow-list, magic-byte check, EXIF strip via `sharp` |
| GET | `/api/artworks/:id` | – | artwork + questions + latest analysis | Session-scoped |
| GET | `/api/artworks/:id/image` | – | image bytes | Served from storage |
| POST | `/api/artworks/:id/questions` | `{ question }` | `{ position, question, answer }` | 409 once 5 exist |
| POST | `/api/artworks/:id/compose` | `{}` | `Composition` + `analysisId` | Requires ≥1 question? No: works with 0–5; more context = better output |
| GET | `/api/health` | – | `{ ok, db }` | For Compose healthcheck |

All responses use a single error envelope `{ error: { code, message } }`.

## 8. Claude Integration (`apps/api/src/services/claude.ts`)

**Model:** `claude-opus-5`. Thinking is adaptive by default on Opus 5, so omit the
`thinking` parameter. Refusal fallbacks enabled by default (server-side `fallbacks: "default"`
with beta `server-side-fallback-2026-07-01`) so a safety decline on one artwork re-routes
inside the same call instead of failing the request. Remove it if not wanted.

**Image handling:** read the stored file, downscale longest edge to 1568 px with `sharp`
(keeps vision quality, cuts tokens), base64-encode, send as an `image` block with the
detected `media_type`.

### 8.1 Question answering

```ts
const response = await client.beta.messages.create({
  model: "claude-opus-5",
  max_tokens: 2000,
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
  system: ANALYST_SYSTEM_PROMPT,          // frozen text → cacheable
  messages: [
    { role: "user", content: [
        { type: "image", source: { type: "base64", media_type, data } },
        { type: "text", text: "Here is the artwork. I will ask questions about it." } ] },
    ...priorQA.flatMap(q => [
        { role: "user", content: q.question },
        { role: "assistant", content: q.answer } ]),
    { role: "user", content: newQuestion },
  ],
});
if (response.stop_reason === "refusal") { /* 422 with friendly message */ }
```

Prior Q&A is replayed so each answer stays consistent with earlier ones. Add
`cache_control: { type: "ephemeral" }` at top level; the image + system prompt are a stable
prefix across the five questions, so questions 2–5 hit the cache.

### 8.2 Compose (analysis + lyrics + style) — one structured call

```ts
const response = await client.beta.messages.parse({
  model: "claude-opus-5",
  max_tokens: 16000,
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
  system: COMPOSER_SYSTEM_PROMPT,
  messages: [{ role: "user", content: [
    { type: "image", source: { type: "base64", media_type, data } },
    { type: "text", text: buildComposePrompt(questionsAndAnswers) },
  ]}],
  output_config: { format: zodOutputFormat(Composition) },
});
const composition = response.parsed_output;   // null on parse failure → retry once, then 502
```

Single call keeps analysis, lyrics, and style internally consistent (style reasons about
the same mood the lyrics used). Split into two calls only if latency becomes a problem.

**Prompt content (`prompts/lyrics.ts`):**
- Analyze visually first (subject, palette, composition, mood, era, symbols).
- Use the user's questions as signals of what they find interesting; weave those themes in.
- Lyrics: original, no quoting existing songs, singable line lengths, at least one chorus.
- Style: justify genre from mood/era/palette; give tempo range, key, instrumentation,
  vocal approach, reference artists as *influences* only.

**Streaming:** compose can take 20–60 s. Phase 1 uses a simple spinner with the
non-streaming `parse()` call. Phase 3 upgrades to `client.beta.messages.stream()` over SSE so
lyrics appear progressively.

## 9. Frontend (React + Vite)

**Routing:** `react-router` — `/` (upload), `/a/:id/questions`, `/a/:id/result`.

**State:** TanStack Query for server state; no global store needed.

**Pages**
1. **UploadPage** — drag-and-drop (`react-dropzone`), client-side preview and size/type
   check, progress bar, then navigate to questions.
2. **QuestionsPage** — artwork on the left, chat-style thread on the right. Counter
   "Question 3 of 5". Suggested-question chips (e.g. "What mood does this convey?",
   "What era is this from?") to reduce blank-page friction. Input disables at 5.
   "Skip to compose" available at any time.
3. **ResultPage** — three panels: Analysis (chips for colors/mood, narrative), Lyrics
   (sectioned, copy button, download `.txt`), Style (genre, BPM, key, instruments,
   references). "Regenerate" button creates a new `analyses` row; history dropdown.

**Styling:** Tailwind CSS. Dark/light via `prefers-color-scheme`.

**Env:** `VITE_API_BASE` defaults to `/api` (Nginx proxies to `api` container).

## 10. Docker

**`docker-compose.yml` (prod-like)**
```yaml
services:
  db:
    image: postgres:16-alpine
    environment: { POSTGRES_DB: artlyrics, POSTGRES_USER: app, POSTGRES_PASSWORD: ${DB_PASSWORD} }
    volumes: [ pgdata:/var/lib/postgresql/data ]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U app -d artlyrics"], interval: 5s, retries: 10 }
  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    environment:
      DATABASE_URL: postgres://app:${DB_PASSWORD}@db:5432/artlyrics
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      UPLOAD_DIR: /data/uploads
    volumes: [ uploads:/data/uploads ]
    depends_on: { db: { condition: service_healthy } }
    command: sh -c "node dist/db/migrate.js && node dist/index.js"
  web:
    build: { context: ., dockerfile: apps/web/Dockerfile }
    ports: [ "8080:80" ]
    depends_on: [ api ]
volumes: { pgdata: {}, uploads: {} }
```

**`docker-compose.dev.yml`** overrides `api` and `web` to run `npm run dev` with bind mounts and
Vite HMR on `5173`, Vite `server.proxy` forwarding `/api` to `http://api:3000`.

**Dockerfiles:** multi-stage. `api`: `node:22-alpine` build → prune dev deps → runtime.
`web`: build with Vite → copy `dist` into `nginx:alpine`.

## 11. Security & Limits

- MIME allow-list + magic-byte sniffing (`file-type`); reject SVG (script risk).
- 10 MB upload cap; `sharp` re-encode strips EXIF/metadata and defuses malformed images.
- Anonymous session cookie (`httpOnly`, `sameSite=lax`) scopes artworks; no cross-session reads.
- Rate limit: 20 uploads/hour and 60 Claude calls/hour per session (`express-rate-limit`).
- API key only in `api` container env; never shipped to the browser.
- Log `usage.input_tokens` / `output_tokens` per call into `analyses` for cost tracking.
- Handle `stop_reason === "refusal"` explicitly with a user-friendly message.
- Retention job (cron or `pg_cron`): delete artworks older than N days, including files.

## 12. Testing

- **shared:** Zod schema unit tests (Vitest).
- **api:** Supertest route tests with a Postgres test container (Testcontainers) and a
  mocked `services/claude.ts`; one live smoke test behind `RUN_LIVE=1`.
- **web:** Vitest + React Testing Library for pages; Playwright e2e for upload → 5 questions
  → result against `docker compose up`.
- **Prompt quality:** a small eval set of ~10 artworks with rubric grading (lyrics are
  original, reference the artwork, style justified). Revisit after prompt changes.

## 13. Delivery Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Scaffold** (½ day) | npm workspace, Vite React app, Express app, shared package, Drizzle + first migration, Compose dev/prod files, `.env.example`, CI lint/typecheck | `docker compose up` serves the SPA and `/api/health` returns `db: ok` |
| **1. Upload** (1 day) | Dropzone, `POST /artworks`, storage service, image serving, session cookie | Image round-trips through the browser |
| **2. Five questions** (1–1.5 days) | Questions route, Claude vision Q&A with history replay + caching, QuestionsPage, 5-cap | Five consistent answers about a test image; cache reads > 0 on Q2–Q5 |
| **3. Compose** (1.5 days) | Structured-output compose call, `analyses` table, ResultPage, regenerate + history | Valid `Composition` JSON rendered; regenerate creates new row |
| **4. Hardening** (1 day) | Rate limits, magic-byte checks, refusal handling, token logging, retention job, error envelope, tests | Test suite green; abuse cases return proper 4xx |
| **5. Polish** (optional) | SSE streaming of lyrics, suggested-question chips, export to PDF/text, share link | Progressive lyrics render; share link opens read-only result |

Estimated total: ~5–6 engineering days for phases 0–4.

## 14. Open Questions

1. Direction of the five questions (user → Claude, or app → user). See §1 assumption.
2. Auth: anonymous sessions only, or accounts (would add a `users` table + login)?
3. Storage: local volume acceptable for v1, or object storage from day one?
4. Should the recommended style also produce a playable reference (e.g. Suno/Udio prompt
   string)? Cheap to add as an extra field on `StyleRecommendation`.

## 15. Build Notes (2026-09-05)

Phases 0–4 implemented. Deviations from the plan above:

- **npm workspaces instead of pnpm** — pnpm/corepack were not installed on the build machine.
- **Zod v4 API via `zod/v4`** — the Anthropic SDK's `betaZodOutputFormat` helper expects zod v4
  types, so shared schemas import from `zod/v4`.
- **Compose parses manually** — `client.beta.messages.create` with `output_config.format`, then
  `Composition.safeParse` on the text, with one retry on schema mismatch. This keeps refusal
  fallbacks (beta namespace) and structured output in the same call.
- **API tests** stub the database and exercise routes up to the DB boundary; the full DB path is
  verified via `docker compose up`. Testcontainers were left out to keep the test run dependency-free.
- **Phase 5 items** (SSE streaming, share links, PDF export) not built. Suggested-question chips were.

## 16. Local model support (added 2026-09-05)

"Local Claude" was clarified to mean a local model served by Ollama, selectable in the UI (Provider /
Model / Base URL form). Changes:

- **Provider abstraction** `AnalysisProvider` with two implementations: `anthropicProvider` and
  `ollamaProvider`. A `ProviderFactory` picks one per request from the session's saved settings.
- **Settings** stored per anonymous session in a new `provider_settings` table (migration
  `0001_provider_settings`). Endpoints `GET/PUT /api/settings` and `POST /api/settings/test`.
- **Settings page** (`/settings`) mirrors the reference UI: provider dropdown, model, optional base URL,
  Docker hint, plus a *Test connection* button that reports reachability, installed models, and
  whether the chosen model has the `vision` capability.
- **Defaults**: Ollama unless `ANTHROPIC_API_KEY` is present. Compose passes
  `OLLAMA_BASE_URL=http://host.docker.internal:11434` and adds `extra_hosts` for Linux hosts.
- **Caveat**: text-only models (`qwen3`, `deepseek-r1`) receive the image but cannot see it, so their
  analysis is not grounded. The UI and the test endpoint say so and suggest `qwen2.5vl`, `gemma3`,
  `llava`, or `llama3.2-vision`.

## 17. Claude CLI provider (added 2026-09-05)

Ollama's local models could not see images (Ollama rejects image input for text-only models such as
qwen3 with HTTP 400, now surfaced as `422 ollama_no_vision`). The user asked to use Claude instead, via
the locally authenticated Claude Code CLI, with a "Claude CLI (direct)" option in the settings UI.

- `claudeCliProvider` (`apps/api/src/services/claudeCli.ts`) runs `claude -p` in a scratch directory
  holding the artwork, restricted to the Read tool, JSON output, `--json-schema` for compose, and
  `--no-session-persistence`. Binary resolution: explicit path → `PATH` → `~/.local/bin/claude` and
  other common locations (`claudeCliResolve.ts`). Distinct error codes for missing binary, auth,
  permission, timeout.
- Settings gained `cliPath` (migration `0002_cli_path`); UI shows a model dropdown (haiku/sonnet/opus)
  and an optional CLI Path field with the hint "Leave blank to auto-resolve."
- Default provider order: `DEFAULT_PROVIDER` → Anthropic if API key → Claude CLI if found and not in
  Docker → Ollama. In Docker the CLI is unavailable, so the CLI mode requires running the API on the
  host (`npm run dev:db` + `npm run dev`).
- Verified live with `haiku`: two grounded answers about a test image (about 11 s each) and a full
  schema-valid composition (about 73 s, 8.2k in / 6.5k out tokens).

## 18. Claude CLI Proxy (added 2026-09-05)

To use the local Claude Code login from the Dockerized API, a host-side proxy was added:

- `scripts/claude-proxy.js`: dependency-free Node HTTP server (default `127.0.0.1:3099`) with
  `GET /health` and `POST /run`. `/run` writes the image into a scratch dir, runs
  `claude -p … --tools Read --json-schema …`, returns the raw JSON envelope, and cleans up. Optional
  bearer token (`CLAUDE_PROXY_TOKEN`), configurable bind host for Linux.
- API: `claudeCli.ts` refactored into a shared core with two executors. `localExecutor` spawns the
  binary; `proxyExecutor` POSTs to the proxy. `claudeProxyProvider` uses the settings' Base URL
  (default `http://host.docker.internal:3099`) and forwards CLI Path to the proxy.
- Settings UI gained the "Claude CLI Proxy" option with Base URL + CLI Path fields, matching the
  reference screenshot. Default model for both CLI providers is now `haiku`.
- Default provider inside Docker is now `claude-proxy` (unless an API key is present).

## 19. Vercel readiness (added 2026-09-05)

The first Vercel build (Root Directory `apps/api`) failed with "Cannot find module '@artlyrics/shared'"
because the API compiled before the shared workspace package was built, plus a switch that was only
non-exhaustive while that type was unresolved. Fixes and additions:

- `prebuild` scripts in `apps/api` and `apps/web` build `packages/shared` first.
- Exhaustive `providerFactory` switch with a `never` default.
- `apps/api/api/index.js` serverless entry exporting the Express app from `dist/`; `apps/api/vercel.json`
  rewrites all paths to it, sets `maxDuration`, includes `drizzle/**`, and schedules the retention cron.
- `GET /api/jobs/retention` guarded by `CRON_SECRET`; `setInterval` retention still runs in Docker.
- `Storage` gained a Vercel Blob implementation, selected when `BLOB_READ_WRITE_TOKEN` is set.
- Pool size via `DB_POOL_MAX` (2 on Vercel), SSL enabled for Neon URLs. Default provider on Vercel is
  Anthropic. `apps/web/vercel.json` provides the SPA fallback and a same-origin `/api` rewrite to the API
  project.
- Dev DB host port is now `DB_PORT` (5433 locally, because an SSH tunnel occupies 5432 on this machine).
